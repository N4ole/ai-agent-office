// Security hardening from the 2026-11-14 audit (chantier 3).

import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ClaudeProvider } from '../src/main/providers/claude/claudeProvider';
import { createAgent } from '../src/main/core/reducer';
import { checkKillTarget, queryProcess, type ProcessInfo } from '../src/main/core/processCheck';

const dirs: string[] = [];
const tmp = (p = 'aao-sec-') => {
  const d = mkdtempSync(path.join(tmpdir(), p));
  dirs.push(d);
  return d;
};
afterAll(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('force stop of an external session (R-04)', () => {
  const SID = 'aaaaaaaa-0000-0000-0000-000000000001';
  const PID = 424242;
  const STARTED = Date.now() - 3600_000;
  const claudeProc: ProcessInfo = { pid: PID, name: 'claude.exe', startedAt: STARTED - 2000, commandLine: 'claude' };

  async function setup(info: ProcessInfo | null) {
    const home = tmp();
    mkdirSync(path.join(home, 'sessions'), { recursive: true });
    writeFileSync(path.join(home, 'sessions', `${PID}.json`), JSON.stringify({ pid: PID, sessionId: SID, cwd: home, status: 'busy', startedAt: STARTED }));
    const killed: number[] = [];
    const provider = new ClaudeProvider({
      claudeHome: () => home,
      claudePath: () => 'claude',
      scanDays: () => 7,
      officeHome: path.join(home, 'office'),
      offsets: { getOffset: () => undefined, setOffset: () => {} },
      processInfo: async () => info,
      killTree: (pid) => void killed.push(pid!),
    });
    const sink: any = {
      upsertAgent: () => true,
      patchAgent: () => {},
      events: () => {},
      getAgent: () => undefined,
      allAgents: () => [],
      console: () => {},
      log: () => {},
    };
    (provider as any).sink = sink;
    await provider.pollRegistry();
    const a = createAgent(
      { id: `cc:${SID}`, provider: 'claude-code', kind: 'session', sessionId: SID, name: 'S', role: 'r', project: 'p', cwd: home, startedAt: STARTED },
      0,
    );
    a.alive = { value: true, source: 'observed' };
    a.pid = { value: PID, source: 'observed' };
    return { provider, a, killed };
  }

  it('kills a process that is still the Claude Code session', async () => {
    const { provider, a, killed } = await setup(claudeProc);
    const r = await provider.control({ type: 'stop', agentId: a.id }, a);
    expect(r.ok).toBe(true);
    expect(killed).toEqual([PID]);
  });

  it('refuses when the PID now belongs to another program', async () => {
    const { provider, a, killed } = await setup({ ...claudeProc, name: 'notepad.exe', commandLine: 'notepad' });
    const r = await provider.control({ type: 'stop', agentId: a.id }, a);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/notepad\.exe/);
    expect(killed).toEqual([]);
  });

  it('refuses when the process started after the session (PID reused)', async () => {
    const { provider, a, killed } = await setup({ ...claudeProc, startedAt: Date.now() - 1000 });
    const r = await provider.control({ type: 'stop', agentId: a.id }, a);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/réutilisé/);
    expect(killed).toEqual([]);
  });

  it('accepts Claude Code installed through npm (node running claude-code)', () => {
    const npm: ProcessInfo = {
      ...claudeProc,
      name: 'node.exe',
      commandLine: '"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js"',
    };
    expect(checkKillTarget(npm, STARTED).ok).toBe(true);
    expect(checkKillTarget({ ...npm, commandLine: 'node server.js' }, STARTED).ok).toBe(false);
    expect(checkKillTarget(claudeProc, undefined).ok).toBe(false);
    expect(checkKillTarget(null, STARTED).ok).toBe(false);
  });

  it.runIf(process.platform === 'win32')(
    'reads the real name and start time of a process',
    async () => {
      const info = await queryProcess(process.pid);
      expect(info?.name.toLowerCase()).toMatch(/node/);
      expect(Math.abs((info?.startedAt ?? 0) - (Date.now() - process.uptime() * 1000))).toBeLessThan(120_000);
    },
    20_000,
  );
});
