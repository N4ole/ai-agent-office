// Claude Code provider: non-intrusive observation of every Claude Code session on this machine,
// plus control of sessions launched from the app.
//
// Real data sources (verified on Claude Code 2.1.312, Windows):
//  1. ~/.claude/sessions/<pid>.json        live registry: pid, sessionId, cwd, status (busy/idle), name
//  2. ~/.claude/projects/<cwd>/<sid>.jsonl  transcript: prompts, tool calls/results, usage, cost-state
//  3. ~/.claude/projects/<cwd>/<sid>/subagents/agent-<id>.jsonl + .meta.json  subagents
//  4. optional hooks (Notification/SessionStart/SessionEnd) relayed to ~/.ai-agent-office/hook-events.jsonl

import { promises as fsp, watch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import type { AgentEvent, AgentState, ControlAction, ControlCapabilities, ControlResult, LaunchOptions } from '../../../shared/types';
import type { AgentProvider, ProviderSink } from '../provider';
import { mapRegistryStatus, type AgentIdentity } from '../../core/reducer';
import { JsonlTailer } from './tailer';
import { parseLines } from './parser';
import { ManagedSessions, killTree } from './managed';
import { clean, firstLine } from '../../core/redact';

export interface OffsetStore {
  getOffset(file: string): number | undefined;
  setOffset(file: string, offset: number): void;
}

export interface ClaudeProviderOptions {
  claudeHome: () => string;
  claudePath: () => string;
  scanDays: () => number;
  officeHome: string;
  offsets: OffsetStore;
  /** Folders whose Claude Code processes are the app's own helpers (quota checks): never shown as agents. */
  ignoreCwds?: () => string[];
  onRateLimit?: (info: unknown) => void;
}

interface RegistryEntry {
  pid: number;
  sessionId: string;
  cwd: string;
  status?: string;
  name?: string;
  kind?: string;
  entrypoint?: string;
  startedAt?: number;
  file: string;
}

interface FileInfo {
  file: string;
  agentId: string;
  sessionId: string;
  subagentId?: string;
  metaFile?: string;
  metaMtime?: number;
  metaFinished?: boolean;
  /** Tool call (Agent/Task) in the parent transcript that spawned this subagent. */
  toolUseId?: string;
  registered: boolean;
  mtimeMs: number;
  lastTs?: number;
}

export const STALE_SESSION_MS = 5 * 60_000;

export function sessionAgentId(sessionId: string): string {
  return `cc:${sessionId}`;
}
export function subAgentId(sessionId: string, sub: string): string {
  return `cc:${sessionId}:${sub}`;
}

export function isPidAlive(pid: number): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e?.code === 'EPERM';
  }
}

export { mapRegistryStatus };

export class ClaudeProvider implements AgentProvider {
  readonly id = 'claude-code';
  private sink!: ProviderSink;
  private tailer = new JsonlTailer();
  private files = new Map<string, FileInfo>();
  private registry = new Map<string, RegistryEntry>(); // by sessionId
  private registryMtimes = new Map<string, number>();
  private lostReported = new Set<string>();
  private spawnByToolUse = new Map<string, string>(); // toolUseId -> spawning agentId
  private watcher: FSWatcher | null = null;
  private timer: NodeJS.Timeout | null = null;
  private tickN = 0;
  private dirty = new Set<string>();
  private reading = new Set<string>();
  private hookTailer = new JsonlTailer();
  private initialDone = false;
  readonly managed: ManagedSessions;

