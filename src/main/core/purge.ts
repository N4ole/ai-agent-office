// History purge requested from the settings screen.

import type { ControlResult } from '../../shared/types';
import type { OfficeDB } from '../db/database';
import type { AgentManager } from './agentManager';

export function purgeHistory(db: OfficeDB, manager: AgentManager, days: number | 'all'): ControlResult {
  if (days === 'all') {
    db.purgeAll();
    return { ok: true, message: 'Historique supprimé (les sessions actives réapparaîtront au prochain événement)' };
  }
  const r = db.purgeOlderThan(Number(days));
  for (const [id, a] of manager.agents) if (a.lastEventAt < Date.now() - Number(days) * 86_400_000 && a.status === 'done') manager.agents.delete(id);
  return { ok: true, message: `${r.events} événements et ${r.agents} agents supprimés` };
}
