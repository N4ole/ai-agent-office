// Agent list with quick status tabs, collapsible advanced filters and project groups.
import { useMemo, useState } from 'react';
import type { ActivityKind, AgentStatus } from '../../shared/types';
import type { UIAgent } from '../api';
import { select } from '../store';
import { ACTIVITY_LABEL } from '../../main/core/activity';
import { priorityOf } from '../views/Dashboard';
import { officeCamera } from '../views/OfficeView';
import { Avatar, Empty, STATUS_LABEL, StatusDot, ago, useNow } from '../ui';

export interface Filters {
  text: string;
  tab: 'all' | 'active' | 'attention' | 'ended';
  project: string;
  session: string;
  kind: '' | 'session' | 'subagent';
  activity: '' | ActivityKind;
  priority: '' | 'haute' | 'normale' | 'basse';
  history: boolean;
}

export const DEFAULT_FILTERS: Filters = { text: '', tab: 'all', project: '', session: '', kind: '', activity: '', priority: '', history: false };
const RECENT_MS = 24 * 3600_000;

const TAB_STATUSES: Record<Filters['tab'], AgentStatus[] | null> = {
  all: null,
  active: ['working', 'waiting', 'idle'],
  attention: ['waiting', 'error', 'lost'],
  ended: ['done', 'lost'],
};

/** Applies every filter except the status tab (used to compute tab counts). */
export function baseFilter(all: UIAgent[], f: Filters, now = Date.now()) {
  const t = f.text.toLowerCase();
  return all.filter(
    (a) =>
      (f.history || (a.status !== 'done' && a.status !== 'lost') || now - a.lastEventAt < RECENT_MS) &&
      (!t || `${a.name} ${a.role} ${a.project} ${a.currentTask.value ?? ''} ${a.sessionId}`.toLowerCase().includes(t)) &&
      (!f.project || a.project === f.project) &&
      (!f.session || a.sessionId === f.session) &&
      (!f.kind || a.kind === f.kind) &&
      (!f.activity || (a.status === 'working' && a.activity === f.activity)) &&
      (!f.priority || priorityOf(a) === f.priority),
  );
}

export function applyFilters(all: UIAgent[], f: Filters) {
  const st = TAB_STATUSES[f.tab];
  return baseFilter(all, f).filter((a) => !st || st.includes(a.status));
}

