// Electron main process: window, IPC, wiring of providers -> manager -> DB/UI.

import { app, BrowserWindow, dialog, ipcMain, Notification, shell, nativeTheme, screen } from 'electron';
import path from 'node:path';
import os from 'node:os';
import { promises as fsp, existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { IPC, type ControlAction, type LaunchOptions, type SetupCheck, type Settings } from '../shared/types';
import { OfficeDB, type EventQuery } from './db/database';
import { AgentManager } from './core/agentManager';
import { ClaudeProvider } from './providers/claude/claudeProvider';
import { DemoProvider } from './providers/demo/demoProvider';
import type { AgentProvider } from './providers/provider';
import { ProcessMonitor } from './core/processMonitor';
import { mergeSettings } from './core/settings';
import { setCustomRedactions } from './core/redact';
import { hooksStatus, installHooks, uninstallHooks } from './core/hooks';
import { addUsageCost, progressOf } from './core/reducer';
import { QuotaMonitor } from './providers/claude/quota';
import { purgeHistory } from './core/purge';
import type { QuotaState } from '../shared/types';

const OFFICE_HOME = path.join(os.homedir(), '.ai-agent-office');
let win: BrowserWindow | null = null;
let db: OfficeDB;
let manager: AgentManager;
let claude: ClaudeProvider;
let demo: DemoProvider | null = null;
let settings: Settings;
const monitor = new ProcessMonitor();
let quitting = false;
let quota: QuotaMonitor;
const quotaAlerted = new Set<string>();

/** Alerts once per window and reset period when usage crosses 80 % then 95 %. */
function quotaAlerts(q: QuotaState) {
  for (const w of q.windows) {
    for (const level of [95, 80]) {
      if (w.usedPct < level) continue;
      const key = `${w.id}:${w.resetsAt ?? ''}:${level}`;
      if (quotaAlerted.has(key)) break;
      quotaAlerted.add(key);
      const when = w.resetsAt ? new Date(w.resetsAt).toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : 'inconnue';
      manager.notify(
        'quota',
        level >= 95 ? 'error' : 'warning',
        `Quota ${w.label} : ${Math.round(w.usedPct)} % utilisé`,
        `Il reste ${Math.max(0, Math.round(100 - w.usedPct))} %. Réinitialisation : ${when}.`,
      );
      break;
    }
  }
}

// Dev/test helpers: isolated data folder and automatic screenshots (used to verify rendering).
if (process.env.AAO_USER_DATA) app.setPath('userData', process.env.AAO_USER_DATA);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app
    .whenReady()
    .then(main)
    .catch((e) => {
      dialog.showErrorBox('AI Agent Office', `Erreur au démarrage : ${e?.stack ?? e}`);
      app.exit(1);
    });
}

function send(channel: string, payload: unknown) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function wasmPath(): string | undefined {
  try {
    const p = require.resolve('sql.js/dist/sql-wasm.wasm');
    const unpacked = p.replace('app.asar', 'app.asar.unpacked');
    return existsSync(unpacked) ? unpacked : p;
  } catch {
    return undefined;
  }
}

function withProgress(a: any) {
  return { ...a, progress: progressOf(a) };
}

function providerFor(agentId: string): AgentProvider | null {
  const a = manager.agents.get(agentId);
  if (!a) return null;
  if (a.demo) return demo;
  return claude;
}

