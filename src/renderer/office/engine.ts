// 2D pixel-art office renderer (Canvas 2D, top-down view).
// Positions and walks are visual simulation; what a character *does* (animation, bubble, status
// ring) always mirrors the real state of its agent. Lighting follows the real local time.

import type { AgentState } from '../../shared/types';
import { characterSprite, drawIcon, type Pose } from './sprites';

const T = 16; // tile size in world pixels
const CELL_W = 5;
const CELL_H = 5;
const LOUNGE_W = 10;
const TOP = 4; // wall rows
const SPEED = 3.2; // tiles / second
const DESK_RELEASE_MS = 10 * 60_000;

export const STATUS_COLORS: Record<string, string> = {
  working: '#51cf66',
  waiting: '#fcc419',
  idle: '#adb5bd',
  done: '#4dabf7',
  error: '#ff6b6b',
  lost: '#ff6b6b',
  unknown: '#868e96',
};

interface Pt {
  x: number;
  y: number;
}

interface Layout {
  cols: number;
  rows: number;
  w: number;
  h: number;
  door: Pt;
  blocked: Uint8Array;
  loungeSpots: { p: Pt; kind: 'couch' | 'coffee' | 'water' | 'books' }[];
}

interface Actor {
  id: string;
  x: number;
  y: number;
  path: Pt[];
  goal: string;
  seated: boolean;
  walkT: number;
  leaving: boolean;
  gone: boolean;
  briefUntil: number;
  reportedDone: boolean;
  arrivedAt: number;
  celebrateUntil: number;
  lastActionKey: string;
  actionShownAt: number;
  statusSince: number;
  lastStatus: string;
}

export interface EngineCallbacks {
  onSelect(id: string | null): void;
  onHover(id: string | null, screen: Pt): void;
}

/** Light phase from the real local hour. */
export function dayPhase(d = new Date()): 'day' | 'dusk' | 'night' {
  const h = d.getHours() + d.getMinutes() / 60;
  if (h >= 7.5 && h < 18) return 'day';
  if ((h >= 18 && h < 20.5) || (h >= 6 && h < 7.5)) return 'dusk';
  return 'night';
}

export class OfficeEngine {
  private ctx: CanvasRenderingContext2D;
  private agents = new Map<string, AgentState>();
  private actors = new Map<string, Actor>();
  private layout!: Layout;
  private staticLayer: HTMLCanvasElement | null = null;
  private staticPhase = '';
  private shadow: HTMLCanvasElement | null = null;
  private zoom = 3;
  private camX = 0;
  private camY = 0;
  // Smooth camera: current values ease towards these targets.
  private tZoom = 3;
  private tCamX = 0;
  private tCamY = 0;
  private raf = 0;
  private last = performance.now();
  private selected: string | null = null;
  private hovered: string | null = null;
  private drag: { x: number; y: number; cx: number; cy: number; moved: boolean } | null = null;
  private deskCount = 0;
  private dpr = window.devicePixelRatio || 1;
  private centered = false;
  showLinks = true;
  showBubbles = true;
  /** Screen pixels hidden at the top by overlays (live ticker). */
  topInset = 104;

  constructor(private canvas: HTMLCanvasElement, private cb: EngineCallbacks) {
    this.ctx = canvas.getContext('2d')!;
    this.buildLayout(4);
    this.bindInput();
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.canvas.onwheel = this.canvas.onmousedown = this.canvas.onmousemove = this.canvas.onmouseleave = null;
    window.removeEventListener('mouseup', this.onUp);
  }

  // ---------- public API ----------

  setAgents(list: AgentState[]) {
    this.agents = new Map(list.map((a) => [a.id, a]));
    const maxDesk = list.reduce((m, a) => (a.desk >= 0 ? Math.max(m, a.desk) : m), -1);
    const need = Math.max(4, maxDesk + 1);
    if (need > this.deskCount || need < this.deskCount / 2 - 2) this.buildLayout(need);
    const now = Date.now();
    for (const a of list) {
      if (a.desk < 0 || this.actors.has(a.id)) continue;
      // Agents that finished long ago are history, not office occupants.
      const ended = (a.status === 'done' || a.status === 'lost') && now - (a.endedAt ?? a.lastEventAt) > DESK_RELEASE_MS;
      // 'unknown' = history still loading: wait for a real status before placing the character.
      if (!ended && a.status !== 'unknown') this.spawnActor(a);
    }
    for (const act of this.actors.values()) {
      const a = this.agents.get(act.id);
      if ((!a || a.desk < 0) && !act.leaving) {
        act.leaving = true;
        act.seated = false;
        act.goal = 'door';
        act.path = this.findPath(this.tileOf(act), this.layout.door);
      }
    }
  }

  setSelected(id: string | null) {
    this.selected = id;
  }

  /** Smoothly moves the camera onto an agent. */
  focus(id: string) {
    const act = this.actors.get(id);
    if (!act) return;
    const r = this.canvas.getBoundingClientRect();
    if (this.tZoom < 3) this.tZoom = 3;
    this.tCamX = act.x * T + T / 2 - r.width / 2 / this.tZoom;
    this.tCamY = act.y * T - (r.height + this.topInset) / 2 / this.tZoom;
  }

  zoomBy(f: number, sx?: number, sy?: number) {
    const r = this.canvas.getBoundingClientRect();
    const px = sx ?? r.width / 2;
    const py = sy ?? r.height / 2;
    const wx = this.tCamX + px / this.tZoom;
    const wy = this.tCamY + py / this.tZoom;
    this.tZoom = Math.min(8, Math.max(1, this.tZoom * f));
    this.tCamX = wx - px / this.tZoom;
    this.tCamY = wy - py / this.tZoom;
  }