  constructor(private o: ClaudeProviderOptions) {
    this.managed = new ManagedSessions(o.claudePath, {
      onSession: (sid, proc) => {
        const id = sessionAgentId(sid);
        const project = path.basename(proc.cwd);
        this.sink.upsertAgent(
          {
            id,
            provider: 'claude-code',
            kind: 'session',
            sessionId: sid,
            name: proc.opts.name || `Session ${sid.slice(0, 8)}`,
            role: 'Agent principal (piloté par l’app)',
            project,
            cwd: proc.cwd,
            startedAt: proc.startedAt,
            managed: true,
          },
          true,
        );
        this.sink.patchAgent(id, {
          ...(proc.opts.name ? { name: proc.opts.name } : {}),
          managed: true,
          pid: { value: proc.child.pid ?? null, source: proc.child.pid ? 'observed' : 'unavailable', note: 'Processus lancé par l’app' },
          alive: { value: true, source: 'observed' },
        });
        this.sink.events(
          [
            {
              id: `managed-start:${sid}:${proc.startedAt}`,
              agentId: id,
              ts: Date.now(),
              kind: 'session_start',
              summary: proc.opts.resumeSessionId ? 'Session reprise depuis l’app' : 'Session lancée depuis l’app',
              source: 'managed',
            },
          ],
          true,
        );
        this.sink.events(
          [
            {
              id: `managed-busy:${sid}:${Date.now()}`,
              agentId: id,
              ts: Date.now(),
              kind: 'status_change',
              summary: proc.busy ? 'Traite une instruction' : 'Prête, en attente d’instruction',
              source: 'managed',
              data: { status: proc.busy ? 'working' : 'idle', provenance: 'observed' },
            },
          ],
          true,
        );
      },
      onConsole: (sid, key, line) => {
        this.sink.console(sid ? sessionAgentId(sid) : `pending:${key}`, line);
      },
      onRateLimit: (info) => o.onRateLimit?.(info),
      onTurnResult: (sid, ok, summary) => {
        this.sink.events(
          [
            {
              id: `turn:${sid}:${Date.now()}`,
              agentId: sessionAgentId(sid),
              ts: Date.now(),
              kind: 'status_change',
              summary: `Tour terminé : ${summary}`,
              source: 'managed',
              isError: !ok,
              data: { status: 'idle', provenance: 'observed' },
            },
          ],
          true,
        );
      },
      onExit: (sid, _key, code, requested, stderrTail) => {
        if (!sid) {
          this.sink.log('warn', `Processus Claude Code géré arrêté avant init (code ${code}) ${firstLine(stderrTail)}`);
          return;
        }
        const id = sessionAgentId(sid);
        const clean_ = requested || code === 0;
        this.sink.events(
          [
            clean_
              ? {
                  id: `exit:${sid}:${Date.now()}`,
                  agentId: id,
                  ts: Date.now(),
                  kind: 'session_end',
                  summary: requested ? 'Arrêtée depuis l’app' : 'Processus terminé normalement',
                  source: 'managed',
                  data: { provenance: 'observed' },
                }
              : {
                  id: `lost:${sid}:${Date.now()}`,
                  agentId: id,
                  ts: Date.now(),
                  kind: 'process_lost',
                  summary: `Processus arrêté avec le code ${code}${stderrTail ? ' : ' + firstLine(clean(stderrTail), 200) : ''}`,
                  source: 'managed',
                  isError: true,
                },
          ],
          true,
        );
        this.sink.patchAgent(id, {
          alive: { value: false, source: 'observed' },
          pid: { value: null, source: 'unavailable', note: 'Processus terminé' },
          cpu: { value: null, source: 'unavailable' },
          memoryMB: { value: null, source: 'unavailable' },
        });
      },
    });
  }

  private get projectsDir() {
    return path.join(this.o.claudeHome(), 'projects');
  }
  private get sessionsDir() {
    return path.join(this.o.claudeHome(), 'sessions');
  }
  get hookEventsFile() {
    return path.join(this.o.officeHome, 'hook-events.jsonl');
  }

  async start(sink: ProviderSink): Promise<void> {
    this.sink = sink;
    await this.pollRegistry();
    await this.scan(true);
    this.initialDone = true;
    this.finalizeHistory();
    // Hook events: skip history on first start (they are only useful live).
    try {
      const st = await fsp.stat(this.hookEventsFile);
      this.hookTailer.setOffset(this.hookEventsFile, st.size);
    } catch {
      /* no hook file yet */
    }
    this.startWatcher();
    this.timer = setInterval(() => void this.tick(), 1000);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.watcher?.close();
    await this.managed.stopAll();
  }

  private startWatcher() {
    try {
      this.watcher = watch(this.projectsDir, { recursive: true }, (_e, f) => {
        if (!f) return;
        const full = path.join(this.projectsDir, f.toString());
        if (full.endsWith('.jsonl') || full.endsWith('.meta.json')) this.dirty.add(full);
      });
      this.watcher.on('error', (e) => this.sink.log('warn', `Surveillance fichiers interrompue : ${e.message} (repli sur le sondage)`));
    } catch (e: any) {
      this.sink.log('warn', `fs.watch indisponible (${e?.message}); repli sur le sondage périodique`);
    }
  }

