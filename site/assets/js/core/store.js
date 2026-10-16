// État central de l'application : paramètres, contrats, commentaires, historique, présence.
// Toutes les modifications passent par ici : automatisations, journal, annulation (Ctrl+Z).

import { columnByKey, defaultSettings, listOptions, memberById, normalizeSettings } from './schema.js';
import { deriveAll, displayValue, matchFilters } from './compute.js';
import {
  deepClone, initials, isEmpty, norm, safeStorage, sameValue, todayISO, uid,
} from './utils.js';

const PREFS_KEY = 'saison:prefs';
const DEFAULT_PREFS = {
  theme: 'light',
  density: 'comfortable',
  hiddenColumns: null,
  columnWidths: {},
  sort: [{ key: 'ref', dir: 1 }],
  groupBy: '',
  collapsedGroups: [],
  filters: { search: '', fields: {}, quick: '' },
  columnFilters: {},
  boardCollapsed: [],
  dashboardDim: 'cm',
  meId: null,
  lastView: 'dashboard',
};

export const SETTINGS_LABELS = {
  season: 'Saison',
  milestones: 'Jalons et échéances',
  team: 'Équipe',
  lists: 'Listes de valeurs',
  listLabels: 'Listes de valeurs',
  columns: 'Colonnes',
  alerts: 'Seuils d’alerte',
  automations: 'Automatisations',
  emailTemplates: 'Modèles de relance',
};