  resetView(instant = false) {
    const r = this.canvas.getBoundingClientRect();
    const h = r.height - this.topInset;
    const zx = r.width / (this.layout.w * T);
    const zy = h / (this.layout.h * T);
    this.tZoom = Math.max(1, Math.min(6, Math.min(zx, zy) * 0.94));
    this.tCamX = (this.layout.w * T) / 2 - r.width / 2 / this.tZoom;
    this.tCamY = (this.layout.h * T) / 2 - (h / 2 + this.topInset) / this.tZoom;
    if (instant) {
      this.zoom = this.tZoom;
      this.camX = this.tCamX;
      this.camY = this.tCamY;
    }
  }

  // ---------- layout ----------

  private buildLayout(desks: number) {
    const cols = Math.min(5, Math.max(2, Math.ceil(Math.sqrt(desks * 1.4))));
    const rows = Math.max(2, Math.ceil(desks / cols));
    const w = 2 + cols * CELL_W + 1 + LOUNGE_W;
    const h = TOP + rows * CELL_H + 3;
    const blocked = new Uint8Array(w * h);
    const block = (x: number, y: number) => {
      if (x >= 0 && y >= 0 && x < w && y < h) blocked[y * w + x] = 1;
    };
    for (let x = 0; x < w; x++) for (let y = 0; y < TOP; y++) block(x, y);
    for (let y = 0; y < h; y++) {
      block(0, y);
      block(w - 1, y);
    }
    const door = { x: 2 + Math.floor((cols * CELL_W) / 2), y: h - 1 };
    for (let x = 0; x < w; x++) if (x !== door.x) block(x, h - 1);
    for (let i = 0; i < cols * rows; i++) {
      const o = this.cellOrigin(i, cols);
      for (let dx = 1; dx <= 3; dx++) block(o.x + dx, o.y + 2);
    }
    const lx = 2 + cols * CELL_W + 1;
    const loungeSpots: Layout['loungeSpots'] = [];
    const couchY = TOP + 3;
    for (let dx = 1; dx <= 5; dx++) block(lx + dx, couchY + 1);
    for (let dx = 1; dx <= 5; dx++) loungeSpots.push({ p: { x: lx + dx, y: couchY }, kind: 'couch' });
    block(lx + 1, TOP);
    block(lx + 3, TOP);
    loungeSpots.push({ p: { x: lx + 1, y: TOP + 1 }, kind: 'coffee' }, { p: { x: lx + 3, y: TOP + 1 }, kind: 'water' });
    for (let dx = 6; dx <= 8; dx++) block(lx + dx, TOP);
    loungeSpots.push({ p: { x: lx + 7, y: TOP + 1 }, kind: 'books' });
    block(lx + 8, h - 2);
    block(1, h - 2);
    const mt = { x: lx + 3, y: TOP + 7 };
    for (let dx = 0; dx < 3; dx++) for (let dy = 0; dy < 2; dy++) block(mt.x + dx, mt.y + dy);
    this.layout = { cols, rows, w, h, door, blocked, loungeSpots };
    this.deskCount = cols * rows;
    this.staticLayer = null;
    for (const act of this.actors.values()) {
      act.path = [];
      act.goal = '';
      act.seated = false;
    }
    if (!this.centered) {
      requestAnimationFrame(() => this.resetView(true));
      this.centered = true;
    }
  }

  private cellOrigin(i: number, cols = this.layout.cols): Pt {
    return { x: 2 + (i % cols) * CELL_W, y: TOP + Math.floor(i / cols) * CELL_H };
  }

  private seatOf(desk: number): Pt {
    const o = this.cellOrigin(desk);
    return { x: o.x + 2, y: o.y + 1 };
  }

  private isBlocked(x: number, y: number) {
    const L = this.layout;
    if (x < 0 || y < 0 || x >= L.w || y >= L.h) return true;
    return L.blocked[y * L.w + x] === 1;
  }

  private tileOf(a: Actor): Pt {
    return { x: Math.round(a.x), y: Math.round(a.y) };
  }

