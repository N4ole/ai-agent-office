// Data and robustness fixes from the 2026-11-14 audit (R-06, R-07, R-14, R-15, R-16).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { OfficeDB } from '../src/main/db/database';
import { exportToFile } from '../src/main/db/export';
import { QuotaMonitor } from '../src/main/providers/claude/quota';
import { killTree } from '../src/main/providers/claude/managed';
import { AgentManager, DESK_RELEASE_MS, type ManagerOutput } from '../src/main/core/agentManager';
import { mergeSettings } from '../src/main/core/settings';
import { appendHookLine } from '../src/main/core/hookLog';
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

describe('full JSON export (R-07)', () => {
  it('exports every event, beyond the former 5 000 limit, as valid JSON', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'aao-export-'));
    try {
      const db = new OfficeDB(null);
      await db.open();
      const t0 = Date.now() - 100_000;
      const evs: AgentEvent[] = Array.from({ length: 6001 }, (_, i) => ({
        id: `e${i}`,
        agentId: 'cc:a',
        ts: t0 + (i % 3000), // many equal timestamps: pagination must not skip or repeat any
        kind: 'tool_use',
        summary: `s${i}`,
        source: 'transcript',
      }));
      db.insertEvents(evs);
      const file = path.join(dir, 'export.json');
      const r = await exportToFile(db, file);
      const out = JSON.parse(readFileSync(file, 'utf8'));
      expect(r.events).toBe(6001);
      expect(out.events).toHaveLength(6001);
      expect(new Set(out.events.map((e: AgentEvent) => e.id)).size).toBe(6001);
      expect(out.events[0].ts).toBeGreaterThanOrEqual(out.events[6000].ts); // newest first, as before
      expect(Array.isArray(out.agents)).toBe(true);
      expect(Array.isArray(out.notifications)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('database flush (R-14)', () => {
  it('keeps changes pending and logs when the write fails, then saves them later', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'aao-flush-'));
    try {
      const file = path.join(dir, 'office.db');
      const errors: string[] = [];
      const db = new OfficeDB(file);
      db.onError = (m) => void errors.push(m);
      await db.open();
      db.setSetting('k', 1);
      mkdirSync(`${file}.tmp`); // the temporary file cannot be written: simulates a locked/full disk
      await expect(db.flush()).resolves.toBeUndefined();
      expect(db.hasUnsavedChanges).toBe(true);
      expect(errors).toHaveLength(1);
      rmSync(`${file}.tmp`, { recursive: true });
      await db.flush();
      expect(db.hasUnsavedChanges).toBe(false);
      db.close();
      const db2 = new OfficeDB(file);
      await db2.open();
      expect(db2.getSetting('k')).toBe(1);
      db2.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('/usage probe timeout (R-15)', () => {
  it('kills the whole process tree when the probe hangs', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'aao-quota-'));
    const killed: (number | undefined)[] = [];
    try {
      const q = new QuotaMonitor(
        () => 'claude',
        dir,
        () => {},
        {
          timeoutMs: 500,
          // A probe that never answers (and has a child of its own, like claude.cmd → node).
          command: () => ({
            file: process.execPath,
            args: ['-e', "require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1e3)']);setInterval(()=>{},1e3)"],
          }),
          killTree: (pid) => {
            killed.push(pid);
            killTree(pid);
          },
        },
      );
      const r = await q.refresh();
      expect(killed).toHaveLength(1);
      expect(killed[0]).toBeGreaterThan(0);
      expect(r.error).toMatch(/délai/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15_000);
});

describe('long-running memory and disk use (R-16)', () => {
  const quiet: ManagerOutput = { agentsChanged: () => {}, liveEvents: () => {}, notification: () => {}, console: () => {}, log: () => {} };

  it('frees the console of an agent that left the office', () => {
    const m = new AgentManager(null, quiet, () => mergeSettings({}));
    const t0 = Date.now() - 3600_000;
    m.upsertAgent({ id: 'cc:a', provider: 'claude-code', kind: 'session', sessionId: 'a', name: 'A', role: 'r', project: 'p', cwd: 'c', startedAt: t0 }, false);
    m.console('cc:a', { ts: t0, stream: 'out', text: 'hello' });
    m.patchAgent('cc:a', { status: 'done', endedAt: t0 });
    expect(m.getConsole('cc:a')).toHaveLength(1);
    m.housekeeping(t0 + DESK_RELEASE_MS + 1000);
    expect(m.agents.get('cc:a')?.desk).toBe(-1);
    expect(m.getConsole('cc:a')).toHaveLength(0);
  });

  it('rotates hook-events.jsonl when it grows too big', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'aao-hooks-'));
    try {
      const file = path.join(dir, 'hook-events.jsonl');
      for (let i = 0; i < 30; i++) appendHookLine(file, JSON.stringify({ i, pad: 'x'.repeat(40) }), 1000);
      expect(statSync(file).size).toBeLessThanOrEqual(1000);
      expect(existsSync(`${file}.1`)).toBe(true);
      expect(statSync(`${file}.1`).size).toBeLessThanOrEqual(1000);
      const last = readFileSync(file, 'utf8').trim().split('\n').pop()!;
      expect(JSON.parse(last).i).toBe(29);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('forgets read offsets of transcripts that no longer exist', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'aao-offsets-'));
    try {
      const kept = path.join(dir, 'kept.jsonl');
      writeFileSync(kept, '{}\n');
      const file = path.join(dir, 'office.db');
      const db = new OfficeDB(file);
      await db.open();
      db.setOffset(kept, 3);
      db.setOffset(path.join(dir, 'gone.jsonl'), 99);
      expect(db.pruneOffsets()).toBe(1);
      db.flushSync();
      db.close();
      const db2 = new OfficeDB(file);
      await db2.open();
      expect(db2.getOffset(kept)).toBe(3);
      expect(db2.getOffset(path.join(dir, 'gone.jsonl'))).toBeUndefined();
      db2.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