  private async tick() {
    this.tickN++;
    try {
      await this.pollRegistry();
      // Files flagged by the watcher.
      const dirty = [...this.dirty];
      this.dirty.clear();
      for (const f of dirty) {
        if (f.endsWith('.meta.json')) {
          const info = [...this.files.values()].find((x) => x.metaFile === f);
          if (info) await this.readMeta(info);
        } else if (this.files.has(f)) await this.readFile(this.files.get(f)!);
        else await this.discoverFile(f, true);
      }
      // Polling fallback on recently active files (fs.watch can miss events on some setups).
      const now = Date.now();
      for (const info of this.files.values()) {
        if (now - info.mtimeMs < 15 * 60_000 || this.tickN % 10 === 0) {
          try {
            const st = await fsp.stat(info.file);
            if (st.size !== this.tailer.getOffset(info.file)) {
              info.mtimeMs = st.mtimeMs;
              await this.readFile(info);
            }
            if (info.metaFile && this.tickN % 3 === 0) await this.readMeta(info);
          } catch {
            /* file removed */
          }
        }
      }
      if (this.tickN % 5 === 0) await this.scan(false);
      if (this.tickN % 2 === 0) await this.readHooks();
      if (this.tickN % 10 === 0) this.checkStale();
    } catch (e: any) {
      this.sink.log('error', `Erreur de collecte : ${e?.message ?? e}`);
    }
  }

  // ---------- registry ----------

  async pollRegistry(): Promise<void> {
    let names: string[];
    try {
      names = (await fsp.readdir(this.sessionsDir)).filter((n) => n.endsWith('.json'));
    } catch {
      names = [];
    }
    const seen = new Set<string>();
    for (const n of names) {
      const file = path.join(this.sessionsDir, n);
      let entry: RegistryEntry | undefined;
      try {
        const st = await fsp.stat(file);
        const prev = [...this.registry.values()].find((e) => e.file === file);
        if (prev && this.registryMtimes.get(file) === st.mtimeMs) entry = prev;
        else {
          const j = JSON.parse(await fsp.readFile(file, 'utf8'));
          if (!j.sessionId || !j.pid) continue;
          entry = {
            pid: Number(j.pid),
            sessionId: String(j.sessionId),
            cwd: String(j.cwd ?? ''),
            status: j.status,
            name: j.name,
            kind: j.kind,
            entrypoint: j.entrypoint,
            startedAt: Number(j.startedAt) || undefined,
            file,
          };
          this.registryMtimes.set(file, st.mtimeMs);
        }
      } catch {
        continue; // partially written file, retry next tick
      }
      if (!entry) continue;
      if (this.isIgnoredCwd(entry.cwd)) continue;
      seen.add(entry.sessionId);
      this.applyRegistryEntry(entry);
    }
    // Entries that disappeared: the session exited (Claude Code removes its registry file on exit).
    for (const [sid, e] of this.registry) {
      if (seen.has(sid)) continue;
      this.registry.delete(sid);
      if (this.managed.isRunning(sid)) continue;
      const id = sessionAgentId(sid);
      const alive = isPidAlive(e.pid);
      if (!alive) {
        this.sink.events(
          [
            {
              id: `regexit:${sid}:${e.pid}`,
              agentId: id,
              ts: Date.now(),
              kind: 'session_end',
              summary: 'Session fermée (retirée du registre Claude Code)',
              source: 'registry',
              data: { provenance: 'observed' },
            },
          ],
          true,
        );
        this.sink.patchAgent(id, {
          pid: { value: null, source: 'unavailable', note: 'Processus terminé' },
          cpu: { value: null, source: 'unavailable' },
          memoryMB: { value: null, source: 'unavailable' },
        });
        this.endChildren(sid, 'Session parente fermée');
      }
    }
  }

  private isIgnoredCwd(cwd: string): boolean {
    if (!cwd) return false;
    const norm = (p: string) => path.resolve(p).toLowerCase();
    return (this.o.ignoreCwds?.() ?? []).some((d) => norm(cwd) === norm(d));
  }

