// Pure state machine: (agent state, event) -> new agent state.
// Every status change records whether it was observed or inferred.

import type { ActivityKind, AgentEvent, AgentState, AgentStatus, Provenance, Tagged, TokenUsage } from '../../shared/types';
import { activityForTool } from './activity';
import { modelLabel, normalizeModel, priceUsage } from '../../shared/pricing';

export interface PendingTool {
  tool: string;
  command?: string;
  isTest?: boolean;
  file?: string;
}

/** Agent state plus bookkeeping that the UI does not need but persists with the agent. */
export interface InternalAgent extends AgentState {
  pending: Record<string, PendingTool>;
  /** Todo list progress, when the agent uses TodoWrite. */
  todos?: { content: string; status: string }[];
}

const MAX_LIST = 200;

export function unavailable<T>(note: string): Tagged<T> {
  return { value: null, source: 'unavailable', note };
}
export function observed<T>(value: T, note?: string): Tagged<T> {
  return { value, source: 'observed', note };
}
export function inferred<T>(value: T, note?: string): Tagged<T> {
  return { value, source: 'inferred', note };
}

export const PALETTE = ['#e8590c', '#1c7ed6', '#2f9e44', '#ae3ec9', '#f08c00', '#0ca678', '#d6336c', '#4263eb', '#868e96', '#a61e4d', '#5f3dc4', '#099268'];

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface AgentIdentity {
  id: string;
  provider: AgentState['provider'];
  kind: AgentState['kind'];
  sessionId: string;
  subagentId?: string;
  parentId?: string;
  name: string;
  role: string;
  project: string;
  cwd: string;
  transcriptPath?: string;
  startedAt: number;
  managed?: boolean;
  demo?: boolean;
}

export function createAgent(idn: AgentIdentity, desk: number): InternalAgent {
  const seed = hashString(idn.id);
  return {
    ...idn,
    managed: !!idn.managed,
    color: PALETTE[seed % PALETTE.length],
    avatarSeed: seed,
    desk,
    status: 'unknown',
    statusSource: 'unavailable',
    activity: 'idle',
    currentTask: unavailable('Aucune tâche observée pour le moment'),
    lastAction: unavailable('Aucune action observée'),
    lastTool: unavailable('Aucun outil utilisé'),
    model: unavailable('Modèle non encore observé'),
    lastEventAt: idn.startedAt,
    tasks: [],
    filesRead: [],
    filesModified: [],
    commands: [],
    testRuns: [],
    errors: [],
    actionCount: 0,
    tokens: unavailable('Aucune donnée d’usage observée'),
    cost:
      idn.kind === 'subagent'
        ? unavailable('Claude Code ne publie le coût qu’au niveau de la session : inclus dans la session parente')
        : unavailable('Aucun relevé de coût (cost-state) observé'),
    pid: unavailable('PID inconnu (session absente du registre Claude Code)'),
    cpu: unavailable('Processus non identifié'),
    memoryMB: unavailable('Processus non identifié'),
    alive: unavailable('État du processus inconnu'),
    pending: {},
  };
}

function pushUnique(list: string[], v: string) {
  if (!v) return;
  const i = list.indexOf(v);
  if (i >= 0) list.splice(i, 1);
  list.unshift(v);
  if (list.length > MAX_LIST) list.length = MAX_LIST;
}

function capped<T>(list: T[], item: T) {
  list.unshift(item);
  if (list.length > MAX_LIST) list.length = MAX_LIST;
}

function setStatus(a: InternalAgent, s: AgentStatus, src: Provenance, note?: string) {
  a.status = s;
  a.statusSource = src;
  a.statusNote = note;
}

/** Maps the raw Claude Code registry status (busy/idle/...) to our status. */
export function mapRegistryStatus(s: string | undefined): AgentStatus {
  const v = (s ?? '').toLowerCase();
  if (v === 'busy' || v === 'running' || v === 'working') return 'working';
  if (v === 'idle' || v === 'ready') return 'idle';
  if (/wait|input|permission|block|approval/.test(v)) return 'waiting';
  return 'unknown';
}

/**
 * Status change caused by a transcript event. When the live session registry reports a status,
 * it is authoritative for working/idle (transcript lines can arrive slightly late); the transcript
 * still drives error overlays.
 */
function liveStatus(a: InternalAgent, ev: AgentEvent, s: AgentStatus, note?: string) {
  const regAuth = a.registryStatus !== undefined && a.alive.value === true && ev.source === 'transcript';
  if (regAuth && (s === 'working' || s === 'idle')) {
    const reg = mapRegistryStatus(a.registryStatus);
    if (reg !== 'unknown') {
      if (a.status !== reg) setStatus(a, reg, 'observed', 'Statut du registre Claude Code');
      if (reg === 'idle' && a.activity !== 'error') a.activity = 'idle';
      return;
    }
  }
  setStatus(a, s, 'observed', note);
}

