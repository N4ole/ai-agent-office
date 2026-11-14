// Shared types between the main process (connectors, agent manager, DB) and the UI.

/** How trustworthy a piece of information is. Shown in the UI next to values. */
export type Provenance = 'observed' | 'inferred' | 'unavailable';

/** A value tagged with its provenance. `value` is null when unavailable. */
export interface Tagged<T> {
  value: T | null;
  source: Provenance;
  /** Short explanation of where the value came from (or why it is missing). */
  note?: string;
}

export type AgentKind = 'session' | 'subagent';

/**
 * High level status of an agent.
 * - working: currently doing something (tool running or model generating)
 * - waiting: blocked on the user (permission prompt / input needed)
 * - idle: alive but nothing to do (turn finished)
 * - done: finished (subagent completed or session ended cleanly)
 * - error: last observed action failed
 * - lost: process disappeared without a clean end (crash / killed)
 * - unknown: not enough information
 */
export type AgentStatus = 'working' | 'waiting' | 'idle' | 'done' | 'error' | 'lost' | 'unknown';

/** What the character should be doing visually. Derived from the last real event. */
export type ActivityKind =
  'thinking' | 'coding' | 'reading' | 'searching' | 'testing' | 'command' | 'delegating' | 'browsing' | 'waiting' | 'idle' | 'error' | 'done';

export type EventKind =
  | 'agent_detected'
  | 'session_start'
  | 'user_prompt'
  | 'assistant_text'
  | 'thinking'
  | 'tool_use'
  | 'tool_result'
  | 'tool_error'
  | 'subagent_spawn'
  | 'subagent_done'
  | 'turn_end'
  | 'status_change'
  | 'usage'
  | 'cost'
  | 'title'
  | 'notification'
  | 'session_end'
  | 'process_lost'
  | 'stdout'
  | 'system';

/** A normalized event, provider-agnostic. */
export interface AgentEvent {
  /** Stable id used for deduplication. */
  id: string;
  agentId: string;
  ts: number;
  kind: EventKind;
  /** One line human summary. Already redacted. */
  summary: string;
  /** Optional longer content (command output, text). Already redacted, truncated. */
  detail?: string;
  tool?: string;
  /** For tool_use / tool_result pairing. */
  toolUseId?: string;
  isError?: boolean;
  /** Where this event came from. */
  source: 'transcript' | 'registry' | 'hook' | 'managed' | 'process' | 'demo' | 'app';
  /** Extra structured data (file path, command, tokens...). */
  data?: Record<string, unknown>;
}

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

export interface QuotaWindow {
  /** five_hour, seven_day, seven_day_<model>… */
  id: string;
  label: string;
  /** Percentage of the window already used (0-100). */
  usedPct: number;
  resetsAt: number | null;
  /** Reset time exactly as printed by Claude Code, kept for display. */
  resetsText?: string;
  status?: string;
}

export interface QuotaState {
  plan: 'subscription' | 'api' | 'unknown';
  windows: QuotaWindow[];
  fetchedAt: number;
  source: 'usage-command' | 'rate-limit-event';
  overage?: string;
  error?: string;
}

export interface ModelCost {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  usd: number | null;
  calls: number;
}

export interface TaskRecord {
  id: string;
  title: string;
  startedAt: number;
  endedAt?: number;
  status: 'running' | 'done' | 'error';
}

export interface AgentState {
  id: string;
  provider: 'claude-code' | 'demo';
  kind: AgentKind;
  sessionId: string;
  /** Subagent id (for kind=subagent). */
  subagentId?: string;
  parentId?: string;
  name: string;
  role: string;
  project: string;
  cwd: string;
  transcriptPath?: string;
  /** Visual identity, stable across restarts. */
  color: string;
  avatarSeed: number;
  desk: number;

  status: AgentStatus;
  statusSource: Provenance;
  statusNote?: string;
  activity: ActivityKind;
  currentTask: Tagged<string>;
  lastAction: Tagged<string>;
  lastTool: Tagged<string>;
  model: Tagged<string>;
  startedAt: number;
  lastEventAt: number;
  endedAt?: number;

  tasks: TaskRecord[];
  filesRead: string[];
  filesModified: string[];
  commands: { cmd: string; ts: number; isError?: boolean; isTest?: boolean }[];
  testRuns: { cmd: string; ts: number; passed: boolean | null }[];
  errors: { ts: number; message: string; tool?: string }[];
  actionCount: number;

