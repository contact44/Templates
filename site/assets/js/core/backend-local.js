// Stockage « mode local » : les données restent dans ce navigateur (localStorage).
// Utilisé pour la démonstration et tant que Firebase n'est pas configuré.
// Les onglets d'un même navigateur restent synchronisés (BroadcastChannel).

import { deepClone, safeStorage, uid } from './utils.js';

const HISTORY_CAP = 4000;

export function createLocalBackend({ seasonId = '2027', profile = {} } = {}) {
  const key = `saison:${seasonId}:data`;
  const tabId = uid(8);
  let data = null;
  let handlers = null;
  let channel = null;
  const user = { uid: 'local', email: profile.email || '', name: profile.name || 'Moi (mode local)', local: true };

  function load() {
    const stored = safeStorage.get(key, null);
    data = stored && typeof stored === 'object' ? stored : { settings: null, contracts: {}, comments: [], history: [], counter: 0 };
    data.contracts = data.contracts || {};
    data.comments = data.comments || [];
    data.history = data.history || [];
    data.counter = data.counter || 0;
  }

  function persist() {
    if (data.history.length > HISTORY_CAP) data.history.length = HISTORY_CAP;
    safeStorage.set(key, data);
    try { channel?.postMessage({ type: 'changed', from: tabId }); } catch { /* canal fermé */ }
  }

  function contractList() { return Object.values(data.contracts).map(deepClone); }

  function emitContracts(changes) {
    queueMicrotask(() => handlers?.contracts(contractList(), changes, { fromCache: false, pending: false }));
  }
  function emitComments() { queueMicrotask(() => handlers?.comments(deepClone(data.comments))); }
  function emitHistory() { queueMicrotask(() => handlers?.history(deepClone(data.history))); }
  function emitSettings() { queueMicrotask(() => handlers?.settings(deepClone(data.settings))); }

  function onExternalChange() {
    const before = data.contracts;
    const beforeSettings = JSON.stringify(data.settings);
    const beforeComments = data.comments.length;
    load();
    const changes = [];
    for (const [id, c] of Object.entries(data.contracts)) {
      const prev = before[id];
      if (!prev) changes.push({ type: 'added', id, remote: true, by: c.updatedByName });
      else if (JSON.stringify(prev) !== JSON.stringify(c)) {
        const keys = Object.keys({ ...prev.values, ...c.values }).filter((k) => JSON.stringify(prev.values[k]) !== JSON.stringify(c.values[k]));
        changes.push({ type: 'modified', id, remote: true, keys, by: c.updatedByName });
      }
    }
    for (const id of Object.keys(before)) if (!data.contracts[id]) changes.push({ type: 'removed', id, remote: true });
    if (changes.length) emitContracts(changes);
    if (JSON.stringify(data.settings) !== beforeSettings) emitSettings();
    if (data.comments.length !== beforeComments) emitComments();
    emitHistory();
  }

  const stamp = (actor) => ({ updatedAt: Date.now(), updatedBy: actor.uid, updatedByName: actor.name });

  return {
    kind: 'local',
    label: 'Mode local (ce navigateur)',
    user,

    async init() { load(); },

    onAuth(cb) { queueMicrotask(() => cb(user)); return () => {}; },
    async signIn() { return user; },
    async signOut() {},
    async resetPassword() {},
    async changePassword() { throw new Error('Non disponible en mode local.'); },
    setDisplayName(name) { user.name = name; },

    async start(h) {
      handlers = h;
      try {
        channel = new BroadcastChannel(`saison-${seasonId}`);
        channel.onmessage = (ev) => { if (ev.data?.from !== tabId) onExternalChange(); };
        channel.unref?.();
      } catch { channel = null; }
      handlers.sync({ status: 'local' });
      handlers.settings(deepClone(data.settings));
      handlers.contracts(contractList(), [], { initial: true });
      handlers.comments(deepClone(data.comments));
      handlers.history(deepClone(data.history));
      handlers.presence([]);
      return () => { handlers = null; channel?.close(); };
    },

    async ensureSeason(defaults) {
      if (!data.settings) { data.settings = deepClone(defaults); persist(); emitSettings(); }
      return deepClone(data.settings);
    },

    async reserveRefs(count) {
      const start = data.counter + 1;
      data.counter += count;
      persist();
      return start;
    },

    async setCounterAtLeast(n) {
      if (data.counter < n) { data.counter = n; persist(); }
    },

    async createContracts(items, history = [], actor = user) {
      const changes = [];
      for (const it of items) {
        const createdAt = it.createdAt || Date.now();
        data.contracts[it.id] = {
          id: it.id, values: deepClone(it.values),
          createdAt, createdBy: it.createdBy || actor.uid, createdByName: it.createdByName || actor.name,
          ...stamp(actor),
          ...(it.updatedAt ? { updatedAt: it.updatedAt, updatedBy: it.updatedBy, updatedByName: it.updatedByName } : {}),
        };
        changes.push({ type: 'added', id: it.id, remote: false });
      }
      data.history.unshift(...history);
      persist(); emitContracts(changes); if (history.length) emitHistory();
    },

    async updateContracts(updates, history = [], actor = user) {
      const changes = [];
      for (const { id, patch } of updates) {
        const c = data.contracts[id];
        if (!c) continue;
        c.values = { ...c.values, ...deepClone(patch) };
        Object.assign(c, stamp(actor));
        changes.push({ type: 'modified', id, remote: false, keys: Object.keys(patch) });
      }
      data.history.unshift(...history);
      persist(); emitContracts(changes); if (history.length) emitHistory();
    },

    async deleteContracts(ids, history = []) {
      const changes = [];
      for (const id of ids) {
        if (data.contracts[id]) { delete data.contracts[id]; changes.push({ type: 'removed', id, remote: false }); }
      }
      // Les commentaires sont conservés : une annulation de la suppression les retrouve.
      data.history.unshift(...history);
      persist(); emitContracts(changes); if (history.length) emitHistory();
    },

    async saveSettings(partial, history = []) {
      data.settings = { ...(data.settings || {}), ...deepClone(partial) };
      data.history.unshift(...history);
      persist(); emitSettings(); if (history.length) emitHistory();
    },

    async addComment(comment) {
      data.comments.push(deepClone(comment));
      persist(); emitComments();
    },

    async deleteComment(id) {
      data.comments = data.comments.filter((c) => c.id !== id);
      persist(); emitComments();
    },

    async addHistory(entries) {
      data.history.unshift(...entries);
      persist(); emitHistory();
    },

    async loadHistory({ beforeTs = null, beforeId = null, contractId = null, max = 500 } = {}) {
      if (contractId) return deepClone(data.history.filter((h) => h.contractId === contractId));
      const sorted = data.history.slice().sort((a, b) => b.ts - a.ts || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
      const after = (h) => !beforeTs || h.ts < beforeTs || (h.ts === beforeTs && beforeId && h.id < beforeId);
      return deepClone(sorted.filter(after).slice(0, max));
    },
    historyIsPartial: false,

    setPresence() {},

    /** Remplace tout le contenu (restauration d'une sauvegarde, données de démonstration). */
    async replaceAll({ settings, contracts, comments = [], history = [], counter = 0 }) {
      const removed = Object.keys(data.contracts);
      data = {
        settings: deepClone(settings),
        contracts: Object.fromEntries(contracts.map((c) => [c.id, deepClone(c)])),
        comments: deepClone(comments),
        history: deepClone(history).concat(data.history || []).slice(0, HISTORY_CAP),
        counter,
      };
      persist();
      emitSettings();
      emitContracts([...removed.map((id) => ({ type: 'removed', id, remote: false })), ...contracts.map((c) => ({ type: 'added', id: c.id, remote: false }))]);
      emitComments(); emitHistory();
    },
  };
}
