// Security hardening from the 2026-11-14 audit (chantier 3).

import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ClaudeProvider } from '../src/main/providers/claude/claudeProvider';
import { createAgent } from '../src/main/core/reducer';
import { installHooks, uninstallHooks, writeJsonAtomic } from '../src/main/core/hooks';
import { devHelpers } from '../src/main/core/devHelpers';
import { hookRecord } from '../src/main/core/hookLog';
import { validateSettingsPatch } from '../src/main/core/settingsValidation';
import { PROD_CSP, withDevCsp } from '../src/shared/csp';
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

describe('~/.claude/settings.json changes (R-05)', () => {
  it('backs up before every change, never overwrites a backup, and leaves no temp file', async () => {
    const home = tmp();
    const office = path.join(home, 'office');
    const relay = path.join(home, 'relay.js');
    writeFileSync(relay, '// relay');
    const settingsFile = path.join(home, 'settings.json');
    const original = { theme: 'dark', hooks: { Notification: [{ hooks: [{ type: 'command', command: 'mine' }] }] } };
    writeFileSync(settingsFile, JSON.stringify(original));
    await installHooks(home, relay, office);
    await installHooks(home, relay, office);
    await uninstallHooks(home);
    const files = readdirSync(home);
    const backups = files.filter((f) => /^settings\.json\.ai-agent-office-.*\.bak$/.test(f)).sort();
    expect(backups).toHaveLength(3); // install, re-install, uninstall: one each, none overwritten
    expect(JSON.parse(readFileSync(path.join(home, backups[0]), 'utf8'))).toEqual(original);
    expect(files.filter((f) => f.endsWith('.tmp'))).toEqual([]);
    const final = JSON.parse(readFileSync(settingsFile, 'utf8'));
    expect(final.theme).toBe('dark');
    expect(final.hooks.Notification[0].hooks[0].command).toBe('mine');
  });

  it('writes settings.json atomically (temp file in the same folder, then rename)', async () => {
    const home = tmp();
    const file = path.join(home, 'settings.json');
    writeFileSync(file, '{"a":1}');
    const seen: string[] = [];
    await writeJsonAtomic(file, { a: 2 }, (tmpFile) => void seen.push(tmpFile));
    expect(seen).toHaveLength(1);
    expect(path.dirname(seen[0])).toBe(home);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ a: 2 });
    expect(readdirSync(home)).toEqual(['settings.json']);
  });
});

describe('production build hardening (R-17, R-25)', () => {
  const env = {
    AAO_USER_DATA: 'C:/tmp/x',
    AAO_WINDOW: '1280x720',
    AAO_SCREENSHOT: 'C:/tmp/s.png',
    AAO_SCRIPT: 'alert(1)',
    AAO_EXIT: '1',
    VITE_DEV_SERVER_URL: 'http://localhost:5199',
  };

  it('ignores the AAO_* and dev-server variables in a packaged app', () => {
    expect(devHelpers(env, true)).toEqual({});
  });

  it('keeps them for development', () => {
    const d = devHelpers(env, false);
    expect(d.userData).toBe('C:/tmp/x');
    expect(d.window).toEqual({ width: 1280, height: 720 });
    expect(d.screenshot).toMatchObject({ file: 'C:/tmp/s.png', scripts: ['alert(1)'], exit: true });
    expect(d.devServerUrl).toBe('http://localhost:5199');
    expect(devHelpers({ VITE_DEV_SERVER_URL: 'https://evil.example' }, false).devServerUrl).toBeUndefined();
  });

  it('ships a production CSP without the dev server, and a separate dev CSP', () => {
    const html = readFileSync(path.join(__dirname, '../src/renderer/index.html'), 'utf8');
    expect(html).toContain(PROD_CSP);
    expect(html).not.toMatch(/localhost/);
    expect(withDevCsp(html)).toContain('ws://localhost:5199');
  });

  it('leaves source maps out of the packaged app', () => {
    const pkg = JSON.parse(readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
    expect(pkg.build.files).toContain('!**/*.map');
  });
});

describe('hook relay (hook-events.jsonl)', () => {
  it('masks secrets before writing, not only truncates', () => {
    const rec = hookRecord(
      {
        hook_event_name: 'Notification',
        session_id: 's',
        cwd: 'C:/p',
        message: 'Claude needs your permission: export ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnopqrstuvwx',
        other: 'dropped',
      },
      1000,
    );
    expect(rec.message).not.toContain('sk-ant-api03');
    expect(rec.message).toContain('Claude needs your permission');
    expect(rec).not.toHaveProperty('other');
    expect(rec.ts).toBe(1000);
    expect(hookRecord({ message: 'x'.repeat(2000) }, 1).message!.length).toBeLessThanOrEqual(500);
  });
});

describe('settings sent by the renderer', () => {
  it('validates claudePath and claudeHome', () => {
    const dir = tmp();
    const exe = path.join(dir, 'claude.cmd');
    const txt = path.join(dir, 'notes.txt');
    writeFileSync(exe, '@echo off');
    writeFileSync(txt, 'x');
    const ok = (p: object) => validateSettingsPatch(p).errors;
    expect(ok({ claudePath: 'claude' })).toEqual([]);
    expect(ok({ claudePath: '' })).toEqual([]);
    expect(ok({ claudePath: exe })).toEqual([]);
    expect(ok({ claudePath: path.join(dir, 'missing.exe') })[0]).toMatch(/introuvable/);
    expect(ok({ claudePath: dir })[0]).toMatch(/pas un fichier/);
    expect(ok({ claudePath: 'claude & calc' })[0]).toMatch(/invalide/);
    if (process.platform === 'win32') expect(ok({ claudePath: txt })[0]).toMatch(/exécutable/);
    expect(ok({ claudeHome: dir })).toEqual([]);
    expect(ok({ claudeHome: exe })[0]).toMatch(/pas un dossier/);
    expect(ok({ claudeHome: path.join(dir, 'nope') })[0]).toMatch(/introuvable/);
    expect(ok({ claudeHome: 'relative/dir' })[0]).toMatch(/absolu/);
  });

  it('drops unknown keys', () => {
    expect(validateSettingsPatch({ scanDays: 3, __proto__x: 1, evil: 'x' } as any).patch).toEqual({ scanDays: 3 });
  });
});
