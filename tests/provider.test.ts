// End-to-end test of the Claude Code connector against a simulated ~/.claude directory,
// using real files, real fs watching/polling and real child processes for PIDs.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ClaudeProvider } from '../src/main/providers/claude/claudeProvider';
import { AgentManager } from '../src/main/core/agentManager';
import { OfficeDB } from '../src/main/db/database';
import { mergeSettings } from '../src/main/core/settings';
import type { AppNotification } from '../src/shared/types';
import { SID, assistantTool, lines, toolResult, turnDuration, userPrompt } from './fixtures';

const home = mkdtempSync(path.join(tmpdir(), 'aao-claude-'));
const proj = path.join(home, 'projects', 'C--proj-demo');
const sessions = path.join(home, 'sessions');
const transcript = path.join(proj, `${SID}.jsonl`);
const notifs: AppNotification[] = [];
let provider: ClaudeProvider;
let manager: AgentManager;
let db: OfficeDB;
const children: ChildProcess[] = [];

function sleeper(): ChildProcess {
  const c = spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 600000)'], { stdio: 'ignore' });
  children.push(c);
  return c;
}

async function waitFor(cond: () => boolean, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('timeout waiting for condition');
}

const writeRegistry = (pid: number, sid: string, status: string) =>
  writeFileSync(path.join(sessions, `${pid}.json`), JSON.stringify({ pid, sessionId: sid, cwd: 'C:\\proj\\demo', status, name: 'demo-agent', kind: 'interactive', entrypoint: 'cli', startedAt: Date.now() }));

beforeAll(async () => {
  mkdirSync(proj, { recursive: true });
  mkdirSync(sessions, { recursive: true });
  writeRegistry(process.pid, SID, 'busy');
  writeFileSync(transcript, lines(userPrompt('Ajoute la page de login'), assistantTool('Read', { file_path: 'C:\\proj\\demo\\src\\login.ts' }, 'toolu_R')));
  db = new OfficeDB(null);
  await db.open();
  const settings = mergeSettings({ claudeHome: home });
  manager = new AgentManager(db, { agentsChanged: () => {}, liveEvents: () => {}, notification: (n) => notifs.push(n), console: () => {}, log: () => {} }, () => settings);
  provider = new ClaudeProvider({ claudeHome: () => home, claudePath: () => 'claude', scanDays: () => 7, officeHome: path.join(home, 'office'), offsets: db });
  await provider.start(manager);
});

afterAll(async () => {
  await provider.stop();
  children.forEach((c) => c.kill());
  rmSync(home, { recursive: true, force: true });
});

