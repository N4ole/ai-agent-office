// Optional Claude Code hook relay. Claude Code runs it for Notification / SessionStart / SessionEnd
// hooks and pipes the hook payload (JSON) on stdin. It appends a minimal line, with secrets masked
// (built-in patterns) and long texts truncated, to
// ~/.ai-agent-office/hook-events.jsonl, which AI Agent Office tails. It never blocks Claude Code:
// any failure exits 0 silently, and a hard timeout ends the process after 2 s.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { appendHookLine, hookRecord } from './core/hookLog';

setTimeout(() => process.exit(0), 2000).unref();
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  try {
    const keep = hookRecord(JSON.parse(input), Date.now()); // secrets masked before writing
    const dir = path.join(os.homedir(), '.ai-agent-office');
    fs.mkdirSync(dir, { recursive: true });
    appendHookLine(path.join(dir, 'hook-events.jsonl'), JSON.stringify(keep));
  } catch {
    /* never fail the hook */
  }
  process.exit(0);
});
