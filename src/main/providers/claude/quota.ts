// Subscription quotas (5-hour session window and weekly windows), from two real sources:
//  1. Claude Code's built-in `/usage` command, run headless:
//       claude -p --no-session-persistence --input-format stream-json --output-format stream-json --verbose
//     It is answered locally (0 token, 0 $, ~2 s) and prints e.g.
//       "Current session: 57% used · resets Oct 30, 3:39pm (Europe/Paris)"
//       "Current week (all models): 60% used · resets Nov 3, 9:59pm (Europe/Paris)"
//     It runs in a dedicated folder that the connector ignores, so it never shows up as an agent.
//  2. `rate_limit_event` messages emitted by sessions the app controls (structured, real time):
//       { unifiedWindows: { five_hour: { utilization: 0.86, resetsAt }, seven_day: {...} } }

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import type { QuotaState, QuotaWindow } from '../../../shared/types';
import { killTree } from './managed';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "Oct 30, 3:39pm (Europe/Paris)" or "3:39pm (Europe/Paris)" → epoch ms (local time), or null. */
export function parseResetText(text: string, now = new Date()): number | null {
  const m = /(?:([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(text.trim());
  if (!m) return null;
  let h = Number(m[3]);
  const min = Number(m[4] ?? 0);
  const ap = m[5]?.toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  const d = new Date(now);
  d.setSeconds(0, 0);
  d.setHours(h, min);
  if (m[1]) {
    const mon = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    if (mon < 0) return null;
    d.setMonth(mon, Number(m[2]));
    // Reset dates are in the future: a date long past means next year.
    if (d.getTime() < now.getTime() - 86_400_000) d.setFullYear(d.getFullYear() + 1);
  } else if (d.getTime() < now.getTime() - 60_000) {
    d.setDate(d.getDate() + 1); // time only, already past today → tomorrow
  }
  return d.getTime();
}

function windowId(label: string): { id: string; label: string } {
  const l = label.toLowerCase();
  if (l.includes('session')) return { id: 'five_hour', label: 'Session (5 h)' };
  const scope = /\(([^)]+)\)/.exec(label)?.[1] ?? '';
  if (l.includes('week')) {
    if (!scope || /all models/i.test(scope)) return { id: 'seven_day', label: 'Semaine (tous modèles)' };
    const s = scope.replace(/\s*only$/i, '');
    return { id: `seven_day_${s.toLowerCase().replace(/\W+/g, '_')}`, label: `Semaine (${s})` };
  }
  return { id: l.replace(/\W+/g, '_'), label };
}

/** Parses the text printed by `/usage`. */
export function parseUsageText(text: string, now = new Date()): Omit<QuotaState, 'fetchedAt' | 'source'> {
  if (/Total cost:/i.test(text) && !/% used/i.test(text)) return { plan: 'api', windows: [] };
  const windows: QuotaWindow[] = [];
  const re = /^\s*([A-Z][^:\n]{2,60}):\s*(\d+(?:[.,]\d+)?)\s*%\s*used(?:\s*[·•\-–]\s*resets\s+([^\n]+))?\s*$/gim;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const { id, label } = windowId(m[1]);
    const resetsText = m[3]?.trim();
    windows.push({ id, label, usedPct: Number(m[2].replace(',', '.')), resetsAt: resetsText ? parseResetText(resetsText, now) : null, resetsText });
  }
  const plan = /subscription/i.test(text) ? 'subscription' : windows.length ? 'subscription' : 'unknown';
  return { plan, windows };
}

/** Maps a stream-json `rate_limit_event.rate_limit_info` to quota windows. */
export function windowsFromRateLimit(info: any): QuotaWindow[] {
  const out: QuotaWindow[] = [];
  const w = info?.unifiedWindows;
  if (!w || typeof w !== 'object') return out;
  for (const [key, v] of Object.entries<any>(w)) {
    if (typeof v?.utilization !== 'number') continue;
    const label = key === 'five_hour' ? 'Session (5 h)' : key === 'seven_day' ? 'Semaine (tous modèles)' : key.replace(/_/g, ' ');
    out.push({
      id: key,
      label,
      usedPct: Math.round(v.utilization * 1000) / 10,
      resetsAt: typeof v.resetsAt === 'number' ? v.resetsAt * 1000 : null,
      status: v.status,
    });
  }
  return out;
}

const USAGE_ARGS = ['-p', '--no-session-persistence', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'];

export interface QuotaMonitorOptions {
  /** Max duration of one /usage probe (default 30 s). */
  timeoutMs?: number;
  /** Kills a process and its children (default: taskkill /T on Windows). */
  killTree?: (pid: number | undefined) => void;
  /** Program and arguments actually started for the given claude arguments. */
  command?: (args: string[]) => { file: string; args: string[] };
}

export class QuotaMonitor {
  private state: QuotaState | null = null;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<QuotaState> | null = null;
  /** Set when the probe folder cannot be created: no probe is ever started. */
  readonly disabled: string | null = null;

  private opts: Required<QuotaMonitorOptions>;

  constructor(
    private claudePath: () => string,
    readonly cwd: string,
    private onChange: (q: QuotaState) => void,
    opts: QuotaMonitorOptions = {},
  ) {
    this.opts = {
      timeoutMs: opts.timeoutMs ?? 30_000,
      killTree: opts.killTree ?? killTree,
      command: opts.command ?? ((args) => ({ file: this.claudePath(), args })),
    };
    try {
      mkdirSync(cwd, { recursive: true });
    } catch (e: any) {
      // Folder unusable (R-22): the app keeps running, quotas are simply unavailable.
      this.disabled = `Quota désactivé : dossier ${cwd} inaccessible (${e?.code ?? e?.message ?? e})`;
    }
  }

  get(): QuotaState | null {
    return this.state;
  }

  /** (Re)starts periodic refresh. 0 disables it. */
  schedule(minutes: number) {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (minutes > 0) this.timer = setInterval(() => void this.refresh(), minutes * 60_000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  private publish(next: QuotaState) {
    this.state = next;
    this.onChange(next);
  }

  /** Live update from a controlled session's rate_limit_event (more precise and more recent). */
  ingestRateLimit(info: any) {
    const windows = windowsFromRateLimit(info);
    if (!windows.length) return;
    const prev = this.state?.windows ?? [];
    // Keep per-model weekly windows that only /usage reports.
    const merged = [...windows, ...prev.filter((p) => !windows.some((w) => w.id === p.id))];
    this.publish({
      plan: 'subscription',
      windows: merged,
      fetchedAt: Date.now(),
      source: 'rate-limit-event',
      overage: info?.isUsingOverage ? 'en cours' : info?.overageStatus,
    });
  }

  refresh(): Promise<QuotaState> {
    if (this.running) return this.running;
    if (this.disabled) {
      const q: QuotaState = { plan: 'unknown', windows: this.state?.windows ?? [], fetchedAt: Date.now(), source: 'usage-command', error: this.disabled };
      this.publish(q);
      return Promise.resolve(q);
    }
    this.running = new Promise<QuotaState>((resolve) => {
      const done = (q: QuotaState) => {
        this.running = null;
        // A failed probe must not erase the last good values.
        if (q.error && this.state?.windows.length) q = { ...this.state, error: q.error };
        this.publish(q);
        resolve(q);
      };
      let out = '';
      let child;
      try {
        const cmd = this.opts.command(USAGE_ARGS);
        child = spawn(cmd.file, cmd.args, { cwd: this.cwd, windowsHide: true });
      } catch (e: any) {
        return done({ plan: 'unknown', windows: [], fetchedAt: Date.now(), source: 'usage-command', error: `Claude Code introuvable : ${e?.message ?? e}` });
      }
      let timedOut = false;
      // child.kill() would only end the first process (e.g. cmd.exe of claude.cmd): kill the whole tree (R-15).
      const kill = setTimeout(() => {
        timedOut = true;
        this.opts.killTree(child.pid);
      }, this.opts.timeoutMs);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (d: string) => (out += d));
      child.on('error', (e) => {
        clearTimeout(kill);
        done({ plan: 'unknown', windows: [], fetchedAt: Date.now(), source: 'usage-command', error: e.message });
      });
      child.on('exit', () => {
        clearTimeout(kill);
        let text = '';
        for (const line of out.split('\n')) {
          try {
            const o = JSON.parse(line);
            if (o.type === 'result' && typeof o.result === 'string') text = o.result;
          } catch {
            /* partial line */
          }
        }
        if (!text)
          return done({
            plan: 'unknown',
            windows: [],
            fetchedAt: Date.now(),
            source: 'usage-command',
            error: timedOut ? `Pas de réponse de /usage dans le délai (${Math.round(this.opts.timeoutMs / 1000)} s)` : 'Réponse de /usage vide',
          });
        const parsed = parseUsageText(text);
        done({
          ...parsed,
          fetchedAt: Date.now(),
          source: 'usage-command',
          error: parsed.plan === 'unknown' && !parsed.windows.length ? 'Format de /usage non reconnu' : undefined,
        });
      });
      child.stdin.end(JSON.stringify({ type: 'user', message: { role: 'user', content: '/usage' } }) + '\n');
    });
    return this.running;
  }
}
