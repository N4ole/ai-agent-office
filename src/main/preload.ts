// Exposes a narrow, typed API to the UI. No Node access in the renderer.
import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/types';

const invoke = (ch: string, ...args: unknown[]) => ipcRenderer.invoke(ch, ...args);
const on = (ch: string) => (cb: (payload: any) => void) => {
  const h = (_e: unknown, p: any) => cb(p);
  ipcRenderer.on(ch, h);
  return () => ipcRenderer.removeListener(ch, h);
};

const api = {
  snapshot: () => invoke(IPC.snapshot),
  getEvents: (q: unknown) => invoke(IPC.getEvents, q),
  getSessions: () => invoke(IPC.getSessions),
  usageByDay: (days: number) => invoke(IPC.usageByDay, days),
  getConsole: (agentId: string) => invoke(IPC.getConsole, agentId),
  getSettings: () => invoke(IPC.getSettings),
  setSettings: (patch: unknown) => invoke(IPC.setSettings, patch),
  capabilities: (agentId: string) => invoke(IPC.capabilities, agentId),
  control: (action: unknown) => invoke(IPC.control, action),
  launch: (opts: unknown) => invoke(IPC.launch, opts),
  setupChecks: () => invoke(IPC.setupChecks),
  health: () => invoke(IPC.health),
  getQuota: () => invoke(IPC.getQuota),
  refreshQuota: () => invoke(IPC.refreshQuota),
  onQuota: on(IPC.quota),
  installHooks: () => invoke(IPC.installHooks),
  uninstallHooks: () => invoke(IPC.uninstallHooks),
  exportData: (payload?: unknown) => invoke(IPC.exportData, payload),
  purge: (days: number | 'all') => invoke(IPC.purge, days),
  markRead: () => invoke(IPC.markRead),
  pickFolder: () => invoke(IPC.pickFolder),
  updateAgentMeta: (id: string, meta: unknown) => invoke(IPC.updateAgentMeta, id, meta),
  onAgents: on(IPC.agentsPatch),
  onEvents: on(IPC.events),
  onNotification: on(IPC.notification),
  onConsole: on(IPC.console),
  onLog: on(IPC.log),
  onSelectAgent: on('office:select-agent'),
  onHistoryPurged: on(IPC.historyPurged),
};

contextBridge.exposeInMainWorld('office', api);
export type OfficeApi = typeof api;