async function main() {
  nativeTheme.themeSource = 'dark';
  await fsp.mkdir(OFFICE_HOME, { recursive: true });
  db = new OfficeDB(path.join(app.getPath('userData'), 'office.db'));
  await db.open(wasmPath());
  settings = mergeSettings(db.getSetting<Partial<Settings>>('settings'));
  setCustomRedactions(settings.redactPatterns);
  const purged = db.purgeOlderThan(settings.retentionDays);

  manager = new AgentManager(
    db,
    {
      agentsChanged: (agents, removed) => send(IPC.agentsPatch, { agents: agents.map(withProgress), removed }),
      liveEvents: (events) => send(IPC.events, events),
      notification: (n, osNotif) => {
        send(IPC.notification, n);
        if (osNotif && Notification.isSupported()) {
          const nn = new Notification({ title: n.title, body: n.body, silent: n.level === 'info' });
          nn.on('click', () => {
            win?.show();
            win?.focus();
            if (n.agentId) send('office:select-agent', n.agentId);
          });
          nn.show();
        }
      },
      console: (agentId, line) => send(IPC.console, { agentId, line }),
      log: (level, msg) => {
        console[level === 'error' ? 'error' : 'log'](`[office] ${msg}`);
        send(IPC.log, { level, msg, ts: Date.now() });
      },
    },
    () => settings,
  );
  manager.restore(db.loadAgents());
  // Agents saved before cost estimation existed: re-price them from their stored usage events.
  let repriced = 0;
  for (const a of manager.agents.values()) {
    if (a.costByModel) continue;
    for (const ev of db.queryEvents({ agentId: a.id, kinds: ['usage'], limit: 5000 }).reverse()) addUsageCost(a, ev.data ?? {});
    if (a.costByModel) {
      repriced++;
      db.saveAgent(a);
    }
  }

  quota = new QuotaMonitor(
    () => settings.claudePath || 'claude',
    path.join(OFFICE_HOME, 'quota'),
    (q) => {
      send(IPC.quota, q);
      quotaAlerts(q);
    },
  );

  claude = new ClaudeProvider({
    ignoreCwds: () => [quota.cwd],
    onRateLimit: (info) => quota.ingestRateLimit(info),
    claudeHome: () => settings.claudeHome,
    claudePath: () => settings.claudePath || 'claude',
    scanDays: () => settings.scanDays,
    officeHome: OFFICE_HOME,
    offsets: db,
  });

  registerIpc();
  createWindow();
  if (repriced) manager.log('info', `Coût estimé calculé pour ${repriced} agents existants`);
  if (purged.events) manager.log('info', `Rétention : ${purged.events} événements anciens supprimés`);

  // Start observation after the window exists so the user sees agents appear.
  claude
    .start(manager)
    .then(() => {
      manager.housekeeping();
      manager.log('info', 'Connecteur Claude Code démarré');
    })
    .catch((e) => manager.log('error', `Connecteur Claude Code : ${e?.message ?? e}`));
  if (settings.demoMode) await startDemo();

  // Quota check (/usage: answered locally by Claude Code, no token used).
  setTimeout(() => void quota.refresh(), 3000);
  quota.schedule(settings.quotaRefreshMin);
  setInterval(() => manager.housekeeping(), 30_000);
  setInterval(async () => {
    const pids = [...manager.agents.values()].filter((a) => a.alive.value === true && a.pid.value).map((a) => a.pid.value as number);
    if (!pids.length) return;
    manager.applyResources(await monitor.sample(pids));
  }, 10_000);
}

async function startDemo() {
  if (demo) return;
  demo = new DemoProvider();
  await demo.start(manager);
}
async function stopDemo() {
  if (!demo) return;
  await demo.stop();
  demo = null;
  manager.removeDemoAgents();
}

interface WinState {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
}

/** Window size that fits the screen it opens on (laptops at 125-150 % scaling have ~1280x720 usable). */
function initialBounds(): Partial<WinState> {
  const saved = db.getSetting<WinState>('window');
  if (
    saved &&
    screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return saved.x < a.x + a.width - 100 && saved.x + saved.width > a.x + 100 && saved.y >= a.y - 10 && saved.y < a.y + a.height - 100;
    })
  )
    return saved;
  const wa = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.min(1500, Math.round(wa.width * 0.92));
  const height = Math.min(920, Math.round(wa.height * 0.92));
  return { width, height, maximized: wa.width < 1400 || wa.height < 800 };
}