  private applyRegistryEntry(e: RegistryEntry) {
    const prev = this.registry.get(e.sessionId);
    this.registry.set(e.sessionId, e);
    const id = sessionAgentId(e.sessionId);
    const alive = isPidAlive(e.pid);
    const isNew = this.sink.upsertAgent(
      {
        id,
        provider: 'claude-code',
        kind: 'session',
        sessionId: e.sessionId,
        name: e.name || `Session ${e.sessionId.slice(0, 8)}`,
        role: 'Agent principal',
        project: path.basename(e.cwd || '') || '?',
        cwd: e.cwd,
        startedAt: e.startedAt ?? Date.now(),
        managed: this.managed.isRunning(e.sessionId),
      },
      true,
    );
    const a = this.sink.getAgent(id);
    if (!a) return;
    if (alive) {
      this.lostReported.delete(e.sessionId);
      this.sink.patchAgent(id, {
        pid: { value: e.pid, source: 'observed', note: 'Registre ~/.claude/sessions' },
        alive: { value: true, source: 'observed' },
        registryStatus: e.status,
        entrypoint: e.entrypoint,
        endedAt: undefined,
      });
      const mapped = mapRegistryStatus(e.status);
      const statusChanged = !prev || prev.status !== e.status || isNew || a.status === 'done' || a.status === 'lost' || a.status === 'unknown';
      // While the transcript reports a tool error, keep "error" until the registry moves on.
      if (statusChanged && !(a.status === 'error' && mapped === 'working' && prev?.status === e.status)) {
        this.sink.events(
          [
            {
              id: `reg:${e.sessionId}:${e.status}:${Date.now()}`,
              agentId: id,
              ts: Date.now(),
              kind: 'status_change',
              summary: `Statut Claude Code : ${e.status ?? 'inconnu'}`,
              source: 'registry',
              data: { status: mapped, provenance: 'observed', raw: e.status },
            },
          ],
          true,
        );
      }
    } else if (!this.lostReported.has(e.sessionId) && !this.managed.isRunning(e.sessionId)) {
      // Registry file still present but process gone: crash or forced kill.
      this.lostReported.add(e.sessionId);
      this.sink.events(
        [
          {
            id: `lost:${e.sessionId}:${e.pid}`,
            agentId: id,
            ts: Date.now(),
            kind: 'process_lost',
            summary: `Processus ${e.pid} introuvable alors que la session est encore enregistrée (plantage ou arrêt forcé)`,
            source: 'registry',
            isError: true,
          },
        ],
        true,
      );
      this.sink.patchAgent(id, {
        pid: { value: e.pid, source: 'observed', note: 'Processus disparu' },
        cpu: { value: null, source: 'unavailable' },
        memoryMB: { value: null, source: 'unavailable' },
      });
      this.endChildren(e.sessionId, 'Session parente perdue');
    }
  }

  private endChildren(sessionId: string, why: string) {
    for (const a of this.sink.allAgents()) {
      if (a.kind === 'subagent' && a.sessionId === sessionId && a.status !== 'done' && a.status !== 'lost') {
        this.sink.events(
          [{ id: `childend:${a.id}`, agentId: a.id, ts: Date.now(), kind: 'session_end', summary: why, source: 'registry', data: { provenance: 'inferred' } }],
          true,
        );
      }
    }
  }

  // ---------- transcripts ----------

