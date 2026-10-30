// Bundles the Electron main + preload processes with esbuild.
import { build } from 'esbuild';
const common = { bundle: true, platform: 'node', target: 'node22', format: 'cjs', sourcemap: true, external: ['electron', 'sql.js'], logLevel: 'info' };
await build({ ...common, entryPoints: ['src/main/index.ts'], outfile: 'dist/main/index.js' });
await build({ ...common, entryPoints: ['src/main/preload.ts'], outfile: 'dist/main/preload.js' });
await build({ ...common, entryPoints: ['src/main/hook-relay.ts'], outfile: 'dist/main/hook-relay.js' });
