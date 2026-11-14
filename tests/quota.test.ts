import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseResetText, parseUsageText, windowsFromRateLimit } from '../src/main/providers/claude/quota';
import { ClaudeProvider } from '../src/main/providers/claude/claudeProvider';
import { AgentManager } from '../src/main/core/agentManager';
import { mergeSettings } from '../src/main/core/settings';

// Exact text printed by Claude Code 2.1.314 for `/usage` (subscription).
const REAL = `You are currently using your subscription to power your Claude Code usage

Current session: 57% used · resets Oct 30, 3:39pm (Europe/Paris)
Current week (all models): 60% used · resets Nov 3, 9:59pm (Europe/Paris)

What's contributing to your usage?
Approximate · sessions on this machine only · shares overlap

Last 24h · 352 requests · 9 sessions
  77%  Start fresh when you switch tasks · run /clear`;

const NOW = new Date(2026, 9, 30, 12, 0); // 30 Oct 2026, 12:00 local

describe('/usage parsing', () => {
  it('reads the 5-hour and weekly windows from the real output', () => {
    const r = parseUsageText(REAL, NOW);
    expect(r.plan).toBe('subscription');
    expect(r.windows.map((w) => [w.id, w.usedPct])).toEqual([
      ['five_hour', 57],
      ['seven_day', 60],
    ]);
    expect(new Date(r.windows[0].resetsAt!)).toEqual(new Date(2026, 9, 30, 15, 39));
    expect(new Date(r.windows[1].resetsAt!)).toEqual(new Date(2026, 10, 3, 21, 59));
  });

  it('ignores the "what is contributing" percentages', () => {
    expect(parseUsageText(REAL, NOW).windows).toHaveLength(2);
  });

  it('keeps per-model weekly windows', () => {
    const r = parseUsageText(`${REAL}\nCurrent week (Sonnet only): 12% used · resets Nov 3, 9:59pm (Europe/Paris)`, NOW);
    expect(r.windows.find((w) => w.id === 'seven_day_sonnet')).toMatchObject({ usedPct: 12, label: 'Semaine (Sonnet)' });
  });

  it('recognizes API-key usage (no subscription quota)', () => {
    const r = parseUsageText('Total cost:            $0.0000\nUsage:                 0 input, 0 output', NOW);
    expect(r).toEqual({ plan: 'api', windows: [] });
  });

  it('parses reset times with and without a date', () => {
    expect(new Date(parseResetText('3:39pm (Europe/Paris)', NOW)!)).toEqual(new Date(2026, 9, 30, 15, 39));
    expect(new Date(parseResetText('9am', NOW)!)).toEqual(new Date(2026, 9, 31, 9, 0)); // already past today → tomorrow
    expect(new Date(parseResetText('Jan 2, 12am', NOW)!)).toEqual(new Date(2027, 0, 2, 0, 0)); // next year
    expect(parseResetText('soon', NOW)).toBeNull();
  });

  it('maps the structured rate_limit_event of controlled sessions', () => {
    const w = windowsFromRateLimit({
      status: 'allowed',
      unifiedWindows: { five_hour: { utilization: 0.86, resetsAt: 1793278200, status: 'allowed' }, seven_day: { utilization: 0.2, resetsAt: 1793739600 } },
    });
    expect(w).toEqual([
      { id: 'five_hour', label: 'Session (5 h)', usedPct: 86, resetsAt: 1793278200000, status: 'allowed' },
      { id: 'seven_day', label: 'Semaine (tous modèles)', usedPct: 20, resetsAt: 1793739600000, status: undefined },
    ]);
    expect(windowsFromRateLimit({})).toEqual([]);
  });
});

describe('quota probe isolation', () => {
  it('never shows the app’s own quota check as an agent', async () => {
    const home = mkdtempSync(path.join(tmpdir(), 'aao-q-'));
    const quotaDir = path.join(home, 'office', 'quota');
    mkdirSync(path.join(home, 'sessions'), { recursive: true });
    mkdirSync(path.join(home, 'projects'), { recursive: true });
    writeFileSync(
      path.join(home, 'sessions', `${process.pid}.json`),
      JSON.stringify({ pid: process.pid, sessionId: 'dddddddd-0000-0000-0000-000000000001', cwd: quotaDir, status: 'busy' }),
    );
    const settings = mergeSettings({ claudeHome: home });
    const manager = new AgentManager(
      null,
      { agentsChanged: () => {}, liveEvents: () => {}, notification: () => {}, console: () => {}, log: () => {} },
      () => settings,
    );
    const store = new Map<string, number>();
    const provider = new ClaudeProvider({
      claudeHome: () => home,
      claudePath: () => 'claude',
      scanDays: () => 7,
      officeHome: path.join(home, 'office'),
      offsets: { getOffset: (f) => store.get(f), setOffset: (f, o) => void store.set(f, o) },
      ignoreCwds: () => [quotaDir],
    });
    await provider.start(manager);
    expect(manager.agents.size).toBe(0);
    await provider.stop();
    rmSync(home, { recursive: true, force: true });
  });
});
