// R-19: user-defined redaction patterns must not be able to freeze the app (ReDoS).

import { afterEach, describe, expect, it } from 'vitest';
import { checkRedactPattern, checkRedactPatterns, hasNestedQuantifier, MAX_PATTERNS } from '../src/shared/redactPatterns';
import { redact, setCustomRedactions } from '../src/main/core/redact';
import { mergeSettings } from '../src/main/core/settings';

afterEach(() => setCustomRedactions([]));

describe('custom redaction patterns (R-19)', () => {
  it('accepts ordinary patterns', () => {
    for (const p of ['CLIENT-\\d+', 'PRJ-[A-Z]{3}-\\d{4}', 'secret_[a-z0-9]{8,40}', '(?:foo|bar)-\\d+', '(?:abc)+x', '(?:foo|bar){2}', 'acme\\.internal'])
      expect(checkRedactPattern(p)).toBeNull();
  });

  it('rejects catastrophic shapes before they ever run', () => {
    for (const p of ['(a+)+$', '(a*)*b', '(\\w+\\s?)*$', '(a|aa)+$', '((ab)*)+c', '(x+x+)+y', '(.*a){12}']) {
      expect(hasNestedQuantifier(p) || checkRedactPattern(p) !== null, p).toBe(true);
    }
  });

  it('rejects invalid, empty-matching, back-referencing and over-long patterns', () => {
    expect(checkRedactPattern('(')).toMatch(/invalide/);
    expect(checkRedactPattern('a*')).toMatch(/vide/);
    expect(checkRedactPattern('(a)\\1')).toMatch(/référence/);
    expect(checkRedactPattern('a'.repeat(201))).toMatch(/longue/);
  });

  it('limits the number of patterns', () => {
    const r = checkRedactPatterns(Array.from({ length: MAX_PATTERNS + 3 }, (_, i) => `ID${i}-\\d+`));
    expect(r.ok).toHaveLength(MAX_PATTERNS);
    expect(r.errors).toHaveLength(3);
  });

  it('never applies a rejected pattern, so redaction stays fast', () => {
    const rejected = setCustomRedactions(['(a+)+$', 'CLIENT-\\d+']);
    expect(rejected).toHaveLength(1);
    const t0 = Date.now();
    expect(redact('a'.repeat(40) + '! CLIENT-12')).toBe('a'.repeat(40) + '! ••••••');
    expect(Date.now() - t0).toBeLessThan(500);
  });

  it('drops unsafe patterns from stored settings', () => {
    expect(mergeSettings({ redactPatterns: ['(a+)+$', 'OK-\\d+', 42 as any] }).redactPatterns).toEqual(['OK-\\d+']);
  });
});
