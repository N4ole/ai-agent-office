// Append-only log written by the hook relay (~/.ai-agent-office/hook-events.jsonl).
// Rotated so it never grows without limit (R-16): when the next line would exceed `maxBytes`,
// the file is renamed to `<file>.1` (replacing the previous one) and a new file is started.
// The app's reader detects the smaller file and starts again from its beginning.

import fs from 'node:fs';
import { redact } from './redact';

export const HOOK_LOG_MAX_BYTES = 5 * 1024 * 1024;

export function appendHookLine(file: string, line: string, maxBytes = HOOK_LOG_MAX_BYTES): void {
  const data = line + '\n';
  try {
    const size = fs.statSync(file).size;
    if (size > 0 && size + Buffer.byteLength(data) > maxBytes) fs.renameSync(file, `${file}.1`);
  } catch {
    /* no file yet, or rotated concurrently by another hook */
  }
  fs.appendFileSync(file, data);
}

/**
 * The minimal line kept for one hook payload. Free text is masked with the built-in secret patterns
 * *before* it reaches the disk, then truncated (user-defined patterns live in the app's database and
 * are applied again when the app reads the line).
 */
export function hookRecord(h: any, ts: number) {
  const text = (v: unknown, max: number) => (typeof v === 'string' ? redact(v).slice(0, max) : undefined);
  return {
    ts,
    hook_event_name: h?.hook_event_name,
    session_id: h?.session_id,
    agent_id: h?.agent_id,
    cwd: h?.cwd,
    message: text(h?.message, 500),
    notification_type: h?.notification_type,
    reason: text(h?.reason, 200),
    source: h?.source,
  };
}
