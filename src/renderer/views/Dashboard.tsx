import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import type { AgentStatus } from '../../shared/types';
import { api, type UIAgent } from '../api';
import { select, useStore } from '../store';
import { EventLog } from '../components/EventLog';
import { Avatar, Empty, Prov, StatusPill, ago, chatCost, fmtNum, fmtUSD, useNow } from '../ui';
import { modelLabel } from '../../shared/pricing';
import { QuotaBar, QuotaDetails } from '../components/QuotaWidget';
import { ACTIVITY_LABEL } from '../../main/core/activity';
import { STATUS_COLORS } from '../office/engine';

/** Priority is not a Claude Code concept: derived from status, and labelled as such. */
export function priorityOf(a: UIAgent): 'haute' | 'normale' | 'basse' {
  if (a.status === 'error' || a.status === 'lost' || a.status === 'waiting') return 'haute';
  if (a.status === 'working') return 'normale';
  return 'basse';
}

export function Dashboard({ agents }: { agents: UIAgent[] }) {
  const [usage, setUsage] = useState<{ day: string; input: number; output: number }[]>([]);
  const notifications = useStore((s) => s.notifications);
  useEffect(() => {
    const load = () => api.usageByDay(14).then(setUsage);
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  const k = useMemo(() => {
    const by = (s: AgentStatus[]) => agents.filter((a) => s.includes(a.status)).length;
    const sessions = agents.filter((a) => a.kind === 'session');
    const alive = agents.filter((a) => a.alive.value === true);
    const withCost = sessions.filter((a) => a.cost.source === 'observed');
    return {
      active: by(['working', 'waiting']),
      idle: by(['idle']),
      error: by(['error', 'lost']),
      tasksDone: agents.reduce((n, a) => n + a.tasks.filter((t) => t.status === 'done').length, 0),
      running: sessions.filter((a) => a.alive.value === true).length,
      subs: agents.filter((a) => a.kind === 'subagent').length,
      projects: new Set(agents.filter((a) => a.status !== 'done' && a.status !== 'lost').map((a) => a.project)).size,
      tokOut: agents.reduce((n, a) => n + (a.tokens.value?.output ?? 0), 0),
      tokIn: agents.reduce((n, a) => n + (a.tokens.value ? a.tokens.value.input + a.tokens.value.cacheRead + a.tokens.value.cacheCreation : 0), 0),
      cost: withCost.reduce((n, a) => n + (a.cost.value ?? 0), 0),
      est: agents.reduce((n, a) => n + (a.estimatedCost?.value ?? 0), 0),
      withCost: withCost.length,
      sessions: sessions.length,
      cpu: alive.reduce((n, a) => n + (a.cpu.value ?? 0), 0),
      ram: alive.reduce((n, a) => n + (a.memoryMB.value ?? 0), 0),
      measured: alive.filter((a) => a.memoryMB.value !== null).length,
      alive: alive.length,
    };
  }, [agents]);

  const maxU = Math.max(1, ...usage.map((u) => u.output));
  // Always the last 14 days, including days without activity (empty bar).
  const days14 = Array.from({ length: 14 }, (_, i) => {
    const day = new Date(Date.now() - (13 - i) * 86_400_000).toISOString().slice(0, 10);
    return usage.find((u) => u.day === day) ?? { day, input: 0, output: 0 };
  });
  // Cost per chat: each session plus its sub-agents, estimated from tokens × model price.
  const costRows = agents
    .filter((a) => a.kind === 'session')
    .map((a) => ({ a, c: chatCost(a, agents) }))
    .filter((r) => (r.c.total ?? 0) > 0)
    .sort((x, y) => (y.c.total ?? 0) - (x.c.total ?? 0))
    .slice(0, 8);
  const maxCost = Math.max(0.0001, ...costRows.map((r) => r.c.total ?? 0));
  const byModel = new Map<string, { usd: number; out: number }>();
  for (const a of agents)
    for (const [m, v] of Object.entries(a.costByModel ?? {})) {
      const cur = byModel.get(m) ?? { usd: 0, out: 0 };
      cur.usd += v.usd ?? 0;
      cur.out += v.output;
      byModel.set(m, cur);
    }
  const models = [...byModel.entries()].sort((x, y) => y[1].usd - x[1].usd);
  const maxModel = Math.max(0.0001, ...models.map(([, v]) => v.usd));
  const roots = agents.filter((a) => !a.parentId || !agents.some((p) => p.id === a.parentId)).sort((a, b) => b.lastEventAt - a.lastEventAt);
  const activity = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of agents) if (a.status === 'working') m.set(a.activity, (m.get(a.activity) ?? 0) + 1);
    return [...m.entries()];
  }, [agents]);
  const alerts = notifications.filter((n) => n.level !== 'info').slice(0, 6);

  return (
    <div className="page">
      <div className="kpis">
        <Kpi ic="▶" v={k.active} l="Agents actifs" c={STATUS_COLORS.working} sub={`${k.idle} en pause`} />
        <Kpi ic="⚠" v={k.error} l="En erreur / perdus" c={k.error ? STATUS_COLORS.error : undefined} sub="sur la sélection" />
        <Kpi ic="✔" v={k.tasksDone} l="Tâches terminées" c={STATUS_COLORS.done} />
        <Kpi ic="◉" v={k.running} l="Sessions en cours" sub={`${k.sessions} au total · ${k.subs} sous-agents`} />
        <Kpi ic="▦" v={k.projects} l="Projets actifs" />
        <Kpi ic="✎" v={fmtNum(k.tokOut)} l="Tokens générés" sub={`${fmtNum(k.tokIn)} en entrée (cache inclus)`} c="#b197fc" />
        <Kpi
          ic="$"
          v={`≈ ${fmtUSD(k.est)}`}
          l="Coût estimé (tarif API)"
          sub={`Relevés Claude Code : ${fmtUSD(k.cost)} sur ${k.withCost}/${k.sessions} sessions`}
          c="#ffc935"
        />
        <Kpi
          ic="⚙"
          v={k.measured ? `${k.cpu.toFixed(0)} %` : '—'}
          l="CPU Claude Code"
          sub={k.measured ? `${fmtNum(k.ram)} Mo de RAM` : k.alive ? 'mesure en cours…' : 'aucun processus actif'}
        />
      </div>
      <QuotaCard />
      <div className="grid2">
        <div className="card">
          <div className="card-title">
            Tokens générés par jour (14 j) <Prov src="observed" note="Somme des champs usage des transcripts enregistrés" />
          </div>
          {usage.length ? (
            <div className="bars1" style={{ marginBottom: 20 }}>
              {days14.map((u) => (
                <div
                  key={u.day}
                  className="b"
                  style={{ height: `${(u.output / maxU) * 100}%` }}
                  title={`${u.day} : ${fmtNum(u.output)} sortie · ${fmtNum(u.input)} entrée`}
                >
                  <span>{u.day.slice(5)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="na">Aucune donnée d’usage enregistrée</div>
          )}
        </div>
        <div className="card">
          <div className="card-title">
            Coût estimé par chat <Prov src="inferred" note="Tokens × tarif API public du modèle, sous-agents inclus" />
          </div>
          {costRows.length ? (
            costRows.map(({ a, c }) => (
              <div
                key={a.id}
                className="hbar"
                onClick={() => select(a.id)}
                title={`${a.name}
Agent : ${fmtUSD(c.own ?? 0)}${
                  c.subCount
                    ? `
Sous-agents (${c.subCount}) : ${fmtUSD(c.subs)}`
                    : ''
                }${
                  a.cost.value != null
                    ? `
Relevé Claude Code : ${fmtUSD(a.cost.value)}`
                    : ''
                }`}
              >
                <span className="ellipsis">
                  {a.name}
                  {c.subCount ? <span className="faint"> +{c.subCount}</span> : null}
                </span>
                <div className="track">
                  <div className="fill" style={{ width: `${((c.total ?? 0) / maxCost) * 100}%` }} />
                </div>
                <span className="mono small" style={{ textAlign: 'right' }}>
                  {fmtUSD(c.total ?? 0)}
                </span>
              </div>
            ))
          ) : (
            <Empty title="Aucune consommation">Le coût apparaît dès la première réponse d’un modèle.</Empty>
          )}
          {models.length > 0 && (
            <>
              <div className="card-title" style={{ marginTop: 14 }}>
                Par modèle
              </div>
              {models.map(([m, v]) => (
                <div key={m} className="hbar" style={{ cursor: 'default' }} title={`${fmtNum(v.out)} tokens générés`}>
                  <span className="ellipsis">{modelLabel(m)}</span>
                  <div className="track">
                    <div className="fill" style={{ width: `${(v.usd / maxModel) * 100}%`, background: 'var(--blue)' }} />
                  </div>
                  <span className="mono small" style={{ textAlign: 'right' }}>
                    {fmtUSD(v.usd)}
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
      <div className="grid2">
        <div className="card">
          <div className="card-title">Organigramme</div>
          <div className="org" style={{ maxHeight: 340, overflow: 'auto' }}>
            <ul>
              {roots.slice(0, 40).map((r) => (
                <TreeNode key={r.id} a={r} all={agents} />
              ))}
            </ul>
            {!roots.length && <Empty title="Aucun agent" />}
          </div>
        </div>
        <div className="card">
          <div className="card-title">En ce moment</div>
          {activity.length ? (
            <div className="row wrap" style={{ marginBottom: 12 }}>
              {activity.map(([act, n]) => (
                <span key={act} className="pill" style={{ '--c': '#74c0fc' } as CSSProperties}>
                  {ACTIVITY_LABEL[act as keyof typeof ACTIVITY_LABEL]} · {n}
                </span>
              ))}
            </div>
          ) : (
            <div className="faint small" style={{ marginBottom: 12 }}>
              Aucun agent au travail.
            </div>
          )}
          <div className="card-title">Dernières alertes</div>
          {alerts.length ? (
            <ul className="list">
              {alerts.map((n) => (
                <li
                  key={n.id}
                  className="row"
                  style={{ cursor: n.agentId ? 'pointer' : undefined, wordBreak: 'normal' }}
                  onClick={() => n.agentId && select(n.agentId)}
                >
                  <span className="dot" style={{ background: n.level === 'error' ? 'var(--err)' : n.level === 'warning' ? 'var(--warn)' : 'var(--ok)' }} />
                  <span className="grow ellipsis">
                    <b>{n.title}</b> <span className="faint">{n.body}</span>
                  </span>
                  <span className="faint tiny mono">{ago(n.ts)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="faint small">Aucune alerte.</div>
          )}
        </div>
      </div>
      <div className="card" style={{ padding: 0, overflowX: 'auto', marginTop: 14 }}>
        <table>
          <thead>
            <tr>
              <th>Agent</th>
              <th>Statut</th>
              <th>Activité</th>
              <th>
                Priorité <Prov src="inferred" note="Déduite du statut : Claude Code n’a pas de notion de priorité" />
              </th>
              <th>Actions</th>
              <th>Coût estimé</th>
              <th>Dernier événement</th>
            </tr>
          </thead>
          <tbody>
            {agents
              .slice()
              .sort((a, b) => b.lastEventAt - a.lastEventAt)
              .slice(0, 60)
              .map((a) => (
                <tr key={a.id} className="click" onClick={() => select(a.id)}>
                  <td>
                    <span className="row">
                      <Avatar a={a} style={{ width: 12, height: 18 }} />
                      <span>
                        {a.kind === 'subagent' ? '↳ ' : ''}
                        {a.name}
                        <div className="faint tiny">{a.project}</div>
                      </span>
                    </span>
                  </td>
                  <td>
                    <StatusPill status={a.status} />
                  </td>
                  <td className="small">{a.status === 'working' ? ACTIVITY_LABEL[a.activity] : <span className="faint">—</span>}</td>
                  <td className="small">{priorityOf(a)}</td>
                  <td className="mono">{a.actionCount}</td>
                  <td className="mono small" title="Estimation au tarif API (cet agent seul)">
                    {a.estimatedCost?.value != null ? `≈ ${fmtUSD(a.estimatedCost.value)}` : <span className="faint">—</span>}
                  </td>
                  <td className="faint small">il y a {ago(a.lastEventAt)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <div className="card" style={{ height: 400, display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden', marginTop: 14 }}>
        <EventLog />
      </div>
    </div>
  );
}

function QuotaCard() {
  const q = useStore((s) => s.quota);
  const [busy, setBusy] = useState(false);
  const now = useNow(30_000);
  if (q?.plan === 'api' && !q.windows.length) return null;
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-title">
        Quotas d’utilisation restants <Prov src="observed" note="Valeurs fournies par Claude Code (/usage ou rate_limit_event)" />
      </div>
      <div className="quota-grid">
        {q?.windows.map((w) => (
          <QuotaBar key={w.id} w={w} now={now} />
        ))}
      </div>
      <div style={{ marginTop: 10 }}>
        <QuotaDetails
          q={q ? { ...q, windows: [] } : null}
          now={now}
          busy={busy}
          onRefresh={async () => {
            setBusy(true);
            await api.refreshQuota();
            setBusy(false);
          }}
        />
      </div>
    </div>
  );
}

function Kpi({ ic, v, l, c, sub }: { ic: string; v: ReactNode; l: string; c?: string; sub?: string }) {
  return (
    <div className="kpi" style={{ '--c': c } as CSSProperties}>
      <div className="kh">
        <span>{l}</span>
        <span className="ic">{ic}</span>
      </div>
      <div className="v">{v}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

function TreeNode({ a, all }: { a: UIAgent; all: UIAgent[] }) {
  const kids = all.filter((x) => x.parentId === a.id);
  return (
    <li>
      <span className="node" onClick={() => select(a.id)}>
        <Avatar a={a} style={{ width: 10, height: 15 }} /> {a.name} <span className="faint tiny">{a.role}</span> <StatusPill status={a.status} />
      </span>
      {kids.length > 0 && (
        <ul>
          {kids.map((c) => (
            <TreeNode key={c.id} a={c} all={all} />
          ))}
        </ul>
      )}
    </li>
  );
}