  tokens: Tagged<TokenUsage>;
  cost: Tagged<number>;
  /** Cost computed from tokens × public price of each model (always 'inferred'). */
  estimatedCost?: Tagged<number>;
  /** Per-model breakdown of tokens and estimated cost. */
  costByModel?: Record<string, ModelCost>;
  pid: Tagged<number>;
  cpu: Tagged<number>;
  memoryMB: Tagged<number>;

  /** True when this app launched and controls the process. */
  managed: boolean;
  /** Whether the session process is known to be alive. */
  alive: Tagged<boolean>;
  /** Raw status reported by the Claude Code session registry (busy/idle/...). */
  registryStatus?: string;
  entrypoint?: string;
  gitBranch?: string;
  demo?: boolean;
}

export type NotificationLevel = 'info' | 'success' | 'warning' | 'error';
export type NotificationType = 'agent_new' | 'subagent_new' | 'task_start' | 'task_end' | 'error' | 'blocked' | 'session_lost' | 'resources' | 'cost' | 'quota';

export interface AppNotification {
  id: string;
  ts: number;
  type: NotificationType;
  level: NotificationLevel;
  title: string;
  body: string;
  agentId?: string;
  read?: boolean;
}

export interface Settings {
  claudeHome: string;
  /** Load transcripts modified within this many days at startup. */
  scanDays: number;
  retentionDays: number;
  notifications: Record<NotificationType, { app: boolean; os: boolean }>;
  costThresholdUSD: number;
  cpuThresholdPct: number;
  memThresholdMB: number;
  /** Minutes without activity before a busy agent is flagged as possibly blocked. */
  stuckMinutes: number;
  /** Minutes between two quota checks (/usage, free). 0 = manual only. */
  quotaRefreshMin: number;
  demoMode: boolean;
  redactPatterns: string[];
  claudePath: string;
  setupDone: boolean;
}

export interface LaunchOptions {
  cwd: string;
  prompt?: string;
  model?: string;
  permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';
  resumeSessionId?: string;
  name?: string;
}

/** Control capabilities available for a given agent, computed honestly. */
export interface ControlCapabilities {
  sendInstruction: boolean;
  interrupt: boolean;
  pause: false;
  stop: boolean;
  resume: boolean;
  openTerminal: boolean;
  openFolder: boolean;
  reasons: Record<string, string>;
}

export interface SetupCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
}

export interface Snapshot {
  agents: AgentState[];
  notifications: AppNotification[];
  settings: Settings;
}

export const IPC = {
  snapshot: 'office:snapshot',
  agentsPatch: 'office:agents-patch',
  events: 'office:events',
  notification: 'office:notification',
  getEvents: 'office:get-events',
  searchEvents: 'office:search-events',
  getSessions: 'office:get-sessions',
  getSettings: 'office:get-settings',
  setSettings: 'office:set-settings',
  control: 'office:control',
  capabilities: 'office:capabilities',
  launch: 'office:launch',
  setupChecks: 'office:setup-checks',
  installHooks: 'office:install-hooks',
  uninstallHooks: 'office:uninstall-hooks',
  exportData: 'office:export',
  purge: 'office:purge',
  markRead: 'office:mark-read',
  pickFolder: 'office:pick-folder',
  updateAgentMeta: 'office:update-agent-meta',
  console: 'office:console',
  getConsole: 'office:get-console',
  usageByDay: 'office:usage-by-day',
  log: 'office:log',
  health: 'office:health',
  quota: 'office:quota',
  getQuota: 'office:get-quota',
  refreshQuota: 'office:refresh-quota',
} as const;

export interface Health {
  claudeHomeFound: boolean;
  watchedFiles: number;
  liveSessions: number;
  managedRunning: number;
  hooks: boolean;
  dbEvents: number;
  demo: boolean;
}

export type ControlAction =
  | { type: 'send'; agentId: string; text: string }
  | { type: 'interrupt'; agentId: string }
  | { type: 'stop'; agentId: string }
  | { type: 'resume'; agentId: string }
  | { type: 'openTerminal'; agentId: string }
  | { type: 'openFolder'; agentId: string }
  | { type: 'resumeInTerminal'; agentId: string };

export interface ControlResult {
  ok: boolean;
  message: string;
}
