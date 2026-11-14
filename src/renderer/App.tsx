import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AgentEvent, Health } from '../shared/types';
import { api, type UIAgent } from './api';
import { dismissToast, select, setView, store, useStore, type View } from './store';
import { OfficeView, officeCamera } from './views/OfficeView';
import { Dashboard } from './views/Dashboard';
import { HistoryView } from './views/HistoryView';
import { SettingsView } from './views/SettingsView';
import { EventLog } from './components/EventLog';
import { AgentPanel } from './components/AgentPanel';
import { LaunchDialog, SetupWizard } from './components/Dialogs';
import { QuotaWidget } from './components/QuotaWidget';
import { DEFAULT_FILTERS, Sidebar, applyFilters, type Filters } from './components/Sidebar';
import { Avatar, ConfirmHost, Modal, STATUS_LABEL, StatusDot, ago, fmtNum, useNow, useResizable } from './ui';
import { STATUS_COLORS } from './office/engine';

const VIEWS: { id: View; label: string; ico: string }[] = [
  { id: 'office', label: 'Bureau', ico: '▦' },
  { id: 'dashboard', label: 'Tableau de bord', ico: '◔' },
  { id: 'logs', label: 'Journaux', ico: '≡' },
  { id: 'history', label: 'Historique', ico: '⟲' },
  { id: 'settings', label: 'Paramètres', ico: '⚙' },
];

function loadFilters(): Filters {
  try {
    return { ...DEFAULT_FILTERS, ...JSON.parse(localStorage.getItem('filters') ?? '{}'), text: '' };
  } catch {
    return DEFAULT_FILTERS;
  }
}

