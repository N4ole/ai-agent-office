// Detailed agent sheet: what it is doing now, key figures, controls, then details.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { ControlAction, ControlCapabilities } from '../../shared/types';
import { api, type UIAgent } from '../api';
import { select, setView, toast, useStore } from '../store';
import { ACTIVITY_LABEL } from '../../main/core/activity';
import { PRICES_AS_OF, modelLabel } from '../../shared/pricing';
import { EventLog } from './EventLog';
import {
  ActivityIcon,
  Avatar,
  Prov,
  StatusPill,
  TV,
  ago,
  chatCost,
  fmtUSD as usd,
  confirmAction,
  copyText,
  fmtDateTime,
  fmtDur,
  fmtNum,
  fmtTime,
  fmtUSD,
  useNow,
} from '../ui';

function Sec({ title, children, open = true, extra }: { title: string; children: ReactNode; open?: boolean; extra?: ReactNode }) {
  return (
    <details className="sec" open={open}>
      <summary>
        {title}
        {extra}
      </summary>
      <div className="in">{children}</div>
    </details>
  );
}

const ACTION_LABEL: Record<string, string> = {
  sendInstruction: 'Envoyer une instruction',
  interrupt: 'Interrompre',
  pause: 'Pause',
  stop: 'Arrêter',
  resume: 'Reprendre',
  openTerminal: 'Ouvrir un terminal',
  openFolder: 'Ouvrir le dossier',
};

function Controls({ a }: { a: UIAgent }) {
  const [caps, setCaps] = useState<ControlCapabilities | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let off = false;
    api.capabilities(a.id).then((c) => !off && setCaps(c));
    return () => {
      off = true;
    };
  }, [a.id, a.status, a.alive.value, a.managed]);
  if (!caps) return null;

  const run = async (action: ControlAction, confirm?: { title: string; body: string; ok: string }) => {
    if (confirm && !(await confirmAction(confirm.title, confirm.body, confirm.ok))) return;
    setBusy(true);
    const r = await api.control(action);
    setBusy(false);
    toast({
      type: r.ok ? 'task_end' : 'error',
      level: r.ok ? 'success' : 'error',
      title: r.ok ? 'Commande exécutée' : 'Commande refusée',
      body: r.message,
      agentId: a.id,
    });
    return r;
  };
  const send = async () => {
    if (!msg.trim()) return;
    const r = await run({ type: 'send', agentId: a.id, text: msg });
    if (r?.ok) setMsg('');
  };
  const unavailable = (Object.keys(ACTION_LABEL) as (keyof ControlCapabilities)[]).filter((k) => !caps[k] && caps.reasons[k]);
  const stopBody = `Le processus Claude Code de ${a.name}${a.pid.value ? ` (PID ${a.pid.value})` : ''} sera arrêté et son travail en cours interrompu.${a.managed ? '' : '\n\nCette session a été lancée dans un terminal externe : elle sera fermée de force.'}`;

  return (
    <Sec title="Contrôle">
      {caps.sendInstruction && (
        <div className="sendbox">
          <textarea
            rows={1}
            placeholder="Instruction pour l’agent…  (Ctrl+Entrée pour envoyer)"
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.ctrlKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button className="btn primary" disabled={busy || !msg.trim()} onClick={send}>
            Envoyer
          </button>
        </div>
      )}
      <div className="actions">
        {caps.interrupt && (
          <button
            className="btn sm"
            disabled={busy}
            onClick={() =>
              run(
                { type: 'interrupt', agentId: a.id },
                {
                  title: 'Interrompre le tour en cours ?',
                  body: `${a.name} arrête ce qu’il fait. La session reste ouverte et peut recevoir une nouvelle instruction.`,
                  ok: 'Interrompre',
                },
              )
            }
          >
            ⏸ Interrompre
          </button>
        )}
        {caps.resume && (
          <button className="btn sm" disabled={busy} onClick={() => run({ type: 'resume', agentId: a.id })}>
            ▶ Reprendre dans l’app
          </button>
        )}
        {caps.resume && a.kind === 'session' && (
          <button className="btn sm" disabled={busy} onClick={() => run({ type: 'resumeInTerminal', agentId: a.id })}>
            ▶ Reprendre dans un terminal
          </button>
        )}
        {caps.openTerminal && (
          <button className="btn sm" disabled={busy} onClick={() => run({ type: 'openTerminal', agentId: a.id })}>
            ⌨ Terminal
          </button>
        )}
        {caps.openFolder && (
          <button className="btn sm" disabled={busy} onClick={() => run({ type: 'openFolder', agentId: a.id })}>
            📁 Dossier
          </button>
        )}
        {caps.stop && (
          <button
            className="btn sm danger"
            disabled={busy}
            onClick={() => run({ type: 'stop', agentId: a.id }, { title: 'Arrêter l’agent ?', body: stopBody, ok: 'Arrêter' })}
          >
            ■ Arrêter
          </button>
        )}
      </div>
      {unavailable.length > 0 && (
        <details className="unavail">
          <summary>
            {unavailable.length} action{unavailable.length > 1 ? 's' : ''} indisponible{unavailable.length > 1 ? 's' : ''} pour cet agent
          </summary>
          <ul>
            {unavailable.map((k) => (
              <li key={k}>
                <b>{ACTION_LABEL[k]}</b> : {caps.reasons[k]}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Sec>
  );
}

function Console({ a }: { a: UIAgent }) {
  const lines = useStore((s) => s.consoles.get(a.id));
  const [initial, setInitial] = useState<typeof lines>([]);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    api.getConsole(a.id).then(setInitial);
  }, [a.id]);
  const all = lines && lines.length >= (initial?.length ?? 0) ? lines : (initial ?? []);
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [all.length]);
  if (!a.managed && !all.length)
    return (
      <div className="empty" style={{ textAlign: 'left' }}>
        <b>Pas de terminal intégré pour cette session</b>
        Elle a été lancée hors de l’app, qui n’a donc pas accès à son terminal interactif. Les événements réellement observés (outils, résultats, erreurs) sont
        dans l’onglet Journal. Pour un terminal pilotable, lancez une session avec « Nouvelle session ».
      </div>
    );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: 10 }}>
      <div className="console" ref={box}>
        {all.map((l, i) => (
          <div key={i} className={l.stream}>
            <span style={{ opacity: 0.4 }}>{fmtTime(l.ts)} </span>
            {l.text}
          </div>
        ))}
        {!all.length && <span style={{ opacity: 0.5 }}>En attente de sortie…</span>}
      </div>
      <Controls a={a} />
    </div>
  );
}

