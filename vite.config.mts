import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { withDevCsp } from './src/shared/csp';

export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [
    react(),
    // The production CSP (index.html) allows no localhost origin; the dev server needs one (R-25).
    { name: 'dev-csp', apply: 'serve', transformIndexHtml: (html: string) => withDevCsp(html) },
  ],
  build: { outDir: '../../dist/renderer', emptyOutDir: true },
  server: { port: 5199, strictPort: true },
});