export function createStore(backend, { seasonId = '2027' } = {}) {
  const listeners = new Map();
  const state = {
    backend,
    seasonId,
    user: null,
    settings: normalizeSettings(defaultSettings()),
    contracts: new Map(),
    list: [],
    derived: new Map(),
    comments: [],
    history: [],
    presence: [],
    sync: { status: 'connecting' },
    loaded: { settings: false, contracts: false },
    prefs: { ...deepClone(DEFAULT_PREFS), ...safeStorage.get(PREFS_KEY, {}) },
    today: todayISO(),
  };
  const undoStack = [];
  const redoStack = [];

  /* ------------------------------------------------------------ Évènements */

  function on(evt, fn) {
    if (!listeners.has(evt)) listeners.set(evt, new Set());
    listeners.get(evt).add(fn);
    return () => listeners.get(evt)?.delete(fn);
  }
  function emit(evt, payload) {
    for (const fn of listeners.get(evt) || []) {
      try { fn(payload); } catch (err) { console.error(`[store] ${evt}`, err); }
    }
  }

  /* --------------------------------------------------------- Préférences */

  function setPrefs(patch, { silent } = {}) {
    state.prefs = { ...state.prefs, ...patch };
    safeStorage.set(PREFS_KEY, state.prefs);
    if (!silent) emit('prefs', patch);
  }

  function setFilters(patch) {
    setPrefs({ filters: { ...state.prefs.filters, ...patch } });
  }

  /* ------------------------------------------------------------ Lecture */

  function recompute() {
    state.list = [...state.contracts.values()];
    state.derived = deriveAll(state.settings, state.list, state.today);
  }

  const getContract = (id) => state.contracts.get(id) || null;

  function me() {
    const u = state.user || {};
    const member = meMember();
    return {
      uid: u.uid || 'anonyme',
      email: u.email || '',
      name: member?.name || u.name || u.email || 'Utilisateur',
      color: member?.color || '#1428a0',
      initials: member?.initials || initials(member?.name || u.name || u.email),
      memberId: member?.id || null,
    };
  }

  function meMember() {
    const team = state.settings.team || [];
    const u = state.user;
    if (u?.email) {
      const byEmail = team.find((m) => m.email && norm(m.email) === norm(u.email));
      if (byEmail) return byEmail;
    }
    if (state.prefs.meId) return team.find((m) => m.id === state.prefs.meId) || null;
    return null;
  }

  function filtered(extra = {}) {
    const filters = { ...state.prefs.filters, ...extra };
    const ctx = { meId: meMember()?.id || null };
    return state.list.filter((c) => matchFilters(state.settings, c, state.derived.get(c.id), filters, ctx));
  }

  /* ---------------------------------------------------- Journal (historique) */

  function fieldDisplay(col, value) {
    if (!col) return isEmpty(value) ? '' : String(value);
    return displayValue(state.settings, { values: { [col.key]: value } }, col);
  }

  function historyEntry(contract, extra) {
    const actor = me();
    return {
      id: uid(),
      ts: Date.now(),
      uid: actor.uid,
      user: actor.name,
      contractId: contract?.id || null,
      contractRef: contract?.values?.ref || '',
      contractLabel: contract?.values?.client || '',
      ...extra,
    };
  }

  /* ------------------------------------------------------ Automatisations */

  function automationsFor(contract, patch) {
    const s = state.settings;
    const auto = s.automations || {};
    const statuses = listOptions(s, 'statut');
    const extra = {};
    if (auto.statusStampsDate && 'statut' in patch && !isEmpty(patch.statut)) {
      const opt = statuses.find((o) => o.value === patch.statut);
      const field = opt?.dateField;
      if (field && columnByKey(s, field) && isEmpty(contract.values[field]) && !(field in patch)) extra[field] = state.today;
    }
    if (auto.dateAdvancesStatus && !('statut' in patch)) {
      let bestIdx = -1;
      for (const [k, v] of Object.entries(patch)) {
        if (isEmpty(v)) continue;
        const idx = statuses.findIndex((o) => o.dateField === k);
        if (idx > bestIdx) bestIdx = idx;
      }
      if (bestIdx >= 0) {
        const curIdx = statuses.findIndex((o) => o.value === contract.values.statut);
        const cur = statuses[curIdx];
        const movable = curIdx < 0 || cur.stage === 'todo' || cur.stage === 'active';
        if (movable && curIdx < bestIdx) extra.statut = statuses[bestIdx].value;
      }
    }
    return extra;
  }

  /* --------------------------------------------------------- Écritures */

  function guardWrite(promise, what) {
    return Promise.resolve(promise).catch((err) => {
      console.error(err);
      emit('error', { message: errorMessage(err, what), err });
      throw err;
    });
  }

  /**
   * Met à jour un ou plusieurs champs d'un contrat.
   * opts.automations (défaut true) applique les automatisations ; opts.undo (défaut true) empile l'annulation.
   */
  async function updateFields(id, patch, opts = {}) {
    const contract = getContract(id);
    if (!contract) return null;
    const clean = {};
    for (const [k, v] of Object.entries(patch)) {
      const col = columnByKey(state.settings, k);
      if (col && (col.readonly || col.type === 'computed')) continue;
      if (!sameValue(contract.values[k], v)) clean[k] = v === undefined ? null : v;
    }
    if (!Object.keys(clean).length) return null;
    const auto = opts.automations === false ? {} : automationsFor(contract, clean);
    const full = { ...clean, ...auto };
    const before = {};
    for (const k of Object.keys(full)) before[k] = contract.values[k] === undefined ? null : deepClone(contract.values[k]);
    const history = Object.entries(full).map(([k, v]) => {
      const col = columnByKey(state.settings, k);
      return historyEntry(contract, {
        action: 'update', field: k, fieldLabel: col?.label || k,
        from: fieldDisplay(col, before[k]), to: fieldDisplay(col, v),
        ...(k in auto ? { auto: true } : {}),
        ...(opts.source === 'undo' ? { undo: true } : {}),
      });
    });
    if (opts.undo !== false) pushUndo({ label: 'Modification', undo: () => updateFields(id, before, { undo: false, automations: false, source: 'undo' }), redo: () => updateFields(id, full, { undo: false, automations: false, source: 'undo' }) });
    await guardWrite(backend.updateContracts([{ id, patch: full }], history, me()), 'la modification');
    if (Object.keys(auto).length) emit('automation', { id, fields: Object.keys(auto), values: auto });
    return full;
  }

  const updateField = (id, key, value, opts) => updateFields(id, { [key]: value }, opts);

  /** Même modification sur plusieurs contrats (actions groupées). */
  async function bulkUpdate(ids, patch, opts = {}) {
    const updates = []; const history = []; const befores = [];
    for (const id of ids) {
      const c = getContract(id);
      if (!c) continue;
      const own = typeof patch === 'function' ? patch(c) : patch;
      const clean = {};
      for (const [k, v] of Object.entries(own || {})) if (!sameValue(c.values[k], v)) clean[k] = v === undefined ? null : v;
      if (!Object.keys(clean).length) continue;
      const auto = opts.automations === false ? {} : automationsFor(c, clean);
      const full = { ...clean, ...auto };
      const before = {};
      for (const k of Object.keys(full)) before[k] = c.values[k] === undefined ? null : deepClone(c.values[k]);
      updates.push({ id, patch: full });
      befores.push({ id, patch: before });
      for (const [k, v] of Object.entries(full)) {
        const col = columnByKey(state.settings, k);
        history.push(historyEntry(c, { action: 'update', field: k, fieldLabel: col?.label || k, from: fieldDisplay(col, before[k]), to: fieldDisplay(col, v), ...(k in auto ? { auto: true } : {}) }));
      }
    }
    if (!updates.length) return 0;
    if (opts.undo !== false) {
      pushUndo({
        label: opts.label || 'Modification groupée',
        undo: () => backendBulk(befores.map((b) => ({ ...b })), 'undo'),
        redo: () => backendBulk(updates.map((u) => ({ ...u })), 'undo'),
      });
    }
    await guardWrite(backend.updateContracts(updates, opts.history === false ? [] : history, me()), 'la modification groupée');
    return updates.length;
  }

  async function backendBulk(updates, source) {
    const history = [];
    for (const u of updates) {
      const c = getContract(u.id);
      if (!c) continue;
      for (const [k, v] of Object.entries(u.patch)) {
        const col = columnByKey(state.settings, k);
        history.push(historyEntry(c, { action: 'update', field: k, fieldLabel: col?.label || k, from: fieldDisplay(col, c.values[k]), to: fieldDisplay(col, v), ...(source === 'undo' ? { undo: true } : {}) }));
      }
    }
    await guardWrite(backend.updateContracts(updates.filter((u) => getContract(u.id)), history, me()), 'l’annulation');
  }

  function maxRefNumber() {
    let max = 0;
    for (const c of state.list) {
      const m = String(c.values.ref || '').match(/(\d+)\s*$/);
      if (m) max = Math.max(max, Number(m[1]));
    }
    return max;
  }

  async function reserveRefs(count) {
    let start;
    try { start = await backend.reserveRefs(count); } catch { start = null; }
    const floor = maxRefNumber() + 1;
    if (!start || start < floor) {
      start = floor;
      try { await backend.setCounterAtLeast(start + count - 1); } catch { /* compteur indisponible hors ligne */ }
    }
    return start;
  }

  function formatRef(n) {
    return `${state.settings.season.refPrefix || 'C'}-${String(n).padStart(3, '0')}`;
  }

  /** Crée un contrat ; retourne son identifiant. */
  async function createContract(values = {}, opts = {}) {
    const id = uid();
    const start = await reserveRefs(1);
    const statuses = listOptions(state.settings, 'statut');
    const v = { statut: statuses[0]?.value || '', ...deepClone(values), ref: formatRef(start) };
    const meM = meMember();
    if (isEmpty(v.cm) && meM && opts.assignMe !== false) v.cm = meM.id;
    const contract = { id, values: v };
    const history = [historyEntry(contract, { action: 'create' })];
    if (opts.undo !== false) pushUndo({ label: 'Création', undo: () => deleteContracts([id], { undo: false }), redo: () => restoreContracts([deepClone(contract)]) });
    await guardWrite(backend.createContracts([contract], history, me()), 'la création');
    return id;
  }

  async function restoreContracts(contracts) {
    const history = contracts.map((c) => historyEntry(c, { action: 'restore' }));
    await guardWrite(backend.createContracts(contracts.map((c) => ({ id: c.id, values: c.values })), history, me()), 'la restauration');
  }

  async function duplicateContract(id) {
    const c = getContract(id);
    if (!c) return null;
    const values = deepClone(c.values);
    delete values.ref;
    values.client = `${values.client || 'Sans nom'} (copie)`;
    return createContract(values);
  }

  async function deleteContracts(ids, opts = {}) {
    const snapshot = ids.map(getContract).filter(Boolean).map(deepClone);
    if (!snapshot.length) return;
    const history = snapshot.map((c) => historyEntry(c, { action: 'delete' }));
    if (opts.undo !== false) pushUndo({ label: snapshot.length > 1 ? 'Suppressions' : 'Suppression', undo: () => restoreContracts(snapshot), redo: () => deleteContracts(snapshot.map((c) => c.id), { undo: false }) });
    await guardWrite(backend.deleteContracts(snapshot.map((c) => c.id), history), 'la suppression');
  }

  /**
   * Import de lignes (valeurs déjà typées).
   * mode « append » : ajoute ; « update » : met à jour les contrats reconnus (réf. ou client) et ajoute les autres ;
   * « replace » : supprime les contrats existants puis importe.
   */
  async function importContracts(rows, { mode = 'append', source = 'Excel' } = {}) {
    let toCreate = []; const updates = [];
    const actor = me();
    if (mode === 'update') {
      const byRef = new Map(state.list.filter((c) => c.values.ref).map((c) => [norm(c.values.ref), c]));
      const byClient = new Map(state.list.filter((c) => c.values.client).map((c) => [norm(c.values.client), c]));
      for (const values of rows) {
        const match = (values.ref && byRef.get(norm(values.ref))) || (values.client && byClient.get(norm(values.client)));
        if (match) {
          const patch = {};
          for (const [k, v] of Object.entries(values)) if (k !== 'ref' && !isEmpty(v) && !sameValue(match.values[k], v)) patch[k] = v;
          if (Object.keys(patch).length) updates.push({ id: match.id, patch });
        } else toCreate.push(values);
      }
    } else toCreate = rows.slice();

    if (mode === 'replace' && state.list.length) {
      await guardWrite(backend.deleteContracts(state.list.map((c) => c.id), []), 'le remplacement');
    }
    const taken = new Set(mode === 'replace' ? [] : state.list.map((c) => norm(c.values.ref)));
    const needRef = toCreate.filter((v) => isEmpty(v.ref) || taken.has(norm(v.ref)));
    let next = needRef.length ? await reserveRefs(needRef.length) : 0;
    const statuses = listOptions(state.settings, 'statut');
    const created = toCreate.map((values) => {
      const v = { ...values };
      if (isEmpty(v.statut)) v.statut = statuses[0]?.value || '';
      if (isEmpty(v.ref) || taken.has(norm(v.ref))) v.ref = formatRef(next++);
      taken.add(norm(v.ref));
      return { id: uid(), values: v };
    });
    const maxImported = Math.max(0, ...created.map((c) => Number(String(c.values.ref).match(/(\d+)\s*$/)?.[1] || 0)));
    if (maxImported) { try { await backend.setCounterAtLeast(maxImported); } catch { /* sans incidence */ } }
    const summary = historyEntry(null, {
      action: 'import',
      to: `${source} : ${created.length} contrat(s) ajouté(s)${updates.length ? `, ${updates.length} mis à jour` : ''}${mode === 'replace' ? ' (remplacement complet)' : ''}`,
    });
    for (let i = 0; i < created.length; i += 400) {
      await guardWrite(backend.createContracts(created.slice(i, i + 400), i === 0 ? [summary] : [], actor), 'l’import');
    }
    if (!created.length) await backend.addHistory([summary]);
    for (let i = 0; i < updates.length; i += 400) {
      await guardWrite(backend.updateContracts(updates.slice(i, i + 400), [], actor), 'l’import');
    }
    undoStack.length = 0; redoStack.length = 0; emit('undo');
    return { created: created.length, updated: updates.length };
  }

  /* ------------------------------------------------------------ Annulation */

  function pushUndo(entry) {
    undoStack.push(entry);
    if (undoStack.length > 100) undoStack.shift();
    redoStack.length = 0;
    emit('undo');
  }

  async function undo() {
    const e = undoStack.pop();
    if (!e) return null;
    await e.undo();
    redoStack.push(e);
    emit('undo');
    return e.label;
  }

  async function redo() {
    const e = redoStack.pop();
    if (!e) return null;
    await e.redo();
    undoStack.push(e);
    emit('undo');
    return e.label;
  }

  /* --------------------------------------------------------- Paramètres */

  async function saveSettings(partial, description) {
    const history = Object.keys(partial).length
      ? [historyEntry(null, { action: 'settings', field: Object.keys(partial).join(','), fieldLabel: Object.keys(partial).map((k) => SETTINGS_LABELS[k] || k).filter((x, i, a) => a.indexOf(x) === i).join(', '), to: description || '' })]
      : [];
    await guardWrite(backend.saveSettings(deepClone(partial), history), 'l’enregistrement des paramètres');
  }

  /** Renomme une valeur de liste et met à jour les contrats concernés. */
  async function renameListValue(listKey, oldValue, newValue) {
    const lists = deepClone(state.settings.lists);
    const opt = (lists[listKey] || []).find((o) => o.value === oldValue);
    if (!opt) return;
    opt.value = newValue;
    await saveSettings({ lists }, `Valeur « ${oldValue} » renommée en « ${newValue} »`);
    await replaceListValueInContracts(listKey, oldValue, newValue);
  }

  async function replaceListValueInContracts(listKey, oldValue, newValue) {
    const cols = state.settings.columns.filter((c) => (c.type === 'select' || c.type === 'multiselect') && c.list === listKey);
    if (!cols.length) return 0;
    return bulkUpdate(state.list.map((c) => c.id), (c) => {
      const patch = {};
      for (const col of cols) {
        const v = c.values[col.key];
        if (col.type === 'select' && v === oldValue) patch[col.key] = newValue ?? null;
        if (col.type === 'multiselect' && Array.isArray(v) && v.includes(oldValue)) {
          patch[col.key] = [...new Set(v.map((x) => (x === oldValue ? newValue : x)).filter(Boolean))];
        }
      }
      return patch;
    }, { automations: false, undo: false, label: 'Mise à jour de liste' });
  }

  function countListValueUsage(listKey, value) {
    const cols = state.settings.columns.filter((c) => (c.type === 'select' || c.type === 'multiselect') && c.list === listKey);
    return state.list.filter((c) => cols.some((col) => {
      const v = c.values[col.key];
      return Array.isArray(v) ? v.includes(value) : v === value;
    })).length;
  }

  async function replaceMemberInContracts(memberId, replacementId) {
    const cols = state.settings.columns.filter((c) => c.type === 'person');
    return bulkUpdate(state.list.map((c) => c.id), (c) => {
      const patch = {};
      for (const col of cols) if (c.values[col.key] === memberId) patch[col.key] = replacementId || null;
      return patch;
    }, { automations: false, undo: false });
  }

  /* --------------------------------------------------------- Commentaires */

  async function addComment(contractId, text) {
    const actor = me();
    const c = getContract(contractId);
    const comment = { id: uid(), contractId, text: String(text).trim(), uid: actor.uid, user: actor.name, ts: Date.now() };
    if (!comment.text) return;
    await guardWrite(backend.addComment(comment), 'l’ajout du commentaire');
    await backend.addHistory([historyEntry(c, { action: 'comment', to: comment.text.slice(0, 140) })]).catch(() => {});
  }

  async function deleteComment(id) {
    await guardWrite(backend.deleteComment(id), 'la suppression du commentaire');
  }

  async function logEvent(contractId, extra) {
    const c = contractId ? getContract(contractId) : null;
    await backend.addHistory([historyEntry(c, extra)]).catch(() => {});
  }

  /* ---------------------------------------------- Sauvegarde et démonstration */

  function exportBackup() {
    return {
      format: 'suivi-saison-contractuelle',
      version: 1,
      exportedAt: new Date().toISOString(),
      seasonId,
      settings: deepClone(state.settings),
      contracts: state.list.map(deepClone),
      comments: deepClone(state.comments),
      history: deepClone(state.history),
    };
  }

  async function restoreBackup(data) {
    if (!data || data.format !== 'suivi-saison-contractuelle' || !Array.isArray(data.contracts)) {
      throw new Error('Ce fichier n’est pas une sauvegarde de l’application.');
    }
    const settings = normalizeSettings(data.settings);
    const contracts = data.contracts.map((c) => ({ ...c, id: c.id || uid(), values: c.values || {} }));
    const counter = Math.max(0, ...contracts.map((c) => Number(String(c.values.ref || '').match(/(\d+)\s*$/)?.[1] || 0)));
    const actor = me();
    const entry = { id: uid(), ts: Date.now(), uid: actor.uid, user: actor.name, action: 'restore-all', to: `Restauration d’une sauvegarde (${contracts.length} contrats)` };
    await guardWrite(backend.replaceAll({ settings, contracts, comments: data.comments || [], history: [entry], counter }), 'la restauration');
    undoStack.length = 0; redoStack.length = 0; emit('undo');
  }

  async function loadDemo(buildDemo) {
    const settings = deepClone(state.settings);
    const demo = buildDemo(settings, state.today);
    const isDefaultTeam = (settings.team || []).every((m) => /^Contract Manager \d$/.test(m.name));
    if (isDefaultTeam) settings.team = demo.team;
    const actor = me();
    const entry = { id: uid(), ts: Date.now(), uid: actor.uid, user: actor.name, action: 'restore-all', to: `Chargement des données de démonstration (${demo.contracts.length} contrats fictifs)` };
    await guardWrite(backend.replaceAll({ settings, contracts: demo.contracts, comments: demo.comments, history: [entry, ...demo.history], counter: demo.counter }), 'le chargement de la démonstration');
    undoStack.length = 0; redoStack.length = 0; emit('undo');
  }

  async function clearAll() {
    const actor = me();
    const entry = { id: uid(), ts: Date.now(), uid: actor.uid, user: actor.name, action: 'restore-all', to: 'Suppression de tous les contrats' };
    await guardWrite(backend.replaceAll({ settings: deepClone(state.settings), contracts: [], comments: [], history: [entry], counter: 0 }), 'la suppression');
    undoStack.length = 0; redoStack.length = 0; emit('undo');
  }

  /* ------------------------------------------------------- Présence */

  let lastPresence = {};
  function setPresence(info) {
    lastPresence = { ...lastPresence, ...info };
    const actor = me();
    try { backend.setPresence({ ...lastPresence, name: actor.name, color: actor.color, initials: actor.initials, email: actor.email }); } catch { /* best effort */ }
  }

  function peers() {
    const myUid = state.user?.uid;
    return state.presence.filter((p) => p.uid !== myUid);
  }

  /* ------------------------------------------------------- Démarrage */

  async function start() {
    const stop = await backend.start({
      settings(s) {
        state.loaded.settings = true;
        if (s) state.settings = normalizeSettings(s);
        recompute();
        emit('settings');
        emit('data', { reason: 'settings' });
        emit('user');
      },
      contracts(list, changes = [], meta = {}) {
        const remote = [];
        const map = new Map();
        for (const c of list) map.set(c.id, c);
        for (const ch of changes) if (ch.remote && ch.type !== 'removed') remote.push(ch);
        state.contracts = map;
        state.loaded.contracts = true;
        recompute();
        emit('data', { reason: 'contracts', changes, remote, initial: !!meta.initial });
        if (remote.length) emit('remote', remote);
      },
      comments(list) { state.comments = list.slice().sort((a, b) => a.ts - b.ts); emit('comments'); },
      history(list) { state.history = list.slice().sort((a, b) => b.ts - a.ts); emit('history'); },
      presence(list) { state.presence = list; emit('presence'); },
      sync(s) { state.sync = { ...state.sync, ...s }; emit('sync', state.sync); },
      error(err) { emit('error', { message: errorMessage(err), err }); },
    });
    // Recalcule les alertes au changement de jour.
    setInterval(() => {
      const t = todayISO();
      if (t !== state.today) { state.today = t; recompute(); emit('data', { reason: 'day' }); }
    }, 60000);
    return stop;
  }

  function setUser(user) {
    state.user = user;
    emit('user');
  }

  return {
    state, on, emit, start, setUser,
    setPrefs, setFilters, filtered, getContract, me, meMember,
    updateField, updateFields, bulkUpdate, createContract, duplicateContract, deleteContracts, importContracts,
    undo, redo, canUndo: () => undoStack.length > 0, canRedo: () => redoStack.length > 0,
    saveSettings, renameListValue, replaceListValueInContracts, countListValueUsage, replaceMemberInContracts,
    addComment, deleteComment, logEvent,
    exportBackup, restoreBackup, loadDemo, clearAll,
    setPresence, peers, formatRef,
    member: (id) => memberById(state.settings, id),
  };
}

export function errorMessage(err, what) {
  const code = err?.code || '';
  if (code.includes('permission-denied')) return 'Accès refusé : votre compte n’est pas autorisé à modifier ces données.';
  if (code.includes('not-found')) return 'Cet élément n’existe plus (il a peut-être été supprimé par un autre utilisateur).';
  if (code.includes('unavailable')) return 'Connexion au serveur impossible. Les modifications seront envoyées dès le retour du réseau.';
  if (code.includes('resource-exhausted')) return 'Quota Firebase dépassé pour aujourd’hui.';
  return `Échec de ${what || 'l’opération'} : ${err?.message || err}`;
}
