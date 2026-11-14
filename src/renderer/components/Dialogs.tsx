import { useEffect, useState } from 'react';
import type { LaunchOptions, SetupCheck } from '../../shared/types';
import { api } from '../api';
import { select, store, toast } from '../store';
import { Modal, confirmAction } from '../ui';
import { Checks } from '../views/SettingsView';

const PERMS: { id: NonNullable<LaunchOptions['permissionMode']>; label: string; help: string }[] = [
  {
    id: 'acceptEdits',
    label: 'Modifier les fichiers',
    help: 'Recommandé. Les modifications de fichiers sont acceptées ; les commandes non autorisées sont refusées.',
  },
  { id: 'plan', label: 'Plan seulement', help: 'L’agent analyse et propose, sans rien modifier.' },
  {
    id: 'default',
    label: 'Lecture seule',
    help: 'En mode piloté, Claude Code ne peut pas vous demander d’autorisation : tout outil qui en exige une est refusé.',
  },
  {
    id: 'bypassPermissions',
    label: 'Tout autoriser',
    help: 'DANGER : l’agent peut exécuter n’importe quelle commande sans confirmation. À réserver à un dossier isolé.',
  },
];

export function LaunchDialog({ onClose, cwd: initialCwd }: { onClose: () => void; cwd?: string }) {
  const [o, setO] = useState<LaunchOptions>({ cwd: initialCwd ?? '', prompt: '', model: '', permissionMode: 'acceptEdits', name: '' });
  const [busy, setBusy] = useState(false);
  const perm = PERMS.find((p) => p.id === o.permissionMode)!;
  const launch = async () => {
    if (
      o.permissionMode === 'bypassPermissions' &&
      !(await confirmAction('Tout autoriser ?', 'L’agent pourra exécuter n’importe quelle commande sans confirmation dans ce dossier.', 'Lancer quand même'))
    )
      return;
    setBusy(true);
    const r = await api.launch({ ...o, model: o.model || undefined, name: o.name || undefined });
    setBusy(false);
    toast({ type: r.ok ? 'agent_new' : 'error', level: r.ok ? 'success' : 'error', title: r.ok ? 'Session lancée' : 'Échec du lancement', body: r.message });
    if (r.ok) {
      const sid = /Session ([0-9a-f-]{36})/.exec(r.message)?.[1];
      if (sid) setTimeout(() => select(`cc:${sid}`), 400);
      onClose();
    }
  };
  return (
    <Modal title="Nouvelle session Claude Code" onClose={onClose}>
      <p className="muted small" style={{ marginTop: 0 }}>
        La session est lancée et pilotée par l’app : vous pourrez lui envoyer des instructions, l’interrompre, l’arrêter et suivre sa sortie en direct.
      </p>
      <div className="field">
        <label>Dossier de travail</label>
        <div className="row">
          <input className="grow" value={o.cwd} onChange={(e) => setO({ ...o, cwd: e.target.value })} placeholder="C:\chemin\du\projet" />
          <button
            className="btn"
            onClick={async () => {
              const p = await api.pickFolder();
              if (p) setO({ ...o, cwd: p });
            }}
          >
            Parcourir…
          </button>
        </div>
      </div>
      <div className="field">
        <label>Première instruction</label>
        <textarea
          rows={4}
          autoFocus
          value={o.prompt}
          onChange={(e) => setO({ ...o, prompt: e.target.value })}
          placeholder="Ex. : Lis le README et propose trois améliorations."
          onKeyDown={(e) => e.key === 'Enter' && e.ctrlKey && o.cwd && o.prompt?.trim() && launch()}
        />
      </div>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="field grow">
          <label>Nom (optionnel)</label>
          <input value={o.name} onChange={(e) => setO({ ...o, name: e.target.value })} placeholder="ex. Refonte UI" />
        </div>
        <div className="field" style={{ width: 150 }}>
          <label>Modèle</label>
          <select value={o.model} onChange={(e) => setO({ ...o, model: e.target.value })}>
            <option value="">Par défaut</option>
            <option value="opus">Opus</option>
            <option value="sonnet">Sonnet</option>
            <option value="haiku">Haiku</option>
          </select>
        </div>
      </div>
      <div className="field">
        <label>Autorisations</label>
        <div className="chips">
          {PERMS.map((p) => (
            <button
              key={p.id}
              className={`chip ${o.permissionMode === p.id ? 'on' : ''}`}
              style={p.id === 'bypassPermissions' && o.permissionMode === p.id ? { background: 'var(--err)', borderColor: 'var(--err)' } : undefined}
              onClick={() => setO({ ...o, permissionMode: p.id })}
            >
              {p.label}
            </button>
          ))}
        </div>
        <span className={`hint ${o.permissionMode === 'bypassPermissions' ? 'err' : ''}`}>{perm.help}</span>
      </div>
      <div className="modal-foot">
        <span className="faint tiny" style={{ marginRight: 'auto', alignSelf: 'center' }}>
          Ctrl+Entrée pour lancer
        </span>
        <button className="btn" onClick={onClose}>
          Annuler
        </button>
        <button className="btn primary" disabled={busy || !o.cwd || !o.prompt?.trim()} onClick={launch}>
          {busy ? 'Lancement…' : 'Lancer la session'}
        </button>
      </div>
    </Modal>
  );
}

export function SetupWizard({ onClose }: { onClose: () => void }) {
  const [checks, setChecks] = useState<SetupCheck[]>([]);
  useEffect(() => {
    api.setupChecks().then(setChecks);
  }, []);
  const finish = async (view?: 'settings') => {
    store.set({ settings: await api.setSettings({ setupDone: true }), ...(view ? { view } : {}) });
    onClose();
  };
  const critical = checks.filter((c) => ['claude', 'home'].includes(c.id) && !c.ok);
  return (
    <Modal
      title={
        <span className="row">
          <img src="./icon.png" width={22} height={22} style={{ imageRendering: 'pixelated', borderRadius: 4 }} alt="" /> Bienvenue dans AI Agent Office
        </span>
      }
      onClose={() => finish()}
      wide
    >
      <div className="grid2" style={{ gap: 20 }}>
        <div>
          <p style={{ marginTop: 0 }}>
            Chaque personnage du bureau est une <b>vraie session</b> ou un <b>vrai sous-agent</b> Claude Code. Les sessions lancées depuis n’importe quel
            terminal apparaissent toutes seules.
          </p>
          <p className="muted small">
            L’app lit, sans jamais les modifier, les fichiers que Claude Code écrit déjà : registre des sessions actives, transcripts et sous-agents.
          </p>
          <div className="col small" style={{ gap: 6, marginTop: 12 }}>
            <div>
              <span className="prov prov-obs">observé</span> lu tel quel dans les fichiers ou le processus
            </div>
            <div>
              <span className="prov prov-inf">déduit</span> conclusion de l’app, toujours signalée
            </div>
            <div>
              <span className="prov prov-na">indispo.</span> Claude Code ne fournit pas l’information
            </div>
          </div>
        </div>
        <div>
          <div className="label" style={{ marginBottom: 4 }}>
            Votre environnement
          </div>
          <Checks checks={checks} />
          {critical.length > 0 && <p className="err small">Claude Code n’a pas été trouvé : installez-le ou indiquez son chemin dans les paramètres.</p>}
        </div>
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={() => finish('settings')}>
          Paramètres
        </button>
        <button className="btn primary" onClick={() => finish()}>
          Ouvrir le bureau
        </button>
      </div>
    </Modal>
  );
}
