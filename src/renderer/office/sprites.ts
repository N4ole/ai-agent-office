// Procedural pixel-art sprites. Every character is generated from its agent's avatar seed
// (stable across restarts), so each agent keeps its own look.

export type Canvas = HTMLCanvasElement;

const SKINS = ['#f6d3b3', '#e8b48f', '#c98e66', '#9a6440', '#6e4428'];
const HAIRS = ['#2b1d16', '#5a3a22', '#a0662f', '#d9b25a', '#c4492d', '#3d3d48', '#e6e6e6', '#6b4fa0'];
const PANTS = ['#2e3a59', '#3b3b3b', '#4a3b2a', '#22403a'];

// 12 x 18 character templates. Legend:
// o outline · h hair · s skin · e eye · m mouth · c shirt · d shirt shade · p pants · b shoes
const HEAD: Record<string, string[]> = {
  short: ['...oooooo...', '..ohhhhhho..', '.ohhhhhhhho.', '.ohssssssho.', '.osesssseso.', '.osssssssso.', '..ossmmsso..', '...oossoo...'],
  long: ['...oooooo...', '..ohhhhhho..', '.ohhhhhhhho.', '.ohssssssho.', 'ohsesssesho.', 'ohsssssssho.', 'ohhssmmsshho', 'oh.oossoo.ho'],
  spiky: ['..o.oo.o.o..', '.ohohhohho..', '.ohhhhhhhho.', '.ohssssssho.', '.osesssseso.', '.osssssssso.', '..ossmmsso..', '...oossoo...'],
  bun: ['....oooo....', '...ohhhho...', '..oohhhhoo..', '.ohhhhhhhho.', '.osesssseso.', '.osssssssso.', '..ossmmsso..', '...oossoo...'],
};

const BODY = ['..occcccco..', '.occcccccco.', 'occcccccccco', 'ocdcccccdcco', 'ocdcccccdcco', 'osoccccccoso'];
const LEGS: Record<string, string[]> = {
  stand: ['..oppppppo..', '..opppoppo..', '..opo..opo..', '..obbo.obbo.'],
  walk1: ['..oppppppo..', '..oppo.opo..', '.opo...opo..', '.obbo..obbo.'],
  walk2: ['..oppppppo..', '..opo.oppo..', '..opo...opo.', '..obbo..obbo'],
};
const ARMS_TYPE: string[][] = [
  ['occcccccccco', 'ocdcccccdcco', 'ocdcccccdcco', '.os......so.'],
  ['occcccccccco', 'ocdcccccdcco', 'osdcccccdcso', '..........so'],
];
const ARMS_REST = ['occcccccccco', 'ocdcccccdcco', 'ocdcccccdcco', 'osoccccccoso'];
const ARMS_UP = ['occcccccccso', 'ocdcccccdcso', 'ocdcccccdcco', 'osoccccccoo.'];

export interface Look {
  skin: string;
  hair: string;
  shirt: string;
  shirtDark: string;
  pants: string;
  head: keyof typeof HEAD;
  glasses: boolean;
  headset: boolean;
}

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

export function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.max(0, Math.round(((n >> 16) & 255) * f)));
  const g = Math.min(255, Math.max(0, Math.round(((n >> 8) & 255) * f)));
  const b = Math.min(255, Math.max(0, Math.round((n & 255) * f)));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export function lookFor(seed: number, color: string): Look {
  const r = rng(seed);
  const heads = Object.keys(HEAD) as (keyof typeof HEAD)[];
  return {
    skin: SKINS[Math.floor(r() * SKINS.length)],
    hair: HAIRS[Math.floor(r() * HAIRS.length)],
    shirt: color,
    shirtDark: shade(color, 0.72),
    pants: PANTS[Math.floor(r() * PANTS.length)],
    head: heads[Math.floor(r() * heads.length)],
    glasses: r() < 0.3,
    headset: r() < 0.25,
  };
}

function paint(ctx: CanvasRenderingContext2D, rows: string[], y0: number, look: Look) {
  const map: Record<string, string> = {
    o: '#1b1b26',
    h: look.hair,
    s: look.skin,
    e: '#1b1b26',
    m: shade(look.skin, 0.7),
    c: look.shirt,
    d: look.shirtDark,
    p: look.pants,
    b: '#141418',
  };
  rows.forEach((row, y) => {
    for (let x = 0; x < 12; x++) {
      const ch = row[x];
      if (!ch || ch === '.' || ch === ' ') continue;
      ctx.fillStyle = map[ch] ?? map.o;
      ctx.fillRect(x, y0 + y, 1, 1);
    }
  });
}

export type Pose = 'stand' | 'walk1' | 'walk2' | 'sit-type1' | 'sit-type2' | 'sit-rest' | 'sit-up' | 'sit-slump';

const cache = new Map<string, Canvas>();