  async scan(initial: boolean): Promise<void> {
    let dirs: string[];
    try {
      dirs = await fsp.readdir(this.projectsDir);
    } catch {
      return;
    }
    const minMtime = Date.now() - this.o.scanDays() * 86_400_000;
    for (const d of dirs) {
      const pdir = path.join(this.projectsDir, d);
      let entries;
      try {
        entries = await fsp.readdir(pdir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const ent of entries) {
        const full = path.join(pdir, ent.name);
        if (ent.isFile() && ent.name.endsWith('.jsonl')) {
          if (this.files.has(full)) continue;
          try {
            const st = await fsp.stat(full);
            if (st.mtimeMs < minMtime && !this.o.offsets.getOffset(full)) continue;
          } catch {
            continue;
          }
          await this.discoverFile(full, !initial);
        } else if (ent.isDirectory()) {
          const subDir = path.join(full, 'subagents');
          let subs: string[];
          try {
            subs = await fsp.readdir(subDir);
          } catch {
            continue;
          }
          for (const s of subs) {
            if (!s.endsWith('.jsonl')) continue;
            const f = path.join(subDir, s);
            if (this.files.has(f)) continue;
            try {
              const st = await fsp.stat(f);
              if (st.mtimeMs < minMtime && !this.o.offsets.getOffset(f)) continue;
            } catch {
              continue;
            }
            await this.discoverFile(f, !initial);
          }
        }
      }
    }
  }

  /** Identifies what a transcript path is (session or subagent) and starts tracking it. */
  async discoverFile(file: string, live: boolean): Promise<void> {
    if (this.files.has(file) || !file.endsWith('.jsonl')) return;
    const base = path.basename(file, '.jsonl');
    const parent = path.dirname(file);
    let info: FileInfo;
    if (path.basename(parent) === 'subagents') {
      const sessionId = path.basename(path.dirname(parent));
      const sub = base.replace(/^agent-/, '');
      info = {
        file,
        sessionId,
        subagentId: sub,
        agentId: subAgentId(sessionId, sub),
        metaFile: path.join(parent, `${base}.meta.json`),
        registered: false,
        mtimeMs: Date.now(),
      };
    } else if (/^[0-9a-f-]{36}$/i.test(base) && path.dirname(parent) === this.projectsDir) {
      info = { file, sessionId: base, agentId: sessionAgentId(base), registered: false, mtimeMs: Date.now() };
    } else return;
    try {
      info.mtimeMs = (await fsp.stat(file)).mtimeMs;
    } catch {
      return;
    }
    // Make sure a parent session is known before its subagents (ordering on first scan).
    if (info.subagentId) {
      const parentFile = path.join(path.dirname(path.dirname(parent)), `${info.sessionId}.jsonl`);
      if (!this.files.has(parentFile)) await this.discoverFile(parentFile, live);
    }
    this.files.set(file, info);
    const saved = this.o.offsets.getOffset(file);
    if (saved !== undefined && this.sink.getAgent(info.agentId)) {
      this.tailer.setOffset(file, saved);
      info.registered = true;
    }
    if (info.metaFile) await this.readMeta(info);
    await this.readFile(info, live);
  }

  private async readMeta(info: FileInfo) {
    if (!info.metaFile) return;
    try {
      const st = await fsp.stat(info.metaFile);
      if (info.metaMtime === st.mtimeMs) return;
      info.metaMtime = st.mtimeMs;
      const meta = JSON.parse(await fsp.readFile(info.metaFile, 'utf8'));
      const id = info.agentId;
      if (meta.toolUseId) info.toolUseId = String(meta.toolUseId);
      const parentId = (meta.toolUseId && this.spawnByToolUse.get(meta.toolUseId)) || sessionAgentId(info.sessionId);
      const existing = this.sink.getAgent(id);
      if (!existing) {
        await this.registerFromFile(info, meta);
      } else {
        this.sink.patchAgent(id, {
          role: meta.agentType || existing.role,
          parentId: this.spawnByToolUse.get(info.toolUseId ?? '') ?? existing.parentId ?? parentId,
        });
        if (meta.model) this.sink.patchAgent(id, { model: { value: String(meta.model), source: 'observed', note: 'Modèle demandé (meta.json)' } });
      }
      if (meta.finished && !info.metaFinished) {
        info.metaFinished = true;
        // read remaining transcript before marking done
        await this.readFile(info);
        this.sink.events(
          [{ id: `subdone:${id}`, agentId: id, ts: info.mtimeMs, kind: 'subagent_done', summary: 'Sous-agent terminé', source: 'transcript' }],
          Date.now() - info.mtimeMs < 120_000,
        );
      }
    } catch {
      /* meta not written yet */
    }
  }

  private async registerFromFile(info: FileInfo, meta?: any) {
    if (info.registered && this.sink.getAgent(info.agentId)) return;
    // Peek the first records for cwd / branch / start time.
    let cwd = '';
    let startedAt = info.mtimeMs;
    let gitBranch: string | undefined;
    let firstPrompt = '';
    try {
      const fh = await fsp.open(info.file, 'r');
      const buf = Buffer.alloc(64 * 1024);
      const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
      await fh.close();
      for (const line of buf.subarray(0, bytesRead).toString('utf8').split('\n')) {
        try {
          const r = JSON.parse(line);
          if (!cwd && r.cwd) cwd = r.cwd;
          if (!gitBranch && r.gitBranch) gitBranch = r.gitBranch;
          if (r.timestamp) startedAt = Math.min(startedAt, Date.parse(r.timestamp) || startedAt);
          if (!firstPrompt && r.type === 'user' && typeof r.message?.content === 'string') firstPrompt = r.message.content;
        } catch {
          /* partial line */
        }
      }
    } catch {
      /* unreadable */
    }
    const reg = this.registry.get(info.sessionId);
    if (!cwd) cwd = reg?.cwd ?? '';
    const project = path.basename(cwd) || path.basename(path.dirname(info.file));
    let idn: AgentIdentity;
    if (info.subagentId) {
      const parentAgent = this.sink.getAgent(sessionAgentId(info.sessionId));
      if (!cwd && parentAgent) cwd = parentAgent.cwd;
      idn = {
        id: info.agentId,
        provider: 'claude-code',
        kind: 'subagent',
        sessionId: info.sessionId,
        subagentId: info.subagentId,
        parentId: (meta?.toolUseId && this.spawnByToolUse.get(meta.toolUseId)) || sessionAgentId(info.sessionId),
        name: clean(meta?.description || '', 60) || `Sous-agent ${info.subagentId.slice(0, 6)}`,
        role: meta?.agentType || 'Sous-agent',
        project: parentAgent?.project || project,
        cwd: cwd || parentAgent?.cwd || '',
        transcriptPath: info.file,
        startedAt,
      };
    } else {
      idn = {
        id: info.agentId,
        provider: 'claude-code',
        kind: 'session',
        sessionId: info.sessionId,
        name: reg?.name || `Session ${info.sessionId.slice(0, 8)}`,
        role: 'Agent principal',
        project,
        cwd,
        transcriptPath: info.file,
        startedAt,
        managed: this.managed.isRunning(info.sessionId),
      };
    }
    const live = this.initialDone && Date.now() - info.mtimeMs < 120_000;
    this.sink.upsertAgent(idn, live);
    this.sink.patchAgent(info.agentId, { transcriptPath: info.file, gitBranch });
    if (meta?.model) this.sink.patchAgent(info.agentId, { model: { value: String(meta.model), source: 'observed', note: 'Modèle demandé (meta.json)' } });
    info.registered = true;
  }

  private async readFile(info: FileInfo, _live = true): Promise<void> {
    if (this.reading.has(info.file)) {
      this.dirty.add(info.file);
      return;
    }
    this.reading.add(info.file);
    try {
      if (!info.registered || !this.sink.getAgent(info.agentId)) {
        let meta: any;
        if (info.metaFile) {
          try {
            meta = JSON.parse(await fsp.readFile(info.metaFile, 'utf8'));
          } catch {
            /* none */
          }
        }
        await this.registerFromFile(info, meta);
      }
      for (let guard = 0; guard < 50; guard++) {
        const { lines, more } = await this.tailer.read(info.file);
        if (lines.length) {
          const ctx = {
            agentId: info.agentId,
            lastTs: info.lastTs,
            onSpawn: (toolUseId: string) => {
              this.spawnByToolUse.set(toolUseId, info.agentId);
            },
          };
          const { events } = parseLines(lines, ctx);
          info.lastTs = ctx.lastTs;
          const now = Date.now();
          const liveEvents = events.filter((e) => this.initialDone && now - e.ts < 120_000);
          const histEvents = events.filter((e) => !(this.initialDone && now - e.ts < 120_000));
          if (histEvents.length) this.sink.events(histEvents, false);
          if (liveEvents.length) this.sink.events(liveEvents, true);
          this.relinkSubagents();
        }
        this.o.offsets.setOffset(info.file, this.tailer.getOffset(info.file));
        if (!more) break;
        await new Promise((r) => setImmediate(r));
      }
    } finally {
      this.reading.delete(info.file);
    }
  }

  /** Fixes parents of nested subagents once the spawning tool_use has been parsed. */
  private relinkSubagents() {
    for (const info of this.files.values()) {
      if (!info.subagentId || !info.toolUseId) continue;
      const spawner = this.spawnByToolUse.get(info.toolUseId);
      const a = this.sink.getAgent(info.agentId);
      if (a && spawner && spawner !== info.agentId && a.parentId !== spawner) this.sink.patchAgent(a.id, { parentId: spawner });
    }
  }

  /** After the initial replay, settle statuses of sessions that are not running anymore. */
  private finalizeHistory() {
    const now = Date.now();
    for (const a of this.sink.allAgents()) {
      if (a.provider !== 'claude-code') continue;
      if (a.kind === 'session') {
        if (this.registry.has(a.sessionId) || this.managed.isRunning(a.sessionId)) continue;
        if (a.status === 'done' || a.status === 'lost') continue;
        // Every running session (interactive or -p) is listed in the registry, so an absent one has ended.
        if (now - a.lastEventAt > 30_000) {
          this.sink.events(
            [
              {
                id: `hist-end:${a.id}:${a.lastEventAt}`,
                agentId: a.id,
                ts: a.lastEventAt,
                kind: 'session_end',
                summary: 'Session terminée (absente du registre, transcript inactif)',
                source: 'app',
                data: { provenance: 'inferred' },
              },
            ],
            true,
          );
        } else {
          this.sink.events(
            [
              {
                id: `hist-act:${a.id}:${a.lastEventAt}`,
                agentId: a.id,
                ts: now,
                kind: 'status_change',
                summary: 'Activité récente du transcript, session absente du registre (mode -p ?)',
                source: 'app',
                data: { status: 'working', provenance: 'inferred' },
              },
            ],
            true,
          );
        }
      } else if (a.status !== 'done' && a.status !== 'lost') {
        const parentAlive = this.registry.has(a.sessionId) || this.managed.isRunning(a.sessionId);
        if (!parentAlive && now - a.lastEventAt > 2 * 60_000) {
          this.sink.events(
            [
              {
                id: `hist-end:${a.id}:${a.lastEventAt}`,
                agentId: a.id,
                ts: a.lastEventAt,
                kind: 'session_end',
                summary: 'Sous-agent inactif, session parente terminée',
                source: 'app',
                data: { provenance: 'inferred' },
              },
            ],
            true,
          );
        }
      }
    }
  }

  /** Sessions outside the registry (headless runs) that stopped writing are considered ended. */
  private checkStale() {
    const now = Date.now();
    for (const a of this.sink.allAgents()) {
      if (a.provider !== 'claude-code' || a.status === 'done' || a.status === 'lost') continue;
      if (a.kind === 'session' && (this.registry.has(a.sessionId) || this.managed.isRunning(a.sessionId))) continue;
      if (a.kind === 'subagent') {
        const parentAlive = this.registry.has(a.sessionId) || this.managed.isRunning(a.sessionId);
        if (parentAlive && now - a.lastEventAt < 30 * 60_000) continue;
      }
      if (now - a.lastEventAt > STALE_SESSION_MS) {
        this.sink.events(
          [
            {
              id: `stale:${a.id}:${a.lastEventAt}`,
              agentId: a.id,
              ts: now,
              kind: 'session_end',
              summary: `Aucune activité depuis ${Math.round((now - a.lastEventAt) / 60000)} min et processus non suivi : considéré terminé`,
              source: 'app',
              data: { provenance: 'inferred' },
            },
          ],
          true,
        );
      }
    }
  }

  // ---------- hooks (optional) ----------

  private async readHooks() {
    const { lines } = await this.hookTailer.read(this.hookEventsFile);
    const evs: AgentEvent[] = [];
    for (const l of lines) {
      let h: any;
      try {
        h = JSON.parse(l);
      } catch {
        continue;
      }
      const sid = h.session_id;
      if (!sid) continue;
      const agentId = h.agent_id ? subAgentId(sid, h.agent_id) : sessionAgentId(sid);
      const t = Number(h.ts) || Date.now();
      if (h.hook_event_name === 'Notification') {
        const msg = clean(h.message ?? '', 300);
        const waiting = /permission|waiting for your input|needs your/i.test(msg) || /permission|idle/.test(String(h.notification_type ?? ''));
        evs.push({
          id: `hook:${sid}:${t}:n`,
          agentId,
          ts: t,
          kind: 'notification',
          summary: msg || 'Notification Claude Code',
          source: 'hook',
          data: { waiting, type: h.notification_type },
        });
      } else if (h.hook_event_name === 'SessionEnd') {
        evs.push({
          id: `hook:${sid}:${t}:end`,
          agentId,
          ts: t,
          kind: 'session_end',
          summary: `Session terminée (${h.reason ?? 'raison inconnue'})`,
          source: 'hook',
          data: { provenance: 'observed' },
        });
      } else if (h.hook_event_name === 'SessionStart') {
        evs.push({
          id: `hook:${sid}:${t}:start`,
          agentId,
          ts: t,
          kind: 'session_start',
          summary: `Session démarrée (${h.source ?? 'startup'})`,
          source: 'hook',
        });
      }
    }
    if (evs.length) {
      for (const e of evs) {
        if (!this.sink.getAgent(e.agentId)) continue;
        this.sink.events([e], true);
      }
    }
  }

  /** Counters for the status bar. */
  health() {
    return {
      watchedFiles: this.files.size,
      liveSessions: this.registry.size,
      managedRunning: this.managed.list().filter((p) => p.child.exitCode === null).length,
    };
  }

  // ---------- control ----------

  capabilities(a: AgentState): ControlCapabilities {
    const reasons: Record<string, string> = {
      pause: 'Claude Code n’offre pas de mise en pause. Utilisez « Interrompre » puis envoyez une instruction pour continuer.',
    };
    const caps: ControlCapabilities = {
      sendInstruction: false,
      interrupt: false,
      pause: false,
      stop: false,
      resume: false,
      openTerminal: !!a.cwd,
      openFolder: !!a.cwd,
      reasons,
    };
    if (a.kind === 'subagent') {
      reasons.sendInstruction =
        reasons.interrupt =
        reasons.stop =
        reasons.resume =
          'Les sous-agents sont pilotés par leur agent parent : agissez sur la session parente.';
      return caps;
    }
    const running = this.managed.isRunning(a.sessionId);
    const externalAlive = !running && a.alive.value === true && a.pid.value != null;
    if (running) {
      caps.sendInstruction = caps.interrupt = caps.stop = true;
      reasons.resume = 'La session tourne déjà.';
    } else if (externalAlive) {
      caps.stop = true;
      reasons.sendInstruction = reasons.interrupt =
        'Session lancée depuis un terminal externe : Claude Code ne fournit pas d’interface documentée pour lui envoyer une instruction. Ouvrez son terminal, ou arrêtez-la puis reprenez-la depuis l’app.';
      reasons.resume = 'La session tourne encore dans un autre terminal.';
      reasons.stop = 'Arrête de force le processus Claude Code externe (taskkill).';
    } else {
      caps.resume = !!a.cwd;
      reasons.sendInstruction = reasons.interrupt = 'Session arrêtée : reprenez-la d’abord.';
      reasons.stop = 'Aucun processus en cours.';
    }
    return caps;
  }

  async control(action: ControlAction, a: AgentState): Promise<ControlResult> {
    const caps = this.capabilities(a);
    switch (action.type) {
      case 'send':
        if (!caps.sendInstruction) return { ok: false, message: caps.reasons.sendInstruction ?? 'Non disponible' };
        return this.managed.send(a.sessionId, action.text)
          ? { ok: true, message: 'Instruction envoyée' }
          : { ok: false, message: 'Le processus ne répond plus' };
      case 'interrupt':
        if (!caps.interrupt) return { ok: false, message: caps.reasons.interrupt ?? 'Non disponible' };
        return this.managed.interrupt(a.sessionId) ? { ok: true, message: 'Interruption envoyée' } : { ok: false, message: 'Le processus ne répond plus' };
      case 'stop':
        if (!caps.stop) return { ok: false, message: caps.reasons.stop ?? 'Non disponible' };
        if (this.managed.isRunning(a.sessionId)) {
          this.managed.stop(a.sessionId);
          return { ok: true, message: 'Arrêt demandé' };
        }
        if (a.pid.value) {
          this.lostReported.add(a.sessionId); // expected disappearance, not a crash
          killTree(a.pid.value);
          return { ok: true, message: `Processus ${a.pid.value} arrêté` };
        }
        return { ok: false, message: 'PID inconnu' };
      case 'resume':
        if (!caps.resume) return { ok: false, message: caps.reasons.resume ?? 'Non disponible' };
        return this.launch({ cwd: a.cwd, resumeSessionId: a.sessionId, name: a.name });
      case 'openTerminal':
        return openTerminal(a.cwd);
      case 'resumeInTerminal':
        if (a.alive.value === true) return { ok: false, message: 'La session tourne déjà ; ouvrez plutôt un terminal dans son dossier.' };
        return openTerminal(a.cwd, [this.o.claudePath(), '--resume', a.sessionId]);
      case 'openFolder':
        return { ok: true, message: a.cwd }; // handled by the main process (shell.openPath)
    }
  }

  async launch(opts: LaunchOptions): Promise<ControlResult> {
    try {
      const st = await fsp.stat(opts.cwd);
      if (!st.isDirectory()) return { ok: false, message: 'Le dossier de travail n’existe pas' };
    } catch {
      return { ok: false, message: 'Le dossier de travail n’existe pas' };
    }
    if (!opts.prompt && !opts.resumeSessionId) return { ok: false, message: 'Une première instruction est nécessaire pour démarrer une session headless.' };
    return this.managed.launch(opts);
  }
}

/** Opens Windows Terminal (or cmd as a fallback) in a folder, optionally running a command. */
export function openTerminal(cwd: string, cmd?: string[]): Promise<ControlResult> {
  return new Promise((resolve) => {
    if (!cwd) return resolve({ ok: false, message: 'Dossier de travail inconnu' });
    if (process.platform !== 'win32') return resolve({ ok: false, message: 'Disponible uniquement sous Windows' });
    const wtArgs = ['-d', cwd, ...(cmd ?? [])];
    const child = spawn('wt.exe', wtArgs, { detached: true, stdio: 'ignore', windowsHide: false });
    child.on('error', () => {
      // Windows Terminal absent: fall back to cmd.exe
      const c2 = spawn('cmd.exe', ['/c', 'start', '""', '/D', cwd, 'cmd.exe', '/K', ...(cmd ?? [])], {
        detached: true,
        stdio: 'ignore',
        windowsVerbatimArguments: false,
      });
      c2.on('error', (e) => resolve({ ok: false, message: `Impossible d’ouvrir un terminal : ${e.message}` }));
      c2.on('spawn', () => resolve({ ok: true, message: 'Terminal ouvert (cmd)' }));
      c2.unref();
    });
    child.on('spawn', () => {
      child.unref();
      resolve({ ok: true, message: 'Terminal ouvert' });
    });
  });
}

export function defaultClaudeHome(): string {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}