function createWindow() {
  const fixed = process.env.AAO_WINDOW?.match(/^(\d+)x(\d+)$/); // test helper: exact inner size
  const b = fixed ? { width: Number(fixed[1]), height: Number(fixed[2]) } : initialBounds();
  win = new BrowserWindow({
    ...b,
    useContentSize: !!fixed,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#0e0f16',
    title: 'AI Agent Office',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '../renderer/icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.once('ready-to-show', () => {
    if (!fixed && (b as WinState).maximized) win?.maximize();
    win?.show();
  });
  const saveBounds = () => {
    if (!win || win.isDestroyed() || win.isMinimized() || fixed) return;
    db.setSetting('window', { ...win.getNormalBounds(), maximized: win.isMaximized() });
  };
  win.on('resized', saveBounds);
  win.on('moved', saveBounds);
  win.on('maximize', saveBounds);
  win.on('unmaximize', saveBounds);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'));

  const shot = process.env.AAO_SCREENSHOT;
  if (shot) {
    const delays = (process.env.AAO_SCREENSHOT_AT ?? '6000').split(',').map(Number);
    delays.forEach((d, i) =>
      setTimeout(async () => {
        const script = (process.env.AAO_SCRIPT ?? '').split('|||')[i];
        if (script) await win?.webContents.executeJavaScript(script).catch(() => {});
        await new Promise((r) => setTimeout(r, 800));
        const img = await win!.webContents.capturePage();
        await fsp.writeFile(shot.replace('.png', `-${i}.png`), img.toPNG());
        if (i === delays.length - 1 && process.env.AAO_EXIT) {
          quitting = true;
          await shutdown();
          app.exit(0);
        }
      }, d),
    );
  }

  win.on('close', async (e) => {
    if (quitting) return;
    const running = claude?.managed.list().filter((p) => p.child.exitCode === null) ?? [];
    if (running.length) {
      e.preventDefault();
      const r = await dialog.showMessageBox(win!, {
        type: 'warning',
        buttons: ['Arrêter et quitter', 'Annuler'],
        defaultId: 1,
        cancelId: 1,
        title: 'Sessions en cours',
        message: `${running.length} session(s) Claude Code lancée(s) depuis l’app tourne(nt) encore.`,
        detail: 'Quitter les arrêtera (leur historique reste disponible et elles pourront être reprises).',
      });
      if (r.response !== 0) return;
    }
    quitting = true;
    await shutdown();
    win?.destroy();
    app.quit();
  });
}

async function shutdown() {
  try {
    manager.flush();
    await claude?.stop();
    await demo?.stop();
    db.flushSync();
  } catch (e) {
    console.error(e);
  }
}

app.on('window-all-closed', () => app.quit());

function checkCmd(cmd: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: 15000 }, (err, stdout, stderr) =>
      resolve({ ok: !err, out: (stdout || stderr || err?.message || '').trim() }),
    );
  });
}

async function setupChecks(): Promise<SetupCheck[]> {
  const checks: SetupCheck[] = [];
  const c = await checkCmd(settings.claudePath || 'claude', ['--version']);
  checks.push({
    id: 'claude',
    label: 'Claude Code CLI',
    ok: c.ok,
    detail: c.ok ? c.out : `Introuvable (${c.out}). Installez Claude Code ou indiquez son chemin dans les paramètres.`,
  });
  const home = settings.claudeHome;
  const hasHome = existsSync(home);
  checks.push({ id: 'home', label: 'Dossier de données Claude Code', ok: hasHome, detail: hasHome ? home : `${home} introuvable` });
  const hasProjects = existsSync(path.join(home, 'projects'));
  checks.push({
    id: 'projects',
    label: 'Transcripts de sessions (projects/)',
    ok: hasProjects,
    detail: hasProjects ? 'Lecture seule, aucune modification' : 'Aucun transcript : lancez une session Claude Code une première fois',
  });
  const hasSessions = existsSync(path.join(home, 'sessions'));
  checks.push({
    id: 'sessions',
    label: 'Registre des sessions actives (sessions/)',
    ok: hasSessions,
    detail: hasSessions ? 'Détection des PID et statuts busy/idle' : 'Absent : statut en direct déduit des transcripts uniquement',
  });
  try {
    await fsp.access(home, (await import('node:fs')).constants.R_OK);
    checks.push({ id: 'perm', label: 'Permission de lecture', ok: true, detail: 'OK' });
  } catch {
    checks.push({ id: 'perm', label: 'Permission de lecture', ok: false, detail: `Impossible de lire ${home}` });
  }
  const node = await checkCmd('node', ['--version']);
  checks.push({
    id: 'node',
    label: 'Node.js (pour les hooks optionnels)',
    ok: node.ok,
    detail: node.ok ? node.out : 'Absent : les hooks optionnels ne pourront pas être utilisés (le reste fonctionne)',
  });
  const hooks = await hooksStatus(home);
  checks.push({ id: 'hooks', label: 'Hooks optionnels (alertes « en attente »)', ok: hooks, detail: hooks ? 'Installés' : 'Non installés (facultatif)' });
  const wt = await checkCmd('where', ['wt']);
  checks.push({ id: 'wt', label: 'Windows Terminal', ok: wt.ok, detail: wt.ok ? 'Disponible' : 'Absent : repli sur cmd.exe' });
  return checks;
}

