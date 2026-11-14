// Event log with search, filters, progressive loading, live append, copy and export.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { AgentEvent, EventKind } from '../../shared/types';
import { api } from '../api';
import { select, toast, useStore } from '../store';
import { Empty, copyText, fmtDateTime, fmtTime } from '../ui';

export const KIND: Partial<Record<EventKind, { label: string; color: string }>> = {
  agent_detected: { label: 'Détection', color: '#4dabf7' },
  session_start: { label: 'Démarrage', color: '#4dabf7' },
  user_prompt: { label: 'Demande', color: '#ffc935' },
  assistant_text: { label: 'Message', color: '#b197fc' },
  tool_use: { label: 'Outil', color: '#74c0fc' },
  tool_result: { label: 'Résultat', color: '#868e96' },
  tool_error: { label: 'Erreur', color: '#ff6b6b' },
  subagent_spawn: { label: 'Délégation', color: '#ffa94d' },
  subagent_done: { label: 'Sous-agent fini', color: '#51cf66' },
  turn_end: { label: 'Fin de tour', color: '#51cf66' },
  status_change: { label: 'Statut', color: '#adb5bd' },
  notification: { label: 'Notification', color: '#fcc419' },
  session_end: { label: 'Fin session', color: '#4dabf7' },
  process_lost: { label: 'Processus perdu', color: '#ff6b6b' },
  title: { label: 'Titre', color: '#adb5bd' },
  system: { label: 'Système', color: '#adb5bd' },
};

const FILTERS: { id: string; label: string; kinds?: EventKind[]; errors?: boolean }[] = [
  { id: 'all', label: 'Tout' },
  { id: 'prompts', label: 'Demandes & messages', kinds: ['user_prompt', 'assistant_text'] },
  { id: 'tools', label: 'Outils', kinds: ['tool_use', 'tool_result', 'subagent_spawn'] },
  { id: 'errors', label: 'Erreurs', errors: true },
  {
    id: 'status',
    label: 'Cycle de vie',
    kinds: ['status_change', 'agent_detected', 'session_start', 'session_end', 'process_lost', 'turn_end', 'subagent_done', 'notification'],
  },
];

