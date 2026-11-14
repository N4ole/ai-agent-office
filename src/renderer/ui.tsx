// Shared UI pieces: provenance badges, formatting, avatars, modal & confirmation dialogs.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { AgentStatus, Provenance, Tagged } from '../shared/types';
import { STATUS_COLORS } from './office/engine';
import { characterSprite, iconCanvas } from './office/sprites';
import type { UIAgent } from './api';

export const STATUS_LABEL: Record<AgentStatus, string> = {
  working: 'Au travail',
  waiting: 'En attente',
  idle: 'Inactif',
  done: 'Terminé',
  error: 'Erreur',
  lost: 'Perdu',
  unknown: 'Inconnu',
};

const PROV: Record<Provenance, { label: string; cls: string; help: string }> = {
  observed: { label: 'observé', cls: 'prov-obs', help: 'Lu tel quel dans les fichiers de Claude Code ou le processus' },
  inferred: { label: 'déduit', cls: 'prov-inf', help: 'Conclusion de l’app à partir des données observées' },
  unavailable: { label: 'indispo.', cls: 'prov-na', help: 'Claude Code ne fournit pas cette information' },
};

export function Prov({ src, note }: { src: Provenance; note?: string }) {
  const p = PROV[src];
  return (
    <span className={`prov ${p.cls}`} title={note ? `${p.help}\n${note}` : p.help}>
      {p.label}
    </span>
  );
}

/** Displays a tagged value with its provenance; unavailable values show their reason on hover. */
export function TV<T>({ v, fmt }: { v: Tagged<T>; fmt?: (x: T) => ReactNode }) {
  if (v.value === null || v.source === 'unavailable')
    return (
      <span className="na" title={v.note}>
        indisponible
      </span>
    );
  return (
    <span title={v.note}>
      {fmt ? fmt(v.value) : String(v.value)} {v.source !== 'observed' && <Prov src={v.source} note={v.note} />}
    </span>
  );
}

export function StatusPill({ status, src, note }: { status: AgentStatus; src?: Provenance; note?: string }) {
  return (
    <span className="pill" style={{ '--c': STATUS_COLORS[status] } as CSSProperties} title={note}>
      <span className={`dot ${status === 'working' ? 'pulse' : ''}`} />
      {STATUS_LABEL[status]}
      {src === 'inferred' ? <Prov src={src} note={note} /> : null}
    </span>
  );
}

export function StatusDot({ status, size = 8 }: { status: AgentStatus; size?: number }) {
  return (
    <span
      className={`dot ${status === 'working' ? 'pulse' : ''}`}
      style={{ background: STATUS_COLORS[status], color: STATUS_COLORS[status], width: size, height: size }}
      title={STATUS_LABEL[status]}
    />
  );
}

/** Pixel avatar of an agent (same sprite as in the office). */
export function Avatar({ a, className, style }: { a: Pick<UIAgent, 'avatarSeed' | 'color' | 'status'>; className?: string; style?: CSSProperties }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, 12, 18);
    g.drawImage(characterSprite(a.avatarSeed, a.color, 'stand', a.status === 'lost' ? 'grey' : undefined), 0, 0);
  }, [a.avatarSeed, a.color, a.status]);
  return <canvas ref={ref} width={12} height={18} className={className} style={{ imageRendering: 'pixelated', ...style }} />;
}

/** Pixel activity icon (same glyphs as the office bubbles). */
export function ActivityIcon({ name, scale = 2 }: { name: string; scale?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.replaceChildren(iconCanvas(name, scale));
  }, [name, scale]);
  return <span ref={ref} style={{ display: 'inline-flex' }} />;
}

