// Content-Security-Policy of the renderer (R-25). The packaged app only loads its own files;
// the Vite dev server additionally needs its HTTP and WebSocket origins, added in dev mode only.

export const PROD_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'";
export const DEV_CSP = `${PROD_CSP} ws://localhost:5199 http://localhost:5199`;

/** Used by vite.config.mts when serving (`npm run dev`): swaps the production CSP for the dev one. */
export function withDevCsp(html: string): string {
  if (!html.includes(PROD_CSP)) throw new Error('index.html CSP differs from PROD_CSP (src/shared/csp.ts)');
  return html.replace(PROD_CSP, DEV_CSP);
}