/** Returns a 12x18 canvas for this look and pose (cached). */
export function characterSprite(seed: number, color: string, pose: Pose, tint?: 'grey'): Canvas {
  const key = `${seed}|${color}|${pose}|${tint ?? ''}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const look = lookFor(seed, color);
  if (tint === 'grey') {
    look.shirt = '#6b6b78';
    look.shirtDark = '#55555f';
  }
  const c = document.createElement('canvas');
  c.width = 12;
  c.height = 18;
  const ctx = c.getContext('2d')!;
  const headY = pose === 'sit-slump' ? 2 : 0;
  paint(ctx, HEAD[look.head], headY, look);
  if (look.glasses) {
    ctx.fillStyle = '#1b1b26';
    ctx.fillRect(2, headY + 4, 8, 1);
    ctx.fillStyle = '#9fd3ff';
    ctx.fillRect(3, headY + 4, 1, 1);
    ctx.fillRect(8, headY + 4, 1, 1);
  }
  if (look.headset) {
    ctx.fillStyle = '#30303a';
    ctx.fillRect(1, headY + 3, 1, 3);
    ctx.fillRect(10, headY + 3, 1, 3);
    ctx.fillRect(2, headY, 8, 1);
    ctx.fillStyle = '#e03131';
    ctx.fillRect(10, headY + 4, 1, 1);
  }
  if (pose.startsWith('sit')) {
    const arms = pose === 'sit-type1' ? ARMS_TYPE[0] : pose === 'sit-type2' ? ARMS_TYPE[1] : pose === 'sit-up' ? ARMS_UP : ARMS_REST;
    paint(ctx, BODY.slice(0, 2), 8, look);
    paint(ctx, arms, 10, look);
  } else {
    paint(ctx, BODY, 8, look);
    paint(ctx, LEGS[pose] ?? LEGS.stand, 14, look);
  }
  cache.set(key, c);
  return c;
}

/** 7x7 pixel icons for activity bubbles. */
const ICONS: Record<string, { rows: string[]; color: string }> = {
  thinking: { rows: ['.......', '.......', '.......', 'x.x.x..', '.......', '.......', '.......'], color: '#5c5f66' },
  coding: { rows: ['.......', '.x...x.', 'x..x..x', '.x.x.x.', 'x..x..x', '.x...x.', '.......'], color: '#1c7ed6' },
  reading: { rows: ['.......', 'xxx.xxx', 'x.x.x.x', 'xxx.xxx', 'x.x.x.x', 'xxxxxxx', '.......'], color: '#7048e8' },
  searching: { rows: ['.xxx...', 'x...x..', 'x...x..', 'x...x..', '.xxxx..', '....xx.', '.....xx'], color: '#0c8599' },
  testing: { rows: ['.......', '......x', '.....x.', 'x...x..', '.x.x...', '..x....', '.......'], color: '#2f9e44' },
  command: { rows: ['.......', 'x......', '.x.....', '..x....', '.x.....', 'x..xxx.', '.......'], color: '#343a40' },
  delegating: { rows: ['..x....', '.xxx...', '..x..x.', '.....xx', 'xx.xxxx', '.....xx', '.....x.'], color: '#e8590c' },
  browsing: { rows: ['.xxxxx.', 'x..x..x', 'xxxxxxx', 'x..x..x', 'xxxxxxx', 'x..x..x', '.xxxxx.'], color: '#1098ad' },
  waiting: { rows: ['.xxxx..', 'x....x.', '....x..', '...x...', '...x...', '.......', '...x...'], color: '#f08c00' },
  error: { rows: ['...x...', '...x...', '...x...', '...x...', '...x...', '.......', '...x...'], color: '#e03131' },
  done: { rows: ['.......', '......x', '.....xx', 'x...xx.', 'xx.xx..', '.xxx...', '..x....'], color: '#2f9e44' },
  idle: { rows: ['.......', '.xxxxx.', '.x...xx', '.x...xx', '.xxxxx.', '..xxx..', '.......'], color: '#8d6e63' },
  lost: { rows: ['x.....x', '.x...x.', '..x.x..', '...x...', '..x.x..', '.x...x.', 'x.....x'], color: '#e03131' },
  talk: { rows: ['.......', 'xxxxxxx', 'x.....x', 'x.xxx.x', 'x.....x', 'xxxxxxx', '.x.....'], color: '#495057' },
};

export function drawIcon(ctx: CanvasRenderingContext2D, name: string, x: number, y: number, color?: string) {
  const ic = ICONS[name] ?? ICONS.thinking;
  ctx.fillStyle = color ?? ic.color;
  ic.rows.forEach((row, yy) => {
    for (let xx = 0; xx < 7; xx++) if (row[xx] === 'x') ctx.fillRect(x + xx, y + yy, 1, 1);
  });
}

/** Draws an icon onto a small standalone canvas (used by the UI lists). */
export function iconCanvas(name: string, scale = 2): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 7 * scale;
  c.height = 7 * scale;
  const g = c.getContext('2d')!;
  g.scale(scale, scale);
  drawIcon(g, name, 0, 0, '#e9ecef');
  return c;
}