export const fmtTime = (t: number) => new Date(t).toLocaleTimeString('fr-FR');
export const fmtDateTime = (t: number) => new Date(t).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
export function fmtDur(ms: number) {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, '0')}`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${String(m % 60).padStart(2, '0')}`;
  return `${Math.floor(h / 24)} j ${h % 24} h`;
}
/** Compact relative time: "12 s", "4 min", "2 h", "3 j". */
export function ago(t: number, now = Date.now()) {
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  return `${Math.floor(s / 86400)} j`;
}
export const fmtNum = (n: number) => new Intl.NumberFormat('fr-FR', { notation: n > 99999 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(n);
export const fmtUSD = (n: number) => `${n.toFixed(n < 1 ? 3 : 2)} $`;

/** Re-renders every `ms` so relative times stay fresh. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function Modal({ title, children, onClose, wide }: { title: ReactNode; children: ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog">
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="btn ghost sm icon" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Switch({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="sw" />
      <span>{children}</span>
    </label>
  );
}

// ----- confirmation dialog (promise based) -----
type ConfirmReq = { title: string; body: string; ok: string; danger?: boolean; resolve: (v: boolean) => void };
let pushConfirm: ((r: ConfirmReq) => void) | null = null;

export function confirmAction(title: string, body: string, ok = 'Confirmer', danger = true): Promise<boolean> {
  return new Promise((resolve) => {
    if (!pushConfirm) return resolve(window.confirm(`${title}\n\n${body}`));
    pushConfirm({ title, body, ok, danger, resolve });
  });
}

export function ConfirmHost() {
  const [req, setReq] = useState<ConfirmReq | null>(null);
  useEffect(() => {
    pushConfirm = setReq;
    return () => {
      pushConfirm = null;
    };
  }, []);
  if (!req) return null;
  const done = (v: boolean) => {
    req.resolve(v);
    setReq(null);
  };
  return (
    <Modal title={req.title} onClose={() => done(false)}>
      <p style={{ whiteSpace: 'pre-wrap', margin: 0 }} className="muted">
        {req.body}
      </p>
      <div className="modal-foot">
        <button className="btn" onClick={() => done(false)}>
          Annuler
        </button>
        <button className={`btn ${req.danger ? 'danger' : 'primary'}`} autoFocus onClick={() => done(true)}>
          {req.ok}
        </button>
      </div>
    </Modal>
  );
}

/** Draggable splitter that resizes a neighbouring panel; width persisted per key. */
export function useResizable(key: string, initial: number, min: number, max: number, side: 'left' | 'right') {
  const [w, setW] = useState(() => {
    try {
      const v = Number(localStorage.getItem(`w:${key}`));
      return v >= min && v <= max ? v : initial;
    } catch {
      return initial;
    }
  });
  const onDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = w;
    const move = (ev: MouseEvent) => {
      const d = side === 'left' ? ev.clientX - x0 : x0 - ev.clientX;
      const nw = Math.min(max, Math.max(min, w0 + d));
      setW(nw);
      try {
        localStorage.setItem(`w:${key}`, String(nw));
      } catch {
        /* storage unavailable */
      }
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
    };
    document.body.style.cursor = 'col-resize';
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  return { width: w, handle: <div className="splitter" onMouseDown={onDown} title="Glisser pour redimensionner" /> };
}

export async function copyText(t: string) {
  try {
    await navigator.clipboard.writeText(t);
    return true;
  } catch {
    return false;
  }
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <b>{title}</b>
      {children}
    </div>
  );
}

/**
 * Estimated API-equivalent cost of a "chat": the agent itself plus all its sub-agents (recursively).
 * Each part comes from tokens × the public price of the model that produced them.
 */
export function chatCost(a: UIAgent, all: Iterable<UIAgent>): { own: number | null; subs: number; total: number | null; subCount: number } {
  const list = [...all];
  const kids = (id: string): UIAgent[] => list.filter((x) => x.parentId === id).flatMap((c) => [c, ...kids(c.id)]);
  const desc = kids(a.id);
  const own = a.estimatedCost?.value ?? null;
  const subs = desc.reduce((n, c) => n + (c.estimatedCost?.value ?? 0), 0);
  return { own, subs, total: own === null && !subs ? null : (own ?? 0) + subs, subCount: desc.length };
}
