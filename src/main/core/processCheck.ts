// Safety check before force-killing an external Claude Code session by PID (R-04).
// The PID comes from ~/.claude/sessions/<pid>.json; if that process ended and Windows reused the
// PID, `taskkill /T /F` would kill an unrelated program and its children. Before killing, the
// process must still look like Claude Code and must have started no later than the session.

import { execFile } from 'node:child_process';

export interface ProcessInfo {
  pid: number;
  /** Image name, e.g. "claude.exe" or "node.exe". */
  name: string;
  /** Process creation time (epoch ms), or null if unknown. */
  startedAt: number | null;
  commandLine: string;
}

/** Tolerance between the process start and the session's `startedAt` recorded by Claude Code. */
export const START_TOLERANCE_MS = 60_000;

/** Native installer → claude.exe; npm install → node.exe running @anthropic-ai/claude-code. */
export function looksLikeClaude(p: ProcessInfo): boolean {
  const name = p.name.toLowerCase();
  if (name === 'claude.exe' || name === 'claude') return true;
  if (name === 'node.exe' || name === 'node') return /@anthropic-ai[\\/]claude-code|[\\/]claude(?:\.cmd|\.js)?["\s]|claude-code/i.test(p.commandLine + ' ');
  return false;
}

/** Decides whether `pid` may be killed as the Claude Code session that started at `sessionStartedAt`. */
export function checkKillTarget(info: ProcessInfo | null, sessionStartedAt: number | undefined): { ok: true } | { ok: false; reason: string } {
  if (!info) return { ok: false, reason: 'le processus n’existe plus ou ses informations sont inaccessibles' };
  if (!looksLikeClaude(info)) return { ok: false, reason: `le PID ${info.pid} correspond maintenant à « ${info.name} », pas à Claude Code` };
  if (!sessionStartedAt)
    return { ok: false, reason: 'l’heure de démarrage de la session est inconnue, impossible de vérifier que le PID n’a pas été réutilisé' };
  if (info.startedAt == null) return { ok: false, reason: 'l’heure de démarrage du processus est inconnue' };
  if (info.startedAt > sessionStartedAt + START_TOLERANCE_MS)
    return { ok: false, reason: `le processus ${info.pid} a démarré après la session : son PID a probablement été réutilisé` };
  return { ok: true };
}

/** Reads name, start time and command line of a process (Windows, via CIM). */
export function queryProcess(pid: number): Promise<ProcessInfo | null> {
  if (!Number.isInteger(pid) || pid <= 0) return Promise.resolve(null);
  if (process.platform !== 'win32') return Promise.resolve(null);
  const script =
    `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; ` +
    `if ($p) { $p.Name; ([DateTimeOffset]$p.CreationDate).ToUnixTimeMilliseconds(); $p.CommandLine }`;
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 10_000 }, (err, stdout) => {
      if (err && !stdout) return resolve(null);
      const [name, started, ...cmd] = stdout.split(/\r?\n/);
      if (!name?.trim()) return resolve(null);
      const t = Number(started);
      resolve({ pid, name: name.trim(), startedAt: Number.isFinite(t) && t > 0 ? t : null, commandLine: cmd.join(' ').trim() });
    });
  });
}
