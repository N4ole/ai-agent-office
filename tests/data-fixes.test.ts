// Data and robustness fixes from the 2026-11-14 audit (R-06, R-07, R-14, R-15, R-16).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OfficeDB } from '../src/main/db/database';
import type { AgentEvent } from '../src/shared/types';

const usage = (id: string, ts: number, output: number): AgentEvent => ({
  id,
  agentId: 'cc:a',
  ts,
  kind: 'usage',
  summary: 'usage',
  source: 'transcript',
  data: { input: 1, output },
});

const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('tokens per day (R-06)', () => {
  const prevTz = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = 'Europe/Paris'; // UTC+1/+2: 00:30 local is still "yesterday" in UTC
  });
  afterAll(() => {
    if (prevTz === undefined) delete process.env.TZ;
    else process.env.TZ = prevTz;
  });

  it('groups by local date, not UTC', async () => {
    const db = new OfficeDB(null);
    await db.open();
    const t = new Date();
    t.setDate(t.getDate() - 1);
    t.setHours(0, 30, 0, 0); // just after local midnight
    db.insertEvents([usage('u1', t.getTime(), 42)]);
    expect(db.usageByDay(14)).toEqual([{ day: localDay(t), input: 1, output: 42 }]);
  });
});
