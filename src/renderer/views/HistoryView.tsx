import { useEffect, useMemo, useState } from 'react';
import { api, type SessionRow } from '../api';
import { select, useStore } from '../store';
import { Avatar, Empty, StatusPill, chatCost, fmtDateTime, fmtDur, fmtUSD } from '../ui';
import type { AgentStatus } from '../../shared/types';

export function HistoryView() {
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [q, setQ] = useState('');
  const agents = useStore((s) => s.agents);
  useEffect(() => {
    api.getSessions().then(setRows);
    const t = setInterval(() => api.getSessions().then(setRows), 15_000);
    return () => clearInterval(t);
  }, []);
  const list = useMemo(() => {
    const t = q.toLowerCase();
    return rows.filter((r) => {
      const a = agents.get(`cc:${r.session_id}`);
      return !t || `${a?.name ?? r.name} ${r.project} ${r.cwd} ${r.session_id} ${a?.currentTask.value ?? ''}`.toLowerCase().includes(t);
    });
  }, [rows, q, agents]);
  return (
    <div className="page">
      <div className="page-head">
        <h2>Historique des sessions</h2>
        <span className="faint">
          {list.length} session{list.length > 1 ? 's' : ''}
        </span>
        <div className="search grow" style={{ maxWidth: 420, marginLeft: 'auto' }}>
          <input placeholder="Nom, projet, dossier, tâche, identifiant…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Session</th>
              <th>Projet</th>
              <th>Statut</th>
              <th>Début</th>
              <th>Durée</th>
              <th>Sous-agents</th>
              <th title="Tokens × tarif API public, sous-agents inclus">Coût estimé</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => {
              const a = agents.get(`cc:${r.session_id}`);
              return (
                <tr key={r.session_id} className="click" onClick={() => select(`cc:${r.session_id}`)}>
                  <td>
                    <div className="row">
                      {a && <Avatar a={a} style={{ width: 14, height: 21 }} />}
                      <div style={{ minWidth: 0 }}>
                        <b>{a?.name ?? r.name}</b>
                        {a?.currentTask.value && (
                          <div className="muted small ellipsis" style={{ maxWidth: 420 }}>
                            {a.currentTask.value}
                          </div>
                        )}
                        <div className="faint mono tiny">{r.session_id}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    {r.project}
                    <div className="faint tiny ellipsis" style={{ maxWidth: 220 }}>
                      {r.cwd}
                    </div>
                  </td>
                  <td>
                    <StatusPill status={(a?.status ?? r.status) as AgentStatus} />
                  </td>
                  <td className="small">{fmtDateTime(r.started_at)}</td>
                  <td className="small mono">{fmtDur(r.last_event_at - r.started_at)}</td>
                  <td className="mono">{r.subagents || <span className="faint">0</span>}</td>
                  <td className="mono small">
                    {a && chatCost(a, agents.values()).total != null ? `≈ ${fmtUSD(chatCost(a, agents.values()).total!)}` : <span className="faint">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!list.length && <Empty title="Aucune session">{q ? 'Aucun résultat pour cette recherche.' : 'Les sessions Claude Code apparaîtront ici.'}</Empty>}
      </div>
    </div>
  );
}
