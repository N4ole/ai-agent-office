// Validation of user-defined redaction patterns (R-19). They run on every line the app displays or
// stores, in the main process: a catastrophic regex (ReDoS) would freeze the whole app. Shared by the
// settings screen (immediate feedback) and the main process (enforcement).

export const MAX_PATTERNS = 20;
export const MAX_PATTERN_LENGTH = 200;
/** Time allowed to scan the probe strings below; real lines are at most a few KB. */
const PROBE_BUDGET_MS = 25;

/**
 * Finds a quantified group that itself contains a quantifier or an alternation, e.g. (a+)+, (a|ab)*,
 * (\w+\s?)*: the classic shapes of exponential backtracking. Escapes and [...] classes are skipped.
 */
export function hasNestedQuantifier(p: string): boolean {
  // `loose`: contains a quantifier or an alternation; `unbounded`: contains + * or {n,}.
  type G = { loose: boolean; unbounded: boolean };
  const stack: G[] = [];
  let last: G | null = null; // group that just closed, if the current char may quantify it
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '\\') {
      i++;
      last = null;
      continue;
    }
    if (c === '[') {
      for (i++; i < p.length && p[i] !== ']'; i++) if (p[i] === '\\') i++;
      last = null;
      continue;
    }
    if (c === '(') {
      stack.push({ loose: false, unbounded: false });
      const prefix = /^\(\?(?::|=|!|<=|<!|<[A-Za-z_]\w*>)/.exec(p.slice(i)); // (?: (?= (?<name> ... are not quantifiers
      if (prefix) i += prefix[0].length - 1;
      last = null;
      continue;
    }
    if (c === ')') {
      const g = stack.pop() ?? { loose: false, unbounded: false };
      const parent = stack[stack.length - 1];
      if (parent) {
        parent.loose ||= g.loose;
        parent.unbounded ||= g.unbounded;
      }
      last = g;
      continue;
    }
    const brace = c === '{' ? /^\{(\d*)(,?)(\d*)\}/.exec(p.slice(i)) : null;
    const isUnbounded = c === '+' || c === '*' || (!!brace && brace[2] === ',' && brace[3] === '');
    const isRepeat = isUnbounded || (!!brace && Number(brace[3] || brace[1]) > 1);
    // (a+)+, (a|b)* : exponential.  (.*a){12} : polynomial of a high degree.
    if (last && ((isUnbounded && last.loose) || (isRepeat && last.unbounded))) return true;
    if (c === '|' || isRepeat || c === '?') for (const g of stack) g.loose = true;
    if (isUnbounded) for (const g of stack) g.unbounded = true;
    last = null;
  }
  return false;
}

/** Returns an error message (French, shown to the user) or null if the pattern is acceptable. */
export function checkRedactPattern(p: string): string | null {
  if (p.length > MAX_PATTERN_LENGTH) return `trop longue (${p.length} caractères, ${MAX_PATTERN_LENGTH} max)`;
  let re: RegExp;
  try {
    re = new RegExp(p, 'g');
  } catch (e: any) {
    return `invalide (${e?.message ?? e})`;
  }
  if (/\\[1-9]|\\k</.test(p)) return 'les références arrière (\\1, \\k<nom>) ne sont pas acceptées';
  if (hasNestedQuantifier(p)) return 'quantificateurs imbriqués (ex. (a+)+) : risque de blocage de l’application';
  if (re.test('')) return 'correspond à une chaîne vide';
  const probes = ['a'.repeat(400) + '!', 'x '.repeat(200) + '§', '0'.repeat(300) + 'a', 'Lorem ipsum dolor sit amet, '.repeat(15)];
  const t0 = performance.now();
  for (const s of probes) {
    re.lastIndex = 0;
    s.replace(re, '');
  }
  if (performance.now() - t0 > PROBE_BUDGET_MS) return 'trop lente sur un texte de test : risque de blocage de l’application';
  return null;
}

/** Splits a list into accepted patterns and readable errors. */
export function checkRedactPatterns(list: unknown): { ok: string[]; errors: string[] } {
  const ok: string[] = [];
  const errors: string[] = [];
  const items = Array.isArray(list) ? list : [];
  for (const raw of items) {
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const p = raw.trim();
    if (ok.length >= MAX_PATTERNS) {
      errors.push(`« ${p.slice(0, 40)} » : ${MAX_PATTERNS} expressions maximum`);
      continue;
    }
    const err = checkRedactPattern(p);
    if (err) errors.push(`« ${p.slice(0, 40)} » : ${err}`);
    else ok.push(p);
  }
  return { ok, errors };
}