  /** BFS on the tile grid (small maps: plenty fast). */
  private findPath(from: Pt, to: Pt): Pt[] {
    const L = this.layout;
    if (from.x === to.x && from.y === to.y) return [];
    const W = L.w;
    const prev = new Int32Array(W * L.h).fill(-1);
    const start = from.y * W + from.x;
    const goal = to.y * W + to.x;
    if (start < 0 || start >= prev.length) return [to];
    const q = [start];
    prev[start] = start;
    while (q.length) {
      const cur = q.shift()!;
      if (cur === goal) break;
      const cx = cur % W;
      const cy = (cur - cx) / W;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx;
        const ny = cy + dy;
        const ni = ny * W + nx;
        if (nx < 0 || ny < 0 || nx >= W || ny >= L.h || prev[ni] !== -1) continue;
        if (this.isBlocked(nx, ny) && ni !== goal) continue;
        prev[ni] = cur;
        q.push(ni);
      }
    }
    if (prev[goal] === -1) return [to];
    const path: Pt[] = [];
    for (let c = goal; c !== start; c = prev[c]) path.push({ x: c % W, y: Math.floor(c / W) });
    return path.reverse();
  }

  private spawnActor(a: AgentState) {
    const fresh = Date.now() - a.startedAt < 60_000 || (a.kind === 'subagent' && a.status !== 'done');
    const start = fresh ? this.layout.door : this.seatOf(a.desk);
    const now = performance.now();
    this.actors.set(a.id, {
      id: a.id, x: start.x, y: start.y, path: [], goal: '', seated: false, walkT: 0, leaving: false, gone: false,
      briefUntil: a.kind === 'subagent' && fresh ? now + 2500 : 0,
      reportedDone: a.status === 'done', arrivedAt: 0, celebrateUntil: 0, lastActionKey: a.lastAction.value ?? '', actionShownAt: 0, statusSince: now, lastStatus: a.status,
    });
  }

  // ---------- simulation ----------

  /** Where should this agent be right now, given its real status? */
  private targetFor(act: Actor, a: AgentState, now: number): { key: string; p: Pt; seated: boolean } {
    const seat = this.seatOf(a.desk);
    const parentAgent = a.parentId ? this.agents.get(a.parentId) : undefined;
    const parentHere = parentAgent && parentAgent.desk >= 0 && a.parentId && this.actors.has(a.parentId);
    if (parentHere && now < act.briefUntil) {
      const ps = this.seatOf(parentAgent!.desk);
      return { key: `brief:${a.parentId}`, p: { x: ps.x + 1, y: ps.y }, seated: false };
    }
    if (parentHere && a.status === 'done' && a.kind === 'subagent' && !act.reportedDone) {
      const ps = this.seatOf(parentAgent!.desk);
      return { key: `report:${a.parentId}`, p: { x: ps.x - 1, y: ps.y }, seated: false };
    }
    if (a.status === 'idle' && now - act.statusSince > 15_000) {
      const spots = this.layout.loungeSpots;
      const i = a.avatarSeed % spots.length;
      return { key: `lounge:${i}`, p: spots[i].p, seated: spots[i].kind === 'couch' };
    }
    return { key: `desk:${a.desk}`, p: seat, seated: true };
  }

  /** Keeps the room in view: centred on an axis where it fits, never scrolled far past its edges. */
  private clampCamera() {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const roomW = this.layout.w * T;
    const roomH = this.layout.h * T;
    const inset = this.topInset / this.tZoom;
    const viewW = r.width / this.tZoom;
    const viewH = r.height / this.tZoom - inset;
    if (roomW <= viewW) this.tCamX = roomW / 2 - viewW / 2;
    else this.tCamX = Math.min(roomW - viewW + T, Math.max(-T, this.tCamX));
    if (roomH <= viewH) this.tCamY = roomH / 2 - viewH / 2 - inset;
    else this.tCamY = Math.min(roomH - viewH - inset + T, Math.max(-inset - T, this.tCamY));
  }

  private step(dt: number, now: number) {
    this.clampCamera();
    // camera easing
    const k = 1 - Math.pow(0.0005, dt);
    this.zoom += (this.tZoom - this.zoom) * k;
    this.camX += (this.tCamX - this.camX) * k;
    this.camY += (this.tCamY - this.camY) * k;

    for (const act of this.actors.values()) {
      const a = this.agents.get(act.id);
      if (a && a.status !== act.lastStatus) {
        if (a.status === 'done' && act.lastStatus !== 'done') act.celebrateUntil = now + 4000;
        act.lastStatus = a.status;
        act.statusSince = now;
      }
      if (a && (a.lastAction.value ?? '') !== act.lastActionKey) {
        act.lastActionKey = a.lastAction.value ?? '';
        act.actionShownAt = now;
      }
      if (!act.leaving && a) {
        const tgt = this.targetFor(act, a, now);
        if (tgt.key !== act.goal) {
          act.goal = tgt.key;
          act.seated = false;
          act.path = this.findPath(this.tileOf(act), tgt.p);
        }
        if (!act.path.length && Math.abs(act.x - tgt.p.x) < 0.01 && Math.abs(act.y - tgt.p.y) < 0.01) {
          act.seated = tgt.seated;
          if (tgt.key.startsWith('report:')) {
            act.arrivedAt = act.arrivedAt || now;
            if (now - act.arrivedAt > 2500) act.reportedDone = true;
          } else act.arrivedAt = 0;
        }
      }
      if (act.path.length) {
        const nxt = act.path[0];
        const dx = nxt.x - act.x;
        const dy = nxt.y - act.y;
        const dist = Math.hypot(dx, dy);
        const stepLen = SPEED * dt;
        act.walkT += dt;
        if (dist <= stepLen) {
          act.x = nxt.x;
          act.y = nxt.y;
          act.path.shift();
        } else {
          act.x += (dx / dist) * stepLen;
          act.y += (dy / dist) * stepLen;
        }
      } else if (act.leaving && !act.gone) act.gone = true;
    }
    for (const [id, act] of this.actors) if (act.gone) this.actors.delete(id);
  }

  // ---------- rendering ----------

  private frame = (t: number) => {
    const dt = Math.min(0.1, (t - this.last) / 1000);
    this.last = t;
    this.step(dt, t);
    this.render(t);
    this.raf = requestAnimationFrame(this.frame);
  };

  private ensureSize() {
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width * this.dpr));
    const h = Math.max(1, Math.round(r.height * this.dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    return r;
  }

  private occupant(i: number): AgentState | undefined {
    for (const a of this.agents.values()) if (a.desk === i && this.actors.has(a.id)) return a;
    return undefined;
  }

  private render(t: number) {
    const r = this.ensureSize();
    const ctx = this.ctx;
    const phase = dayPhase();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#0c0c14';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const z = this.zoom * this.dpr;
    ctx.setTransform(z, 0, 0, z, -this.camX * z, -this.camY * z);
    if (!this.staticLayer || this.staticPhase !== phase) {
      this.staticLayer = this.renderStatic(phase);
      this.staticPhase = phase;
    }
    ctx.drawImage(this.staticLayer, 0, 0);
    this.drawClock(ctx);

    const vx0 = this.camX - 32;
    const vy0 = this.camY - 48;
    const vx1 = this.camX + r.width / this.zoom + 32;
    const vy1 = this.camY + r.height / this.zoom + 48;

    // selection spotlight on the floor
    const selAct = this.selected ? this.actors.get(this.selected) : undefined;
    if (selAct) {
      const g = ctx.createRadialGradient(selAct.x * T + 8, selAct.y * T + 4, 2, selAct.x * T + 8, selAct.y * T + 4, 30);
      g.addColorStop(0, 'rgba(255,212,59,0.28)');
      g.addColorStop(1, 'rgba(255,212,59,0)');
      ctx.fillStyle = g;
      ctx.fillRect(selAct.x * T - 24, selAct.y * T - 28, 64, 64);
    }

    for (let i = 0; i < this.deskCount; i++) this.drawDesk(ctx, this.cellOrigin(i), this.occupant(i), t);

    if (this.showLinks) {
      ctx.lineWidth = 1;
      for (const act of this.actors.values()) {
        const a = this.agents.get(act.id);
        if (!a?.parentId) continue;
        const p = this.actors.get(a.parentId);
        if (!p) continue;
        const sel = this.selected === a.id || this.selected === a.parentId;
        if (!sel && a.status === 'done') continue;
        ctx.strokeStyle = sel ? 'rgba(255,212,59,0.9)' : 'rgba(255,255,255,0.18)';
        ctx.setLineDash([2, 2]);
        ctx.lineDashOffset = -t / 80;
        ctx.beginPath();
        ctx.moveTo(p.x * T + 8, p.y * T + 4);
        ctx.lineTo(act.x * T + 8, act.y * T + 4);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    const sorted = [...this.actors.values()].sort((a, b) => a.y - b.y);
    for (const act of sorted) {
      const px = act.x * T;
      const py = act.y * T;
      if (px < vx0 || px > vx1 || py < vy0 || py > vy1) continue;
      const a = this.agents.get(act.id);
      if (a) this.drawActor(ctx, act, a, t);
    }
    for (let i = 0; i < this.deskCount; i++) this.drawDeskFront(ctx, this.cellOrigin(i), this.occupant(i));

    // night lighting: darken the room, then add warm pools around lit desks
    if (phase !== 'day') this.drawLighting(ctx, phase);

    for (const act of sorted) {
      const a = this.agents.get(act.id);
      if (!a) continue;
      const px = act.x * T;
      const py = act.y * T;
      if (px < vx0 || px > vx1 || py < vy0 || py > vy1) continue;
      this.drawOverlay(ctx, act, a, t);
    }
  }

  private drawLighting(ctx: CanvasRenderingContext2D, phase: 'dusk' | 'night') {
    const L = this.layout;
    const W = L.w * T;
    const H = L.h * T;
    const shadow = (this.shadow ??= document.createElement('canvas'));
    if (shadow.width !== W || shadow.height !== H) {
      shadow.width = W;
      shadow.height = H;
    }
    const g = shadow.getContext('2d')!;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, W, H);
    g.fillStyle = phase === 'night' ? 'rgba(8,10,40,0.55)' : 'rgba(60,30,60,0.25)';
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'destination-out';
    const light = (x: number, y: number, rad: number, a: number) => {
      const rg = g.createRadialGradient(x, y, 2, x, y, rad);
      rg.addColorStop(0, `rgba(0,0,0,${a})`);
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = rg;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    };
    for (let i = 0; i < this.deskCount; i++) {
      if (!this.occupant(i)) continue;
      const o = this.cellOrigin(i);
      light((o.x + 2.5) * T, (o.y + 1.6) * T, 40, 0.9);
    }
    const lx = 2 + L.cols * CELL_W + 1;
    light((lx + 2) * T, (TOP + 1) * T, 36, 0.7);
    light((lx + 4.5) * T, (TOP + 8) * T, 50, 0.6);
    ctx.drawImage(shadow, 0, 0);
  }

  private renderStatic(phase: 'day' | 'dusk' | 'night'): HTMLCanvasElement {
    const L = this.layout;
    const c = document.createElement('canvas');
    c.width = L.w * T;
    c.height = L.h * T;
    const g = c.getContext('2d')!;
    for (let y = TOP; y < L.h - 1; y++)
      for (let x = 1; x < L.w - 1; x++) {
        const lounge = x > 2 + L.cols * CELL_W;
        g.fillStyle = lounge ? ((x + y) % 2 ? '#3a3350' : '#352f4a') : y % 2 ? '#5b4636' : '#56412f';
        g.fillRect(x * T, y * T, T, T);
        if (!lounge) {
          g.fillStyle = 'rgba(0,0,0,0.12)';
          g.fillRect(x * T + ((y * 7) % 16), y * T, 1, T);
          g.fillRect(x * T, y * T + T - 1, T, 1);
        }
      }
    const lx = 2 + L.cols * CELL_W + 1;
    g.fillStyle = '#4c3f73';
    g.fillRect((lx + 1) * T, (TOP + 6) * T, 7 * T, 4 * T);
    g.fillStyle = '#5f4f8c';
    g.fillRect((lx + 1) * T + 3, (TOP + 6) * T + 3, 7 * T - 6, 4 * T - 6);
    g.fillStyle = '#2a2438';
    g.fillRect((lx - 1) * T + 6, TOP * T, 4, (L.h - TOP - 1) * T);
    // walls
    g.fillStyle = '#2d2a3e';
    g.fillRect(0, 0, L.w * T, TOP * T);
    g.fillStyle = '#3b3752';
    g.fillRect(0, (TOP - 1) * T, L.w * T, T);
    g.fillStyle = '#24212f';
    g.fillRect(0, TOP * T - 2, L.w * T, 2);
    g.fillRect(0, 0, T, L.h * T);
    g.fillRect((L.w - 1) * T, 0, T, L.h * T);
    g.fillRect(0, (L.h - 1) * T, L.w * T, T);
    // door + mat
    g.fillStyle = '#7a5230';
    g.fillRect(L.door.x * T - 4, (L.h - 1) * T, T + 8, T);
    g.fillStyle = '#a87443';
    g.fillRect(L.door.x * T - 2, (L.h - 1) * T + 2, T + 4, T - 2);
    g.fillStyle = '#ffd43b';
    g.fillRect(L.door.x * T + T - 1, (L.h - 1) * T + 8, 2, 2);
    g.fillStyle = '#3b2f2a';
    g.fillRect(L.door.x * T - 6, (L.h - 2) * T + 6, T + 12, 8);
    // windows: sky follows the real time of day
    const sky: Record<string, [string, string]> = { day: ['#4dabf7', '#a5d8ff'], dusk: ['#f76707', '#ffc078'], night: ['#0b1340', '#25306b'] };
    for (let x = 2; x < L.w - 3; x += 5) {
      g.fillStyle = '#1b1b26';
      g.fillRect(x * T, T * 0.6, 3 * T, T * 1.9);
      const grd = g.createLinearGradient(0, T * 0.7, 0, T * 2.4);
      grd.addColorStop(0, sky[phase][0]);
      grd.addColorStop(1, sky[phase][1]);
      g.fillStyle = grd;
      g.fillRect(x * T + 2, T * 0.6 + 2, 3 * T - 4, T * 1.9 - 4);
      if (phase === 'night') {
        g.fillStyle = '#fff9db';
        for (let s = 0; s < 4; s++) g.fillRect(x * T + 5 + ((s * 13 + x * 7) % 38), T * 0.6 + 5 + ((s * 7 + x) % 20), 1, 1);
        if (x === 2) {
          g.fillStyle = '#fff3bf';
          g.fillRect(x * T + 34, T * 0.6 + 6, 6, 6);
        }
      } else {
        g.fillStyle = 'rgba(255,255,255,0.6)';
        g.fillRect(x * T + 6, T * 0.6 + 6, 6, 2);
      }
      g.fillStyle = '#1b1b26';
      g.fillRect(x * T + 1.5 * T - 1, T * 0.6, 2, T * 1.9);
    }
    // whiteboard
    const wb = { x: 3 * T, y: T * 2.6 };
    g.fillStyle = '#ced4da';
    g.fillRect(wb.x - 1, wb.y - 1, 4 * T + 2, T + 2);
    g.fillStyle = '#f8f9fa';
    g.fillRect(wb.x, wb.y, 4 * T, T);
    g.fillStyle = '#e03131';
    g.fillRect(wb.x + 4, wb.y + 4, 14, 1);
    g.fillStyle = '#1c7ed6';
    g.fillRect(wb.x + 4, wb.y + 8, 24, 1);
    g.fillRect(wb.x + 34, wb.y + 3, 8, 8);
    this.drawCoffee(g, lx + 1, TOP);
    this.drawWater(g, lx + 3, TOP);
    this.drawBookshelf(g, lx + 6, TOP);
    this.drawCouch(g, lx + 1, TOP + 3);
    this.drawMeetingTable(g, lx + 3, TOP + 7);
    this.drawPlant(g, lx + 8, L.h - 2);
    this.drawPlant(g, 1, L.h - 2);
    for (let i = 0; i < this.deskCount; i++) {
      const o = this.cellOrigin(i);
      const sx = (o.x + 2) * T;
      const sy = (o.y + 1) * T;
      g.fillStyle = '#212529';
      g.fillRect(sx + 1, sy - 6, 14, 12);
      g.fillStyle = '#343a40';
      g.fillRect(sx + 2, sy - 5, 12, 10);
    }
    g.fillStyle = '#ffd43b';
    g.font = 'bold 8px monospace';
    g.fillText('AI AGENT OFFICE', lx * T + 6, T * 3.65);
    return c;
  }

  private drawCoffee(g: CanvasRenderingContext2D, x: number, y: number) {
    g.fillStyle = '#495057';
    g.fillRect(x * T + 2, y * T - 10, 12, 24);
    g.fillStyle = '#212529';
    g.fillRect(x * T + 4, y * T - 6, 8, 6);
    g.fillStyle = '#fa5252';
    g.fillRect(x * T + 10, y * T - 8, 2, 2);
    g.fillStyle = '#f8f9fa';
    g.fillRect(x * T + 6, y * T + 6, 4, 4);
  }
  private drawWater(g: CanvasRenderingContext2D, x: number, y: number) {
    g.fillStyle = '#dee2e6';
    g.fillRect(x * T + 3, y * T, 10, 14);
    g.fillStyle = '#74c0fc';
    g.fillRect(x * T + 4, y * T - 12, 8, 12);
    g.fillStyle = '#a5d8ff';
    g.fillRect(x * T + 5, y * T - 11, 2, 8);
  }
  private drawBookshelf(g: CanvasRenderingContext2D, x: number, y: number) {
    g.fillStyle = '#6b4226';
    g.fillRect(x * T, y * T - 16, 3 * T, T + 16);
    const colors = ['#e03131', '#1c7ed6', '#2f9e44', '#f08c00', '#7048e8', '#0ca678'];
    for (let shelf = 0; shelf < 3; shelf++) {
      g.fillStyle = '#4a2c17';
      g.fillRect(x * T + 2, y * T - 14 + shelf * 10, 3 * T - 4, 8);
      for (let b = 0; b < 9; b++) {
        g.fillStyle = colors[(b + shelf * 2) % colors.length];
        g.fillRect(x * T + 3 + b * 5, y * T - 13 + shelf * 10 + (b % 3 === 0 ? 1 : 0), 4, 7 - (b % 3 === 0 ? 1 : 0));
      }
    }
  }
  private drawCouch(g: CanvasRenderingContext2D, x: number, y: number) {
    g.fillStyle = '#862e9c';
    g.fillRect(x * T + 8, (y + 1) * T - 4, 5 * T, T + 4);
    g.fillStyle = '#9c36b5';
    g.fillRect(x * T + 10, (y + 1) * T - 2, 5 * T - 4, 8);
    g.fillStyle = '#5f1f6e';
    g.fillRect(x * T + 4, (y + 1) * T - 6, 6, T + 6);
    g.fillRect((x + 5) * T + 6, (y + 1) * T - 6, 6, T + 6);
  }
  private drawMeetingTable(g: CanvasRenderingContext2D, x: number, y: number) {
    g.fillStyle = '#3d2a1c';
    g.fillRect(x * T, y * T + 4, 3 * T, 2 * T - 2);
    g.fillStyle = '#8c5a35';
    g.fillRect(x * T, y * T, 3 * T, 2 * T - 4);
    g.fillStyle = '#f8f9fa';
    g.fillRect(x * T + 8, y * T + 6, 8, 6);
    g.fillRect(x * T + 26, y * T + 10, 6, 8);
  }
  private drawPlant(g: CanvasRenderingContext2D, x: number, y: number) {
    g.fillStyle = '#c2703d';
    g.fillRect(x * T + 4, y * T + 8, 8, 8);
    g.fillStyle = '#2b8a3e';
    g.fillRect(x * T + 2, y * T - 2, 12, 10);
    g.fillStyle = '#40c057';
    g.fillRect(x * T + 4, y * T - 6, 4, 8);
    g.fillRect(x * T + 9, y * T - 4, 4, 6);
  }

  /** Wall clock showing the real local time (placed between windows). */
  private drawClock(ctx: CanvasRenderingContext2D) {
    // first gap between windows (windows span tiles 2-5, 7-10, ...)
    const cx = 6 * T;
    const cy = T * 1.55;
    ctx.fillStyle = '#f8f9fa';
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1b1b26';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    const d = new Date();
    const h = ((d.getHours() % 12) + d.getMinutes() / 60) * (Math.PI / 6);
    const m = d.getMinutes() * (Math.PI / 30);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.sin(h) * 3, cy - Math.cos(h) * 3);
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.sin(m) * 5, cy - Math.cos(m) * 5);
    ctx.stroke();
  }

  private drawDesk(ctx: CanvasRenderingContext2D, o: Pt, a: AgentState | undefined, t: number) {
    const x = (o.x + 1) * T;
    const y = (o.y + 2) * T;
    ctx.fillStyle = '#a0703f';
    ctx.fillRect(x, y - 4, 3 * T, 8);
    ctx.fillStyle = '#c08a52';
    ctx.fillRect(x, y - 4, 3 * T, 2);
    const mx = x + T + 1;
    const my = y - 14;
    ctx.fillStyle = '#212529';
    ctx.fillRect(mx, my, 14, 10);
    ctx.fillRect(mx + 6, my + 10, 2, 3);
    let glow = '#2b2f36';
    if (a) {
      const map: Record<string, string> = { coding: '#4dabf7', reading: '#9775fa', testing: '#69db7c', command: '#ced4da', searching: '#3bc9db', browsing: '#66d9e8', thinking: '#748ffc', delegating: '#ffa94d', error: '#ff6b6b', waiting: '#ffd43b', idle: '#495057', done: '#69db7c' };
      glow = map[a.activity] ?? '#495057';
      if (a.status === 'lost') glow = t % 600 < 300 ? '#fa5252' : '#212529';
      if (a.status === 'done') glow = '#3d4a3f';
    }
    ctx.fillStyle = glow;
    ctx.fillRect(mx + 1, my + 1, 12, 8);
    if (a && a.status === 'working' && (a.activity === 'coding' || a.activity === 'command' || a.activity === 'testing')) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      const phase = Math.floor(t / 200) % 4;
      for (let l = 0; l < 3; l++) ctx.fillRect(mx + 2, my + 2 + l * 2, 3 + ((l + phase) % 4) * 2, 1);
    }
    ctx.fillStyle = '#dee2e6';
    ctx.fillRect(x + T + 2, y - 3, 12, 2);
    if (a) {
      ctx.fillStyle = a.color;
      ctx.fillRect(x + 3, y - 6, 4, 4);
      ctx.fillStyle = '#f8f9fa';
      ctx.fillRect(x + 2 * T + 6, y - 6, 6, 4);
    }
  }

  private drawDeskFront(ctx: CanvasRenderingContext2D, o: Pt, a: AgentState | undefined) {
    const x = (o.x + 1) * T;
    const y = (o.y + 2) * T;
    ctx.fillStyle = '#7d5530';
    ctx.fillRect(x, y + 4, 3 * T, 10);
    ctx.fillStyle = '#5c3d22';
    ctx.fillRect(x + 2, y + 14, 3, 2);
    ctx.fillRect(x + 3 * T - 5, y + 14, 3, 2);
    if (a) {
      ctx.fillStyle = a.color;
      ctx.fillRect(x + T, y + 7, T, 4);
    }
  }

  private poseFor(act: Actor, a: AgentState, t: number): Pose {
    if (act.path.length) return Math.floor(act.walkT * 8) % 2 ? 'walk1' : 'walk2';
    if (!act.seated) return 'stand';
    if (a.status === 'lost') return 'sit-slump';
    if (a.status === 'waiting' || act.celebrateUntil > t) return 'sit-up';
    const typing = ['coding', 'command', 'testing', 'searching', 'browsing'].includes(a.activity);
    if (typing && a.status === 'working') return Math.floor(t / 160) % 2 ? 'sit-type1' : 'sit-type2';
    return 'sit-rest';
  }

  private drawActor(ctx: CanvasRenderingContext2D, act: Actor, a: AgentState, t: number) {
    const pose = this.poseFor(act, a, t);
    const spr = characterSprite(a.avatarSeed, a.color, pose, a.status === 'lost' ? 'grey' : undefined);
    let bob = 0;
    if (act.celebrateUntil > t && !act.path.length) bob = -Math.abs(Math.sin(t / 120)) * 4;
    else if (a.activity === 'thinking' && act.seated && a.status === 'working') bob = Math.sin(t / 400) > 0.6 ? -1 : 0;
    const px = Math.round(act.x * T + 2);
    const py = Math.round(act.y * T - (act.seated ? 6 : 10) + bob);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(act.x * T + 8, act.y * T + (act.seated ? 6 : 8), 7, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();
    if (!act.seated) {
      ctx.strokeStyle = STATUS_COLORS[a.status] ?? '#868e96';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    if (this.hovered === a.id && this.selected !== a.id) {
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1;
      ctx.strokeRect(px - 2, py - 2, 16, (act.seated ? 14 : 18) + 4);
    }
    if (act.seated) ctx.drawImage(spr, 0, 0, 12, 14, px, py, 12, 14);
    else ctx.drawImage(spr, px, py);
    if (a.activity === 'reading' && act.seated && a.status === 'working') {
      ctx.fillStyle = '#f8f9fa';
      ctx.fillRect(px + 3, py + 10, 6, 4);
      ctx.fillStyle = '#adb5bd';
      ctx.fillRect(px + 4, py + 11, 4, 1);
    }
    if (a.kind === 'subagent') {
      ctx.fillStyle = '#ffd43b';
      ctx.fillRect(px + 10, py + 9, 3, 3);
    }
  }

  private drawOverlay(ctx: CanvasRenderingContext2D, act: Actor, a: AgentState, t: number) {
    const cx = act.x * T + 8;
    const top = act.y * T - (act.seated ? 6 : 10);
    let icon: string | null = null;
    if (a.status === 'lost') icon = 'lost';
    else if (a.status === 'error' || a.activity === 'error') icon = 'error';
    else if (a.status === 'waiting') icon = 'waiting';
    else if (act.celebrateUntil > t || (a.status === 'done' && t - act.statusSince < 8000)) icon = 'done';
    else if (act.goal.startsWith('brief:') || act.goal.startsWith('report:')) icon = 'talk';
    else if (a.status === 'working') icon = a.activity;
    else if (a.status === 'idle' && !act.seated && act.goal.startsWith('lounge')) icon = 'idle';
    if (icon) {
      const blink = (icon === 'error' || icon === 'lost' || icon === 'waiting') && Math.floor(t / 400) % 2 === 0;
      const bx = Math.round(cx - 5);
      const by = Math.round(top - 13 + (icon === 'thinking' ? Math.sin(t / 300) : 0));
      ctx.fillStyle = blink ? '#ffe3e3' : '#f8f9fa';
      ctx.fillRect(bx, by, 11, 10);
      ctx.fillRect(bx + 1, by - 1, 9, 12);
      ctx.fillRect(bx + 3, by + 11, 2, 2);
      if (icon === 'thinking') {
        const n = Math.floor(t / 350) % 4;
        ctx.fillStyle = '#5c5f66';
        for (let i = 0; i < n; i++) ctx.fillRect(bx + 2 + i * 3, by + 5, 2, 2);
      } else drawIcon(ctx, icon, bx + 2, by + 1);
    }
    // labels & speech bubbles in screen space (crisp text)
    const z = this.zoom * this.dpr;
    const sx = (cx - this.camX) * z;
    const sy = (act.y * T + (act.seated ? 6 : 9) - this.camY) * z;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const fs = Math.max(10, Math.min(12, 2.8 * this.zoom)) * this.dpr;
    const sel = this.selected === a.id;
    if (this.zoom >= 1.8 || sel) {
      ctx.font = `600 ${fs}px "Segoe UI", system-ui, sans-serif`;
      const name = a.name.length > 20 ? a.name.slice(0, 19) + '…' : a.name;
      const tw = ctx.measureText(name).width;
      const pad = 5 * this.dpr;
      const bw = tw + pad * 2 + 6 * this.dpr;
      const bh = fs + 6 * this.dpr;
      const bx = sx - bw / 2;
      const by = sy + 3 * this.dpr;
      ctx.fillStyle = sel ? 'rgba(255,212,59,0.95)' : 'rgba(12,12,20,0.82)';
      roundRect(ctx, bx, by, bw, bh, 4 * this.dpr);
      ctx.fill();
      ctx.fillStyle = STATUS_COLORS[a.status] ?? '#ced4da';
      ctx.beginPath();
      ctx.arc(bx + pad + 2 * this.dpr, by + bh / 2, 2.5 * this.dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = sel ? '#1b1b26' : '#f1f3f5';
      ctx.fillText(name, bx + pad + 7 * this.dpr, by + bh / 2 + fs * 0.36);
      if (a.demo) {
        ctx.fillStyle = '#ff922b';
        ctx.font = `800 ${fs * 0.8}px "Segoe UI", sans-serif`;
        ctx.fillText('DÉMO', bx + bw + 4 * this.dpr, by + bh / 2 + fs * 0.3);
      }
    }
    const fresh = t - act.actionShownAt < 4000 && act.actionShownAt > 0;
    if (this.showBubbles && a.lastAction.value && (fresh || sel) && a.status !== 'done' && this.zoom >= 1.5) {
      ctx.font = `${fs * 0.92}px "Cascadia Mono", Consolas, monospace`;
      // Never wider than a desk cell, so bubbles of neighbours do not overlap.
      const maxW = CELL_W * T * z * 0.94 - 14 * this.dpr;
      let txt = a.lastAction.value.length > 60 ? a.lastAction.value.slice(0, 60) : a.lastAction.value;
      if (ctx.measureText(txt).width > maxW) {
        while (txt.length > 4 && ctx.measureText(txt + '…').width > maxW) txt = txt.slice(0, -1);
        txt += '…';
      }
      const w = ctx.measureText(txt).width + 14 * this.dpr;
      const h = fs + 10 * this.dpr;
      const by = (top - 16 - this.camY) * z - h - 6 * this.dpr;
      const bx = sx - w / 2;
      ctx.fillStyle = 'rgba(248,249,250,0.96)';
      roundRect(ctx, bx, by, w, h, 5 * this.dpr);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(sx - 4 * this.dpr, by + h);
      ctx.lineTo(sx, by + h + 5 * this.dpr);
      ctx.lineTo(sx + 4 * this.dpr, by + h);
      ctx.fill();
      ctx.fillStyle = '#1b1b26';
      ctx.fillText(txt, bx + 7 * this.dpr, by + h / 2 + fs * 0.33);
    }
    ctx.restore();
  }

  // ---------- input ----------

  private pick(clientX: number, clientY: number): string | null {
    const r = this.canvas.getBoundingClientRect();
    const wx = this.camX + (clientX - r.left) / this.zoom;
    const wy = this.camY + (clientY - r.top) / this.zoom;
    let best: string | null = null;
    let bestY = -Infinity;
    for (const act of this.actors.values()) {
      const x0 = act.x * T;
      const y0 = act.y * T - (act.seated ? 8 : 12);
      if (wx >= x0 && wx <= x0 + T && wy >= y0 && wy <= y0 + 22 && act.y > bestY) {
        best = act.id;
        bestY = act.y;
      }
    }
    if (!best) {
      for (const a of this.agents.values()) {
        if (a.desk < 0 || !this.actors.has(a.id)) continue;
        const o = this.cellOrigin(a.desk);
        if (wx >= (o.x + 1) * T && wx <= (o.x + 4) * T && wy >= (o.y + 1) * T && wy <= (o.y + 3) * T) best = a.id;
      }
    }
    return best;
  }

  private onUp = (e: MouseEvent) => {
    if (this.drag && !this.drag.moved) this.cb.onSelect(this.pick(e.clientX, e.clientY));
    this.drag = null;
    this.canvas.style.cursor = this.hovered ? 'pointer' : 'grab';
  };

  private bindInput() {
    const c = this.canvas;
    c.onwheel = (e) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      this.zoomBy(e.deltaY < 0 ? 1.18 : 1 / 1.18, e.clientX - r.left, e.clientY - r.top);
    };
    c.onmousedown = (e) => {
      this.drag = { x: e.clientX, y: e.clientY, cx: this.tCamX, cy: this.tCamY, moved: false };
    };
    c.onmousemove = (e) => {
      if (this.drag) {
        const dx = e.clientX - this.drag.x;
        const dy = e.clientY - this.drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) this.drag.moved = true;
        if (this.drag.moved) {
          // dragging follows the mouse 1:1 (no easing lag)
          this.tCamX = this.camX = this.drag.cx - dx / this.zoom;
          this.tCamY = this.camY = this.drag.cy - dy / this.zoom;
          c.style.cursor = 'grabbing';
        }
        return;
      }
      const id = this.pick(e.clientX, e.clientY);
      if (id !== this.hovered) {
        this.hovered = id;
        c.style.cursor = id ? 'pointer' : 'grab';
      }
      this.cb.onHover(id, { x: e.clientX, y: e.clientY });
    };
    c.onmouseleave = () => {
      this.hovered = null;
      this.cb.onHover(null, { x: 0, y: 0 });
    };
    window.addEventListener('mouseup', this.onUp);
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