describe('Claude Code connector (simulated ~/.claude)', () => {
  it('detects a running session from the registry and its transcript', () => {
    const a = manager.agents.get(`cc:${SID}`)!;
    expect(a).toBeDefined();
    expect(a.name).toBe('demo-agent');
    expect(a.project).toBe('demo');
    expect(a.alive).toMatchObject({ value: true, source: 'observed' });
    expect(a.pid.value).toBe(process.pid);
    expect(a.status).toBe('working');
    expect(a.currentTask.value).toBe('Ajoute la page de login');
    expect(a.filesRead[0]).toContain('login.ts');
    expect(a.activity).toBe('reading');
  });

  it('follows appended transcript lines live', async () => {
    appendFileSync(transcript, lines(toolResult('toolu_R', 'contenu'), assistantTool('Edit', { file_path: 'C:\\proj\\demo\\src\\login.ts' }, 'toolu_E')));
    await waitFor(() => manager.agents.get(`cc:${SID}`)!.activity === 'coding');
    expect(manager.agents.get(`cc:${SID}`)!.filesModified[0]).toContain('login.ts');
  });

  it('detects a new subagent and links it to its parent', async () => {
    appendFileSync(transcript, lines(assistantTool('Agent', { description: 'Vérifier les tests', subagent_type: 'Explore', prompt: 'go' }, 'toolu_AG')));
    const subDir = path.join(proj, SID, 'subagents');
    mkdirSync(subDir, { recursive: true });
    writeFileSync(path.join(subDir, 'agent-abc123.meta.json'), JSON.stringify({ agentType: 'Explore', description: 'Vérifier les tests', toolUseId: 'toolu_AG', finished: false }));
    writeFileSync(path.join(subDir, 'agent-abc123.jsonl'), lines({ ...userPrompt('go'), isSidechain: true, agentId: 'abc123' }, assistantTool('Bash', { command: 'npm test' }, 'toolu_T')));
    const id = `cc:${SID}:abc123`;
    await waitFor(() => !!manager.agents.get(id));
    const sub = manager.agents.get(id)!;
    expect(sub.kind).toBe('subagent');
    expect(sub.parentId).toBe(`cc:${SID}`);
    expect(sub.role).toBe('Explore');
    expect(sub.name).toBe('Vérifier les tests');
    await waitFor(() => manager.agents.get(id)!.activity === 'testing');
    expect(notifs.some((n) => n.type === 'subagent_new')).toBe(true);
    writeFileSync(path.join(subDir, 'agent-abc123.meta.json'), JSON.stringify({ agentType: 'Explore', description: 'Vérifier les tests', toolUseId: 'toolu_AG', finished: true }));
    await waitFor(() => manager.agents.get(id)!.status === 'done');
  });

  it('switches to idle when the turn ends and the registry says idle', async () => {
    appendFileSync(transcript, lines(turnDuration()));
    writeRegistry(process.pid, SID, 'idle');
    await waitFor(() => manager.agents.get(`cc:${SID}`)!.status === 'idle');
    expect(manager.agents.get(`cc:${SID}`)!.statusSource).toBe('observed');
  });

  it('detects several new sessions at once', async () => {
    const ids = ['aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000003'];
    for (const sid of ids) writeFileSync(path.join(proj, `${sid}.jsonl`), lines({ ...userPrompt(`tâche ${sid.slice(-1)}`), sessionId: sid }));
    await waitFor(() => ids.every((sid) => manager.agents.has(`cc:${sid}`)));
    const desks = ids.map((sid) => manager.agents.get(`cc:${sid}`)!.desk);
    expect(new Set(desks).size).toBe(3);
  });

  it('reports a crashed session (registered, process gone)', async () => {
    const sid = 'bbbbbbbb-0000-0000-0000-000000000001';
    const c = sleeper();
    await new Promise((r) => c.once('spawn', r));
    writeFileSync(path.join(proj, `${sid}.jsonl`), lines({ ...userPrompt('long job'), sessionId: sid }));
    writeRegistry(c.pid!, sid, 'busy');
    await waitFor(() => manager.agents.get(`cc:${sid}`)?.alive.value === true);
    c.kill();
    await waitFor(() => manager.agents.get(`cc:${sid}`)!.status === 'lost');
    expect(notifs.some((n) => n.type === 'session_lost')).toBe(true);
  });

  it('marks a cleanly exited session as done', async () => {
    const sid = 'cccccccc-0000-0000-0000-000000000001';
    const c = sleeper();
    await new Promise((r) => c.once('spawn', r));
    writeFileSync(path.join(proj, `${sid}.jsonl`), lines({ ...userPrompt('court'), sessionId: sid }));
    writeRegistry(c.pid!, sid, 'idle');
    await waitFor(() => manager.agents.get(`cc:${sid}`)?.status === 'idle');
    c.kill();
    await new Promise((r) => c.once('exit', r));
    unlinkSync(path.join(sessions, `${c.pid}.json`));
    await waitFor(() => manager.agents.get(`cc:${sid}`)!.status === 'done');
    expect(manager.agents.get(`cc:${sid}`)!.statusSource).toBe('observed');
  });

  it('exposes honest control capabilities', () => {
    const ext = manager.agents.get(`cc:${SID}`)!;
    const caps = provider.capabilities(ext);
    expect(caps.sendInstruction).toBe(false);
    expect(caps.reasons.sendInstruction).toMatch(/terminal externe/);
    expect(caps.stop).toBe(true);
    expect(caps.pause).toBe(false);
    const sub = provider.capabilities(manager.agents.get(`cc:${SID}:abc123`)!);
    expect(sub.stop).toBe(false);
  });

  it('never stores the same event twice when files are rescanned', async () => {
    const before = db.countEvents();
    await provider.scan(false);
    await new Promise((r) => setTimeout(r, 1500));
    expect(db.countEvents()).toBe(before);
  });
});
