// "Export all (JSON)" from the settings screen (R-07): complete export, streamed to disk page by
// page so a large history never has to be serialized as one huge string.

import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import type { OfficeDB } from './database';

export async function exportToFile(db: OfficeDB, file: string): Promise<{ events: number }> {
  const out = createWriteStream(file, { encoding: 'utf8' });
  const failed = once(out, 'error').then(([e]) => Promise.reject(e));
  failed.catch(() => {}); // surfaced through the races below
  const write = async (s: string) => {
    if (!out.write(s)) await Promise.race([once(out, 'drain'), failed]);
  };
  let n = 0;
  try {
    await write(`{\n  "agents": ${JSON.stringify(db.loadAgents())},\n  "events": [`);
    for (const page of db.eventPages()) {
      for (const e of page) await write(`${n++ ? ',' : ''}\n    ${JSON.stringify(e)}`);
    }
    await write(`\n  ],\n  "notifications": ${JSON.stringify(db.loadNotifications(-1))}\n}\n`);
    out.end();
    await Promise.race([finished(out), failed]);
  } catch (e) {
    out.destroy();
    throw e;
  }
  return { events: n };
}