export function AgentPanel({ a }: { a: UIAgent }) {
  const agents = useStore((s) => s.agents);
  const [tab, setTab] = useState<'sheet' | 'log' | 'console'>('sheet');
  const now = useNow();
  useEffect(() => {
    setTab(a.managed ? 'console' : 'sheet');
  }, [a.id]);
  const parent = a.parentId ? agents.get(a.parentId) : undefined;
  const children = [...agents.values()].filter((x) => x.parentId === a.id);
  const end = a.endedAt ?? (a.status === 'done' || a.status === 'lost' ? a.lastEventAt : now);
  const tok = a.tokens.value;
  const doneTasks = a.tasks.filter((t) => t.status === 'done').length;
  const cc = chatCost(a, agents.values());

  return (
    <>
      <div className="hero" style={{ '--c': a.color } as CSSProperties}>
        <div className="hero-top">
          <Avatar a={a} className="avatar" />
          <div className="grow">
            <input
              className="name"
              defaultValue={a.name}
              key={a.id + a.name}
              title="Renommer (conservé après redémarrage)"
              onBlur={(e) => e.target.value !== a.name && api.updateAgentMeta(a.id, { name: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
            <div className="row wrap" style={{ gap: 6, marginTop: 4 }}>
              <StatusPill status={a.status} src={a.statusSource} note={a.statusNote} />
              <span className="muted small">{a.role}</span>
              {a.managed && (
                <span className="pill" style={{ '--c': '#ffc935' } as CSSProperties} title="Lancée et contrôlée par l’app">
                  pilotée
                </span>
              )}
              {a.demo && <span className="badge-demo">DÉMO</span>}
            </div>
          </div>
          <input type="color" value={a.color} title="Couleur de l’agent" onChange={(e) => api.updateAgentMeta(a.id, { color: e.target.value })} />
          <button className="btn ghost sm icon" onClick={() => select(null)} title="Fermer (Échap)">
            ✕
          </button>
        </div>
        <div className="now">
          <div className="ic">
            <ActivityIcon
              name={
                a.status === 'working' ? a.activity : a.status === 'lost' ? 'lost' : a.status === 'done' ? 'done' : a.status === 'waiting' ? 'waiting' : 'idle'
              }
            />
          </div>
          <div className="grow">
            <div className="row between">
              <b>
                {a.status === 'working'
                  ? ACTIVITY_LABEL[a.activity]
                  : a.status === 'idle'
                    ? 'En pause, attend une demande'
                    : a.status === 'done'
                      ? 'Travail terminé'
                      : a.status === 'lost'
                        ? 'Processus perdu'
                        : a.status === 'waiting'
                          ? 'Attend votre intervention'
                          : 'État inconnu'}
              </b>
              <span className="faint tiny mono" title={fmtDateTime(a.lastEventAt)}>
                il y a {ago(a.lastEventAt, now)}
              </span>
            </div>
            <div className="mono small ellipsis muted" title={a.lastAction.value ?? ''}>
              {a.lastAction.value ?? '—'}
            </div>
          </div>
        </div>
        {a.statusNote && a.statusSource !== 'observed' && (
          <div className="faint tiny" style={{ marginTop: 6 }}>
            {a.statusNote}
          </div>
        )}
        <div className="tiles">
          <div className="tile" title={a.tokens.note}>
            <div className="v">{tok ? fmtNum(tok.output) : '—'}</div>
            <div className="l">tokens générés</div>
          </div>
          <div
            className="tile"
            title={
              cc.total !== null
                ? `Estimation au tarif API : tokens × prix public de chaque modèle${cc.subCount ? `, sous-agents inclus (${cc.subCount})` : ''}`
                : 'Aucune donnée de tokens'
            }
          >
            <div className="v">{cc.total !== null ? `≈ ${fmtUSD(cc.total)}` : '—'}</div>
            <div className="l">coût estimé</div>
          </div>
          <div className="tile">
            <div className="v">{a.actionCount}</div>
            <div className="l">actions</div>
          </div>
          <div className="tile" title="Du premier au dernier événement observé">
            <div className="v">{fmtDur(end - a.startedAt)}</div>
            <div className="l">durée</div>
          </div>
        </div>
      </div>
      <div className="ptabs">
        <button className={tab === 'sheet' ? 'on' : ''} onClick={() => setTab('sheet')}>
          Fiche
        </button>
        <button className={tab === 'log' ? 'on' : ''} onClick={() => setTab('log')}>
          Journal
        </button>
        <button className={tab === 'console' ? 'on' : ''} onClick={() => setTab('console')}>
          Terminal {a.managed && <span className="count">live</span>}
        </button>
      </div>
      {tab === 'log' && <EventLog agentId={a.id} compact />}
      {tab === 'console' && (
        <div className="pbody" style={{ display: 'flex', flexDirection: 'column' }}>
          <Console a={a} />
        </div>
      )}
      {tab === 'sheet' && (
        <div className="pbody">
          <Controls a={a} />
          <Sec
            title="Tâche"
            extra={
              <span className="faint tiny" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>
                {doneTasks}/{a.tasks.length} terminées
              </span>
            }
          >
            <div className="kv">
              <span>En cours</span>
              <TV v={a.currentTask} />
              <span>Outil</span>
              <TV v={a.lastTool} />
              <span>Progression</span>
              <span>
                {a.progress && a.progress.value !== null ? (
                  <span title={a.progress.note}>
                    {Math.round(a.progress.value * 100)} % <span className="faint tiny">{a.progress.note}</span>
                    <div className="progress">
                      <div style={{ width: `${Math.round(a.progress.value * 100)}%` }} />
                    </div>
                  </span>
                ) : (
                  <span className="na" title="L’agent n’utilise pas de liste de tâches : progression non mesurable">
                    non mesurable
                  </span>
                )}
              </span>
            </div>
            {a.todos && a.todos.length > 0 && (
              <ul className="list" style={{ marginTop: 8 }}>
                {a.todos.map((t, i) => (
                  <li key={i} className={t.status === 'completed' ? 'faint' : ''}>
                    {t.status === 'completed' ? '☑' : t.status === 'in_progress' ? '▶' : '☐'} {t.content}
                  </li>
                ))}
              </ul>
            )}
            {a.tasks.length > 0 && (
              <>
                <div className="label" style={{ margin: '12px 0 4px' }}>
                  Historique
                </div>
                <ul className="list">
                  {a.tasks.slice(0, 12).map((t) => (
                    <li key={t.id}>
                      <span className={t.status === 'error' ? 'err' : t.status === 'done' ? 'ok' : ''}>
                        {t.status === 'running' ? '▶' : t.status === 'done' ? '✔' : '✖'}
                      </span>{' '}
                      {t.title}
                      <span className="faint">
                        {' '}
                        · {fmtTime(t.startedAt)}
                        {t.endedAt ? ` · ${fmtDur(t.endedAt - t.startedAt)}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Sec>
          <CostSection a={a} />
          <Sec
            title="Développement"
            extra={
              a.errors.length ? (
                <span className="pill" style={{ '--c': '#ff6b6b', textTransform: 'none', letterSpacing: 0 } as CSSProperties}>
                  {a.errors.length} erreur{a.errors.length > 1 ? 's' : ''}
                </span>
              ) : null
            }
          >
            <Collapsible title="Fichiers modifiés" items={a.filesModified} />
            <Collapsible title="Fichiers consultés" items={a.filesRead} />
            <Collapsible title="Commandes" items={a.commands.map((c) => `${c.isError ? '✖ ' : c.isError === false ? '✔ ' : '… '}${c.cmd}`)} />
            <Collapsible
              title="Tests"
              items={a.testRuns.map((t) => `${t.passed ? '✔ réussi' : '✖ échec'} · ${fmtTime(t.ts)} · ${t.cmd}`)}
              note="réussite = code de sortie 0"
            />
            <Collapsible title="Erreurs" items={a.errors.map((e) => `${fmtTime(e.ts)} ${e.tool ? `[${e.tool}] ` : ''}${e.message}`)} danger />
          </Sec>
          <Sec title="Consommation & ressources" open={false}>
            <div className="kv">
              <span>Modèle</span>
              <TV v={a.model} />
              <span>Tokens entrée</span>
              <TV v={a.tokens} fmt={(t) => `${fmtNum(t.input + t.cacheRead + t.cacheCreation)} (dont cache lu ${fmtNum(t.cacheRead)})`} />
              <span>Tokens sortie</span>
              <TV v={a.tokens} fmt={(t) => fmtNum(t.output)} />
              <span>PID</span>
              <TV v={a.pid} />
              <span>CPU</span>
              <TV v={a.cpu} fmt={(v) => `${v} %`} />
              <span>RAM</span>
              <TV v={a.memoryMB} fmt={(v) => `${v} Mo`} />
            </div>
          </Sec>
          <Sec title="Identité" open={false}>
            <div className="kv">
              <span>Type</span>
              <span>{a.kind === 'subagent' ? 'Sous-agent' : 'Session (agent principal)'}</span>
              <span>Projet</span>
              <span>{a.project}</span>
              <span>Dossier</span>
              <span className="mono small ellipsis" title={a.cwd}>
                {a.cwd || <span className="na">inconnu</span>}
              </span>
              <span>Session</span>
              <span
                className="mono small ellipsis"
                style={{ cursor: 'copy' }}
                title="Cliquer pour copier"
                onClick={async () => (await copyText(a.sessionId)) && toast({ type: 'task_end', level: 'success', title: 'Copié', body: a.sessionId })}
              >
                {a.sessionId}
              </span>
              {a.gitBranch && (
                <>
                  <span>Branche git</span>
                  <span>{a.gitBranch}</span>
                </>
              )}
              {a.entrypoint && (
                <>
                  <span>Lancement</span>
                  <span>{a.entrypoint}</span>
                </>
              )}
              <span>Démarrage</span>
              <span>{fmtDateTime(a.startedAt)}</span>
              <span>Statut</span>
              <span>
                {a.statusNote ?? '—'} <Prov src={a.statusSource} />
              </span>
            </div>
          </Sec>
          <Sec
            title={`Relations${children.length ? ` · ${children.length} sous-agent${children.length > 1 ? 's' : ''}` : ''}`}
            open={!!parent || children.length > 0}
          >
            {parent && (
              <div className="row small" style={{ marginBottom: 6 }}>
                Parent : <AgentLink a={parent} />
              </div>
            )}
            {children.length ? (
              <ul className="list">
                {children.map((c) => (
                  <li key={c.id} className="row">
                    <AgentLink a={c} /> <span className="faint grow">{c.role}</span> <StatusPill status={c.status} />
                  </li>
                ))}
              </ul>
            ) : (
              !parent && <div className="faint small">Aucun sous-agent observé</div>
            )}
          </Sec>
          <button className="btn sm ghost" onClick={() => setView('logs')}>
            Voir tous les journaux →
          </button>
        </div>
      )}
    </>
  );
}

function AgentLink({ a }: { a: UIAgent }) {
  return (
    <a onClick={() => select(a.id)} className="row" style={{ gap: 5, display: 'inline-flex' }}>
      <Avatar a={a} style={{ width: 10, height: 15 }} />
      {a.name}
    </a>
  );
}

function Collapsible({ title, items, note, danger }: { title: string; items: string[]; note?: string; danger?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ padding: '3px 0' }}>
      <a className={danger && items.length ? 'err' : ''} style={{ color: items.length ? undefined : 'var(--fg3)' }} onClick={() => setOpen(!open)}>
        {open ? '▾' : '▸'} {title} <span className="mono">({items.length})</span>
      </a>
      {note && <span className="faint tiny"> · {note}</span>}
      {open && (
        <ul className="list mono" style={{ maxHeight: 220, overflow: 'auto', marginTop: 4 }}>
          {items.slice(0, 200).map((x, i) => (
            <li key={i}>{x}</li>
          ))}
          {!items.length && <li className="na">Rien d’observé</li>}
        </ul>
      )}
    </div>
  );
}

function CostSection({ a }: { a: UIAgent }) {
  const agents = useStore((s) => s.agents);
  const cc = chatCost(a, agents.values());
  const rows = Object.entries(a.costByModel ?? {}).sort((x, y) => (y[1].usd ?? 0) - (x[1].usd ?? 0));
  return (
    <Sec
      title="Coût"
      extra={
        cc.total !== null ? (
          <span className="mono" style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--acc)' }}>
            ≈ {usd(cc.total)}
          </span>
        ) : null
      }
    >
      {rows.length ? (
        <table className="small" style={{ marginBottom: 8 }}>
          <thead>
            <tr>
              <th>Modèle</th>
              <th style={{ textAlign: 'right' }}>Appels</th>
              <th style={{ textAlign: 'right' }}>Entrée</th>
              <th style={{ textAlign: 'right' }}>Sortie</th>
              <th style={{ textAlign: 'right' }}>Coût</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([m, v]) => (
              <tr key={m} title={`Cache lu : ${fmtNum(v.cacheRead)} · cache écrit : ${fmtNum(v.cacheWrite)} tokens`}>
                <td>{modelLabel(m)}</td>
                <td className="mono" style={{ textAlign: 'right' }}>
                  {v.calls}
                </td>
                <td className="mono" style={{ textAlign: 'right' }}>
                  {fmtNum(v.input + v.cacheRead + v.cacheWrite)}
                </td>
                <td className="mono" style={{ textAlign: 'right' }}>
                  {fmtNum(v.output)}
                </td>
                <td className="mono" style={{ textAlign: 'right' }}>
                  {v.usd === null ? (
                    <span className="na" title="Modèle absent de la grille tarifaire">
                      tarif inconnu
                    </span>
                  ) : (
                    usd(v.usd)
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="faint small" style={{ marginBottom: 8 }}>
          Aucune réponse de modèle observée pour l’instant.
        </div>
      )}
      <div className="kv">
        <span>Cet agent</span>
        <span>
          {cc.own !== null ? (
            <>
              ≈ {usd(cc.own)} <Prov src="inferred" note={a.estimatedCost?.note} />
            </>
          ) : (
            <span className="na">indisponible</span>
          )}
        </span>
        {cc.subCount > 0 && (
          <>
            <span>Sous-agents ({cc.subCount})</span>
            <span>
              ≈ {usd(cc.subs)} <Prov src="inferred" />
            </span>
          </>
        )}
        {cc.subCount > 0 && (
          <>
            <span>
              <b>Total du chat</b>
            </span>
            <span>
              <b>≈ {usd(cc.total ?? 0)}</b>
            </span>
          </>
        )}
        {a.kind === 'session' && (
          <>
            <span>Relevé Claude Code</span>
            <span>
              {a.cost.value !== null ? (
                <>
                  {usd(a.cost.value)}{' '}
                  <Prov
                    src="observed"
                    note="Relevé cost-state écrit par Claude Code : ponctuel, il peut dater d’avant les derniers échanges, et ne couvre que le processus en cours (pas l’historique avant une reprise)."
                  />
                </>
              ) : (
                <span className="na" title={a.cost.note}>
                  pas encore écrit
                </span>
              )}
            </span>
          </>
        )}
      </div>
      <div className="faint tiny" style={{ marginTop: 8 }}>
        Tarif API public par modèle ({PRICES_AS_OF}) appliqué aux tokens des transcripts (entrée, sortie, cache lu et écrit). Avec un abonnement claude.ai,
        c’est un équivalent API, pas le montant facturé.
      </div>
    </Sec>
  );
}
