import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { JsonlTailer } from '../src/main/providers/claude/tailer';
import { OfficeDB } from '../src/main/db/database';
import { createAgent } from '../src/main/core/reducer';
import type { AgentEvent } from '../src/shared/types';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'aao-'));
  dirs.push(d);
  return d;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('JsonlTailer', () => {
  it('reads only complete lines and resumes after partial writes', async () => {
    const f = path.join(tmp(), 'a.jsonl');
    writeFileSync(f, '{"a":1}\n{"b":');
    const t = new JsonlTailer();
    expect((await t.read(f)).lines).toEqual(['{"a":1}']);
    appendFileSync(f, '2}\n');
    expect((await t.read(f)).lines).toEqual(['{"b":2}']);
    expect((await t.read(f)).lines).toEqual([]);
  });

  it('handles multi-byte characters and CRLF', async () => {
    const f = path.join(tmp(), 'b.jsonl');
    writeFileSync(f, '{"t":"été ✓"}\r\n');
    expect((await new JsonlTailer().read(f)).lines).toEqual(['{"t":"été ✓"}']);
  });

  it('restarts from zero when a file is truncated', async () => {
    const f = path.join(tmp(), 'c.jsonl');
    writeFileSync(f, '{"a":1}\n{"a":2}\n');
    const t = new JsonlTailer();
    await t.read(f);
    writeFileSync(f, '{"z":9}\n');
    const r = await t.read(f);
    expect(r.reset).toBe(true);
    expect(r.lines).toEqual(['{"z":9}']);
  });

  it('reads big files in chunks', async () => {
    const f = path.join(tmp(), 'd.jsonl');
    writeFileSync(f, Array.from({ length: 1000 }, (_, i) => JSON.stringify({ i })).join('\n') + '\n');
    const t = new JsonlTailer(1024);
    let total = 0;
    for (let g = 0; g < 1000; g++) {
      const r = await t.read(f);
      total += r.lines.length;
      if (!r.more) break;
    }
    expect(total).toBe(1000);
  });
});

const ev = (id: string, extra: Partial<AgentEvent> = {}): AgentEvent => ({
  id,
  agentId: 'cc:a',
  ts: Date.now(),
  kind: 'tool_use',
  summary: `s ${id}`,
  source: 'transcript',
  ...extra,
});

describe('OfficeDB', () => {
  it('deduplicates events by id', async () => {
    const db = new OfficeDB(null);
    await db.open();
    expect(db.insertEvents([ev('1'), ev('2')])).toHaveLength(2);
    expect(db.insertEvents([ev('2'), ev('3')]).map((e) => e.id)).toEqual(['3']);
    expect(db.countEvents()).toBe(3);
  });

  it('searches and filters events, hiding usage by default', async () => {
    const db = new OfficeDB(null);
    await db.open();
    db.insertEvents([ev('a', { summary: 'npm test', isError: true }), ev('b', { summary: 'lit fichier' }), ev('u', { kind: 'usage' })]);
    expect(db.queryEvents({ text: 'npm' }).map((e) => e.id)).toEqual(['a']);
    expect(db.queryEvents({ errorsOnly: true }).map((e) => e.id)).toEqual(['a']);
    expect(db.queryEvents({}).some((e) => e.kind === 'usage')).toBe(false);
    expect(db.queryEvents({ kinds: ['usage'] })).toHaveLength(1);
  });

  it('persists agents, offsets and settings across reopen', async () => {
    const file = path.join(tmp(), 'office.db');
    const db = new OfficeDB(file);
    await db.open();
    const a = createAgent(
      { id: 'cc:a', provider: 'claude-code', kind: 'session', sessionId: 's', name: 'N', role: 'r', project: 'p', cwd: 'c', startedAt: 1 },
      3,
    );
    db.saveAgent(a);
    db.setOffset('f.jsonl', 1234);
    db.setSetting('settings', { scanDays: 3 });
    db.insertEvents([ev('x')]);
    db.flushSync();
    db.close();
    const db2 = new OfficeDB(file);
    await db2.open();
    expect(db2.loadAgents()[0]).toMatchObject({ id: 'cc:a', desk: 3, color: a.color });
    expect(db2.getOffset('f.jsonl')).toBe(1234);
    expect(db2.getSetting<any>('settings').scanDays).toBe(3);
    expect(db2.countEvents()).toBe(1);
  });

  it('never persists demo agents', async () => {
    const db = new OfficeDB(null);
    await db.open();
    const a = createAgent(
      { id: 'demo:1', provider: 'demo', kind: 'session', sessionId: 'd', name: 'D', role: 'r', project: 'p', cwd: '', startedAt: 1, demo: true },
      0,
    );
    db.saveAgent(a);
    expect(db.loadAgents()).toHaveLength(0);
  });

  it('purges old data', async () => {
    const db = new OfficeDB(null);
    await db.open();
    db.insertEvents([ev('old', { ts: Date.now() - 40 * 86_400_000 }), ev('new')]);
    expect(db.purgeOlderThan(30).events).toBe(1);
    expect(db.countEvents()).toBe(1);
  });

  it('recovers from a corrupted database file', async () => {
    const file = path.join(tmp(), 'bad.db');
    writeFileSync(file, 'not a sqlite file at all');
    const db = new OfficeDB(file);
    await db.open();
    expect(db.countEvents()).toBe(0);
  });
});
