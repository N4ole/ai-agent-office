// Regenerates the README screenshots (docs/images/*.png) from demo mode.
//
//   npm run screenshots
//
// Uses the existing capture helpers (AAO_* variables, development builds only) with a throw-away
// data folder: your history (%APPDATA%\AI Agent Office) and your Claude Code sessions (~/.claude)
// are never read or shown. Opens an app window for ~25 s; do not use the mouse/keyboard meanwhile.

import { spawn, execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const out = path.join(root, 'docs', 'images');
const SIZE = process.env.SHOTS_SIZE ?? '1440x900';

// Each step: the UI action to run, then (0.8 s later) the capture, saved as `file` (null = discarded,
// used to let an animation finish before the real capture).
const key = (k) => `window.dispatchEvent(new KeyboardEvent('keydown', { key: '${k}', bubbles: true }))`;
const steps = [
  { at: 9000, script: '', file: 'office.png' }, // demo agents have reached their desks
  { at: 10000, script: key('j'), file: null }, // select the first agent…
  { at: 12500, script: '', file: 'office-agent.png' }, // …once its detail panel is fully open
  { at: 14000, script: `${key('Escape')};${key('2')}`, file: 'dashboard.png' },
  { at: 16500, script: key('3'), file: 'logs.png' },
];

console.log('Build…');
execSync('npm run build', { cwd: root, stdio: 'inherit' });

const tmp = mkdtempSync(path.join(tmpdir(), 'aao-shots-'));
const userData = path.join(tmp, 'userData');
const claudeHome = path.join(tmp, 'claude'); // empty: no real session can appear
for (const d of [userData, path.join(claudeHome, 'projects'), path.join(claudeHome, 'sessions')]) mkdirSync(d, { recursive: true });

// Pre-seeded settings: demo mode on, setup wizard done, no /usage probe of the real account.
// Written with the app's own OfficeDB (bundled on the fly) so the schema is always the real one.
// Inside node_modules so that require('sql.js') resolves.
const dbModule = path.join(root, 'node_modules', '.cache', 'aao-screenshots', 'office-db.cjs');
await build({
  entryPoints: [path.join(root, 'src/main/db/database.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: dbModule,
  external: ['sql.js'],
  logLevel: 'silent',
});
const { OfficeDB } = require(dbModule);
// Stand-in for `claude` that only answers /usage with demo values (the real account is never queried).
const fakeClaude = path.join(tmp, 'claude-demo.cmd');
writeFileSync(fakeClaude, '@echo off\r\necho {"type":"result","result":"Current session: 38%% used\\nCurrent week (all models): 61%% used"}\r\n');
// No toast and, above all, no Windows notification popping up on the desktop during the run.
const silent = Object.fromEntries(
  ['agent_new', 'subagent_new', 'task_start', 'task_end', 'error', 'blocked', 'session_lost', 'resources', 'cost', 'quota'].map((t) => [
    t,
    { app: false, os: false },
  ]),
);
const db = new OfficeDB(path.join(userData, 'office.db'));
await db.open();
db.setSetting('settings', { demoMode: true, setupDone: true, claudeHome, claudePath: fakeClaude, quotaRefreshMin: 0, notifications: silent });
db.flushSync();
db.close();

const shot = path.join(tmp, 'shot.png');
const electron = require('electron'); // path of the Electron binary
console.log(`Captures (${SIZE})…`);
// Terminals inside VS Code (an Electron app) export ELECTRON_RUN_AS_NODE=1, which would start
// Electron as plain Node.js: drop it.
const baseEnv = { ...process.env };
delete baseEnv.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.'], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...baseEnv,
    VITE_DEV_SERVER_URL: '',
    CLAUDE_CONFIG_DIR: claudeHome,
    AAO_USER_DATA: userData,
    AAO_WINDOW: SIZE,
    AAO_SCREENSHOT: shot,
    AAO_SCREENSHOT_AT: steps.map((s) => s.at).join(','),
    AAO_SCRIPT: steps.map((s) => s.script).join('|||'),
    AAO_EXIT: '1',
  },
});
const code = await new Promise((r) => child.on('exit', r));

mkdirSync(out, { recursive: true });
let missing = 0;
steps.forEach((s, i) => {
  if (!s.file) return;
  const src = shot.replace('.png', `-${i}.png`);
  if (!existsSync(src)) {
    missing++;
    return console.error(`Capture manquante : ${s.file}`);
  }
  copyFileSync(src, path.join(out, s.file));
  console.log(`docs/images/${s.file}`);
});
rmSync(tmp, { recursive: true, force: true });
process.exit(code || missing ? 1 : 0);
