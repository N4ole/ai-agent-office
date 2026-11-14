// Development/test helpers driven by environment variables (isolated data folder, fixed window
// size, automatic screenshots with scripted UI steps, dev server URL).
// They are only honoured when the app is NOT packaged (R-17): in an installed build, anyone able
// to set these variables could otherwise load a remote page or run JavaScript inside the window.

export interface DevHelpers {
  userData?: string;
  window?: { width: number; height: number };
  devServerUrl?: string;
  screenshot?: { file: string; delays: number[]; scripts: string[]; exit: boolean };
}

export function devHelpers(env: NodeJS.ProcessEnv, isPackaged: boolean): DevHelpers {
  if (isPackaged) return {};
  const out: DevHelpers = {};
  if (env.AAO_USER_DATA) out.userData = env.AAO_USER_DATA;
  const w = env.AAO_WINDOW?.match(/^(\d+)x(\d+)$/);
  if (w) out.window = { width: Number(w[1]), height: Number(w[2]) };
  if (env.VITE_DEV_SERVER_URL && /^http:\/\/localhost:\d+\/?$/.test(env.VITE_DEV_SERVER_URL)) out.devServerUrl = env.VITE_DEV_SERVER_URL;
  if (env.AAO_SCREENSHOT) {
    out.screenshot = {
      file: env.AAO_SCREENSHOT,
      delays: (env.AAO_SCREENSHOT_AT ?? '6000').split(',').map(Number),
      scripts: (env.AAO_SCRIPT ?? '').split('|||'),
      exit: !!env.AAO_EXIT,
    };
  }
  return out;
}