function closeRunningTasks(a: InternalAgent, ts: number, status: 'done' | 'error') {
  for (const t of a.tasks)
    if (t.status === 'running') {
      t.status = status;
      t.endedAt = ts;
    }
}

/** Activity to show once no tool is pending. */
function settleActivity(a: InternalAgent): ActivityKind {
  const ids = Object.keys(a.pending);
  if (ids.length) {
    const p = a.pending[ids[ids.length - 1]];
    return activityForTool(p.tool, { command: p.command });
  }
  return 'thinking';
}

/** Is the event "live" (recent) or replayed history? Replayed events must not flip live status. */
export function isLive(ev: AgentEvent, now = Date.now(), windowMs = 120_000): boolean {
  return now - ev.ts < windowMs;
}

/**
 * Applies one event. Mutates and returns the same object (callers clone when needed).
 * `live` tells whether the event is happening now (vs replay of history at startup).
 */
export function reduce(a: InternalAgent, ev: AgentEvent, live: boolean): InternalAgent {
  // Bookkeeping records (title, cost) are not activity: they must not make an agent look recent.
  const activity = ev.kind !== 'title' && ev.kind !== 'cost' && ev.ts > 0;
  if (activity && ev.ts > a.lastEventAt) a.lastEventAt = ev.ts;
  if (activity && ev.ts < a.startedAt) a.startedAt = ev.ts;
  const d = (ev.data ?? {}) as Record<string, any>;

  switch (ev.kind) {
    case 'user_prompt': {
      closeRunningTasks(a, ev.ts, 'done');
      capped(a.tasks, { id: ev.id, title: ev.summary, startedAt: ev.ts, status: 'running' });
      a.currentTask = observed(ev.summary, a.kind === 'subagent' ? 'Consigne reçue de l’agent parent' : 'Dernière demande utilisateur');
      a.activity = 'thinking';
      if (live) liveStatus(a, ev, 'working', 'Demande reçue');
      break;
    }
    case 'thinking':
      a.activity = Object.keys(a.pending).length ? settleActivity(a) : 'thinking';
      if (live) liveStatus(a, ev, 'working');
      break;
    case 'assistant_text':
      a.lastAction = observed(ev.summary, 'Message de l’agent');
      if (!Object.keys(a.pending).length) a.activity = 'thinking';
      if (live) liveStatus(a, ev, 'working');
      break;
    case 'tool_use':
    case 'subagent_spawn': {
      const tool = ev.tool ?? 'outil';
      a.actionCount++;
      a.lastTool = observed(tool);
      a.lastAction = observed(ev.summary);
      a.pending[ev.toolUseId ?? ev.id] = { tool, command: d.command, isTest: d.isTest, file: d.file };
      a.activity = activityForTool(tool, { command: d.command });
      if (d.file) {
        if (tool === 'Read' || tool === 'NotebookRead') pushUnique(a.filesRead, d.file);
        else if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(tool)) pushUnique(a.filesModified, d.file);
      }
      if (d.command) capped(a.commands, { cmd: d.command, ts: ev.ts, isTest: !!d.isTest });
      if (Array.isArray(d.todos)) {
        a.todos = d.todos;
        const active = d.todos.find((t: any) => t.status === 'in_progress');
        if (active) a.currentTask = observed(active.content, 'Tâche « en cours » de sa liste TodoWrite');
      }
      if (live) liveStatus(a, ev, 'working', `Utilise ${tool}`);
      break;
    }
    case 'tool_result':
    case 'tool_error': {
      const key = ev.toolUseId ?? '';
      const p = a.pending[key];
      delete a.pending[key];
      const isErr = ev.kind === 'tool_error';
      if (p?.command) {
        const c = a.commands.find((x) => x.cmd === p.command && x.isError === undefined);
        if (c) c.isError = isErr;
        if (p.isTest) capped(a.testRuns, { cmd: p.command, ts: ev.ts, passed: !isErr });
      }
      if (isErr) {
        capped(a.errors, { ts: ev.ts, message: ev.summary, tool: p?.tool });
        a.activity = 'error';
        if (live) setStatus(a, 'error', 'observed', 'Le dernier outil a renvoyé une erreur');
      } else {
        a.activity = settleActivity(a);
        if (live && a.status === 'error') {
          setStatus(a, 'working', 'observed');
          liveStatus(a, ev, 'working');
        }
      }
      break;
    }
    case 'turn_end':
      closeRunningTasks(a, ev.ts, a.status === 'error' ? 'error' : 'done');
      a.pending = {};
      a.activity = a.kind === 'subagent' ? 'done' : 'idle';
      if (live) liveStatus(a, ev, 'idle', 'Tour terminé, attend une nouvelle demande');
      break;
    case 'usage': {
      const prev: TokenUsage = a.tokens.value ?? { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
      a.tokens = observed(
        {
          input: prev.input + (d.input ?? 0),
          output: prev.output + (d.output ?? 0),
          cacheRead: prev.cacheRead + (d.cacheRead ?? 0),
          cacheCreation: prev.cacheCreation + (d.cacheCreation ?? 0),
        },
        'Somme des champs usage des réponses API du transcript',
      );
      if (typeof d.model === 'string' && d.model && d.model !== '<synthetic>') a.model = observed(d.model);
      addUsageCost(a, d);
      break;
    }
    case 'cost':
      if (typeof d.totalCostUSD === 'number') {
        a.cost = observed(
          d.totalCostUSD,
          d.unknownModelCost ? 'Coût partiel : modèle au tarif inconnu de Claude Code' : 'Relevé cost-state écrit par Claude Code',
        );
      }
      break;
    case 'title':
      if (a.kind === 'session') {
        if (a.currentTask.source === 'unavailable') a.currentTask = observed(ev.summary, 'Titre de session généré par Claude Code');
        a.role = a.role || 'Agent principal';
        a.name = a.name.startsWith('Session ') ? ev.summary : a.name;
      }
      break;
    case 'subagent_done':
      closeRunningTasks(a, ev.ts, 'done');
      a.pending = {};
      a.activity = 'done';
      a.endedAt = a.endedAt ?? ev.ts;
      setStatus(a, 'done', 'observed', 'Sous-agent marqué « finished » par Claude Code');
      break;
    case 'session_end':
      closeRunningTasks(a, ev.ts, 'done');
      a.pending = {};
      a.activity = 'done';
      a.endedAt = ev.ts;
      a.alive = observed(false);
      setStatus(a, 'done', (d.provenance as Provenance) ?? 'observed', ev.summary);
      break;
    case 'process_lost':
      a.pending = {};
      a.activity = 'error';
      a.endedAt = ev.ts;
      a.alive = observed(false, 'Processus introuvable');
      setStatus(a, 'lost', 'observed', ev.summary);
      break;
    case 'notification':
      if (d.waiting) {
        a.activity = 'waiting';
        setStatus(a, 'waiting', 'observed', ev.summary);
      }
      break;
    case 'status_change':
      if (d.status) {
        setStatus(a, d.status as AgentStatus, (d.provenance as Provenance) ?? 'observed', ev.summary);
        if (d.status === 'idle') {
          a.activity = 'idle';
          a.pending = {};
        }
        if (d.status === 'waiting') a.activity = 'waiting';
        if (d.status === 'working' && (a.activity === 'idle' || a.activity === 'done')) a.activity = 'thinking';
      }
      break;
    default:
      break;
  }
  return a;
}

