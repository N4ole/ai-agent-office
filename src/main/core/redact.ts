// Masks secrets before anything is displayed, stored or exported.

const BUILTIN: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{10,}/g, // Anthropic keys
  /\bsk-[A-Za-z0-9_-]{20,}/g, // OpenAI-style keys
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g, // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, // Slack
  /\bAIza[0-9A-Za-z_-]{30,}\b/g, // Google API key
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWT
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

// key=value style secrets: keep the key, mask the value.
const KV =
  /\b((?:api[_-]?key|apikey|secret|token|password|passwd|pwd|auth|authorization|access[_-]?key|client[_-]?secret)["']?\s*[:=]\s*["']?)([^\s"'&,;]{4,})/gi;
const BEARER = /\b(Bearer\s+)[A-Za-z0-9._\-~+/]{8,}=*/g;

const MASK = '••••••';

let custom: RegExp[] = [];

export function setCustomRedactions(patterns: string[]): void {
  custom = [];
  for (const p of patterns) {
    try {
      if (p.trim()) custom.push(new RegExp(p, 'g'));
    } catch {
      // invalid user pattern: ignored (validated in the settings UI)
    }
  }
}

export function redact(input: string): string {
  if (!input) return input;
  let out = input;
  for (const re of BUILTIN) out = out.replace(re, MASK);
  out = out.replace(BEARER, (_m, k: string) => `${k}${MASK}`);
  out = out.replace(KV, (_m, k: string) => `${k}${MASK}`);
  for (const re of custom) out = out.replace(re, MASK);
  return out;
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `… [+${s.length - max} car.]`;
}

/** Redact + truncate in one go. */
export function clean(s: unknown, max = 4000): string {
  const str = typeof s === 'string' ? s : s == null ? '' : safeStringify(s);
  return truncate(redact(str), max);
}

export function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export function firstLine(s: string, max = 160): string {
  const line = (s || '').split(/\r?\n/).find((l) => l.trim().length > 0) ?? '';
  return truncate(line.trim(), max);
}
