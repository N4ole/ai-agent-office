// Public Anthropic API prices (first-party), in USD per million tokens.
// Source: https://platform.claude.com/docs/en/about-claude/pricing (read on 2026-10-30).
// Checked against Claude Code's own cost-state record: tokens × these prices reproduced a
// session's recorded cost to the cent (claude-opus-5-5, 1.4184 $).
// For claude.ai subscriptions this is the API-equivalent cost, not what is actually billed.

export interface ModelPrice {
  label: string;
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  /** Optional higher rate card above a prompt-length threshold (Haiku 5.5). */
  longPrompt?: { above: number; input: number; output: number };
}

const std = (label: string, input: number, output: number, cacheRead = input * 0.1): ModelPrice => ({
  label, input, output, cacheWrite5m: input * 1.25, cacheWrite1h: input * 2, cacheRead,
});

export const PRICES_AS_OF = '30/10/2026';
export const PRICES_SOURCE = 'platform.claude.com/docs/en/about-claude/pricing';

export const PRICES: Record<string, ModelPrice> = {
  'claude-fable-5-1': std('Fable 5.1', 10, 50, 0.25),
  'claude-mythos-5-1': std('Mythos 5.1', 10, 50, 0.25),
  'claude-fable-5': std('Fable 5', 10, 50, 1),
  'claude-mythos-5': std('Mythos 5', 10, 50, 1),
  'claude-opus-5-5': std('Opus 5.5', 4, 20, 0.2),
  'claude-opus-5': std('Opus 5', 5, 25),
  'claude-opus-4-8': std('Opus 4.8', 5, 25),
  'claude-opus-4-7': std('Opus 4.7', 5, 25),
  'claude-opus-4-6': std('Opus 4.6', 5, 25),
  'claude-opus-4-5': std('Opus 4.5', 5, 25),
  'claude-opus-4-1': std('Opus 4.1', 15, 75),
  'claude-opus-4': std('Opus 4', 15, 75),
  'claude-sonnet-5-5': std('Sonnet 5.5', 2, 10, 0.1),
  'claude-sonnet-5': std('Sonnet 5', 2, 10),
  'claude-sonnet-4-6': std('Sonnet 4.6', 3, 15),
  'claude-sonnet-4-5': std('Sonnet 4.5', 3, 15),
  'claude-sonnet-4': std('Sonnet 4', 3, 15),
  'claude-haiku-5-5': { ...std('Haiku 5.5', 0.1, 0.5), longPrompt: { above: 100_000, input: 0.5, output: 2.5 } },
  'claude-haiku-4-5': std('Haiku 4.5', 1, 5),
  'claude-3-5-haiku': std('Haiku 3.5', 0.8, 4),
};

/** Maps a model string as written in transcripts ("claude-opus-5-5[1m]", "anthropic.claude-…", dated ids) to a price key. */
export function normalizeModel(model: string | undefined | null): string | null {
  if (!model) return null;
  let m = model.toLowerCase().trim();
  m = m.replace(/^(us\.|eu\.|global\.)?anthropic\./, '').replace(/\[.*?\]$/, '').replace(/@.*$/, '').replace(/-\d{8}$/, '').replace(/-v\d+(:\d+)?$/, '');
  if (PRICES[m]) return m;
  // Short aliases used by Claude Code (--model opus / sonnet / haiku) never reach transcripts,
  // but tolerate a prefix match on a known id (e.g. "claude-opus-5-5-fast").
  const hit = Object.keys(PRICES).sort((a, b) => b.length - a.length).find((k) => m.startsWith(k));
  return hit ?? null;
}

export interface UsageTokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
}

/** Cost in USD of one API response's usage. Returns null if the model is not in the price table. */
export function priceUsage(model: string | undefined | null, u: UsageTokens): number | null {
  const key = normalizeModel(model);
  if (!key) return null;
  const p = PRICES[key];
  let inRate = p.input;
  let outRate = p.output;
  let readRate = p.cacheRead;
  let w5 = p.cacheWrite5m;
  let w1 = p.cacheWrite1h;
  const promptLen = u.input + u.cacheRead + u.cacheWrite5m + u.cacheWrite1h;
  if (p.longPrompt && promptLen > p.longPrompt.above) {
    const f = p.longPrompt.input / p.input;
    inRate = p.longPrompt.input;
    outRate = p.longPrompt.output;
    readRate *= f;
    w5 *= f;
    w1 *= f;
  }
  return (u.input * inRate + u.output * outRate + u.cacheRead * readRate + u.cacheWrite5m * w5 + u.cacheWrite1h * w1) / 1_000_000;
}

export function modelLabel(model: string | null | undefined): string {
  const k = normalizeModel(model);
  return k ? PRICES[k].label : model ?? '?';
}
