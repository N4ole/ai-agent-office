// R-01 / R-08: purging history must also clear the manager's memory, tell the UI,
// and never re-import already-read transcripts after a restart.

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { OfficeDB } from '../src/main/db/database';
import { AgentManager, type ManagerOutput } from '../src/main/core/agentManager';
import { mergeSettings } from '../src/main/core/settings';
import { purgeHistory } from '../src/main/core/purge';
import type { AgentIdentity } from '../src/main/core/reducer';
import type { AgentEvent } from '../src/shared/types';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'aao-purge-'));
  dirs.push(d);
  return d;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

const DAY = 86_400_000;
const settings = mergeSettings({});

function output() {
  const removed: string[] = [];
  const o: ManagerOutput = {
    agentsChanged: (_a, r) => void removed.push(...r),
    liveEvents: () => {},
    notification: () => {},
    console: () => {},
    log: () => {},
  };
  return { removed, o };
}

const idn = (id: string, startedAt: number): AgentIdentity => ({
  id,
  provider: 'claude-code',
  kind: 'session',
  sessionId: id.replace('cc:', ''),
  name: `Session ${id}`,
  role: 'Agent principal',
  project: 'p',
  cwd: 'C:\\p',
  startedAt,
});
const ev = (agentId: string, id: string, ts: number): AgentEvent => ({ id, agentId, ts, kind: 'tool_use', summary: `s ${id}`, source: 'transcript' });

describe('purge all (R-01)', () => {
  it('clears memory, notifies the UI, keeps offsets and does not re-import after restart', async () => {
    const file = path.join(tmp(), 'office.db');
    const db = new OfficeDB(file);
    await db.open();
    const { removed, o } = output();
    const m = new AgentManager(db, o, () => settings);
    const t0 = Date.now() - 3600_000;
    m.upsertAgent(idn('cc:s1', t0), false);
    m.events([ev('cc:s1', 'e1', t0 + 1000), ev('cc:s1', 'e2', t0 + 2000)], false);
    m.flush();
    db.setOffset('C:/x/s1.jsonl', 4096);

    const r = purgeHistory(db, m, 'all');
    m.flush();
    expect(r.ok).toBe(true);
    expect(m.agents.size).toBe(0);
    expect(removed).toContain('cc:s1');
    expect(db.countEvents()).toBe(0);
    expect(db.loadAgents()).toHaveLength(0);
    // Offsets are kept: the transcripts were read already.
    expect(db.getOffset('C:/x/s1.jsonl')).toBe(4096);
    // The message tells the truth about what happens next.
    expect(r.message).toMatch(/ne seront pas réimportés/);

    // Restart: the provider re-reads the same transcript from scratch.
    db.flushSync();
    db.close();
    const db2 = new OfficeDB(file);
    await db2.open();
    const out2 = output();
    const m2 = new AgentManager(db2, out2.o, () => settings);
    m2.restore(db2.loadAgents());
    m2.upsertAgent(idn('cc:s1', t0), false);
    m2.events([ev('cc:s1', 'e1', t0 + 1000), ev('cc:s1', 'e2', t0 + 2000)], false);
    m2.flush();
    expect(m2.agents.size).toBe(0);
    expect(db2.countEvents()).toBe(0);

    // New activity of a still-running session brings it back.
    m2.patchAgent('cc:s1', { gitBranch: 'main' });
    m2.events([ev('cc:s1', 'e3', Date.now() + 1000)], true);
    expect(m2.agents.get('cc:s1')?.gitBranch).toBe('main');
    expect(db2.countEvents()).toBe(2); // 'agent_detected' + e3
    db2.close();
  });
});

describe('purge by age (R-08)', () => {
  it('removes old inactive agents from memory and notifies the UI', async () => {
    const db = new OfficeDB(null);
    await db.open();
    const { removed, o } = output();
    const m = new AgentManager(db, o, () => settings);
    const old = Date.now() - 40 * DAY;
    m.upsertAgent(idn('cc:old', old), false);
    m.events([ev('cc:old', 'o1', old + 1000)], false);
    m.upsertAgent(idn('cc:new', Date.now() - 1000), false);
    m.events([ev('cc:new', 'n1', Date.now())], false);
    m.flush();

    const r = purgeHistory(db, m, 30);
    m.flush();
    expect(r.ok).toBe(true);
    expect([...m.agents.keys()]).toEqual(['cc:new']);
    expect(removed).toEqual(['cc:old']);
    expect(db.loadAgents().map((a) => a.id)).toEqual(['cc:new']);
    expect(r.message).toBe('2 événements et 1 agents de plus de 30 jours supprimés'); // 'agent_detected' + o1

    // Re-reading the old transcript does not bring the purged data back.
    m.upsertAgent(idn('cc:old', old), false);
    m.events([ev('cc:old', 'o1', old + 1000)], false);
    expect(m.agents.has('cc:old')).toBe(false);
  });

  it('rejects an invalid duration', async () => {
    const db = new OfficeDB(null);
    await db.open();
    const m = new AgentManager(db, output().o, () => settings);
    expect(purgeHistory(db, m, 0).ok).toBe(false);
  });
});
