// Remaining subscription quota: 5-hour session window and weekly window(s).
// Values come from Claude Code itself (`/usage`, or rate_limit_event of app-controlled sessions).
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { QuotaState, QuotaWindow } from '../../shared/types';
import { api } from '../api';
import { useStore } from '../store';
import { ago, fmtDur, useNow } from '../ui';

export function quotaColor(usedPct: number) {
  return usedPct >= 95 ? 'var(--err)' : usedPct >= 80 ? 'var(--warn)' : 'var(--ok)';
}

const SHORT: Record<string, string> = { five_hour: '5 h', seven_day: '7 j' };

function resetIn(w: QuotaWindow, now: number) {
  if (!w.resetsAt) return w.resetsText ?? 'inconnue';
  const ms = w.resetsAt - now;
  if (ms <= 0) return 'imminente';
  return `dans ${fmtDur(ms).replace(/ \d+ s$/, '')}`;
}

function resetAt(w: QuotaWindow) {
  if (!w.resetsAt) return w.resetsText ?? '';
  return new Date(w.resetsAt).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** One window: remaining % in big, a bar of what is used, and the reset time. */
export function QuotaBar({ w, now, compact }: { w: QuotaWindow; now: number; compact?: boolean }) {
  const left = Math.max(0, Math.round(100 - w.usedPct));
  return (
    <div className="qbar" title={`${w.label} : ${Math.round(w.usedPct)} % utilisé · réinitialisation ${resetAt(w)}`}>
      <div className="row between" style={{ gap: 6 }}>
        <span className={compact ? 'tiny muted' : 'small'}>{w.label}</span>
        <span className="mono" style={{ color: quotaColor(w.usedPct), fontWeight: 700, fontSize: compact ? 12 : 15 }}>{left} % restant</span>
      </div>
      <div className="qtrack"><div style={{ width: `${Math.min(100, w.usedPct)}%`, background: quotaColor(w.usedPct) }} /></div>
      <div className="faint tiny">Réinitialisation {resetIn(w, now)}{w.resetsAt ? ` · ${resetAt(w)}` : ''}</div>
    </div>
  );
}

function sourceText(q: QuotaState) {
  return q.source === 'rate-limit-event' ? 'en direct, session pilotée par l’app' : 'commande /usage de Claude Code (gratuite)';
}

export function QuotaDetails({ q, now, onRefresh, busy }: { q: QuotaState | null; now: number; onRefresh: () => void; busy: boolean }) {
  return (
    <div className="col" style={{ gap: 12 }}>
      {!q && <div className="faint small">Lecture des quotas en cours…</div>}
      {q?.plan === 'api' && <div className="muted small">Claude Code est utilisé avec une clé API : pas de quota d’abonnement (facturation au token).</div>}
      {q?.windows.map((w) => <QuotaBar key={w.id} w={w} now={now} />)}
      {q?.overage && q.overage !== 'rejected' && <div className="small muted">Dépassement (overage) : {q.overage}</div>}
      {q?.error && <div className="small" style={{ color: 'var(--warn)' }}>⚠ {q.error}{q.windows.length ? ' · dernières valeurs connues affichées' : ''}</div>}
      <div className="row between">
        <span className="faint tiny">{q ? <>Source : {sourceText(q)} · mis à jour il y a {ago(q.fetchedAt, now)}</> : null}</span>
        <button className="btn sm" disabled={busy} onClick={onRefresh}>{busy ? 'Lecture…' : '↻ Actualiser'}</button>
      </div>
    </div>
  );
}

/** Compact top-bar widget with a popover for details. */
export function QuotaWidget() {
  const q = useStore((s) => s.quota);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pos, setPos] = useState({ top: 52, right: 12 });
  const now = useNow(30_000);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', h);
    return () => window.removeEventListener('mousedown', h);
  }, [open]);
  const refresh = async () => {
    setBusy(true);
    await api.refreshQuota();
    setBusy(false);
  };
  if (q && q.plan === 'api' && !q.windows.length) return null;
  const main = (q?.windows ?? []).filter((w) => w.id === 'five_hour' || w.id === 'seven_day');
  return (
    <div className="quota" ref={ref}>
      <button className="quota-chip" onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
        setOpen(!open);
      }} title="Quotas d’utilisation restants (abonnement Claude)">
        {main.length ? (
          main.map((w) => {
            const left = Math.max(0, Math.round(100 - w.usedPct));
            return (
              <span key={w.id} className="qmini">
                <span className="tiny muted">{SHORT[w.id]}</span>
                <span className="qring" style={{ '--p': `${Math.min(100, w.usedPct)}%`, '--c': quotaColor(w.usedPct) } as CSSProperties} />
                <b className="mono" style={{ color: quotaColor(w.usedPct) }}>{left}%</b>
              </span>
            );
          })
        ) : (
          <span className="tiny muted">{q?.error ? 'Quotas ⚠' : 'Quotas…'}</span>
        )}
      </button>
      {open && (
        <div className="pop" style={{ position: 'fixed', width: 340, maxWidth: 'calc(100vw - 16px)', right: pos.right, top: pos.top, padding: 14 }}>
          <div className="card-title" style={{ marginBottom: 12 }}>Quotas restants</div>
          <QuotaDetails q={q} now={now} onRefresh={refresh} busy={busy} />
        </div>
      )}
    </div>
  );
}
