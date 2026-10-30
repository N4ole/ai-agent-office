import { describe, expect, it } from 'vitest';
import { parseLines, parseRecord } from '../src/main/providers/claude/parser';
import { aiTitle, assistantText, assistantTool, costState, toolResult, turnDuration, userPrompt } from './fixtures';

const ctx = { agentId: 'cc:x' };

describe('transcript parser', () => {
  it('turns a user prompt into a user_prompt event', () => {
    const ev = parseRecord(userPrompt('Ajoute un bouton'), ctx);
    expect(ev).toHaveLength(1);
    expect(ev[0].kind).toBe('user_prompt');
    expect(ev[0].summary).toBe('Ajoute un bouton');
  });

  it('ignores meta / command / system-reminder prompts', () => {
    expect(parseRecord({ ...userPrompt('<system-reminder>x</system-reminder>') }, ctx)).toHaveLength(0);
    expect(parseRecord({ ...userPrompt('<command-name>/clear</command-name>') }, ctx)).toHaveLength(0);
    expect(parseRecord({ ...userPrompt('hello'), isMeta: true }, ctx)).toHaveLength(0);
  });

  it('strips wrapper tags from prompts', () => {
    const ev = parseRecord(userPrompt('<pasted_content id="7a8b">\n# PROJET : bureau\n</pasted_content id="7a8b">'), { agentId: 'x' });
    expect(ev[0].summary).toBe('# PROJET : bureau');
  });

  it('extracts tool calls with file paths and commands, plus usage', () => {
    const ev = parseRecord(assistantTool('Bash', { command: 'npm test' }, 'toolu_1', 'msg_A'), ctx);
    const tool = ev.find((e) => e.kind === 'tool_use')!;
    expect(tool.tool).toBe('Bash');
    expect(tool.toolUseId).toBe('toolu_1');
    expect(tool.data).toMatchObject({ command: 'npm test', isTest: true });
    const usage = ev.find((e) => e.kind === 'usage')!;
    expect(usage.id).toBe('usage:msg_A');
    expect(usage.data).toMatchObject({ input: 10, output: 20, cacheRead: 100, model: 'claude-opus-5-5' });
  });

  it('uses the API message id for usage so repeated blocks dedupe', () => {
    const a = parseRecord(assistantText('a', 'msg_SAME'), ctx).find((e) => e.kind === 'usage')!;
    const b = parseRecord(assistantTool('Read', { file_path: 'x' }, 't', 'msg_SAME'), ctx).find((e) => e.kind === 'usage')!;
    expect(a.id).toBe(b.id);
  });

  it('reports subagent spawns and calls onSpawn', () => {
    const spawned: string[] = [];
    const ev = parseRecord(assistantTool('Agent', { description: 'Explorer', subagent_type: 'Explore', prompt: 'p' }, 'toolu_S'), { agentId: 'cc:x', onSpawn: (id) => spawned.push(id) });
    expect(ev[0].kind).toBe('subagent_spawn');
    expect(spawned).toEqual(['toolu_S']);
  });

  it('marks failed tool results as tool_error', () => {
    const ev = parseRecord(toolResult('toolu_1', 'Exit code 1\nFAIL', true), ctx);
    expect(ev[0].kind).toBe('tool_error');
    expect(ev[0].isError).toBe(true);
    expect(ev[0].toolUseId).toBe('toolu_1');
  });

  it('parses turn end, cost and title records', () => {
    expect(parseRecord(turnDuration(12000), ctx)[0].kind).toBe('turn_end');
    const c = parseRecord(costState(1.25), ctx)[0];
    expect(c.kind).toBe('cost');
    expect(c.data?.totalCostUSD).toBe(1.25);
    expect(parseRecord(aiTitle('Refonte UI'), ctx)[0]).toMatchObject({ kind: 'title', summary: 'Refonte UI' });
  });

  it('skips malformed lines without throwing', () => {
    const r = parseLines(['{bad json', JSON.stringify(userPrompt('ok')), ''], ctx);
    expect(r.bad).toBe(1);
    expect(r.events).toHaveLength(1);
  });

  it('redacts secrets in commands', () => {
    const ev = parseRecord(assistantTool('Bash', { command: 'curl -H "Authorization: Bearer abcdefghijklmnop123"' }, 't'), ctx);
    expect(ev[0].summary).not.toContain('abcdefghijklmnop123');
  });

  it('ignores unknown record types', () => {
    expect(parseRecord({ type: 'api-request-blob', foo: 1 }, ctx)).toEqual([]);
  });
});
