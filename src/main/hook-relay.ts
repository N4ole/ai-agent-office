// Optional Claude Code hook relay. Claude Code runs it for Notification / SessionStart / SessionEnd
// hooks and pipes the hook payload (JSON) on stdin. It appends a minimal, redacted line to
// ~/.ai-agent-office/hook-events.jsonl, which AI Agent Office tails. It never blocks Claude Code:
// any failure exits 0 silently, and a hard timeout ends the process after 2 s.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

setTimeout(() => process.exit(0), 2000).unref();
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  try {
    const h = JSON.parse(input);
    const keep = {
      ts: Date.now(),
      hook_event_name: h.hook_event_name,
      session_id: h.session_id,
      agent_id: h.agent_id,
      cwd: h.cwd,
      message: typeof h.message === 'string' ? h.message.slice(0, 500) : undefined,
      notification_type: h.notification_type,
      reason: h.reason,
      source: h.source,
    };
    const dir = path.join(os.homedir(), '.ai-agent-office');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'hook-events.jsonl'), JSON.stringify(keep) + '\n');
  } catch {
    /* never fail the hook */
  }
  process.exit(0);
});
