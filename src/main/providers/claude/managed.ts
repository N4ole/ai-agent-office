// Sessions launched and controlled by the app, through Claude Code's documented headless mode:
//   claude -p --input-format stream-json --output-format stream-json --verbose
// Verified on Claude Code 2.1.312:
//  - each stdin line {"type":"user",...} starts a turn; the process stays alive between turns
//  - {"type":"control_request","request":{"subtype":"interrupt"}} interrupts the running turn
//  - stdout emits system/init (with session_id), assistant, user, result messages
// Agent activity itself is read from the transcript file (single source of truth); stdout feeds
// the integrated console only.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { LaunchOptions } from '../../../shared/types';
import type { ConsoleLine } from '../provider';
import { clean, firstLine } from '../../core/redact';
import { summarizeTool } from './parser';

export interface ManagedEvents {
  onSession(sessionId: string, proc: ManagedProcess): void;
  onConsole(sessionId: string | null, tempKey: string, line: ConsoleLine): void;
  onTurnResult(sessionId: string, ok: boolean, summary: string): void;
  onExit(sessionId: string | null, tempKey: string, code: number | null, requested: boolean, stderrTail: string): void;
  /** Subscription quota snapshot sent with API responses (stream-json `rate_limit_event`). */
  onRateLimit?(info: unknown): void;
}

export interface ManagedProcess {
  key: string;
  sessionId: string | null;
  child: ChildProcessWithoutNullStreams;
  cwd: string;
  opts: LaunchOptions;
  stopRequested: boolean;
  busy: boolean;
  startedAt: number;
}

let counter = 0;

export function buildArgs(opts: LaunchOptions): string[] {
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'];
  if (opts.model) args.push('--model', opts.model);
  if (opts.permissionMode && opts.permissionMode !== 'default') args.push('--permission-mode', opts.permissionMode);
  if (opts.resumeSessionId) args.push('--resume', opts.resumeSessionId);
  return args;
}

export function userMessage(text: string): string {
  return JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n';
}

/** Renders one stream-json message as console lines. */
export function renderStreamMessage(o: any): string[] {
  const out: string[] = [];
  if (o.type === 'system' && o.subtype === 'init') out.push(`● Session ${o.session_id} prête (modèle ${o.model ?? '?'}, mode ${o.permissionMode ?? '?'})`);
  else if (o.type === 'assistant') {
    for (const b of o.message?.content ?? []) {
      if (b.type === 'text' && b.text?.trim()) out.push(clean(b.text, 4000));
      else if (b.type === 'tool_use') out.push(`⚙ ${summarizeTool(b.name, b.input ?? {})}`);
    }
  } else if (o.type === 'user') {
    for (const b of Array.isArray(o.message?.content) ? o.message.content : []) {
      if (b.type === 'tool_result') {
        const t = typeof b.content === 'string' ? b.content : (b.content ?? []).map((x: any) => x.text ?? '').join('\n');
        out.push(`${b.is_error ? '✖' : '↳'} ${firstLine(clean(t, 800), 300)}`);
      }
    }
  } else if (o.type === 'result') {
    const cost = typeof o.total_cost_usd === 'number' ? ` · ${o.total_cost_usd.toFixed(4)} $` : '';
    out.push(`■ Fin du tour : ${o.subtype}${o.is_error ? ' (erreur)' : ''} · ${Math.round((o.duration_ms ?? 0) / 1000)} s${cost}`);
  }
  return out;
}

export class ManagedSessions {
  private procs = new Map<string, ManagedProcess>();

  constructor(
    private claudePath: () => string,
    private ev: ManagedEvents,
  ) {}

  bySession(sessionId: string): ManagedProcess | undefined {
    for (const p of this.procs.values()) if (p.sessionId === sessionId) return p;
    return undefined;
  }

  isRunning(sessionId: string): boolean {
    const p = this.bySession(sessionId);
    return !!p && p.child.exitCode === null && !p.child.killed;
  }

  list(): ManagedProcess[] {
    return [...this.procs.values()];
  }

