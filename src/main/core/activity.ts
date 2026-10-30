import type { ActivityKind } from '../../shared/types';

const TEST_RE =
  /\b(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test|npx\s+(?:vitest|jest|playwright)|vitest|jest|pytest|py\.test|go\s+test|cargo\s+test|dotnet\s+test|mocha|playwright\s+test|phpunit|rspec|unittest|ctest|tox)\b|\b(?:mvn|gradle|gradlew)\b.*\btest\b/i;

export function isTestCommand(cmd: string): boolean {
  return TEST_RE.test(cmd || '');
}

export const READ_TOOLS = new Set(['Read', 'NotebookRead']);
export const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
export const SEARCH_TOOLS = new Set(['Grep', 'Glob', 'LS', 'ToolSearch']);
export const SHELL_TOOLS = new Set(['Bash', 'PowerShell', 'BashOutput']);
export const AGENT_TOOLS = new Set(['Agent', 'Task']);
export const WEB_TOOLS = new Set(['WebSearch', 'WebFetch']);

/** Maps a tool invocation to the visual activity of the character. */
export function activityForTool(tool: string, input?: Record<string, unknown>): ActivityKind {
  if (READ_TOOLS.has(tool)) return 'reading';
  if (WRITE_TOOLS.has(tool)) return 'coding';
  if (SEARCH_TOOLS.has(tool)) return 'searching';
  if (AGENT_TOOLS.has(tool)) return 'delegating';
  if (WEB_TOOLS.has(tool) || /chrome|browser|playwright/i.test(tool)) return 'browsing';
  if (SHELL_TOOLS.has(tool)) {
    const cmd = String(input?.command ?? '');
    return isTestCommand(cmd) ? 'testing' : 'command';
  }
  if (tool === 'TodoWrite' || tool.startsWith('Task')) return 'thinking';
  if (tool === 'AskUserQuestion' || tool === 'ExitPlanMode') return 'waiting';
  return 'command';
}

export const ACTIVITY_LABEL: Record<ActivityKind, string> = {
  thinking: 'Réflexion',
  coding: 'Programmation',
  reading: 'Lecture',
  searching: 'Recherche',
  testing: 'Tests',
  command: 'Commande',
  delegating: 'Délégation',
  browsing: 'Navigation web',
  waiting: 'En attente',
  idle: 'Inactif',
  error: 'Erreur',
  done: 'Terminé',
};
