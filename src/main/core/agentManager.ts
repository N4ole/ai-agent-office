// Central registry of agents. Implements ProviderSink: providers push identities and events,
// the manager deduplicates (through the DB), reduces state, raises notifications and batches
// updates to the UI.

import type { AgentEvent, AgentState, AppNotification, NotificationLevel, NotificationType, Settings } from '../../shared/types';
import type { ConsoleLine, ProviderSink } from '../providers/provider';
import { createAgent, reduce, type AgentIdentity, type InternalAgent } from './reducer';
import type { OfficeDB } from '../db/database';

export interface ManagerOutput {
  agentsChanged(agents: AgentState[], removed: string[]): void;
  liveEvents(events: AgentEvent[]): void;
  notification(n: AppNotification, os: boolean): void;
  console(agentId: string, line: ConsoleLine): void;
  log(level: string, msg: string): void;
}

/** Done agents keep their desk for this long, then leave the office (history stays). */
export const DESK_RELEASE_MS = 10 * 60_000;

export class AgentManager implements ProviderSink {
  readonly agents = new Map<string, InternalAgent>();
  private changed = new Set<string>();
  private pendingLive: AgentEvent[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private consoles = new Map<string, ConsoleLine[]>();
  private lastErrorNotif = new Map<string, number>();
  private stuckNotified = new Set<string>();
  private costNotified = new Set<string>();
  private resourceNotified = new Map<string, number>();
  private globalCostNotifiedAt = 0;
  private nid = 0;
  /** Agents seen again after a purge but with no new activity yet (identity + pending patch). */
  private deferred = new Map<string, { idn: AgentIdentity; patch: Partial<AgentState> }>();

  constructor(
    private db: OfficeDB | null,
    private out: ManagerOutput,
    private settings: () => Settings,
  ) {}

  /** Restores agents persisted by a previous run. */
  restore(agents: InternalAgent[]): void {
    for (const a of agents) {
      // A restored agent's process liveness must be re-observed; never trust stale values.
      a.alive = { value: null, source: 'unavailable', note: 'À revérifier après redémarrage de l’app' };
      a.cpu = { value: null, source: 'unavailable' };
      a.memoryMB = { value: null, source: 'unavailable' };
      a.managed = false;
      a.pending = a.pending ?? {};
      this.agents.set(a.id, a);
    }
  }

  // ---------- ProviderSink ----------

  upsertAgent(idn: AgentIdentity, live: boolean): boolean {
    const existing = this.agents.get(idn.id);
    if (existing) {
      let touched = false;
      const set = <K extends keyof InternalAgent>(k: K, v: InternalAgent[K]) => {
        if (v !== undefined && v !== '' && existing[k] !== v) {
          existing[k] = v;
          touched = true;
        }
      };
      if (!existing.cwd) set('cwd', idn.cwd);
      if (!existing.project || existing.project === '?') set('project', idn.project);
      if (existing.name.startsWith('Session ') && !idn.name.startsWith('Session ')) set('name', idn.name);
      if (idn.managed) set('managed', true);
      if (idn.parentId && !existing.parentId) set('parentId', idn.parentId);
      if (existing.desk < 0 && existing.status !== 'done' && existing.status !== 'lost') {
        existing.desk = this.freeDesk();
        touched = true;
      }
      if (touched) this.touch(existing);
      return false;
    }
    const cutoff = this.historyCutoff();
    if (cutoff && (idn.startedAt || 0) < cutoff) {
      // Started before a purge: only comes back if it shows new activity (R-01).
      const prev = this.deferred.get(idn.id);
      this.deferred.set(idn.id, { idn: { ...prev?.idn, ...idn }, patch: prev?.patch ?? {} });
      return false;
    }
    this.create(idn, live);
    return true;
  }

  private historyCutoff(): number {
    return this.db?.historyCutoff ?? 0;
  }

  private create(idn: AgentIdentity, live: boolean): InternalAgent {
    const a = createAgent(idn, this.freeDesk());
    this.agents.set(a.id, a);
    this.deferred.delete(a.id);
    this.touch(a);
    const ev: AgentEvent = {
      id: `detected:${a.id}`,
      agentId: a.id,
      ts: Math.max(idn.startedAt || Date.now(), this.historyCutoff()),
      kind: 'agent_detected',
      summary: a.kind === 'subagent' ? `Sous-agent détecté (${a.role})` : `Agent détecté dans ${a.project}`,
      source: 'app',
      data: { parentId: a.parentId },
    };
    this.events([ev], live);
    if (live) {
      if (a.kind === 'subagent') {
        const parent = a.parentId ? this.agents.get(a.parentId) : undefined;
        this.notify('subagent_new', 'info', 'Nouveau sous-agent', `${a.name} (${a.role}) créé par ${parent?.name ?? 'son agent parent'}`, a.id);
      } else this.notify('agent_new', 'info', 'Nouvel agent', `${a.name} a rejoint le bureau (${a.project})`, a.id);
    }
    return a;
  }

  patchAgent(id: string, patch: Partial<AgentState>): void {
    const a = this.agents.get(id);
    if (!a) {
      const d = this.deferred.get(id);
      if (d) Object.assign(d.patch, patch);
      return;
    }
    let diff = false;
    for (const [k, v] of Object.entries(patch)) {
      const cur = (a as any)[k];
      if (JSON.stringify(cur) !== JSON.stringify(v)) {
        (a as any)[k] = v;
        diff = true;
      }
    }
    if (diff) this.touch(a);
  }

  events(evts: AgentEvent[], live: boolean): void {
    const cutoff = this.historyCutoff();
    if (cutoff) evts = evts.filter((e) => e.ts >= cutoff || e.source === 'demo');
    if (!evts.length) return;
    // New activity of an agent that started before a purge: bring it back now.
    for (const ev of evts) {
      const d = this.deferred.get(ev.agentId);
      if (!d || this.agents.has(ev.agentId)) continue;
      this.create(d.idn, live);
      this.patchAgent(ev.agentId, d.patch);
    }
    const fresh = this.db ? this.db.insertEvents(evts) : evts;
    for (const ev of fresh) {
      const a = this.agents.get(ev.agentId);
      if (!a) continue;
      const before = { status: a.status, cost: a.cost.value };
      reduce(a, ev, live);
      this.touch(a);
      if (live) {
        this.pendingLive.push(ev);
        this.deriveNotifications(a, ev, before);
      }
    }
    this.scheduleFlush();
  }

  getAgent(id: string): AgentState | undefined {
    return this.agents.get(id);
  }

  allAgents(): AgentState[] {
    return [...this.agents.values()];
  }

  console(agentId: string, line: ConsoleLine): void {
    let buf = this.consoles.get(agentId);
    if (!buf) this.consoles.set(agentId, (buf = []));
    buf.push(line);
    if (buf.length > 3000) buf.splice(0, buf.length - 3000);
    this.out.console(agentId, line);
  }

  getConsole(agentId: string): ConsoleLine[] {
    return this.consoles.get(agentId) ?? [];
  }

  log(level: 'info' | 'warn' | 'error', msg: string): void {
    this.out.log(level, msg);
  }

  // ---------- internals ----------

  private freeDesk(): number {
    const used = new Set<number>();
    for (const a of this.agents.values()) if (a.desk >= 0) used.add(a.desk);
    let i = 0;
    while (used.has(i)) i++;
    return i;
  }

  private touch(a: InternalAgent) {
    this.changed.add(a.id);
    this.scheduleFlush();
  }

  private scheduleFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => this.flush(), 120);
  }

  flush(): void {
    this.flushTimer = null;
    if (this.changed.size) {
      const list: AgentState[] = [];
      const removed: string[] = [];
      for (const id of this.changed) {
        const a = this.agents.get(id);
        if (!a) {
          removed.push(id);
          continue;
        }
        this.db?.saveAgent(a);
        list.push(a);
      }
      this.changed.clear();
      this.out.agentsChanged(list, removed);
    }
    if (this.pendingLive.length) {
      const evs = this.pendingLive.filter((e) => e.kind !== 'usage' && e.kind !== 'cost' && e.kind !== 'thinking');
      this.pendingLive = [];
      if (evs.length) this.out.liveEvents(evs.slice(-500));
    }
  }

  notify(type: NotificationType, level: NotificationLevel, title: string, body: string, agentId?: string): AppNotification | null {
    const pref = this.settings().notifications[type] ?? { app: true, os: false };
    const n: AppNotification = { id: `n${Date.now()}-${++this.nid}`, ts: Date.now(), type, level, title, body, agentId };
    this.db?.saveNotification(n);
    if (pref.app || pref.os) this.out.notification(n, pref.os);
    return n;
  }

  private deriveNotifications(a: InternalAgent, ev: AgentEvent, before: { status: string; cost: number | null }) {
    switch (ev.kind) {
      case 'user_prompt':
        this.notify('task_start', 'info', `${a.name} commence une tâche`, ev.summary, a.id);
        this.stuckNotified.delete(a.id);
        break;
      case 'turn_end':
        this.notify('task_end', 'success', `${a.name} a terminé`, a.currentTask.value ?? 'Tour terminé', a.id);
        break;
      case 'subagent_done':
        this.notify('task_end', 'success', `Sous-agent terminé`, `${a.name} (${a.role})`, a.id);
        break;
      case 'tool_error': {
        const last = this.lastErrorNotif.get(a.id) ?? 0;
        if (Date.now() - last > 60_000) {
          this.lastErrorNotif.set(a.id, Date.now());
          this.notify('error', 'error', `Erreur chez ${a.name}`, ev.summary, a.id);
        }
        break;
      }
      case 'process_lost':
        this.notify('session_lost', 'error', `Session interrompue : ${a.name}`, ev.summary, a.id);
        break;
      case 'notification':
        if ((ev.data as any)?.waiting) this.notify('blocked', 'warning', `${a.name} attend votre intervention`, ev.summary, a.id);
        break;
      case 'status_change':
        if (a.status === 'waiting' && before.status !== 'waiting') this.notify('blocked', 'warning', `${a.name} attend votre intervention`, ev.summary, a.id);
        break;
      case 'usage': {
        // Without a cost-state record yet, alert on the estimate (clearly labelled).
        const th = this.settings().costThresholdUSD;
        const est = a.estimatedCost?.value ?? 0;
        if (th > 0 && a.cost.source !== 'observed' && est >= th && !this.costNotified.has(a.id)) {
          this.costNotified.add(a.id);
          this.notify('cost', 'warning', 'Seuil de coût dépassé (estimation)', `${a.name} : environ ${est.toFixed(2)} $ au tarif API (seuil ${th} $)`, a.id);
        }
        break;
      }
      case 'cost': {
        const th = this.settings().costThresholdUSD;
        if (th > 0 && (a.cost.value ?? 0) >= th && !this.costNotified.has(a.id)) {
          this.costNotified.add(a.id);
          this.notify('cost', 'warning', 'Seuil de coût dépassé', `${a.name} : ${(a.cost.value ?? 0).toFixed(2)} $ (seuil ${th} $)`, a.id);
        }
        const total = this.totalCostToday();
        if (th > 0 && total >= th * 5 && Date.now() - this.globalCostNotifiedAt > 3_600_000) {
          this.globalCostNotifiedAt = Date.now();
          this.notify('cost', 'warning', 'Coût total élevé', `Sessions actives aujourd’hui : ${total.toFixed(2)} $`);
        }
        break;
      }
    }
  }

  totalCostToday(): number {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    let t = 0;
    for (const a of this.agents.values()) {
      if (a.lastEventAt < start.getTime()) continue;
      // The estimate covers sub-agents and stays current; fall back to Claude Code's record otherwise.
      if (a.estimatedCost?.value != null) t += a.estimatedCost.value;
      else if (a.kind === 'session' && a.cost.source === 'observed') t += a.cost.value ?? 0;
    }
    return t;
  }

  /** Periodic checks: possibly-stuck agents, desk release. Call every ~30 s. */
  housekeeping(now = Date.now()): void {
    const s = this.settings();
    for (const a of this.agents.values()) {
      if (a.status === 'working' && now - a.lastEventAt > s.stuckMinutes * 60_000) {
        if (!this.stuckNotified.has(a.id)) {
          this.stuckNotified.add(a.id);
          a.statusNote = `Aucun événement depuis ${Math.round((now - a.lastEventAt) / 60000)} min : possiblement bloqué (déduction)`;
          this.touch(a);
          this.notify('blocked', 'warning', `${a.name} semble bloqué`, a.statusNote, a.id);
        }
      } else if (a.status !== 'working') this.stuckNotified.delete(a.id);
      if ((a.status === 'done' || a.status === 'lost') && a.desk >= 0 && now - (a.endedAt ?? a.lastEventAt) > DESK_RELEASE_MS) {
        a.desk = -1;
        this.consoles.delete(a.id); // left the office: free its console buffer (R-16)
        this.touch(a);
      }
    }
  }

  /** Applies a CPU / memory sample (observed through the OS) and raises resource alerts. */
  applyResources(samples: Map<number, { cpu: number | null; memMB: number }>): void {
    const s = this.settings();
    for (const a of this.agents.values()) {
      const pid = a.pid.value;
      if (pid == null || a.alive.value !== true) continue;
      const smp = samples.get(pid);
      if (!smp) continue;
      this.patchAgent(a.id, {
        cpu:
          smp.cpu == null
            ? { value: null, source: 'unavailable', note: 'Premier échantillon en cours' }
            : { value: Math.round(smp.cpu * 10) / 10, source: 'observed', note: `Processus ${pid}` },
        memoryMB: { value: Math.round(smp.memMB), source: 'observed', note: `Mémoire de travail du processus ${pid}` },
      });
      const high = (smp.cpu ?? 0) > s.cpuThresholdPct || smp.memMB > s.memThresholdMB;
      const last = this.resourceNotified.get(a.id) ?? 0;
      if (high && Date.now() - last > 10 * 60_000) {
        this.resourceNotified.set(a.id, Date.now());
        this.notify('resources', 'warning', `Ressources élevées : ${a.name}`, `CPU ${smp.cpu?.toFixed(0) ?? '?'} %, RAM ${Math.round(smp.memMB)} Mo`, a.id);
      }
    }
  }

  updateMeta(id: string, meta: { name?: string; role?: string; color?: string }): void {
    const a = this.agents.get(id);
    if (!a) return;
    if (meta.name?.trim()) a.name = meta.name.trim().slice(0, 60);
    if (meta.role?.trim()) a.role = meta.role.trim().slice(0, 60);
    if (meta.color && /^#[0-9a-f]{6}$/i.test(meta.color)) a.color = meta.color;
    this.touch(a);
  }

  /** Removes an agent from memory and tells the UI (history in the DB is handled by the caller). */
  private forget(id: string): void {
    this.agents.delete(id);
    this.deferred.delete(id);
    this.consoles.delete(id);
    this.lastErrorNotif.delete(id);
    this.stuckNotified.delete(id);
    this.costNotified.delete(id);
    this.resourceNotified.delete(id);
    this.changed.add(id);
    this.scheduleFlush();
  }

  /** "Delete all history": every real agent leaves the office. Returns how many were removed. */
  clearHistory(): number {
    let n = 0;
    for (const [id, a] of this.agents) {
      if (a.demo) continue;
      this.forget(id);
      n++;
    }
    this.deferred.clear();
    this.pendingLive = this.pendingLive.filter((e) => e.source === 'demo');
    return n;
  }

  /** "Purge older than": removes agents with no activity since `before` and no running process. */
  purgeBefore(before: number): number {
    let n = 0;
    for (const [id, a] of this.agents) {
      if (a.demo || a.alive.value === true || a.lastEventAt >= before) continue;
      this.forget(id);
      n++;
    }
    return n;
  }

  removeDemoAgents(): void {
    for (const [id, a] of this.agents)
      if (a.demo) {
        this.agents.delete(id);
        this.changed.add(id);
      }
  }
}
