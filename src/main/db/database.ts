// Local SQLite persistence via sql.js (WebAssembly: no native module to compile on Windows).
// The database lives in memory and is flushed to disk atomically (tmp file + rename), debounced.

import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { promises as fsp, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AgentEvent, AppNotification } from '../../shared/types';
import type { InternalAgent } from '../core/reducer';
import { localDay } from '../../shared/dates';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY, session_id TEXT, parent_id TEXT, kind TEXT, project TEXT, cwd TEXT,
  name TEXT, status TEXT, started_at INTEGER, last_event_at INTEGER, demo INTEGER DEFAULT 0, json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS agents_session ON agents(session_id);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, ts INTEGER NOT NULL, kind TEXT NOT NULL, summary TEXT,
  detail TEXT, tool TEXT, is_error INTEGER DEFAULT 0, source TEXT, data TEXT
);
CREATE INDEX IF NOT EXISTS events_agent_ts ON events(agent_id, ts);
CREATE INDEX IF NOT EXISTS events_ts ON events(ts);
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY, ts INTEGER, type TEXT, level TEXT, title TEXT, body TEXT, agent_id TEXT, read INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS offsets (file TEXT PRIMARY KEY, offset INTEGER);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
`;

/** Events that carry no information worth keeping (no accumulators depend on them). */
const NOT_STORED = new Set(['thinking']);
/** Stored for deduplication/statistics but hidden from logs unless explicitly requested. */
export const HIDDEN_KINDS = ['usage', 'cost'];
const HISTORY_CUTOFF_KEY = 'historyCutoff';

export interface EventQuery {
  agentId?: string;
  agentIds?: string[];
  kinds?: string[];
  text?: string;
  errorsOnly?: boolean;
  before?: number;
  since?: number;
  limit?: number;
}

let SQL: SqlJsStatic | null = null;

export async function loadSqlJs(wasmPath?: string): Promise<SqlJsStatic> {
  if (SQL) return SQL;
  SQL = await initSqlJs(wasmPath ? { wasmBinary: readFileSync(wasmPath) as unknown as ArrayBuffer } : undefined);
  return SQL;
}

export class OfficeDB {
  private db!: Database;
  private dirty = false;
  private timer: NodeJS.Timeout | null = null;
  private offsets = new Map<string, number>();
  private saving = false;
  /** Events older than this (epoch ms) are never stored again: set by an explicit purge (R-01). */
  private cutoff = 0;

  /** `file` = null keeps everything in memory (tests). */
  constructor(private file: string | null) {}

  async open(wasmPath?: string): Promise<void> {
    const S = await loadSqlJs(wasmPath);
    if (this.file && existsSync(this.file)) {
      try {
        this.db = new S.Database(readFileSync(this.file));
        this.db.exec('SELECT 1 FROM agents LIMIT 1');
      } catch {
        // Corrupted file: keep a copy and start fresh rather than crash.
        try {
          renameSync(this.file, `${this.file}.corrupt-${Date.now()}`);
        } catch {
          /* ignore */
        }
        this.db = new S.Database();
      }
    } else this.db = new S.Database();
    this.db.exec(SCHEMA);
    for (const r of this.all<{ file: string; offset: number }>('SELECT file, offset FROM offsets')) this.offsets.set(r.file, r.offset);
    this.cutoff = Number(this.getSetting<number>(HISTORY_CUTOFF_KEY)) || 0;
  }

  /** Epoch ms before which history was purged by the user (0 = never). */
  get historyCutoff(): number {
    return this.cutoff;
  }

  private rememberCutoff(ts: number): void {
    if (ts <= this.cutoff) return;
    this.cutoff = ts;
    this.setSetting(HISTORY_CUTOFF_KEY, ts);
  }

  private all<T>(sql: string, params: any[] = []): T[] {
    const st = this.db.prepare(sql);
    try {
      st.bind(params);
      const rows: T[] = [];
      while (st.step()) rows.push(st.getAsObject() as T);
      return rows;
    } finally {
      st.free();
    }
  }

  private run(sql: string, params: any[] = []) {
    this.db.run(sql, params);
    this.markDirty();
  }

  markDirty() {
    this.dirty = true;
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, 3000);
  }

  async flush(): Promise<void> {
    if (!this.file || !this.dirty || this.saving) return;
    this.saving = true;
    try {
      this.dirty = false;
      const data = this.db.export();
      const tmp = `${this.file}.tmp`;
      await fsp.mkdir(path.dirname(this.file), { recursive: true });
      await fsp.writeFile(tmp, data);
      await fsp.rename(tmp, this.file);
    } finally {
      this.saving = false;
    }
  }

  /** Synchronous flush used on application exit. */
  flushSync(): void {
    if (!this.file) return;
    const data = this.db.export();
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, data);
    renameSync(tmp, this.file);
    this.dirty = false;
  }

  // ---- agents ----
  saveAgent(a: InternalAgent): void {
    if (a.demo) return; // demo data never persisted
    this.run(
      `INSERT INTO agents (id, session_id, parent_id, kind, project, cwd, name, status, started_at, last_event_at, demo, json)
       VALUES (?,?,?,?,?,?,?,?,?,?,0,?)
       ON CONFLICT(id) DO UPDATE SET parent_id=excluded.parent_id, project=excluded.project, cwd=excluded.cwd, name=excluded.name,
         status=excluded.status, started_at=excluded.started_at, last_event_at=excluded.last_event_at, json=excluded.json`,
      [a.id, a.sessionId, a.parentId ?? null, a.kind, a.project, a.cwd, a.name, a.status, a.startedAt, a.lastEventAt, JSON.stringify(a)],
    );
  }

  loadAgents(): InternalAgent[] {
    return this.all<{ json: string }>('SELECT json FROM agents WHERE demo = 0').flatMap((r) => {
      try {
        return [JSON.parse(r.json) as InternalAgent];
      } catch {
        return [];
      }
    });
  }

  deleteAgent(id: string): void {
    this.run('DELETE FROM agents WHERE id = ?', [id]);
    this.run('DELETE FROM events WHERE agent_id = ?', [id]);
  }

  // ---- events ----
  /** Inserts events, ignoring duplicates. Returns the events that were new. */
  insertEvents(events: AgentEvent[]): AgentEvent[] {
    const fresh: AgentEvent[] = [];
    if (!events.length) return fresh;
    const st = this.db.prepare(
      'INSERT OR IGNORE INTO events (id, agent_id, ts, kind, summary, detail, tool, is_error, source, data) VALUES (?,?,?,?,?,?,?,?,?,?)',
    );
    try {
      this.db.exec('BEGIN');
      for (const e of events) {
        if (e.ts < this.cutoff && e.source !== 'demo') continue; // purged history: never re-imported
        if (NOT_STORED.has(e.kind) || e.source === 'demo') {
          fresh.push(e);
          continue;
        }
        st.run([
          e.id,
          e.agentId,
          e.ts,
          e.kind,
          e.summary,
          e.detail ?? null,
          e.tool ?? null,
          e.isError ? 1 : 0,
          e.source,
          e.data ? JSON.stringify(e.data) : null,
        ]);
        if (this.db.getRowsModified() > 0) fresh.push(e);
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    } finally {
      st.free();
    }
    this.markDirty();
    return fresh;
  }

  hasEvent(id: string): boolean {
    return this.all('SELECT 1 FROM events WHERE id = ?', [id]).length > 0;
  }

  queryEvents(q: EventQuery): AgentEvent[] {
    const where: string[] = [];
    const p: any[] = [];
    if (q.agentId) {
      where.push('agent_id = ?');
      p.push(q.agentId);
    }
    if (q.agentIds?.length) {
      where.push(`agent_id IN (${q.agentIds.map(() => '?').join(',')})`);
      p.push(...q.agentIds);
    }
    if (q.kinds?.length) {
      where.push(`kind IN (${q.kinds.map(() => '?').join(',')})`);
      p.push(...q.kinds);
    } else {
      where.push(`kind NOT IN (${HIDDEN_KINDS.map(() => '?').join(',')})`);
      p.push(...HIDDEN_KINDS);
    }
    if (q.errorsOnly) where.push('is_error = 1');
    if (q.text) {
      where.push('(summary LIKE ? OR detail LIKE ? OR tool LIKE ?)');
      const t = `%${q.text.replace(/[%_]/g, (m) => '\\' + m)}%`;
      p.push(t, t, t);
    }
    if (q.before) {
      where.push('ts < ?');
      p.push(q.before);
    }
    if (q.since) {
      where.push('ts >= ?');
      p.push(q.since);
    }
    const sql = `SELECT * FROM events ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ts DESC, id DESC LIMIT ?`;
    p.push(Math.min(q.limit ?? 300, 5000));
    return this.all<any>(sql.replace(/LIKE \?/g, "LIKE ? ESCAPE '\\'"), p).map(rowToEvent);
  }

  /** Token usage per day and model, for the dashboard. */
  usageByDay(days: number): { day: string; output: number; input: number }[] {
    const since = Date.now() - days * 86_400_000;
    const rows = this.all<{ ts: number; data: string }>("SELECT ts, data FROM events WHERE kind = 'usage' AND ts >= ?", [since]);
    const m = new Map<string, { input: number; output: number }>();
    for (const r of rows) {
      const day = localDay(r.ts);
      let d: any = {};
      try {
        d = JSON.parse(r.data);
      } catch {
        /* skip */
      }
      const cur = m.get(day) ?? { input: 0, output: 0 };
      cur.input += (d.input ?? 0) + (d.cacheRead ?? 0) + (d.cacheCreation ?? 0);
      cur.output += d.output ?? 0;
      m.set(day, cur);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, v]) => ({ day, ...v }));
  }

  countEvents(): number {
    return (this.all<{ n: number }>('SELECT COUNT(*) AS n FROM events')[0]?.n as number) ?? 0;
  }

  // ---- notifications ----
  saveNotification(n: AppNotification): void {
    this.run('INSERT OR REPLACE INTO notifications (id, ts, type, level, title, body, agent_id, read) VALUES (?,?,?,?,?,?,?,?)', [
      n.id,
      n.ts,
      n.type,
      n.level,
      n.title,
      n.body,
      n.agentId ?? null,
      n.read ? 1 : 0,
    ]);
  }
  loadNotifications(limit = 300): AppNotification[] {
    return this.all<any>('SELECT * FROM notifications ORDER BY ts DESC LIMIT ?', [limit]).map((r) => ({
      id: r.id,
      ts: r.ts,
      type: r.type,
      level: r.level,
      title: r.title,
      body: r.body,
      agentId: r.agent_id ?? undefined,
      read: !!r.read,
    }));
  }
  markAllRead(): void {
    this.run('UPDATE notifications SET read = 1');
  }

  // ---- settings ----
  getSetting<T>(key: string): T | undefined {
    const r = this.all<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key])[0];
    if (!r) return undefined;
    try {
      return JSON.parse(r.value) as T;
    } catch {
      return undefined;
    }
  }
  setSetting(key: string, value: unknown): void {
    this.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, JSON.stringify(value)]);
  }

  // ---- offsets ----
  getOffset(file: string): number | undefined {
    return this.offsets.get(file);
  }
  setOffset(file: string, offset: number): void {
    if (this.offsets.get(file) === offset) return;
    this.offsets.set(file, offset);
    this.run('INSERT OR REPLACE INTO offsets (file, offset) VALUES (?, ?)', [file, offset]);
  }

  // ---- maintenance ----
  /**
   * Deletes events/notifications older than `days`, and agents with no activity since then.
   * `remember` (explicit purge by the user) also keeps transcripts from re-importing that period.
   */
  purgeOlderThan(days: number, opts: { now?: number; remember?: boolean } = {}): { events: number; agents: number } {
    const cutoff = (opts.now ?? Date.now()) - days * 86_400_000;
    this.db.run('DELETE FROM events WHERE ts < ?', [cutoff]);
    const ev = this.db.getRowsModified();
    this.db.run('DELETE FROM notifications WHERE ts < ?', [cutoff]);
    this.db.run('DELETE FROM agents WHERE last_event_at < ?', [cutoff]);
    const ag = this.db.getRowsModified();
    if (opts.remember) this.rememberCutoff(cutoff);
    this.markDirty();
    return { events: ev, agents: ag };
  }

  /**
   * Deletes all history. Read offsets are kept and a cutoff date is stored, so transcripts
   * already read are not imported again at the next start (R-01).
   */
  purgeAll(now = Date.now()): void {
    this.db.exec('DELETE FROM events; DELETE FROM notifications; DELETE FROM agents;');
    this.rememberCutoff(now);
    this.markDirty();
  }

  sessions(): {
    session_id: string;
    project: string;
    cwd: string;
    name: string;
    status: string;
    started_at: number;
    last_event_at: number;
    subagents: number;
  }[] {
    return this.all<any>(
      `SELECT s.session_id, s.project, s.cwd, s.name, s.status, s.started_at, s.last_event_at,
        (SELECT COUNT(*) FROM agents c WHERE c.session_id = s.session_id AND c.kind = 'subagent') AS subagents
       FROM agents s WHERE s.kind = 'session' ORDER BY s.last_event_at DESC LIMIT 1000`,
    );
  }

  /**
   * Every event visible in the logs (usage/cost bookkeeping excluded, as in the former export),
   * newest first, by pages: the full history never has to sit in one array (R-07).
   */
  *eventPages(pageSize = 1000): Generator<AgentEvent[]> {
    const hidden = HIDDEN_KINDS.map(() => '?').join(',');
    let last: { ts: number; id: string } | null = null;
    for (;;) {
      const rows: any[] = last
        ? this.all(`SELECT * FROM events WHERE kind NOT IN (${hidden}) AND (ts < ? OR (ts = ? AND id < ?)) ORDER BY ts DESC, id DESC LIMIT ?`, [
            ...HIDDEN_KINDS,
            last.ts,
            last.ts,
            last.id,
            pageSize,
          ])
        : this.all(`SELECT * FROM events WHERE kind NOT IN (${hidden}) ORDER BY ts DESC, id DESC LIMIT ?`, [...HIDDEN_KINDS, pageSize]);
      if (!rows.length) return;
      const page = rows.map(rowToEvent);
      yield page;
      if (rows.length < pageSize) return;
      const tail = page[page.length - 1];
      last = { ts: tail.ts, id: tail.id };
    }
  }

  close(): void {
    if (this.timer) clearTimeout(this.timer);
    this.db.close();
  }
}

function rowToEvent(r: any): AgentEvent {
  let data: Record<string, unknown> | undefined;
  if (r.data) {
    try {
      data = JSON.parse(r.data);
    } catch {
      data = undefined;
    }
  }
  return {
    id: r.id,
    agentId: r.agent_id,
    ts: r.ts,
    kind: r.kind,
    summary: r.summary ?? '',
    detail: r.detail ?? undefined,
    tool: r.tool ?? undefined,
    isError: !!r.is_error,
    source: r.source,
    data,
  };
}
