// Optional installation of Claude Code hooks into ~/.claude/settings.json.
// Only adds entries whose command contains HOOK_MARKER, so they can be removed cleanly.
// A backup of settings.json is written before any change.

import { promises as fsp } from 'node:fs';
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
    throw new Error(`settings.json illisible (${e?.message}) : opération annulée pour ne rien écraser`);
  }
}

export async function installHooks(claudeHome: string, relaySource: string, officeHome: string): Promise<string> {
  const file = path.join(claudeHome, 'settings.json');
  const current = await readSettings(file);
  await fsp.mkdir(officeHome, { recursive: true });
  const relay = path.join(officeHome, 'hook-relay.js');
  await fsp.copyFile(relaySource, relay);
  await fsp.writeFile(`${file}.ai-agent-office.bak`, JSON.stringify(current, null, 2));
  await fsp.writeFile(file, JSON.stringify(addHooks(current, hookCommand(relay)), null, 2));
  return `Hooks installés (${HOOK_EVENTS.join(', ')}). Sauvegarde : settings.json.ai-agent-office.bak. Actifs pour les nouvelles sessions Claude Code.`;
}

export async function uninstallHooks(claudeHome: string): Promise<string> {
  const file = path.join(claudeHome, 'settings.json');
  const current = await readSettings(file);
  await fsp.writeFile(file, JSON.stringify(removeHooks(current), null, 2));
  return 'Hooks AI Agent Office retirés de settings.json';
}

export async function hooksStatus(claudeHome: string): Promise<boolean> {
  try {
    return hooksInstalled(await readSettings(path.join(claudeHome, 'settings.json')));
  } catch {
    return false;
  }
}
