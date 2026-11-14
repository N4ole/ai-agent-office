// Validation of settings sent by the renderer (setSettings). The renderer is sandboxed, but
// `claudePath` is executed and `claudeHome` is read, so they are checked here, in the main process.

import fs from 'node:fs';
import path from 'node:path';
import type { Settings } from '../../shared/types';
import { checkRedactPatterns } from '../../shared/redactPatterns';
import { defaultSettings } from './settings';

const EXECUTABLE = /\.(exe|cmd|bat|com)$/i;

/** Error message for the "Claude Code path" setting, or null if acceptable. */
export function checkClaudePath(value: unknown): string | null {
  if (typeof value !== 'string') return 'Chemin de Claude Code invalide';
  const v = value.trim();
  if (!v) return null; // empty: default "claude", looked up in PATH
  if (/["\r\n\0]/.test(v)) return 'Le chemin de Claude Code contient un caractère interdit';
  if (!/[\\/]/.test(v)) return /^[\w.-]+$/.test(v) ? null : 'Nom de commande invalide (ex. « claude »)';
  let st: fs.Stats;
  try {
    st = fs.statSync(v);
  } catch {
    return `Fichier introuvable : ${v}`;
  }
  if (!st.isFile()) return `Ce chemin n’est pas un fichier : ${v}`;
  if (process.platform === 'win32' && !EXECUTABLE.test(v)) return 'Le chemin de Claude Code doit désigner un exécutable (.exe, .cmd, .bat)';
  return null;
}

/** Error message for the "Claude Code data folder" setting, or null if acceptable. */
export function checkClaudeHome(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return 'Dossier de données de Claude Code invalide';
  const v = value.trim();
  if (!path.isAbsolute(v)) return 'Le dossier de données de Claude Code doit être un chemin absolu';
  try {
    if (!fs.statSync(v).isDirectory()) return `Ce chemin n’est pas un dossier : ${v}`;
  } catch {
    return `Dossier introuvable : ${v}`;
  }
  return null;
}

/**
 * Keeps only known settings keys and checks the risky ones. Returns the cleaned patch and the errors;
 * the caller rejects the whole change if there is any error.
 */
export function validateSettingsPatch(patch: unknown): { patch: Partial<Settings>; errors: string[] } {
  const errors: string[] = [];
  if (!patch || typeof patch !== 'object') return { patch: {}, errors: ['Paramètres invalides'] };
  const known = new Set(Object.keys(defaultSettings()));
  const clean: Partial<Settings> = {};
  for (const [k, v] of Object.entries(patch)) if (known.has(k)) (clean as any)[k] = v;
  if ('claudePath' in clean) {
    const e = checkClaudePath(clean.claudePath);
    if (e) errors.push(e);
    else clean.claudePath = String(clean.claudePath).trim() || 'claude';
  }
  if ('claudeHome' in clean) {
    const e = checkClaudeHome(clean.claudeHome);
    if (e) errors.push(e);
    else clean.claudeHome = String(clean.claudeHome).trim();
  }
  if ('redactPatterns' in clean) errors.push(...checkRedactPatterns(clean.redactPatterns).errors);
  return { patch: clean, errors };
}
