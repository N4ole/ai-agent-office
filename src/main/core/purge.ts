// History purge requested from the settings screen (R-01, R-08).
// The database, the manager's memory and the UI are purged together, and a cutoff date is kept
// so that transcripts already read are not imported again.

import type { ControlResult } from '../../shared/types';
import type { OfficeDB } from '../db/database';
import type { AgentManager } from './agentManager';

export interface PurgeResult extends ControlResult {
  /** Epoch ms: everything before it was removed (0 when nothing was done). */
  before: number;
}

export function purgeHistory(db: OfficeDB, manager: AgentManager, days: number | 'all', now = Date.now()): PurgeResult {
  if (days === 'all') {
    const n = manager.clearHistory();
    db.purgeAll(now);
    return {
      ok: true,
      before: now,
      message: `Historique supprimé (${n} agent${n > 1 ? 's' : ''} retiré${n > 1 ? 's' : ''} du bureau). Les transcripts déjà lus ne seront pas réimportés ; une session encore active réapparaîtra à sa prochaine activité.`,
    };
  }
  const d = Number(days);
  if (!Number.isFinite(d) || d < 1) return { ok: false, before: 0, message: 'Durée de conservation invalide' };
  const before = now - d * 86_400_000;
  manager.purgeBefore(before);
  const r = db.purgeOlderThan(d, { now, remember: true });
  return { ok: true, before, message: `${r.events} événements et ${r.agents} agents de plus de ${d} jours supprimés` };
}
