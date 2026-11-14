import { useEffect, useState } from 'react';
import type { NotificationType, SetupCheck, Settings } from '../../shared/types';
import { api } from '../api';
import { store, toast, useStore } from '../store';
import { Switch, confirmAction } from '../ui';
import { PRICES, PRICES_AS_OF, PRICES_SOURCE } from '../../shared/pricing';

const fmtPrice = (v: number) => `${v < 1 ? v.toFixed(v < 0.1 ? 3 : 2) : v % 1 ? v.toFixed(2) : v} $`;

export const NOTIF_LABEL: Record<NotificationType, string> = {
  agent_new: 'Nouvel agent',
  subagent_new: 'Nouveau sous-agent',
  task_start: 'Début de tâche',
  task_end: 'Fin de tâche',
  error: 'Erreur d’exécution',
  blocked: 'Agent bloqué / en attente',
  session_lost: 'Session interrompue',
  resources: 'Ressources élevées',
  cost: 'Seuil de coût dépassé',
  quota: 'Quota bientôt atteint (80 % / 95 %)',
};

export function Checks({ checks }: { checks: SetupCheck[] }) {
  if (!checks.length) return <div className="faint">Vérification…</div>;
  return (
    <div>
      {checks.map((c) => (
        <div key={c.id} className="check">
          <span className={`st ${c.ok ? 'y' : 'n'}`}>{c.ok ? '✓' : '!'}</span>
          <div>
            <b>{c.label}</b>
            <div className="faint small">{c.detail}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

const SECTIONS = [
  { id: 'conn', label: 'Connexion à Claude Code' },
  { id: 'hooks', label: 'Hooks optionnels' },
  { id: 'notif', label: 'Notifications & seuils' },
  { id: 'prices', label: 'Tarifs des modèles' },
  { id: 'data', label: 'Données & confidentialité' },
  { id: 'look', label: 'Apparence & démo' },
];

export function SettingsView() {
  const settings = useStore((s) => s.settings)!;
  const [draft, setDraft] = useState<Settings>(settings);
  const [checks, setChecks] = useState<SetupCheck[]>([]);
  const [patterns, setPatterns] = useState(settings.redactPatterns.join('\n'));
  const [sec, setSec] = useState('conn');
  const [light, setLight] = useState(document.documentElement.dataset.theme === 'light');
  useEffect(() => setDraft(settings), [settings]);
  const refresh = () => api.setupChecks().then(setChecks);
  useEffect(() => {
    refresh();
  }, []);

  const save = async (patch: Partial<Settings>, quiet = false) => {
    const s = await api.setSettings(patch);
    store.set({ settings: s });
    if (!quiet) toast({ type: 'task_end', level: 'success', title: 'Paramètres enregistrés', body: '' });
  };
  const num = (k: keyof Settings, label: string, hint?: string, unit?: string) => (
    <div className="field">
      <label>{label}</label>
      <div className="row">
        <input
          type="number"
          style={{ width: 120 }}
          value={draft[k] as number}
          onChange={(e) => setDraft({ ...draft, [k]: Number(e.target.value) })}
          onBlur={() => draft[k] !== settings[k] && save({ [k]: draft[k] } as Partial<Settings>)}
        />
        {unit && <span className="faint">{unit}</span>}
      </div>
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
  const hooksOk = checks.find((c) => c.id === 'hooks')?.ok;

  return (
    <div className="page" style={{ display: 'grid', gridTemplateColumns: '210px 1fr', gap: 18, alignItems: 'start' }}>
      <nav className="settings-nav">
        <div className="label" style={{ padding: '0 10px 6px' }}>
          Paramètres
        </div>
        {SECTIONS.map((s) => (
          <button key={s.id} className={sec === s.id ? 'on' : ''} onClick={() => setSec(s.id)}>
            {s.label}
          </button>
        ))}
      </nav>
      <div style={{ maxWidth: 760 }}>
        {sec === 'conn' && (
          <div className="card">
            <div className="card-title">
              Vérification de l’environnement{' '}
              <button className="btn sm ghost" style={{ marginLeft: 'auto' }} onClick={refresh}>
                ↻ Revérifier
              </button>
            </div>
            <Checks checks={checks} />
            <div style={{ height: 14 }} />
            <div className="field">
              <label>Exécutable Claude Code</label>
              <input
                value={draft.claudePath}
                onChange={(e) => setDraft({ ...draft, claudePath: e.target.value })}
                onBlur={() => draft.claudePath !== settings.claudePath && save({ claudePath: draft.claudePath }).then(refresh)}
              />
              <span className="hint">« claude » s’il est dans le PATH, sinon le chemin complet de claude.exe.</span>
            </div>
            <div className="field">
              <label>Dossier de données Claude Code</label>
              <input
                value={draft.claudeHome}
                onChange={(e) => setDraft({ ...draft, claudeHome: e.target.value })}
                onBlur={() => draft.claudeHome !== settings.claudeHome && save({ claudeHome: draft.claudeHome }).then(refresh)}
              />
              <span className="hint">
                Par défaut ~/.claude (ou CLAUDE_CONFIG_DIR). Redémarrez l’app après modification. Lecture seule : l’app ne modifie jamais ces fichiers.
              </span>
            </div>
            {num('scanDays', 'Sessions chargées au démarrage', 'Transcripts modifiés pendant cette période.', 'jours')}
          </div>
        )}
        {sec === 'hooks' && (
          <div className="card">
            <div className="card-title">
              Hooks optionnels {hooksOk ? <span className="ok small">· installés</span> : <span className="faint small">· non installés</span>}
            </div>
            <p className="muted" style={{ marginTop: 0 }}>
              Sans hooks, l’app observe déjà tout via les fichiers de Claude Code. Les hooks ajoutent un signal fiable quand un agent
              <b> attend votre autorisation</b>, et la raison exacte de fin des sessions.
            </p>
            <ul className="muted small">
              <li>Ajoute 3 entrées marquées « ai-agent-office » dans ~/.claude/settings.json (une sauvegarde est créée).</li>
              <li>Nécessite Node.js. Actifs pour les nouvelles sessions Claude Code.</li>
              <li>Ne bloquent jamais Claude Code (2 s maximum, erreurs ignorées).</li>
            </ul>
            <div className="row">
              <button
                className="btn primary"
                disabled={hooksOk}
                onClick={async () => {
                  if (
                    !(await confirmAction(
                      'Installer les hooks ?',
                      '~/.claude/settings.json sera modifié (sauvegarde .ai-agent-office.bak créée). Effet sur les nouvelles sessions.',
                      'Installer',
                      false,
                    ))
                  )
                    return;
                  const r = await api.installHooks();
                  toast({ type: 'task_end', level: r.ok ? 'success' : 'error', title: 'Hooks', body: r.message });
                  refresh();
                }}
              >
                Installer
              </button>
              <button
                className="btn"
                disabled={!hooksOk}
                onClick={async () => {
                  if (!(await confirmAction('Retirer les hooks ?', 'Seules les entrées ajoutées par AI Agent Office seront retirées.', 'Retirer'))) return;
                  const r = await api.uninstallHooks();
                  toast({ type: 'task_end', level: r.ok ? 'success' : 'error', title: 'Hooks', body: r.message });
                  refresh();
                }}
              >
                Retirer
              </button>
            </div>
          </div>
        )}
        {sec === 'notif' && (
          <>
            <div className="card">
              <div className="card-title">Notifications</div>
              <table>
                <thead>
                  <tr>
                    <th>Événement</th>
                    <th style={{ width: 110 }}>Dans l’app</th>
                    <th style={{ width: 110 }}>Windows</th>
                  </tr>
                </thead>
                <tbody>
                  {(Object.keys(NOTIF_LABEL) as NotificationType[]).map((t) => (
                    <tr key={t}>
                      <td>{NOTIF_LABEL[t]}</td>
                      {(['app', 'os'] as const).map((ch) => (
                        <td key={ch}>
                          <Switch
                            checked={draft.notifications[t][ch]}
                            onChange={(v) => save({ notifications: { ...draft.notifications, [t]: { ...draft.notifications[t], [ch]: v } } }, true)}
                          >
                            {''}
                          </Switch>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card">
              <div className="card-title">Seuils d’alerte</div>
              <div className="grid2" style={{ gap: 4 }}>
                {num('costThresholdUSD', 'Coût par session', '0 = désactivé', '$')}
                {num('stuckMinutes', 'Agent « bloqué » après', 'Sans aucun événement (déduction).', 'min')}
                {num('cpuThresholdPct', 'CPU d’un processus', undefined, '%')}
                {num('memThresholdMB', 'RAM d’un processus', undefined, 'Mo')}
                {num(
                  'quotaRefreshMin',
                  'Vérification des quotas toutes les',
                  'Commande /usage de Claude Code : sans coût, aucun token. 0 = manuelle uniquement.',
                  'min',
                )}
              </div>
            </div>
          </>
        )}
        {sec === 'prices' && (
          <div className="card">
            <div className="card-title">Tarifs utilisés pour l’estimation</div>
            <p className="muted small" style={{ marginTop: 0 }}>
              Coût estimé = tokens de chaque réponse (lus dans les transcripts) × tarif API public du modèle qui l’a produite. Vérifié sur vos sessions :
              l’estimation retombe au centime près sur le relevé écrit par Claude Code. Avec un abonnement claude.ai (Pro, Max…), c’est un équivalent API, pas
              ce qui vous est facturé.
            </p>
            <table className="small">
              <thead>
                <tr>
                  <th>Modèle</th>
                  <th style={{ textAlign: 'right' }}>Entrée</th>
                  <th style={{ textAlign: 'right' }}>Cache écrit 5 min</th>
                  <th style={{ textAlign: 'right' }}>Cache écrit 1 h</th>
                  <th style={{ textAlign: 'right' }}>Cache lu</th>
                  <th style={{ textAlign: 'right' }}>Sortie</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(PRICES).map(([id, p]) => (
                  <tr key={id} title={id}>
                    <td>
                      {p.label}
                      {p.longPrompt && <span className="faint tiny"> · prompts ≤ {p.longPrompt.above / 1000}K</span>}
                    </td>
                    {[p.input, p.cacheWrite5m, p.cacheWrite1h, p.cacheRead, p.output].map((v, i) => (
                      <td key={i} className="mono" style={{ textAlign: 'right' }}>
                        {fmtPrice(v)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="faint tiny" style={{ marginTop: 8 }}>
              En $ par million de tokens · source : {PRICES_SOURCE} ({PRICES_AS_OF}). Haiku 5.5 passe à 0,50 $ / 2,50 $ au-delà de 100K tokens de prompt. Les
              modèles absents de cette grille sont signalés « tarif inconnu » au lieu d’être estimés.
            </div>
          </div>
        )}
        {sec === 'data' && (
          <div className="card">
            <div className="card-title">Données et confidentialité</div>
            <p className="muted" style={{ marginTop: 0 }}>
              Tout reste sur cet ordinateur. Clés API, tokens, mots de passe et clés privées sont masqués avant tout affichage, enregistrement ou export.
            </p>
            {num('retentionDays', 'Conservation de l’historique', 'Les données plus anciennes sont supprimées au démarrage.', 'jours')}
            <div className="field">
              <label>Masquages supplémentaires (une expression régulière par ligne)</label>
              <textarea
                rows={3}
                className="mono"
                value={patterns}
                placeholder="ex. CLIENT-\d+"
                onChange={(e) => setPatterns(e.target.value)}
                onBlur={() => {
                  const list = patterns
                    .split('\n')
                    .map((x) => x.trim())
                    .filter(Boolean);
                  const bad = list.filter((p) => {
                    try {
                      new RegExp(p);
                      return false;
                    } catch {
                      return true;
                    }
                  });
                  if (bad.length) return toast({ type: 'error', level: 'error', title: 'Expression invalide', body: bad.join(', ') });
                  save({ redactPatterns: list });
                }}
              />
            </div>
            <div className="row wrap">
              <button
                className="btn"
                onClick={async () => {
                  const r = await api.exportData();
                  if (r.ok) toast({ type: 'task_end', level: 'success', title: 'Export', body: r.message });
                }}
              >
                Exporter tout (JSON)
              </button>
              <button
                className="btn"
                onClick={async () => {
                  if (
                    !(await confirmAction(
                      'Supprimer les anciennes données ?',
                      `Événements et sessions terminées de plus de ${draft.retentionDays} jours.`,
                      'Supprimer',
                    ))
                  )
                    return;
                  const r = await api.purge(draft.retentionDays);
                  toast({ type: 'task_end', level: 'success', title: 'Nettoyage', body: r.message });
                }}
              >
                Purger l’ancien
              </button>
              <button
                className="btn danger"
                onClick={async () => {
                  if (
                    !(await confirmAction(
                      'Tout effacer ?',
                      'Tout l’historique enregistré par AI Agent Office sera supprimé. Les fichiers de Claude Code ne sont jamais modifiés.',
                      'Tout effacer',
                    ))
                  )
                    return;
                  const r = await api.purge('all');
                  toast({ type: 'task_end', level: 'success', title: 'Nettoyage', body: r.message });
                }}
              >
                Tout effacer
              </button>
            </div>
          </div>
        )}
        {sec === 'look' && (
          <div className="card">
            <div className="card-title">Apparence</div>
            <Switch
              checked={light}
              onChange={(v) => {
                setLight(v);
                document.documentElement.dataset.theme = v ? 'light' : 'dark';
                try {
                  localStorage.setItem('theme', v ? 'light' : 'dark');
                } catch {
                  /* ignore */
                }
              }}
            >
              Thème clair <span className="faint">(sombre par défaut)</span>
            </Switch>
            <div className="faint small" style={{ marginTop: 4 }}>
              L’éclairage du bureau suit l’heure réelle : jour, crépuscule, nuit.
            </div>
            <div className="card-title" style={{ marginTop: 18 }}>
              Mode démonstration
            </div>
            <Switch checked={draft.demoMode} onChange={(v) => save({ demoMode: v })}>
              Afficher des agents fictifs
            </Switch>
            <div className="faint small" style={{ marginTop: 4 }}>
              Badge DÉMO, jamais enregistrés, aucune commande réelle. Retirés dès que vous désactivez l’option.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
