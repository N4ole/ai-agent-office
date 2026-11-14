// Runs ESLint from the isolated toolchain in tools/lint (see tools/lint/package.json for why).
// Extra arguments are passed through, e.g. `npm run lint -- --fix`.
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const eslint = path.join(root, 'tools/lint/node_modules/eslint/bin/eslint.js');
if (!existsSync(eslint)) {
  console.error('ESLint n’est pas installé. Lancez d’abord : npm run lint:setup');
  process.exit(2);
}
const r = spawnSync(process.execPath, [eslint, '--config', path.join(root, 'tools/lint/eslint.config.mjs'), ...process.argv.slice(2), '.'], {
  cwd: root,
  stdio: 'inherit',
});
process.exit(r.status ?? 1);
