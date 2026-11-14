// Optional installation of Claude Code hooks into ~/.claude/settings.json.
// Only adds entries whose command contains HOOK_MARKER, so they can be removed cleanly.
// A timestamped backup of settings.json is written before every change, and writes are atomic.

import { constants as fsConstants, promises as fsp } from 'node:fs';
import path from 'node:path';

export const HOOK_MARKER = 'ai-agent-office';
export const HOOK_EVENTS = ['Notification', 'SessionStart', 'SessionEnd'] as const;

export function hookCommand(relayPath: string): string {
  return `node "${relayPath.replace(/\\/g, '/')}"`;
}

type Json = Record<string, any>;

export function addHooks(settings: Json, command: string): Json {
  const s: Json = structuredClone(settings ?? {});
  s.hooks = s.hooks && typeof s.hooks === 'object' ? s.hooks : {};
  for (const ev of HOOK_EVENTS) {
    const list: any[] = Array.isArray(s.hooks[ev]) ? s.hooks[ev] : [];
    const cleaned = stripOurs(list);
    cleaned.push({ hooks: [{ type: 'command', command, timeout: 5 }] });
    s.hooks[ev] = cleaned;
  }
  return s;
}

export function removeHooks(settings: Json): Json {
  const s: Json = structuredClone(settings ?? {});
  if (!s.hooks || typeof s.hooks !== 'object') return s;
  for (const ev of Object.keys(s.hooks)) {
    if (!Array.isArray(s.hooks[ev])) continue;
    const cleaned = stripOurs(s.hooks[ev]);
    if (cleaned.length) s.hooks[ev] = cleaned;
    else delete s.hooks[ev];
  }
  return s;
}

function stripOurs(list: any[]): any[] {
  return list
    .map((m) => ({ ...m, hooks: Array.isArray(m?.hooks) ? m.hooks.filter((h: any) => !String(h?.command ?? '').includes(HOOK_MARKER)) : m?.hooks }))
    .filter((m) => !Array.isArray(m.hooks) || m.hooks.length > 0);
}

export function hooksInstalled(settings: Json): boolean {
  const h = settings?.hooks;
  if (!h) return false;
  return HOOK_EVENTS.every(
    (ev) => Array.isArray(h[ev]) && h[ev].some((m: any) => (m?.hooks ?? []).some((x: any) => String(x?.command ?? '').includes(HOOK_MARKER))),
  );
}

async function readSettings(file: string): Promise<Json> {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch (e: any) {
    if (e?.code === 'ENOENT') return {};
    throw new Error(`settings.json illisible (${e?.message}) : opération annulée pour ne rien écraser`, { cause: e });
  }
}

export async function installHooks(claudeHome: string, relaySource: string, officeHome: string): Promise<string> {
  const file = path.join(claudeHome, 'settings.json');
  const current = await readSettings(file);
  await fsp.mkdir(officeHome, { recursive: true });
  const relay = path.join(officeHome, 'hook-relay.js');
  await fsp.copyFile(relaySource, relay);
  const backup = await backupFile(file);
  await writeJsonAtomic(file, addHooks(current, hookCommand(relay)));
  return `Hooks installés (${HOOK_EVENTS.join(', ')}). ${backupNote(backup)} Actifs pour les nouvelles sessions Claude Code.`;
}

export async function uninstallHooks(claudeHome: string): Promise<string> {
  const file = path.join(claudeHome, 'settings.json');
  const current = await readSettings(file);
  const backup = await backupFile(file);
  await writeJsonAtomic(file, removeHooks(current));
  return `Hooks AI Agent Office retirés de settings.json. ${backupNote(backup)}`;
}

function backupNote(backup: string | null): string {
  return backup ? `Sauvegarde : ${path.basename(backup)}.` : '';
}

/**
 * Copies `file` to `<file>.ai-agent-office-<date>.bak` before a change (R-05). Never overwrites an
 * existing backup. Returns the backup path, or null if `file` does not exist yet.
 */
export async function backupFile(file: string, now = new Date()): Promise<string | null> {
  const p = (n: number, l = 2) => String(n).padStart(l, '0');
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}-${p(now.getMilliseconds(), 3)}`;
  for (let i = 0; i < 1000; i++) {
    const target = `${file}.ai-agent-office-${stamp}${i ? `-${i}` : ''}.bak`;
    try {
      await fsp.copyFile(file, target, fsConstants.COPYFILE_EXCL);
      return target;
    } catch (e: any) {
      if (e?.code === 'ENOENT') return null;
      if (e?.code !== 'EEXIST') throw e;
    }
  }
  throw new Error('Impossible de créer une sauvegarde de settings.json');
}

/**
 * Writes JSON through a temporary file in the same folder, then renames it over the target, so a
 * crash never leaves a half-written settings.json behind (R-05).
 */
export async function writeJsonAtomic(file: string, value: unknown, onTemp?: (tmp: string) => void): Promise<void> {
  const tmp = `${file}.${process.pid}-${Date.now()}.tmp`;
  onTemp?.(tmp);
  try {
    await fsp.writeFile(tmp, JSON.stringify(value, null, 2));
    await fsp.rename(tmp, file);
  } catch (e) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}

export async function hooksStatus(claudeHome: string): Promise<boolean> {
  try {
    return hooksInstalled(await readSettings(path.join(claudeHome, 'settings.json')));
  } catch {
    return false;
  }
}