export function App() {
  const ready = useStore((s) => s.ready);
  const agentsMap = useStore((s) => s.agents);
  const view = useStore((s) => s.view);
  const selected = useStore((s) => s.selected);
  const settings = useStore((s) => s.settings);
  const toasts = useStore((s) => s.toasts);
  const notifications = useStore((s) => s.notifications);
  const live = useStore((s) => s.live);
  const [f, setF] = useState<Filters>(loadFilters);
  const [launch, setLaunch] = useState(false);
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [wizard, setWizard] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  // Agent list: hidden by default on narrow windows, toggled with the ☰ button or Ctrl+B.
  const [sideOpen, setSideOpen] = useState(() => window.innerWidth >= 1100);
  const [narrow, setNarrow] = useState(() => window.innerWidth < 1280);
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 1280);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const left = useResizable('side', 290, 220, 480, 'left');
  const right = useResizable('panel', 440, 340, 760, 'right');
  const now = useNow(5000);

  useEffect(() => {
    try {
      localStorage.setItem('filters', JSON.stringify({ ...f, text: '' }));
    } catch {
      /* ignore */
    }
  }, [f]);
  useEffect(() => {
    if (settings && !settings.setupDone) setWizard(true);
  }, [settings?.setupDone]);
  useEffect(() => {
    const load = () =>
      api
        .health()
        .then(setHealth)
        .catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  const all = useMemo(() => [...agentsMap.values()], [agentsMap]);
  const filtered = useMemo(() => applyFilters(all, f), [all, f]);
  const counts = useMemo(
    () => ({
      working: all.filter((a) => a.status === 'working').length,
      attention: all.filter((a) => (a.status === 'waiting' || a.status === 'error' || a.status === 'lost') && now - a.lastEventAt < 86_400_000).length,
    }),
    [all, now],
  );
  const unread = notifications.filter((n) => !n.read).length;

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const typing = /input|textarea|select/i.test((e.target as HTMLElement)?.tagName ?? '');
      if (e.ctrlKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette(true);
        return;
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setLaunch(true);
        return;
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setSideOpen((v) => !v);
        return;
      }
      if (typing || e.ctrlKey || e.altKey) return;
      const v = VIEWS[Number(e.key) - 1];
      if (v) setView(v.id);
      else if (e.key === 'Escape') {
        setNotifOpen(false);
        select(null);
      } else if (e.key === '+' || e.key === '=') officeCamera.zoomIn();
      else if (e.key === '-') officeCamera.zoomOut();
      else if (e.key === '0') officeCamera.reset();
      else if (e.key.toLowerCase() === 'f' && store.get().selected) officeCamera.focus(store.get().selected!);
      else if (e.key.toLowerCase() === 'l') officeCamera.toggleLinks();
      else if (e.key.toLowerCase() === 'b') officeCamera.toggleBubbles();
      else if (e.key === '?') setHelp(true);
      else if (e.key === 'j' || e.key === 'k') {
        const i = filtered.findIndex((a) => a.id === store.get().selected);
        const nx = filtered[(i + (e.key === 'j' ? 1 : -1) + filtered.length) % Math.max(1, filtered.length)];
        if (nx) select(nx.id);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [filtered]);

  if (!ready || !settings)
    return (
      <div style={{ padding: 30 }} className="pixel">
        Chargement du bureau…
      </div>
    );
  const sel = selected ? agentsMap.get(selected) : undefined;
  const lastEvent = live.reduce<AgentEvent | undefined>((m, e) => (!m || e.ts > m.ts ? e : m), undefined);

  return (
    <div className="app">
      <header className="top">
        <button className="btn ghost icon" title="Afficher / masquer la liste des agents (Ctrl+B)" onClick={() => setSideOpen(!sideOpen)}>
          ☰
        </button>
        <div className="brand">
          <img src="./icon.png" alt="" />
          <div>
            <b>AI AGENT OFFICE</b>
            <span>Supervision Claude Code</span>
          </div>
        </div>
        <nav className="nav">
          {VIEWS.map((v, i) => (
            <button key={v.id} className={view === v.id ? 'on' : ''} onClick={() => setView(v.id)} title={`${v.label} (${i + 1})`}>
              <span className="ico">{v.ico}</span>
              <span className="lbl">{v.label}</span>
            </button>
          ))}
        </nav>
        <div className="grow" />
        {settings.demoMode && (
          <span className="badge-demo" title="Des agents fictifs sont affichés">
            MODE DÉMO
          </span>
        )}
        <QuotaWidget />
        <div className="top-stats">
          <span className="stat-chip" title="Agents au travail" onClick={() => setF({ ...f, tab: 'active' })}>
            <StatusDot status="working" /> <b>{counts.working}</b> <span className="lbl">au travail</span>
          </span>
          <span
            className="stat-chip"
            title="En attente, en erreur ou perdus (24 h)"
            onClick={() => setF({ ...f, tab: 'attention' })}
            style={counts.attention ? { borderColor: STATUS_COLORS.waiting + '88' } : undefined}
          >
            <span className="dot" style={{ background: counts.attention ? STATUS_COLORS.waiting : 'var(--fg3)' }} /> <b>{counts.attention}</b>{' '}
            <span className="lbl">à voir</span>
          </span>
        </div>
        <button className="btn sm" onClick={() => setPalette(true)} title="Recherche globale">
          ⌕ <span className="lbl">Rechercher</span> <span className="kbd lbl">Ctrl K</span>
        </button>
        <button
          className="btn sm icon bell"
          title="Notifications"
          onClick={() => {
            setNotifOpen(!notifOpen);
            if (!notifOpen && unread) {
              api.markRead();
              store.set({ notifications: notifications.map((n) => ({ ...n, read: true })) });
            }
          }}
        >
          🔔{unread > 0 && <span className="n">{unread > 99 ? '99+' : unread}</span>}
        </button>
        <button className="btn primary sm" style={{ height: 30 }} title="Lancer une session pilotée (Ctrl+N)" onClick={() => setLaunch(true)}>
          + <span className="lbl">Nouvelle session</span>
        </button>
        {notifOpen && <Notifications onClose={() => setNotifOpen(false)} />}
      </header>
      <div className="main">
        {sideOpen && <Sidebar all={all} filters={f} setFilters={setF} selected={selected} width={narrow ? Math.min(left.width, 280) : left.width} />}
        {sideOpen && left.handle}
        <main className="center">
          {view === 'office' && <OfficeView agents={filtered} onLaunch={() => setLaunch(true)} />}
          {view === 'dashboard' && <Dashboard agents={filtered} />}
          {view === 'logs' && <EventLog />}
          {view === 'history' && <HistoryView />}
          {view === 'settings' && <SettingsView />}
        </main>
        {sel && (
          <>
            {!narrow && right.handle}
            <aside className={`panel ${narrow ? 'overlay' : ''}`} style={{ width: narrow ? Math.min(right.width, 420) : right.width }} key={sel.id}>
              <AgentPanel a={sel} />
            </aside>
          </>
        )}
      </div>
      <footer className="statusbar">
        <StatusItem ok={!!health?.claudeHomeFound} onClick={() => setView('settings')} title="Lecture des fichiers de Claude Code">
          {health?.claudeHomeFound ? 'Claude Code connecté' : 'Claude Code introuvable'}
        </StatusItem>
        {health && (
          <span className="it">
            {health.liveSessions} session{health.liveSessions > 1 ? 's' : ''} active{health.liveSessions > 1 ? 's' : ''} · {health.watchedFiles} transcripts
            suivis
          </span>
        )}
        {health && health.managedRunning > 0 && (
          <span className="it" style={{ color: 'var(--acc)' }}>
            ● {health.managedRunning} pilotée{health.managedRunning > 1 ? 's' : ''} par l’app
          </span>
        )}
        {health && (
          <StatusItem ok={health.hooks} neutral={!health.hooks} onClick={() => setView('settings')} title="Hooks optionnels">
            {health.hooks ? 'Hooks actifs' : 'Hooks non installés'}
          </StatusItem>
        )}
        <span className="grow" />
        {lastEvent && <span className="it">Dernier événement il y a {ago(lastEvent.ts, now)}</span>}
        {health && <span className="it">{fmtNum(health.dbEvents)} événements enregistrés</span>}
        <span className="it click" onClick={() => setHelp(true)}>
          <span className="kbd">?</span> raccourcis
        </span>
      </footer>
      <div className="toasts">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast ${t.level}`}
            onClick={() => {
              if (t.agentId) select(t.agentId);
              dismissToast(t.id);
            }}
          >
            {t.agentId && agentsMap.get(t.agentId) && <Avatar a={agentsMap.get(t.agentId)!} style={{ width: 16, height: 24, flex: 'none' }} />}
            <div style={{ minWidth: 0 }}>
              <b>{t.title}</b>
              {t.body && <span className="muted small">{t.body}</span>}
            </div>
            <span className="x">✕</span>
          </div>
        ))}
      </div>
      {launch && <LaunchDialog onClose={() => setLaunch(false)} cwd={sel?.cwd} />}
      {palette && <Palette agents={all} onClose={() => setPalette(false)} />}
      {wizard && <SetupWizard onClose={() => setWizard(false)} />}
      {help && <Shortcuts onClose={() => setHelp(false)} />}
      <ConfirmHost />
    </div>
  );
}

function StatusItem({ ok, neutral, children, onClick, title }: { ok: boolean; neutral?: boolean; children: ReactNode; onClick?: () => void; title?: string }) {
  return (
    <span className="it click" onClick={onClick} title={title}>
      <span className="dot" style={{ background: neutral ? 'var(--fg3)' : ok ? 'var(--ok)' : 'var(--err)' }} />
      {children}
    </span>
  );
}

function Notifications({ onClose }: { onClose: () => void }) {
  const notifications = useStore((s) => s.notifications);
  const agents = useStore((s) => s.agents);
  return (
    <div className="pop">
      <div className="pop-head">
        <b>Notifications</b>
        <span className="grow" />
        <button className="btn ghost sm icon" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="pop-body">
        {notifications.slice(0, 100).map((n) => {
          const a = n.agentId ? agents.get(n.agentId) : undefined;
          return (
            <div
              key={n.id}
              className="notif"
              onClick={() => {
                if (n.agentId) select(n.agentId);
                onClose();
              }}
            >
              <span
                className="dot"
                style={{
                  background: n.level === 'error' ? 'var(--err)' : n.level === 'warning' ? 'var(--warn)' : n.level === 'success' ? 'var(--ok)' : 'var(--blue)',
                }}
              />
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="row between">
                  <b className="ellipsis">{n.title}</b>
                  <span className="faint tiny mono">{ago(n.ts)}</span>
                </div>
                <div className="muted small" style={{ wordBreak: 'break-word' }}>
                  {n.body}
                </div>
                {a && <div className="faint tiny">{a.project}</div>}
              </div>
            </div>
          );
        })}
        {!notifications.length && <div className="empty">Aucune notification</div>}
      </div>
    </div>
  );
}

function Shortcuts({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ['1 … 5', 'Changer de vue'],
    ['Ctrl K', 'Recherche globale'],
    ['Ctrl N', 'Nouvelle session'],
    ['J / K', 'Agent suivant / précédent'],
    ['F', 'Centrer la caméra sur l’agent'],
    ['+  −  0', 'Zoom avant / arrière / vue d’ensemble'],
    ['L', 'Liens parent ↔ sous-agent'],
    ['B', 'Bulles d’action'],
    ['Ctrl B', 'Afficher / masquer la liste des agents'],
    ['Échap', 'Fermer la fiche'],
    ['Glisser · molette', 'Déplacer · zoomer le bureau'],
    ['?', 'Cette aide'],
  ];
  return (
    <Modal title="Raccourcis clavier" onClose={onClose}>
      <table>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td style={{ width: 150 }}>
                <span className="kbd">{k}</span>
              </td>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}

function Palette({ agents, onClose }: { agents: UIAgent[]; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [i, setI] = useState(0);
  useEffect(() => {
    if (q.length < 2) return setEvents([]);
    const t = setTimeout(() => api.getEvents({ text: q, limit: 30 }).then(setEvents), 180);
    return () => clearTimeout(t);
  }, [q]);
  const t = q.toLowerCase();
  const ag = agents
    .filter((a) => !t || `${a.name} ${a.project} ${a.role} ${a.currentTask.value ?? ''} ${a.sessionId}`.toLowerCase().includes(t))
    .sort((a, b) => b.lastEventAt - a.lastEventAt)
    .slice(0, 8);
  const views = VIEWS.filter((v) => t && v.label.toLowerCase().includes(t));
  type Item = { key: string; group: string; label: ReactNode; sub: string; go: () => void };
  const items: Item[] = [
    ...views.map((v) => ({
      key: `v:${v.id}`,
      group: 'Vues',
      label: (
        <>
          {v.ico} {v.label}
        </>
      ),
      sub: 'Aller à la vue',
      go: () => setView(v.id),
    })),
    ...ag.map((a) => ({
      key: a.id,
      group: 'Agents',
      label: (
        <span className="row" style={{ gap: 8 }}>
          <Avatar a={a} style={{ width: 12, height: 18 }} />
          {a.name}
        </span>
      ),
      sub: `${a.project} · ${STATUS_LABEL[a.status]}${a.currentTask.value ? ' · ' + a.currentTask.value : ''}`,
      go: () => {
        select(a.id);
        setView('office');
      },
    })),
    ...events.map((e) => ({
      key: e.id,
      group: 'Événements',
      label: e.summary,
      sub: `${agents.find((a) => a.id === e.agentId)?.name ?? ''} · il y a ${ago(e.ts)}`,
      go: () => select(e.agentId),
    })),
  ];
  let lastGroup = '';
  return (
    <Modal title="Recherche globale" onClose={onClose} wide>
      <div className="search" style={{ marginBottom: 8 }}>
        <input
          autoFocus
          style={{ width: '100%', height: 36, fontSize: 14 }}
          placeholder="Agent, projet, tâche, commande, fichier, erreur…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setI(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setI(Math.min(items.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setI(Math.max(0, i - 1));
            } else if (e.key === 'Enter' && items[i]) {
              items[i].go();
              onClose();
            }
          }}
        />
      </div>
      <div style={{ maxHeight: '55vh', overflow: 'auto' }}>
        {items.map((it, k) => {
          const head = it.group !== lastGroup;
          lastGroup = it.group;
          return (
            <div key={it.key}>
              {head && <div className="palette-kind">{it.group}</div>}
              <div
                className={`palette-item ${k === i ? 'on' : ''}`}
                onMouseEnter={() => setI(k)}
                onClick={() => {
                  it.go();
                  onClose();
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div className="ellipsis">{it.label}</div>
                  <div className="faint small ellipsis">{it.sub}</div>
                </div>
              </div>
            </div>
          );
        })}
        {!items.length && <div className="empty">Aucun résultat</div>}
      </div>
      <div className="faint tiny" style={{ marginTop: 8 }}>
        ↑ ↓ pour naviguer · Entrée pour ouvrir · Échap pour fermer
      </div>
    </Modal>
  );
}
