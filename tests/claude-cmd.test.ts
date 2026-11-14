// R-03: Claude Code installed through npm is a `claude.cmd` shim. Node refuses to spawn a .cmd
// without a shell (CVE-2024-27980 fix), so launching sessions and the /usage probe used to fail.
// These fakes speak just enough stream-json to exercise the real spawn path.
// NOTE: not a substitute for a check against a real npm install of Claude Code (see the PR).

import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ManagedSessions, type ManagedEvents } from '../src/main/providers/claude/managed';
import { QuotaMonitor } from '../src/main/providers/claude/quota';

const root = mkdtempSync(path.join(tmpdir(), 'aao-cmd-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const npmDir = path.join(root, 'npm & co (x)');
mkdirSync(npmDir, { recursive: true });

const sessionCmd = path.join(npmDir, 'claude-session.cmd');
writeFileSync(sessionCmd, '@echo off\r\necho {"type":"system","subtype":"init","session_id":"cmd-session-1","model":"x"}\r\n');
const usageCmd = path.join(npmDir, 'claude-usage.cmd');
writeFileSync(usageCmd, '@echo off\r\necho {"type":"result","result":"Current session: 42%% used"}\r\n');

describe.runIf(process.platform === 'win32')('Claude Code installed as claude.cmd (R-03)', () => {
  it('launches a managed session through the .cmd shim', async () => {
    const seen: string[] = [];
    const ev: ManagedEvents = {
      onSession: (sid) => void seen.push(sid),
      onConsole: () => {},
      onTurnResult: () => {},
      onExit: () => {},
    };
    const m = new ManagedSessions(() => sessionCmd, ev);
    const r = await m.launch({ cwd: root, prompt: 'bonjour', model: 'sonnet' });
    expect(r).toMatchObject({ ok: true, sessionId: 'cmd-session-1' });
    expect(seen).toEqual(['cmd-session-1']);
  });

  it('refuses a launch option that the .cmd would re-interpret', async () => {
    const m = new ManagedSessions(() => sessionCmd, { onSession: () => {}, onConsole: () => {}, onTurnResult: () => {}, onExit: () => {} });
    const r = await m.launch({ cwd: root, prompt: 'x', model: 'sonnet&calc' });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/refusé/);
  });

  it('runs the /usage probe through the .cmd shim', async () => {
    const q = new QuotaMonitor(
      () => usageCmd,
      path.join(root, 'quota'),
      () => {},
    );
    const s = await q.refresh();
    expect(s.error).toBeUndefined();
    expect(s.windows[0]).toMatchObject({ id: 'five_hour', usedPct: 42 });
  });
});
