// Turns coverage/coverage-summary.json into a Markdown table (for the GitHub job summary).
// Usage: node scripts/coverage-summary.mjs >> "$GITHUB_STEP_SUMMARY"
import { readFileSync } from 'node:fs';
import path from 'node:path';

const file = path.resolve(import.meta.dirname, '../coverage/coverage-summary.json');
let summary;
try {
  summary = JSON.parse(readFileSync(file, 'utf8'));
} catch {
  console.log('Coverage summary not found (did `vitest --coverage` run?).');
  process.exit(0);
}
const root = path.resolve(import.meta.dirname, '..');
const pct = (m) => `${m.pct.toFixed(1)} %`;
const rows = Object.entries(summary)
  .filter(([k]) => k !== 'total')
  .map(([k, v]) => [path.relative(root, k).split(path.sep).join('/'), v])
  .sort(([a], [b]) => a.localeCompare(b));
const t = summary.total;
const out = [
  '## Coverage',
  '',
  `**Total** — lines ${pct(t.lines)}, statements ${pct(t.statements)}, functions ${pct(t.functions)}, branches ${pct(t.branches)}`,
  '',
  '<details><summary>Per file</summary>',
  '',
  '| File | Lines | Statements | Functions | Branches |',
  '|---|---:|---:|---:|---:|',
  ...rows.map(([f, v]) => `| \`${f}\` | ${pct(v.lines)} | ${pct(v.statements)} | ${pct(v.functions)} | ${pct(v.branches)} |`),
  '',
  '</details>',
];
console.log(out.join('\n'));