function registerIpc() {
  ipcMain.handle(IPC.snapshot, () => ({
    agents: [...manager.agents.values()].map(withProgress),
    notifications: db.loadNotifications(200),
    settings,
  }));
  ipcMain.handle(IPC.getEvents, (_e, q: EventQuery) => db.queryEvents(q ?? {}));
  ipcMain.handle(IPC.getSessions, () => db.sessions());
  ipcMain.handle(IPC.usageByDay, (_e, days: number) => db.usageByDay(Number(days) || 14));
  ipcMain.handle(IPC.getConsole, (_e, agentId: string) => manager.getConsole(agentId));
  ipcMain.handle(IPC.getSettings, () => settings);
  ipcMain.handle(IPC.setSettings, async (_e, patch: Partial<Settings>) => {
    const prevDemo = settings.demoMode;
    settings = mergeSettings({ ...settings, ...patch });
    db.setSetting('settings', settings);
    setCustomRedactions(settings.redactPatterns);
    if (settings.demoMode && !prevDemo) await startDemo();
    if (!settings.demoMode && prevDemo) await stopDemo();
    if (patch.quotaRefreshMin !== undefined) quota.schedule(settings.quotaRefreshMin);
    return settings;
  });
  ipcMain.handle(IPC.capabilities, (_e, agentId: string) => {
    const a = manager.agents.get(agentId);
    const p = providerFor(agentId);
    return a && p ? p.capabilities(a) : null;
  });
  ipcMain.handle(IPC.control, async (_e, action: ControlAction) => {
    const a = manager.agents.get(action.agentId);
    const p = providerFor(action.agentId);
    if (!a || !p) return { ok: false, message: 'Agent inconnu' };
    if (action.type === 'openFolder') {
      if (!a.cwd) return { ok: false, message: 'Dossier inconnu' };
      const err = await shell.openPath(a.cwd);
      return err ? { ok: false, message: err } : { ok: true, message: 'Dossier ouvert' };
    }
    const r = await p.control(action, a);
    manager.log(r.ok ? 'info' : 'warn', `Commande ${action.type} sur ${a.name} : ${r.message}`);
    return r;
  });
  ipcMain.handle(IPC.launch, async (_e, opts: LaunchOptions) => {
    const r = await claude.launch(opts);
    manager.log(r.ok ? 'info' : 'warn', `Lancement dans ${opts.cwd} : ${r.message}`);
    return r;
  });
  ipcMain.handle(IPC.setupChecks, () => setupChecks());
  ipcMain.handle(IPC.getQuota, () => quota.get());
  ipcMain.handle(IPC.refreshQuota, () => quota.refresh());
  ipcMain.handle(IPC.health, async () => ({
    ...claude.health(),
    claudeHomeFound: existsSync(path.join(settings.claudeHome, 'projects')),
    hooks: await hooksStatus(settings.claudeHome),
    dbEvents: db.countEvents(),
    demo: settings.demoMode,
  }));
  ipcMain.handle(IPC.installHooks, async () => {
    try {
      const relay = path.join(__dirname, 'hook-relay.js').replace('app.asar', 'app.asar.unpacked');
      return { ok: true, message: await installHooks(settings.claudeHome, existsSync(relay) ? relay : path.join(__dirname, 'hook-relay.js'), OFFICE_HOME) };
    } catch (e: any) {
      return { ok: false, message: e?.message ?? String(e) };
    }
  });
  ipcMain.handle(IPC.uninstallHooks, async () => {
    try {
      return { ok: true, message: await uninstallHooks(settings.claudeHome) };
    } catch (e: any) {
      return { ok: false, message: e?.message ?? String(e) };
    }
  });
  ipcMain.handle(IPC.exportData, async (_e, payload?: { events?: unknown[]; name?: string }) => {
    const r = await dialog.showSaveDialog(win!, {
      title: 'Exporter',
      defaultPath: payload?.name ?? `ai-agent-office-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePath) return { ok: false, message: 'Annulé' };
    const data = payload?.events ? { events: payload.events } : db.exportAll();
    await fsp.writeFile(r.filePath, JSON.stringify(data, null, 2));
    return { ok: true, message: `Exporté vers ${r.filePath}` };
  });
  ipcMain.handle(IPC.purge, (_e, days: number | 'all') => {
    const r = purgeHistory(db, manager, days);
    if (r.ok) send(IPC.historyPurged, { before: r.before });
    return { ok: r.ok, message: r.message };
  });
  ipcMain.handle(IPC.markRead, () => db.markAllRead());
  ipcMain.handle(IPC.pickFolder, async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle(IPC.updateAgentMeta, (_e, id: string, meta: { name?: string; role?: string; color?: string }) => manager.updateMeta(id, meta));
}
