import type { NotificationType, Settings } from '../../shared/types';
import { defaultClaudeHome } from '../providers/claude/claudeProvider';
import { checkRedactPatterns } from '../../shared/redactPatterns';

const TYPES: NotificationType[] = ['agent_new', 'subagent_new', 'task_start', 'task_end', 'error', 'blocked', 'session_lost', 'resources', 'cost', 'quota'];
const OS_DEFAULT = new Set<NotificationType>(['blocked', 'session_lost', 'cost', 'task_end', 'quota']);

export function defaultSettings(): Settings {
  return {
    claudeHome: defaultClaudeHome(),
    scanDays: 7,
    retentionDays: 30,
    notifications: Object.fromEntries(TYPES.map((t) => [t, { app: true, os: OS_DEFAULT.has(t) }])) as Settings['notifications'],
    costThresholdUSD: 5,
    cpuThresholdPct: 80,
    memThresholdMB: 2048,
    stuckMinutes: 10,
    quotaRefreshMin: 5,
    demoMode: false,
    redactPatterns: [],
    claudePath: 'claude',
    setupDone: false,
  };
}

/** Merges stored settings over defaults, ignoring unknown/invalid values. */
export function mergeSettings(stored: Partial<Settings> | undefined): Settings {
  const d = defaultSettings();
  if (!stored || typeof stored !== 'object') return d;
  const out: Settings = { ...d, ...stored, notifications: { ...d.notifications } };
  for (const t of TYPES) if (stored.notifications?.[t]) out.notifications[t] = { ...d.notifications[t], ...stored.notifications[t] };
  out.scanDays = clampNum(out.scanDays, 1, 365, d.scanDays);
  out.retentionDays = clampNum(out.retentionDays, 1, 3650, d.retentionDays);
  out.stuckMinutes = clampNum(out.stuckMinutes, 1, 600, d.stuckMinutes);
  out.quotaRefreshMin = clampNum(out.quotaRefreshMin, 0, 240, d.quotaRefreshMin);
  out.costThresholdUSD = clampNum(out.costThresholdUSD, 0, 100000, d.costThresholdUSD);
  out.cpuThresholdPct = clampNum(out.cpuThresholdPct, 1, 100, d.cpuThresholdPct);
  out.memThresholdMB = clampNum(out.memThresholdMB, 64, 1_000_000, d.memThresholdMB);
  out.redactPatterns = checkRedactPatterns(out.redactPatterns).ok; // R-19: unsafe patterns are dropped
  return out;
}

function clampNum(v: unknown, min: number, max: number, def: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}
