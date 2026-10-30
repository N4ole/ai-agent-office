import type { AgentEvent, AgentState, AppNotification, ControlAction, ControlCapabilities, ControlResult, Health, LaunchOptions, QuotaState, SetupCheck, Settings, Tagged } from '../shared/types';

export type UIAgent = AgentState & { progress?: Tagged<number>; todos?: { content: string; status: string }[] };
export interface ConsoleLine { ts: number; stream: 'out' | 'err' | 'in' | 'sys'; text: string }
export interface SessionRow { session_id: string; project: string; cwd: string; name: string; status: string; started_at: number; last_event_at: number; subagents: number }
export interface EventQuery { agentId?: string; agentIds?: string[]; kinds?: string[]; text?: string; errorsOnly?: boolean; before?: number; since?: number; limit?: number }

export interface OfficeApi {
  snapshot(): Promise<{ agents: UIAgent[]; notifications: AppNotification[]; settings: Settings }>;
  getEvents(q: EventQuery): Promise<AgentEvent[]>;
  getSessions(): Promise<SessionRow[]>;
  usageByDay(days: number): Promise<{ day: string; input: number; output: number }[]>;
  getConsole(agentId: string): Promise<ConsoleLine[]>;
  getSettings(): Promise<Settings>;
  setSettings(patch: Partial<Settings>): Promise<Settings>;
  capabilities(agentId: string): Promise<ControlCapabilities | null>;
  control(action: ControlAction): Promise<ControlResult>;
  launch(opts: LaunchOptions): Promise<ControlResult>;
  setupChecks(): Promise<SetupCheck[]>;
  health(): Promise<Health>;
  getQuota(): Promise<QuotaState | null>;
  refreshQuota(): Promise<QuotaState>;
  onQuota(cb: (q: QuotaState) => void): () => void;
  installHooks(): Promise<ControlResult>;
  uninstallHooks(): Promise<ControlResult>;
  exportData(payload?: { events?: unknown[]; name?: string }): Promise<ControlResult>;
  purge(days: number | 'all'): Promise<ControlResult>;
  markRead(): Promise<void>;
  pickFolder(): Promise<string | null>;
  updateAgentMeta(id: string, meta: { name?: string; role?: string; color?: string }): Promise<void>;
  onAgents(cb: (p: { agents: UIAgent[]; removed: string[] }) => void): () => void;
  onEvents(cb: (e: AgentEvent[]) => void): () => void;
  onNotification(cb: (n: AppNotification) => void): () => void;
  onConsole(cb: (p: { agentId: string; line: ConsoleLine }) => void): () => void;
  onLog(cb: (p: { level: string; msg: string; ts: number }) => void): () => void;
  onSelectAgent(cb: (id: string) => void): () => void;
}

declare global {
  interface Window { office: OfficeApi }
}

export const api: OfficeApi = window.office;
