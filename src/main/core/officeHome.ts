// ~/.ai-agent-office holds the hook relay, hook-events.jsonl and the quota probe's folder.
// If it cannot be created or written (locked-down profile, permissions), the app must still start:
// only quotas and hooks are disabled (R-22).

import fs from 'node:fs';
import path from 'node:path';

export function prepareOfficeHome(dir: string): { ok: boolean; reason?: string } {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.write-test-${process.pid}`);
    fs.writeFileSync(probe, '');
    fs.rmSync(probe, { force: true });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, reason: e?.code ?? e?.message ?? String(e) };
  }
}
