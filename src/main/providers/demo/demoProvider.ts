// DEMO MODE ONLY. Generates fictional agents so the office can be explored without Claude Code.
// Every agent and event is flagged demo=true / source='demo', shown with a "DÉMO" badge,
// never persisted, and removed as soon as demo mode is turned off.

import type { AgentEvent, AgentState, ControlCapabilities, ControlResult } from '../../../shared/types';
import type { AgentProvider, ProviderSink } from '../provider';

const NAMES = ['Ada', 'Linus', 'Grace', 'Alan', 'Margaret', 'Ken'];
const TOOLS: [string, string, Record<string, unknown>][] = [
  ['Read', 'Lit src/app.ts', { file: 'src/app.ts' }],
  ['Edit', 'Modifie src/app.ts', { file: 'src/app.ts' }],
  ['Grep', 'Cherche "TODO"', {}],
  ['Bash', '$ npm test', { command: 'npm test', isTest: true }],
  ['Bash', '$ git status', { command: 'git status' }],
  ['WebSearch', 'Recherche web "pixel art"', {}],
];

export class DemoProvider implements AgentProvider {
  readonly id = 'demo';
  private sink!: ProviderSink;
  private timer: NodeJS.Timeout | null = null;
  private n = 0;

  async start(sink: ProviderSink): Promise<void> {
    this.sink = sink;
    for (let i = 0; i < 4; i++) this.spawn(i);
    this.timer = setInterval(() => this.step(), 1800);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
  }

  private spawn(i: number, parentId?: string) {
    const id = `demo:${i}:${Date.now()}:${this.n++}`;
    this.sink.upsertAgent(
      {
        id,
        provider: 'demo',
        kind: parentId ? 'subagent' : 'session',
        sessionId: id,
        parentId,
        name: `${NAMES[i % NAMES.length]} (démo)`,
        role: parentId ? 'Explore (démo)' : 'Agent principal (démo)',
        project: 'projet-demo',
        cwd: '',
        startedAt: Date.now(),
        demo: true,
      },
      true,
    );
    this.emit(id, 'user_prompt', 'Tâche fictive de démonstration');
  }

  private emit(agentId: string, kind: AgentEvent['kind'], summary: string, extra: Partial<AgentEvent> = {}) {
    this.sink.events([{ id: `demo-ev:${++this.n}`, agentId, ts: Date.now(), kind, summary, source: 'demo', ...extra }], true);
  }

  private step() {
    const agents = this.sink.allAgents().filter((a) => a.demo);
    for (const a of agents) {
      const r = Math.random();
      if (a.status === 'done') continue;
      if (a.kind === 'subagent' && r < 0.08) this.emit(a.id, 'subagent_done', 'Sous-agent de démo terminé');
      else if (r < 0.05) this.emit(a.id, 'turn_end', 'Tour de démo terminé');
      else if (r < 0.25 && a.status === 'idle') this.emit(a.id, 'user_prompt', 'Nouvelle tâche fictive');
      else if (r < 0.13) this.emit(a.id, 'tool_error', 'Erreur : échec fictif', { isError: true, toolUseId: 'x' });
      else if (r < 0.16 && a.kind === 'session' && agents.length < 9) {
        this.emit(a.id, 'subagent_spawn', 'Délègue à Explore (démo)', { tool: 'Agent', toolUseId: `t${this.n}` });
        this.spawn(Math.floor(Math.random() * 6), a.id);
      } else if (a.status !== 'idle') {
        const [tool, summary, data] = TOOLS[Math.floor(Math.random() * TOOLS.length)];
        const tid = `t${this.n}`;
        this.emit(a.id, 'tool_use', summary, { tool, toolUseId: tid, data });
        setTimeout(() => this.emit(a.id, 'tool_result', 'ok', { toolUseId: tid }), 900);
      }
    }
  }

  capabilities(_a: AgentState): ControlCapabilities {
    const why = 'Agent fictif (mode démo) : aucune commande réelle.';
    return {
      sendInstruction: false, interrupt: false, pause: false, stop: false, resume: false, openTerminal: false, openFolder: false,
      reasons: { sendInstruction: why, interrupt: why, pause: why, stop: why, resume: why, openTerminal: why, openFolder: why },
    };
  }

  async control(): Promise<ControlResult> {
    return { ok: false, message: 'Mode démo : aucune commande réelle n’est exécutée.' };
  }
}