  launch(opts: LaunchOptions): Promise<{ ok: boolean; message: string; sessionId?: string }> {
    const key = `m${++counter}`;
    return new Promise((resolve) => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(this.claudePath(), buildArgs(opts), { cwd: opts.cwd, windowsHide: true, env: process.env });
      } catch (e: any) {
        resolve({ ok: false, message: `Impossible de lancer Claude Code : ${e?.message ?? e}` });
        return;
      }
      const mp: ManagedProcess = {
        key,
        sessionId: opts.resumeSessionId ?? null,
        child,
        cwd: opts.cwd,
        opts,
        stopRequested: false,
        busy: false,
        startedAt: Date.now(),
      };
      this.procs.set(key, mp);
      let settled = false;
      const settle = (r: { ok: boolean; message: string; sessionId?: string }) => {
        if (!settled) {
          settled = true;
          resolve(r);
        }
      };
      let stderrTail = '';
      let buf = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (d: string) => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line) continue;
          let o: any;
          try {
            o = JSON.parse(line);
          } catch {
            this.ev.onConsole(mp.sessionId, key, { ts: Date.now(), stream: 'out', text: clean(line, 2000) });
            continue;
          }
          if (o.type === 'system' && o.subtype === 'init' && o.session_id) {
            const first = mp.sessionId !== o.session_id;
            mp.sessionId = o.session_id;
            if (first) this.ev.onSession(o.session_id, mp);
            settle({ ok: true, message: `Session ${o.session_id} lancée`, sessionId: o.session_id });
          }
          if (o.type === 'rate_limit_event' && o.rate_limit_info) this.ev.onRateLimit?.(o.rate_limit_info);
          if (o.type === 'result' && mp.sessionId) {
            mp.busy = false;
            this.ev.onTurnResult(mp.sessionId, !o.is_error, `${o.subtype}${o.is_error ? ' (erreur)' : ''}`);
          }
          for (const text of renderStreamMessage(o)) this.ev.onConsole(mp.sessionId, key, { ts: Date.now(), stream: 'out', text });
        }
      });
      child.stderr.on('data', (d: string) => {
        stderrTail = (stderrTail + d).slice(-4000);
        this.ev.onConsole(mp.sessionId, key, { ts: Date.now(), stream: 'err', text: clean(d, 2000) });
      });
      child.on('error', (e) => {
        settle({ ok: false, message: `Échec du lancement : ${e.message}` });
      });
      child.on('exit', (code) => {
        this.procs.delete(key);
        this.ev.onExit(mp.sessionId, key, code, mp.stopRequested, stderrTail);
        settle({ ok: false, message: `Claude Code s’est arrêté avant de démarrer (code ${code}). ${firstLine(stderrTail, 300)}` });
      });
      if (opts.resumeSessionId) {
        // Resumed session: we already know the id, register immediately.
        this.ev.onSession(opts.resumeSessionId, mp);
      }
      if (opts.prompt) {
        mp.busy = true;
        child.stdin.write(userMessage(opts.prompt));
        this.ev.onConsole(mp.sessionId, key, { ts: Date.now(), stream: 'in', text: `> ${clean(opts.prompt, 2000)}` });
      } else if (opts.resumeSessionId) {
        settle({ ok: true, message: `Session ${opts.resumeSessionId} reprise : en attente d’une instruction`, sessionId: opts.resumeSessionId });
      }
      // Safety net: init normally arrives within a few seconds.
      setTimeout(
        () => settle({ ok: mp.child.exitCode === null, message: mp.child.exitCode === null ? 'Lancé (en attente de la session)' : 'Échec du lancement' }),
        30_000,
      );
    });
  }

  send(sessionId: string, text: string): boolean {
    const p = this.bySession(sessionId);
    if (!p || p.child.exitCode !== null) return false;
    p.busy = true;
    p.child.stdin.write(userMessage(text));
    this.ev.onConsole(sessionId, p.key, { ts: Date.now(), stream: 'in', text: `> ${clean(text, 2000)}` });
    return true;
  }

  interrupt(sessionId: string): boolean {
    const p = this.bySession(sessionId);
    if (!p || p.child.exitCode !== null) return false;
    p.child.stdin.write(JSON.stringify({ type: 'control_request', request_id: `int-${Date.now()}`, request: { subtype: 'interrupt' } }) + '\n');
    this.ev.onConsole(sessionId, p.key, { ts: Date.now(), stream: 'sys', text: '⏸ Interruption demandée' });
    return true;
  }

  stop(sessionId: string): boolean {
    const p = this.bySession(sessionId);
    if (!p) return false;
    p.stopRequested = true;
    killTree(p.child.pid);
    return true;
  }

  async stopAll(): Promise<void> {
    for (const p of this.procs.values()) {
      p.stopRequested = true;
      killTree(p.child.pid);
    }
  }
}

/** Kills a process and its children (Windows: taskkill /T). */
export function killTree(pid: number | undefined): void {
  if (!pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  } else {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
}
