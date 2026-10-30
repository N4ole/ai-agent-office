// Contract every agent provider implements. The Claude Code provider is the only real one today;
// the demo provider implements the same contract with clearly-flagged fake data.

import type { AgentEvent, AgentState, ControlAction, ControlCapabilities, ControlResult, LaunchOptions } from '../../shared/types';
import type { AgentIdentity } from '../core/reducer';

export interface ProviderSink {
  /** Registers (or updates identity of) an agent. Returns true if the agent is new. */
  upsertAgent(identity: AgentIdentity, live: boolean): boolean;
  /** Direct patch for values not carried by events (pid, alive flag, registry status...). */
  patchAgent(id: string, patch: Partial<AgentState>): void;
  /** Feeds normalized events. `live` false while replaying history. */
  events(events: AgentEvent[], live: boolean): void;
  getAgent(id: string): AgentState | undefined;
  allAgents(): AgentState[];
  /** Raw console output of a process controlled by the app (not persisted to the DB). */
  console(agentId: string, line: ConsoleLine): void;
  log(level: 'info' | 'warn' | 'error', msg: string): void;
}

export interface ConsoleLine {
  ts: number;
  stream: 'out' | 'err' | 'in' | 'sys';
  text: string;
}

export interface AgentProvider {
  readonly id: string;
  start(sink: ProviderSink): Promise<void>;
  stop(): Promise<void>;
  capabilities(agent: AgentState): ControlCapabilities;
  control(action: ControlAction, agent: AgentState): Promise<ControlResult>;
  launch?(opts: LaunchOptions): Promise<ControlResult>;
}
