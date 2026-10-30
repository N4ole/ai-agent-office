import { useEffect, useRef, useState } from 'react';
import { OfficeEngine, STATUS_COLORS, dayPhase } from '../office/engine';
import { select, useStore } from '../store';
import type { UIAgent } from '../api';
import { STATUS_LABEL, StatusDot, ago, useNow } from '../ui';
import { ACTIVITY_LABEL } from '../../main/core/activity';

let engineRef: OfficeEngine | null = null;
/** Lets keyboard shortcuts drive the camera. */
export const officeCamera = {
  zoomIn: () => engineRef?.zoomBy(1.25),
  zoomOut: () => engineRef?.zoomBy(0.8),
  reset: () => engineRef?.resetView(),
  focus: (id: string) => engineRef?.focus(id),
  toggleLinks: () => engineRef && (engineRef.showLinks = !engineRef.showLinks),
  toggleBubbles: () => engineRef && (engineRef.showBubbles = !engineRef.showBubbles),
};

const PHASE_LABEL = { day: '☀ Jour', dusk: '◐ Crépuscule', night: '☾ Nuit' };

export function OfficeView({ agents, onLaunch }: { agents: UIAgent[]; onLaunch: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<OfficeEngine | null>(null);
  const selected = useStore((s) => s.selected);
  const live = useStore((s) => s.live);
  const all = useStore((s) => s.agents);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const [links, setLinks] = useState(true);
  const [bubbles, setBubbles] = useState(true);
  const now = useNow(5000);

  useEffect(() => {
    if (!canvas.current) return;
    const e = new OfficeEngine(canvas.current, {
      onSelect: (id) => select(id),
      onHover: (id, p) => setHover(id ? { id, x: p.x, y: p.y } : null),
    });
    engine.current = e;
    engineRef = e;
    return () => {
      e.destroy();
      engineRef = null;
    };
  }, []);
  useEffect(() => engine.current?.setAgents(agents), [agents]);
  useEffect(() => {
    engine.current?.setSelected(selected);
    if (selected) engine.current?.focus(selected);
  }, [selected]);

  const present = agents.filter((a) => a.desk >= 0 && !((a.status === 'done' || a.status === 'lost') && now - (a.endedAt ?? a.lastEventAt) > 600_000));
  const count = (s: string[]) => present.filter((a) => s.includes(a.status)).length;
  const h = hover ? all.get(hover.id) : undefined;
  // Only what happened in the last 10 minutes (startup bookkeeping carries old dates).
  const events = live.filter((e) => e.kind !== 'tool_result' && now - e.ts < 600_000).slice(0, 8);

  return (
    <div className="office">
      <canvas ref={canvas} aria-label="Bureau virtuel des agents" />
      <div className="ticker">
        <span className="live"><span className="dot pulse" style={{ background: 'var(--err)', color: 'var(--err)' }} /> EN DIRECT</span>
        {!events.length && <span className="faint">En attente d’activité…</span>}
        {events.map((e) => {
          const a = all.get(e.agentId);
          return (
            <span key={e.id} className={`ev ${e.isError ? 'err' : ''}`} onClick={() => select(e.agentId)}>
              <b style={{ color: a?.color }}>{a?.name ?? '?'}</b> <span className="muted">{e.summary.slice(0, 70)}</span>
            </span>
          );
        })}
      </div>
      <div className="hud">
        <div className="h" style={{ borderColor: count(['working']) ? STATUS_COLORS.working + '66' : undefined }}><b style={{ color: STATUS_COLORS.working }}>{count(['working'])}</b><span>au travail</span></div>
        <div className="h"><b style={{ color: count(['waiting']) ? STATUS_COLORS.waiting : undefined }}>{count(['waiting'])}</b><span>en attente</span></div>
        <div className="h"><b>{count(['idle'])}</b><span>en pause</span></div>
        <div className="h" style={{ borderColor: count(['error', 'lost']) ? STATUS_COLORS.error + '88' : undefined }}><b style={{ color: count(['error', 'lost']) ? STATUS_COLORS.error : undefined }}>{count(['error', 'lost'])}</b><span>en erreur</span></div>
        <div className="h"><b style={{ fontSize: 13, marginTop: 3 }}>{PHASE_LABEL[dayPhase()]}</b><span>{new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span></div>
      </div>
      <div className="tools">
        <button className="btn sm icon" title="Zoom avant (+)" onClick={officeCamera.zoomIn}>＋</button>
        <button className="btn sm icon" title="Zoom arrière (−)" onClick={officeCamera.zoomOut}>－</button>
        <button className="btn sm icon" title="Vue d’ensemble (0)" onClick={officeCamera.reset}>⤢</button>
        <hr />
        <button className={`btn sm icon ${links ? 'on' : ''}`} title="Liens parent ↔ sous-agent (L)" onClick={() => { officeCamera.toggleLinks(); setLinks(!links); }}>⛓</button>
        <button className={`btn sm icon ${bubbles ? 'on' : ''}`} title="Bulles d’action (B)" onClick={() => { officeCamera.toggleBubbles(); setBubbles(!bubbles); }}>💬</button>
      </div>
      <div className="legend">
        {(['working', 'waiting', 'idle', 'error', 'done'] as const).map((s) => (
          <span key={s} className="row"><StatusDot status={s} /> {STATUS_LABEL[s]}</span>
        ))}
        <span className="faint">· Déplacements simulés, états et actions réels · Glisser pour déplacer, molette pour zoomer</span>
      </div>
      {!present.length && (
        <div className="office-empty">
          <div>
            <div className="pixel" style={{ color: 'var(--acc)', fontSize: 14, marginBottom: 8 }}>Le bureau est vide</div>
            <p className="muted" style={{ marginTop: 0 }}>
              Aucune session Claude Code active. Lancez <span className="mono">claude</span> dans un terminal : l’agent arrivera ici
              tout seul. Ou démarrez une session pilotée depuis l’app.
            </p>
            <button className="btn primary" onClick={onLaunch}>+ Nouvelle session</button>
          </div>
        </div>
      )}
      {h && hover && (
        <div className="tooltip" style={{ left: hover.x + 16, top: hover.y + 16 }}>
          <div className="row" style={{ gap: 6 }}><StatusDot status={h.status} /> <b>{h.name}</b></div>
          <div className="faint tiny">{h.role} · {h.project}</div>
          <div style={{ marginTop: 4 }}>{STATUS_LABEL[h.status]}{h.status === 'working' ? ` · ${ACTIVITY_LABEL[h.activity]}` : ''} <span className="faint">· il y a {ago(h.lastEventAt)}</span></div>
          {h.lastAction.value && <div className="mono tiny" style={{ marginTop: 3, color: '#a3a8c3' }}>{h.lastAction.value.slice(0, 120)}</div>}
          <div className="faint tiny" style={{ marginTop: 4 }}>Cliquer pour ouvrir la fiche</div>
        </div>
      )}
    </div>
  );
}
