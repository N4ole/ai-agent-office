// Dev mode: Vite dev server for the UI + Electron pointing at it.
import { spawn, execSync } from 'node:child_process';
import { createServer } from 'vite';
execSync('node scripts/build-main.mjs', { stdio: 'inherit' });
const server = await createServer({ configFile: 'vite.config.mts' });
await server.listen();
const electron = (await import('electron')).default;
const child = spawn(electron, ['.'], { stdio: 'inherit', env: { ...process.env, VITE_DEV_SERVER_URL: 'http://localhost:5199' } });
child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