export function Sidebar({
  all,
  filters: f,
  setFilters: setF,
  selected,
  width,
}: {
  all: UIAgent[];
  filters: Filters;
  setFilters: (f: Filters) => void;
  selected: string | null;
  width: number;
}) {
  const [showFilters, setShowFilters] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const now = useNow(5000);
  const base = useMemo(() => baseFilter(all, f, now), [all, f, now]);
  const list = useMemo(() => applyFilters(all, f), [all, f]);
  const projects = useMemo(() => [...new Set(all.map((a) => a.project))].sort(), [all]);
  const sessions = useMemo(
    () =>
      all
        .filter((a) => a.kind === 'session')
        .sort((a, b) => b.lastEventAt - a.lastEventAt)
        .slice(0, 80),
    [all],
  );
  const n = (tab: Filters['tab']) => base.filter((a) => !TAB_STATUSES[tab] || TAB_STATUSES[tab]!.includes(a.status)).length;
  const advanced = [f.project, f.session, f.kind, f.activity, f.priority].filter(Boolean).length + (f.history ? 1 : 0);

  const groups = useMemo(() => {
    const m = new Map<string, UIAgent[]>();
    const rank = (a: UIAgent) => (a.status === 'working' || a.status === 'waiting' || a.status === 'error' ? 0 : a.status === 'idle' ? 1 : 2);
    for (const a of list) {
      if (!m.has(a.project)) m.set(a.project, []);
      m.get(a.project)!.push(a);
    }
    return [...m.entries()]
      .map(([project, items]) => {
        const ids = new Set(items.map((a) => a.id));
        const roots = items.filter((a) => !a.parentId || !ids.has(a.parentId)).sort((a, b) => rank(a) - rank(b) || b.lastEventAt - a.lastEventAt);
        const rows: { a: UIAgent; depth: number; kids: number }[] = [];
        const walk = (a: UIAgent, d: number) => {
          const kids = items.filter((c) => c.parentId === a.id).sort((x, y) => y.startedAt - x.startedAt);
          rows.push({ a, depth: d, kids: kids.length });
          kids.forEach((c) => walk(c, d + 1));
        };
        roots.forEach((r) => walk(r, 0));
        return { project, rows, best: Math.min(...items.map(rank)), last: Math.max(...items.map((a) => a.lastEventAt)) };
      })
      .sort((a, b) => a.best - b.best || b.last - a.last);
  }, [list]);

  return (
    <aside className="side" style={{ width }}>
      <div className="side-head">
        <div className="row" style={{ gap: 6 }}>
          <div className="search grow">
            <input placeholder="Rechercher un agent…" value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} />
          </div>
          <button className={`btn sm ${advanced ? 'primary' : ''}`} style={{ height: 30 }} onClick={() => setShowFilters(!showFilters)} title="Filtres avancés">
            ⚲ {advanced ? advanced : ''}
          </button>
        </div>
        <div className="seg">
          {(
            [
              ['all', 'Tous'],
              ['active', 'Actifs'],
              ['attention', 'À voir'],
              ['ended', 'Finis'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} className={f.tab === id ? 'on' : ''} onClick={() => setF({ ...f, tab: id })}>
              <b style={id === 'attention' && n('attention') ? { color: 'var(--warn)' } : undefined}>{n(id)}</b>
              {label}
            </button>
          ))}
        </div>
        {showFilters && (
          <div className="filters">
            <select value={f.project} onChange={(e) => setF({ ...f, project: e.target.value })} title="Projet">
              <option value="">Tous les projets</option>
              {projects.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
            <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as Filters['kind'] })}>
              <option value="">Sessions et sous-agents</option>
              <option value="session">Sessions</option>
              <option value="subagent">Sous-agents</option>
            </select>
            <select className="full" value={f.session} onChange={(e) => setF({ ...f, session: e.target.value })}>
              <option value="">Toutes les sessions</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.sessionId}>
                  {s.name}
                </option>
              ))}
            </select>
            <select value={f.activity} onChange={(e) => setF({ ...f, activity: e.target.value as Filters['activity'] })}>
              <option value="">Toute activité</option>
              {Object.entries(ACTIVITY_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as Filters['priority'] })} title="Déduite du statut">
              <option value="">Toute priorité</option>
              <option value="haute">Priorité haute</option>
              <option value="normale">Priorité normale</option>
              <option value="basse">Priorité basse</option>
            </select>
            <label className="full row small muted" style={{ gap: 6 }}>
              <input type="checkbox" checked={f.history} onChange={(e) => setF({ ...f, history: e.target.checked })} /> Inclure les sessions finies depuis plus
              de 24 h
            </label>
            {advanced > 0 && (
              <button className="btn sm ghost full" onClick={() => setF({ ...DEFAULT_FILTERS, text: f.text, tab: f.tab })}>
                Réinitialiser les filtres
              </button>
            )}
          </div>
        )}
      </div>
      <div className="agent-list">
        {groups.map((g) => {
          const isCol = collapsed.has(g.project);
          return (
            <div key={g.project} className="group">
              <div
                className="group-title"
                onClick={() => {
                  const s = new Set(collapsed);
                  if (isCol) s.delete(g.project);
                  else s.add(g.project);
                  setCollapsed(s);
                }}
              >
                <span>{isCol ? '▸' : '▾'}</span> {g.project} <span className="count">{g.rows.length}</span>
              </div>
              {!isCol &&
                g.rows.slice(0, 150).map(({ a, depth, kids }) => (
                  <div
                    key={a.id}
                    className={`acard ${selected === a.id ? 'sel' : ''}`}
                    onClick={() => select(a.id)}
                    onDoubleClick={() => officeCamera.focus(a.id)}
                    title="Double-clic : centrer dans le bureau"
                  >
                    {depth > 0 && Array.from({ length: depth }, (_, i) => <span key={i} className="tree-indent" />)}
                    <div className="av">
                      <Avatar a={a} />
                      <StatusDot status={a.status} size={11} />
                    </div>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="row" style={{ gap: 6 }}>
                        <span className="nm ellipsis">{a.name}</span>
                        {kids > 0 && (
                          <span className="sub" title={`${kids} sous-agent(s)`}>
                            +{kids}
                          </span>
                        )}
                        {a.managed && (
                          <span className="sub" style={{ color: 'var(--acc)' }} title="Pilotée par l’app">
                            ●
                          </span>
                        )}
                        {a.demo && (
                          <span className="sub" style={{ color: '#ff922b' }}>
                            DÉMO
                          </span>
                        )}
                      </div>
                      <div className="meta ellipsis">
                        {a.status === 'working' ? <span className="act">{ACTIVITY_LABEL[a.activity]}</span> : <span>{STATUS_LABEL[a.status]}</span>}
                        <span className="faint ellipsis">· {a.status === 'working' && a.lastAction.value ? a.lastAction.value : a.role}</span>
                      </div>
                    </div>
                    <span className="ago">{ago(a.lastEventAt, now)}</span>
                  </div>
                ))}
            </div>
          );
        })}
        {!groups.length && (
          <Empty title="Aucun agent">
            {f.tab !== 'all' || advanced || f.text ? (
              <a onClick={() => setF(DEFAULT_FILTERS)}>Effacer les filtres</a>
            ) : (
              'Lancez Claude Code : vos sessions apparaîtront ici.'
            )}
          </Empty>
        )}
      </div>
    </aside>
  );
}