/** Light syntax highlighting: commands, paths, errors, success words. */
export function highlight(text: string): ReactNode[] {
  const re =
    /(^\$ .*$)|([A-Za-z]:\\[^\s"'<>|]+|(?:\.{0,2}\/)?(?:[\w.-]+\/)+[\w.-]+\.\w+)|(\b(?:error|erreur|failed|fail|exception|traceback|denied)\b)|(\b(?:passed|success|ok|réussi)\b)/gim;
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const cls = m[1] ? 'hl-cmd' : m[2] ? 'hl-path' : m[3] ? 'hl-err' : 'hl-ok';
    out.push(
      <span key={i++} className={cls}>
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex++;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function KindTag({ e }: { e: AgentEvent }) {
  const k = KIND[e.kind];
  return (
    <span className="kind" style={{ '--kc': k?.color } as CSSProperties}>
      <i />
      {k?.label ?? e.kind}
      {e.tool && e.kind !== 'subagent_spawn' ? <span className="faint">· {e.tool}</span> : null}
    </span>
  );
}

export function EventLog({ agentId, compact }: { agentId?: string; compact?: boolean }) {
  const agents = useStore((s) => s.agents);
  const live = useStore((s) => s.live);
  const [rows, setRows] = useState<AgentEvent[]>([]);
  const [text, setText] = useState('');
  const [filter, setFilter] = useState('all');
  const [agentFilter, setAgentFilter] = useState('');
  const [showResults, setShowResults] = useState(!!agentId);
  const [open, setOpen] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [more, setMore] = useState(true);
  const box = useRef<HTMLDivElement>(null);
  const f = FILTERS.find((x) => x.id === filter)!;
  const target = agentId ?? (agentFilter || undefined);

  const query = useCallback(
    (before?: number) => api.getEvents({ agentId: target, kinds: f.kinds, errorsOnly: f.errors, text: text || undefined, before, limit: 300 }),
    [target, f, text],
  );

  useEffect(() => {
    let off = false;
    const t = setTimeout(async () => {
      const r = await query();
      if (!off) {
        setRows(r);
        setMore(r.length >= 300);
      }
    }, 180);
    return () => {
      off = true;
      clearTimeout(t);
    };
  }, [query]);

  const merged = useMemo(() => {
    const seen = new Set(rows.map((r) => r.id));
    const t = text.toLowerCase();
    const extra = live.filter(
      (e) =>
        !seen.has(e.id) &&
        (!target || e.agentId === target) &&
        (!f.kinds || f.kinds.includes(e.kind)) &&
        (!f.errors || e.isError) &&
        (!t || e.summary.toLowerCase().includes(t) || (e.detail ?? '').toLowerCase().includes(t)),
    );
    return [...extra, ...rows].filter((e) => showResults || filter === 'tools' || e.kind !== 'tool_result').sort((a, b) => b.ts - a.ts);
  }, [rows, live, target, f, text, showResults, filter]);

  const ordered = useMemo(() => merged.slice().reverse(), [merged]);

  useEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [ordered.length, follow]);

  const loadMore = async () => {
    const oldest = rows[rows.length - 1]?.ts;
    const r = await query(oldest);
    setRows((cur) => [...cur, ...r]);
    setMore(r.length >= 300);
  };

  const asText = (list: AgentEvent[]) =>
    list
      .map(
        (e) =>
          `${fmtDateTime(e.ts)}\t${agents.get(e.agentId)?.name ?? e.agentId}\t${e.kind}\t${e.summary}${e.detail && e.detail !== e.summary ? '\n' + e.detail : ''}`,
      )
      .join('\n');

  let lastDay = '';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <div className="logbar">
        <div className="search" style={{ flex: '1 1 200px' }}>
          <input placeholder="Rechercher (commande, fichier, erreur…)" value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        {!agentId && (
          <select value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)} style={{ maxWidth: 200 }}>
            <option value="">Tous les agents</option>
            {[...agents.values()]
              .sort((a, b) => b.lastEventAt - a.lastEventAt)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.kind === 'subagent' ? '↳ ' : ''}
                  {a.name}
                </option>
              ))}
          </select>
        )}
        <div className="chips">
          {FILTERS.map((x) => (
            <button key={x.id} className={`chip ${filter === x.id ? 'on' : ''}`} onClick={() => setFilter(x.id)}>
              {x.label}
            </button>
          ))}
        </div>
        <div className="row" style={{ marginLeft: 'auto', gap: 6 }}>
          <label className="row small muted" style={{ gap: 5 }} title="Les résultats d’outils réussis sont souvent très nombreux">
            <input type="checkbox" checked={showResults} onChange={(e) => setShowResults(e.target.checked)} /> résultats
          </label>
          <label className="row small muted" style={{ gap: 5 }}>
            <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> suivre
          </label>
          <button
            className="btn sm"
            title="Copier les lignes affichées"
            onClick={async () =>
              toast({
                type: 'task_end',
                level: (await copyText(asText(ordered))) ? 'success' : 'error',
                title: 'Copié',
                body: `${ordered.length} lignes dans le presse-papiers`,
              })
            }
          >
            Copier
          </button>
          <button
            className="btn sm"
            onClick={async () => {
              const r = await api.exportData({ events: merged, name: `journal-${new Date().toISOString().slice(0, 10)}.json` });
              if (r.ok) toast({ type: 'task_end', level: 'success', title: 'Export', body: r.message });
            }}
          >
            Exporter
          </button>
        </div>
      </div>
      <div
        className="log"
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
          if (atBottom !== follow) setFollow(atBottom);
        }}
      >
        {more && ordered.length > 0 && (
          <div style={{ padding: 8, textAlign: 'center' }}>
            <button className="btn sm" onClick={loadMore}>
              Charger les événements plus anciens
            </button>
          </div>
        )}
        {!ordered.length && <Empty title="Aucun événement">Rien d’observé pour ces filtres.</Empty>}
        {ordered.map((e) => {
          const a = agents.get(e.agentId);
          const day = new Date(e.ts).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
          const sep = day !== lastDay;
          lastDay = day;
          return (
            <Fragment key={e.id}>
              {sep && <div className="day-sep">{day}</div>}
              <div
                className={`log-line ${compact ? 'compact' : ''} ${e.isError ? 'e' : ''} ${open === e.id ? 'open' : ''}`}
                onClick={() => setOpen(open === e.id ? null : e.id)}
                title={`${fmtDateTime(e.ts)} · source : ${e.source}`}
              >
                <span className="faint">{fmtTime(e.ts)}</span>
                {!compact && (
                  <span
                    className="ellipsis"
                    style={{ color: a?.color, fontFamily: 'Segoe UI, sans-serif', fontWeight: 600 }}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      select(e.agentId);
                    }}
                  >
                    {a?.name ?? e.agentId}
                  </span>
                )}
                <KindTag e={e} />
                <span className={e.isError ? 'hl-err' : ''} style={{ wordBreak: 'break-word' }}>
                  {highlight(e.summary)}
                </span>
              </div>
              {open === e.id && (
                <pre className="log-detail">
                  {highlight(e.detail || e.summary)}
                  {'\n\n'}
                  <span className="faint">
                    source : {e.source} · {fmtDateTime(e.ts)}
                  </span>
                </pre>
              )}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
