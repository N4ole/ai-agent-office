// Minimal external store (no extra dependency) fed by IPC pushes from the main process.
import { useSyncExternalStore } from 'react';
import type { AgentEvent, AppNotification, QuotaState, Settings } from '../shared/types';
import { api, type ConsoleLine, type UIAgent } from './api';

export type View = 'office' | 'dashboard' | 'logs' | 'history' | 'settings';

interface State {
  ready: boolean;
  agents: Map<string, UIAgent>;
  notifications: AppNotification[];
  toasts: AppNotification[];
  live: AgentEvent[];
  consoles: Map<string, ConsoleLine[]>;
  settings: Settings | null;
  selected: string | null;
  view: View;
  appLog: { level: string; msg: string; ts: number }[];
  quota: QuotaState | null;
  version: number;
}

let state: State = {
  ready: false,
  agents: new Map(),
  notifications: [],
  toasts: [],
  live: [],
  consoles: new Map(),
  settings: null,
  selected: null,
  view: 'office',
  appLog: [],
  quota: null,
  version: 0,
};
const subs = new Set<() => void>();
let scheduled = false;

function emit() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    state = { ...state, version: state.version + 1 };
    subs.forEach((s) => s());
  });
}

export const store = {
  get: () => state,
  set(patch: Partial<State>) {
    state = { ...state, ...patch };
    emit();
  },
  subscribe(cb: () => void) {
    subs.add(cb);
    return () => subs.delete(cb);
  },
};

export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(store.subscribe, () => sel(state));
}

export function select(id: string | null) {
  store.set({ selected: id });
}
export function setView(view: View) {
  store.set({ view });
}

export function toast(n: Omit<AppNotification, 'id' | 'ts'> & { id?: string }) {
  const full: AppNotification = { id: n.id ?? `t${Date.now()}${Math.random()}`, ts: Date.now(), ...n };
  store.set({ toasts: [...state.toasts, full].slice(-4) });
  setTimeout(() => store.set({ toasts: state.toasts.filter((t) => t.id !== full.id) }), 6000);
}

export function dismissToast(id: string) {
  store.set({ toasts: state.toasts.filter((t) => t.id !== id) });
}

export async function initStore() {
  const snap = await api.snapshot();
  state.agents = new Map(snap.agents.map((a) => [a.id, a]));
  state.notifications = snap.notifications;
  state.settings = snap.settings;
  state.quota = await api.getQuota();
  state.ready = true;
  emit();
  api.onQuota((q) => {
    state.quota = q;
    emit();
  });
  api.onAgents(({ agents, removed }) => {
    const m = new Map(state.agents);
    for (const a of agents) m.set(a.id, a);
    for (const id of removed) m.delete(id);
    state.agents = m;
    emit();
  });
  api.onEvents((evs) => {
    state.live = [...evs.slice().reverse(), ...state.live].slice(0, 3000);
    emit();
  });
  api.onNotification((n) => {
    state.notifications = [n, ...state.notifications].slice(0, 500);
    toast(n);
  });
  api.onConsole(({ agentId, line }) => {
    const m = new Map(state.consoles);
    m.set(agentId, [...(m.get(agentId) ?? []), line].slice(-3000));
    state.consoles = m;
    emit();
  });
  api.onLog((l) => {
    state.appLog = [l, ...state.appLog].slice(0, 300);
    emit();
  });
  api.onSelectAgent((id) => store.set({ selected: id, view: 'office' }));
}
