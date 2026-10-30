import { describe, expect, it } from 'vitest';
import { normalizeModel, priceUsage } from '../src/shared/pricing';
import { createAgent, reduce } from '../src/main/core/reducer';
import { parseRecord } from '../src/main/providers/claude/parser';

describe('pricing', () => {
  // Token totals and costs taken from real Claude Code sessions (cost-state records).
  it('reproduces a real Opus 5.5 session cost', () => {
    const usd = priceUsage('claude-opus-5-5', { input: 6, output: 38642, cacheRead: 166929, cacheWrite5m: 0, cacheWrite1h: 76519 })!;
    expect(usd).toBeCloseTo(1.4184, 4);
  });

  it('reproduces a real Sonnet 5.5 session cost (cache reads at 0.05x)', () => {
    const usd = priceUsage('claude-sonnet-5-5', { input: 34, output: 41235, cacheRead: 964465, cacheWrite5m: 0, cacheWrite1h: 68483 })!;
    expect(usd).toBeCloseTo(0.7828, 4);
  });

  it('switches Haiku 5.5 to the long-prompt rate card above 100K prompt tokens', () => {
    const short = priceUsage('claude-haiku-5-5', { input: 50_000, output: 1_000_000, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 })!;
    const long = priceUsage('claude-haiku-5-5', { input: 150_000, output: 1_000_000, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 })!;
    expect(short).toBeCloseTo(0.005 + 0.5, 6);
    expect(long).toBeCloseTo(0.075 + 2.5, 6);
  });

  it('normalizes model ids as written by different platforms', () => {
    expect(normalizeModel('claude-opus-5-5[1m]')).toBe('claude-opus-5-5');
    expect(normalizeModel('anthropic.claude-sonnet-5-5')).toBe('claude-sonnet-5-5');
    expect(normalizeModel('claude-haiku-4-5-20251001')).toBe('claude-haiku-4-5');
    expect(normalizeModel('claude-opus-4-5@20251101')).toBe('claude-opus-4-5');
    expect(normalizeModel('gpt-5')).toBeNull();
    expect(priceUsage('mystery-model', { input: 1, output: 1, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 })).toBeNull();
  });

  it('accumulates an estimated cost per model on the agent, labelled as inferred', () => {
    const a = createAgent({ id: 'a', provider: 'claude-code', kind: 'subagent', sessionId: 's', name: 'n', role: 'r', project: 'p', cwd: '', startedAt: 0 }, 0);
    const msg = (id: string, model: string, out: number) => ({
      type: 'assistant', uuid: id, timestamp: new Date().toISOString(),
      message: { id, model, content: [], usage: { input_tokens: 0, output_tokens: out, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
    });
    for (const r of [msg('m1', 'claude-opus-5-5', 1_000_000), msg('m2', 'claude-haiku-5-5', 1_000_000)]) for (const e of parseRecord(r, { agentId: 'a' })) reduce(a, e, false);
    expect(a.estimatedCost).toMatchObject({ value: 20.5, source: 'inferred' });
    expect(Object.keys(a.costByModel!)).toEqual(['claude-opus-5-5', 'claude-haiku-5-5']);
    // A subagent's own cost was "unavailable" before; the estimate now fills that gap.
    expect(a.cost.source).toBe('unavailable');
  });

  it('flags models with an unknown price instead of inventing one', () => {
    const a = createAgent({ id: 'b', provider: 'claude-code', kind: 'session', sessionId: 's', name: 'n', role: 'r', project: 'p', cwd: '', startedAt: 0 }, 0);
    const r = { type: 'assistant', uuid: 'u', timestamp: new Date().toISOString(), message: { id: 'x', model: 'claude-future-9', content: [], usage: { input_tokens: 10, output_tokens: 10 } } };
    for (const e of parseRecord(r, { agentId: 'b' })) reduce(a, e, false);
    expect(a.estimatedCost?.source).toBe('unavailable');
  });
});
