import { describe, expect, it } from 'vitest';
import { createAgent, progressOf, reduce } from '../src/main/core/reducer';
import { parseRecord } from '../src/main/providers/claude/parser';
import { assistantTool, costState, toolResult, turnDuration, userPrompt } from './fixtures';

const mk = () =>
  createAgent(
    {
      id: 'cc:a',
      provider: 'claude-code',
      kind: 'session',
      sessionId: 's',
      name: 'Session 1234',
      role: 'Agent principal',
      project: 'p',
      cwd: 'C:\\p',
      startedAt: Date.now() - 1000,
    },
    0,
  );
const feed = (a: ReturnType<typeof mk>, rec: object, live = true) => {
  for (const e of parseRecord(rec as any, { agentId: a.id })) reduce(a, e, live);
  return a;
};

describe('agent reducer', () => {
  it('starts with every metric explicitly unavailable', () => {
    const a = mk();
    expect(a.status).toBe('unknown');
    expect(a.tokens.source).toBe('unavailable');
    expect(a.cost.source).toBe('unavailable');
    expect(a.currentTask.source).toBe('unavailable');
  });

  it('follows a full turn: prompt -> tool -> result -> end', () => {
    const a = mk();
    feed(a, userPrompt('Corrige le bug'));
    expect(a.status).toBe('working');
    expect(a.currentTask.value).toBe('Corrige le bug');
    expect(a.tasks[0].status).toBe('running');
    feed(a, assistantTool('Edit', { file_path: 'src/a.ts' }, 't1'));
    expect(a.activity).toBe('coding');
    expect(a.filesModified).toContain('src/a.ts');
    expect(a.lastTool.value).toBe('Edit');
    expect(a.actionCount).toBe(1);
    feed(a, toolResult('t1', 'ok'));
    expect(a.pending).toEqual({});
    expect(a.activity).toBe('thinking');
    feed(a, turnDuration());
    expect(a.status).toBe('idle');
    expect(a.tasks[0].status).toBe('done');
    expect(a.tokens.value?.output).toBe(20);
    expect(a.tokens.source).toBe('observed');
  });

  it('records test runs and their observed outcome', () => {
    const a = mk();
    feed(a, assistantTool('Bash', { command: 'npx vitest run' }, 't1'));
    expect(a.activity).toBe('testing');
    feed(a, toolResult('t1', '1 failed', true));
    expect(a.testRuns[0]).toMatchObject({ passed: false });
    expect(a.status).toBe('error');
    expect(a.errors).toHaveLength(1);
    feed(a, assistantTool('Bash', { command: 'npx vitest run' }, 't2'));
    expect(a.status).toBe('working');
    feed(a, toolResult('t2', 'all passed'));
    expect(a.testRuns[0]).toMatchObject({ passed: true });
  });

  it('does not change live status when replaying history', () => {
    const a = mk();
    feed(a, userPrompt('old'), false);
    feed(a, assistantTool('Read', { file_path: 'x' }, 't'), false);
    expect(a.status).toBe('unknown');
    expect(a.filesRead).toContain('x');
  });

  it('lets the live registry decide working/idle over late transcript lines', () => {
    const a = mk();
    a.registryStatus = 'idle';
    a.alive = { value: true, source: 'observed' };
    feed(a, userPrompt('late line'));
    expect(a.status).toBe('idle');
  });

  it('takes cost from cost-state as observed', () => {
    const a = mk();
    feed(a, costState(0.42));
    expect(a.cost).toMatchObject({ value: 0.42, source: 'observed' });
  });

  it('measures progress only from a todo list', () => {
    const a = mk();
    expect(progressOf(a).source).toBe('unavailable');
    feed(
      a,
      assistantTool(
        'TodoWrite',
        {
          todos: [
            { content: 'A', status: 'completed' },
            { content: 'B', status: 'in_progress' },
          ],
        },
        't',
      ),
    );
    expect(progressOf(a)).toMatchObject({ value: 0.5, source: 'observed' });
    expect(a.currentTask.value).toBe('B');
  });

  it('marks lost processes', () => {
    const a = mk();
    reduce(a, { id: 'l', agentId: a.id, ts: Date.now(), kind: 'process_lost', summary: 'crash', source: 'registry' }, true);
    expect(a.status).toBe('lost');
    expect(a.alive).toMatchObject({ value: false, source: 'observed' });
  });

  it('title and cost records never make an agent look recently active', () => {
    const a = mk();
    a.lastEventAt = 1000;
    for (const e of parseRecord({ type: 'ai-title', aiTitle: 'x', sessionId: 's' } as any, { agentId: a.id, lastTs: 1000 })) reduce(a, e, false);
    for (const e of parseRecord(costState(1) as any, { agentId: a.id })) reduce(a, e, false);
    expect(a.lastEventAt).toBe(1000);
  });
});
