// Safe construction of Windows command lines (R-03, R-18).
//
// Node refuses to spawn a .cmd/.bat without a shell (CVE-2024-27980), and a shell parses
// & | < > ^ % ; ( ) itself. Everything that must go through cmd.exe is therefore built here:
//  - each token is wrapped in double quotes (inside quotes cmd treats & | < > ^ ( ) ; , as text);
//  - % is broken out of the quotes as "^%" so cmd cannot expand an environment variable;
//  - tokens containing " or a line break are rejected (Windows paths cannot contain them);
//  - arguments passed to a .cmd script must also match a conservative character set, because the
//    script re-parses them (%*); prompts never go there (they are sent on stdin).

import { execFileSync } from 'node:child_process';
import path from 'node:path';

export interface SpawnSpec {
  file: string;
  args: string[];
  /** Must be passed to spawn(): the command line is already quoted for cmd.exe. */
  windowsVerbatimArguments?: boolean;
}

export class UnsafeArgumentError extends Error {}

/** Quotes one token for a cmd.exe command line. */
export function quoteForCmd(token: string): string {
  if (/["\r\n\0]/.test(token)) throw new UnsafeArgumentError(`Caractère interdit dans « ${token} »`);
  return `"${token.replace(/%/g, '"^%"')}"`;
}

/** Characters accepted in arguments given to a .cmd/.bat script (flags, model names, session ids). */
const SAFE_SCRIPT_ARG = /^[A-Za-z0-9_\-.:/\\@=+,~[\] ]*$/;

export function checkScriptArg(arg: string): string {
  if (!SAFE_SCRIPT_ARG.test(arg)) throw new UnsafeArgumentError(`Argument refusé pour un script .cmd : « ${arg} »`);
  return arg;
}

/** `cmd.exe /d /s /c "<"program" "arg"...>"`: /d skips AutoRun, /s strips exactly the outer quotes. */
export function cmdLine(program: string, args: string[]): string {
  return `"${[quoteForCmd(program), ...args.map((a) => quoteForCmd(checkScriptArg(a)))].join(' ')}"`;
}

export function comspec(env: NodeJS.ProcessEnv = process.env): string {
  return env.ComSpec || env.COMSPEC || 'cmd.exe';
}

export function isBatchFile(file: string): boolean {
  return /\.(cmd|bat)$/i.test(file);
}

/** How to start `program args` without a shell, except for .cmd/.bat which need cmd.exe. */
export function spawnSpec(program: string, args: string[], env: NodeJS.ProcessEnv = process.env): SpawnSpec {
  if (process.platform === 'win32' && isBatchFile(program)) {
    return { file: comspec(env), args: ['/d', '/s', '/c', cmdLine(program, args)], windowsVerbatimArguments: true };
  }
  return { file: program, args };
}

// ---------- resolution of the `claude` command (R-03) ----------

const cache = new Map<string, { at: number; file: string }>();

/**
 * Turns the "Claude Code path" setting into an executable file. A bare name ("claude") is looked up
 * with `where`, keeping only real executables (PATHEXT): the npm install provides claude.cmd (plus an
 * extension-less shell script that Windows cannot run), the native installer claude.exe.
 * Falls back to the setting itself, so spawn() reports a normal "not found" error.
 */
export function resolveProgram(setting: string, env: NodeJS.ProcessEnv = process.env): string {
  const name = setting.trim() || 'claude';
  if (process.platform !== 'win32' || /[\\/]/.test(name)) return name;
  const key = `${name}|${env.PATH ?? env.Path ?? ''}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.file;
  let file = name;
  try {
    const out = execFileSync('where.exe', [name], { env, windowsHide: true, timeout: 5000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const exts = (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').toLowerCase().split(';').filter(Boolean);
    const found = out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && exts.includes(path.extname(l).toLowerCase()));
    if (found[0]) file = found[0];
  } catch {
    /* not found: keep the bare name */
  }
  cache.set(key, { at: Date.now(), file });
  return file;
}

export function clearResolveCache(): void {
  cache.clear();
}

/** Spawn spec for running Claude Code with `args`, whatever the install method (R-03). */
export function claudeSpawn(setting: string, args: string[], env: NodeJS.ProcessEnv = process.env): SpawnSpec {
  return spawnSpec(resolveProgram(setting, env), args, env);
}

// ---------- terminals (R-18) ----------

/** Windows Terminal splits its command line on ';' (new tab); a literal ';' is written '\;'. */
export function escapeWt(token: string): string {
  return token.replace(/;/g, '\\;');
}

/** `wt -d <cwd> [command...]`. */
export function wtSpec(cwd: string, command?: string[]): SpawnSpec {
  return { file: 'wt.exe', args: ['-d', escapeWt(cwd), ...(command ?? []).map(escapeWt)] };
}

/**
 * Fallback without Windows Terminal: a new cmd.exe window in `cwd`. The folder is never put on the
 * command line (it is the spawn cwd), so & ^ | ; % in its name cannot be interpreted.
 */
export function cmdWindowSpec(command?: string[], env: NodeJS.ProcessEnv = process.env, opts: { launcher?: string; keep?: '/k' | '/c' } = {}): SpawnSpec {
  const launcher = opts.launcher ?? 'start ""';
  const keep = opts.keep ?? '/k';
  // The line is parsed twice: by this cmd.exe (running `start`), then by the new window's cmd.exe.
  // For the first pass every special character of the inner command is caret-escaped (quotes
  // included, so they do not toggle quoting); the second pass sees the properly quoted command.
  const inner = command?.length ? ` ${caretEscape(cmdLine(command[0], command.slice(1)))}` : '';
  return {
    file: comspec(env),
    args: ['/d', '/s', '/c', `"${launcher} ${quoteForCmd(comspec(env))} /d ${keep}${inner}"`],
    windowsVerbatimArguments: true,
  };
}

/** Escapes every cmd.exe special character with ^ (for text parsed outside double quotes). */
export function caretEscape(s: string): string {
  return s.replace(/[\^&|<>()"%!]/g, '^$&');
}