/**
 * Adds one API response's usage to the per-model breakdown and to the estimated cost
 * (tokens × public price of the model). Exported so the history can be re-priced from stored events.
 */
export function addUsageCost(a: AgentState, d: Record<string, any>): void {
  const model = typeof d.model === 'string' ? d.model : '';
  if (!model || model === '<synthetic>') return;
  const total = (d.input ?? 0) + (d.output ?? 0) + (d.cacheRead ?? 0) + (d.cacheCreation ?? 0);
  if (!total) return;
  // Older records have no TTL split: count every cache write at the 5-minute rate.
  const w1 = Number(d.cacheWrite1h ?? 0);
  const w5 = d.cacheWrite5m !== undefined ? Number(d.cacheWrite5m) : Number(d.cacheCreation ?? 0) - w1;
  const usd = priceUsage(model, { input: d.input ?? 0, output: d.output ?? 0, cacheRead: d.cacheRead ?? 0, cacheWrite5m: Math.max(0, w5), cacheWrite1h: w1 });
  const key = normalizeModel(model) ?? model;
  const by = (a.costByModel ??= {});
  const m = (by[key] ??= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, usd: 0, calls: 0 });
  m.input += d.input ?? 0;
  m.output += d.output ?? 0;
  m.cacheRead += d.cacheRead ?? 0;
  m.cacheWrite += d.cacheCreation ?? 0;
  m.calls += 1;
  m.usd = usd === null || m.usd === null ? null : m.usd + usd;
  const priced = Object.entries(by).filter(([, v]) => v.usd !== null);
  const unpriced = Object.keys(by).filter((k) => by[k].usd === null);
  const sum = priced.reduce((n, [, v]) => n + (v.usd ?? 0), 0);
  const models = priced.map(([k]) => modelLabel(k)).join(', ');
  a.estimatedCost = priced.length
    ? inferred(sum, `Tokens × tarif API public (${models})${unpriced.length ? ` · tarif inconnu pour ${unpriced.join(', ')} : non compté` : ''}`)
    : unavailable(`Tarif inconnu pour ${unpriced.join(', ')}`);
}

/** Progress, only when it is measurable (todo list). */
export function progressOf(a: InternalAgent): Tagged<number> {
  if (a.todos && a.todos.length) {
    const done = a.todos.filter((t) => t.status === 'completed').length;
    return observed(done / a.todos.length, `${done}/${a.todos.length} éléments de sa liste de tâches`);
  }
  return unavailable('Progression non mesurable : l’agent n’utilise pas de liste de tâches');
}
