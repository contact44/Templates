// État central de l'application : paramètres, contrats, commentaires, historique, présence.
// Toutes les modifications passent par ici : automatisations, journal, annulation (Ctrl+Z).

import {
  accountRoleOf, columnByKey, defaultSettings, listOptions, memberById, normalizeSettings, VIEW_PRESETS,
} from './schema.js';
import {
  deriveAll, displayValue, genForStep, JALONS, kpis, matchFilters, weekToFreeze,
} from './compute.js';
import {
  deepClone, initials, isEmpty, norm, safeStorage, sameValue, todayISO, uid,
} from './utils.js';

const PREFS_KEY = 'saison:prefs:v2';
const DEFAULT_PREFS = {
  theme: 'light',
  density: 'compact',
  hiddenColumns: null,
  shownGroups: VIEW_PRESETS.suivi,
  columnWidths: {},
  sort: [{ key: 'ref', dir: 1 }],
  groupBy: '',
  collapsedGroups: [],
  filters: { search: '', fields: {}, quick: '' },
  columnFilters: {},
  boardCollapsed: [],
  boardField: 'statut',
  reportLang: 'fr',
  divFilters: { group: '', cm: '', juriste: '' },
  meId: null,
  lastView: 'accueil',
};

export const SETTINGS_LABELS = {
  season: 'Saison',
  milestones: 'Jalons et échéances',
  team: 'Équipe',
  lists: 'Listes de valeurs',
  listLabels: 'Listes de valeurs',
  columns: 'Colonnes',
  alerts: 'Seuils de pilotage',
  automations: 'Automatisations',
  reporting: 'Regroupements des reportings',
  home: 'Accueil',
  homeNotes: 'Dernières modifications',
  homeVigilance: 'Points de vigilance',
  hebdo: 'Suivi hebdomadaire',
  hebdoWeeks: 'Semaines figées',
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
    // Un choix explicite (« Qui suis-je ? ») prime : utile quand l'équipe partage une même clé d'accès.
    if (state.prefs.meId) { const chosen = team.find((m) => m.id === state.prefs.meId); if (chosen) return chosen; }
    if (u?.login) {
      const byLogin = team.find((m) => m.github && norm(m.github) === norm(u.login));
      if (byLogin) return byLogin;
    }
    if (u?.email) {
      const byEmail = team.find((m) => m.email && norm(m.email) === norm(u.email));
      if (byEmail) return byEmail;
    }
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
      contractLabel: contract?.values?.client ? `${contract.values.client}${contract.values.division ? ` (${contract.values.division})` : ''}` : '',
      ...extra,
    };
  }

  /* ------------------------------------------------------ Automatisations */

  /**
   * Macro « HorodaterStatut » du classeur : toute saisie dans REPORT PAR DIV ou REPORT GEN date la colonne
   * « Statut modifié le » (effacée si les deux statuts sont vidés).
   */
  function automationsFor(contract, patch) {
    const auto = state.settings.automations || {};
    const extra = {};
    // REPORT GEN suit toujours l'étape REPORT PAR DIV (dont il n'est que la synthèse).
    if ('reportDiv' in patch) {
      const gen = isEmpty(patch.reportDiv) ? null : genForStep(state.settings, patch.reportDiv);
      if (gen !== undefined && !sameValue(gen, contract.values.statut ?? null) && (gen || isEmpty(patch.reportDiv))) extra.statut = gen;
    }
    if (auto.stampStatusChange !== false && ('statut' in patch || 'reportDiv' in patch) && !isEmpty(contract.values.client ?? patch.client)) {
      const gen = 'statut' in extra ? extra.statut : 'statut' in patch ? patch.statut : contract.values.statut;
      const div = 'reportDiv' in patch ? patch.reportDiv : contract.values.reportDiv;
      extra.statutModifieLe = isEmpty(gen) && isEmpty(div) ? null : state.today;
      if (extra.statutModifieLe === (contract.values.statutModifieLe ?? null)) delete extra.statutModifieLe;
    }
    return extra;
  }

  /* --------------------------------------------------------- Écritures */

  /** Ajoute tout de suite les contrats créés (la fiche peut s'ouvrir avant la réponse de la base). */
  function applyOptimisticCreate(contracts) {
    const actor = me();
    const now = Date.now();
    for (const c of contracts) {
      if (state.contracts.has(c.id)) continue;
      state.contracts.set(c.id, { id: c.id, values: deepClone(c.values), createdAt: now, createdBy: actor.uid, createdByName: actor.name, updatedAt: now, updatedBy: actor.uid, updatedByName: actor.name });
    }
    recompute();
    emit('data', { reason: 'optimistic', changes: contracts.map((c) => ({ type: 'added', id: c.id, remote: false })), remote: [] });
  }

  /** Affiche tout de suite ses propres modifications, sans attendre l'aller-retour avec la base. */
  function applyOptimistic(updates) {
    const actor = me();
    const changes = [];
    for (const { id, patch } of updates) {
      const c = state.contracts.get(id);
      if (!c) continue;
      state.contracts.set(id, { ...c, values: { ...c.values, ...deepClone(patch) }, updatedAt: Date.now(), updatedBy: actor.uid, updatedByName: actor.name });
      changes.push({ type: 'modified', id, keys: Object.keys(patch), remote: false });
    }
    if (!changes.length) return;
    recompute();
    emit('data', { reason: 'optimistic', changes, remote: [] });
  }

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
      // Colonnes en lecture seule (réf., horodatage) : modifiables seulement par l'annulation et les automatisations.
      if (col && (col.type === 'computed' || (col.readonly && opts.source !== 'undo' && !opts.system))) continue;
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
    applyOptimistic([{ id, patch: full }]);
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
    applyOptimistic(updates);
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

  const isOffline = () => state.sync.status === 'offline' || (typeof navigator !== 'undefined' && navigator.onLine === false);

  async function reserveRefs(count) {
    let start = null;
    // Hors ligne, le compteur partagé est inaccessible : numérotation locale, doublons corrigés au retour du réseau.
    if (!isOffline()) { try { start = await backend.reserveRefs(count); } catch { start = null; } }
    const floor = maxRefNumber() + 1;
    if (!start || start < floor) {
      start = floor;
      if (!isOffline()) { try { await backend.setCounterAtLeast(start + count - 1); } catch { /* compteur indisponible */ } }
    }
    return start;
  }

  /**
   * Références en double (créations simultanées sur deux postes) : dans chaque doublon, la ligne créée la
   * première garde son numéro ; les autres reçoivent les numéros suivant le plus grand, dans un ordre calculé
   * de la même façon sur tous les postes (date de création puis identifiant). Chaque poste ne réécrit que
   * ses propres lignes : deux postes qui corrigent en même temps ne choisissent donc jamais le même numéro.
   */
  let fixingRefs = false;
  async function fixDuplicateRefs() {
    if (fixingRefs || isOffline() || !state.user) return;
    const byRef = new Map();
    for (const c of state.list) {
      const r = norm(c.values.ref);
      if (!r) continue;
      if (!byRef.has(r)) byRef.set(r, []);
      byRef.get(r).push(c);
    }
    const order = (a, b) => (a.createdAt || 0) - (b.createdAt || 0) || String(a.id).localeCompare(String(b.id));
    const losers = [];
    for (const group of byRef.values()) {
      if (group.length < 2) continue;
      group.sort(order);
      losers.push(...group.slice(1));
    }
    if (!losers.length) return;
    losers.sort(order);
    let next = maxRefNumber() + 1;
    const updates = losers.map((c) => ({ c, ref: formatRef(next++) })).filter((x) => x.c.createdBy === state.user.uid)
      .map(({ c, ref }) => ({ id: c.id, patch: { ref } }));
    if (!updates.length) return;
    fixingRefs = true;
    try {
      const history = updates.map((u) => historyEntry(getContract(u.id), { action: 'update', field: 'ref', fieldLabel: 'Réf.', from: getContract(u.id).values.ref, to: u.patch.ref, auto: true }));
      applyOptimistic(updates);
      await backend.updateContracts(updates, history, me());
      try { await backend.setCounterAtLeast(next - 1); } catch { /* sans incidence */ }
    } catch { /* nouvel essai au prochain changement */ } finally { fixingRefs = false; }
  }
  let refTimer = null;
  const scheduleRefCheck = () => { clearTimeout(refTimer); refTimer = setTimeout(fixDuplicateRefs, 1500); refTimer.unref?.(); };

  function formatRef(n) {
    const p = state.settings.season.refPrefix;
    return p ? `${p}-${String(n).padStart(3, '0')}` : String(n);
  }

  function defaultNewValues() {
    const s = state.settings;
    const actif = listOptions(s, 'statutCompte').find((o) => o.role === 'actif')?.value || '';
    return {
      statutCompte: actif,
      statut: listOptions(s, 'statut')[0]?.value || '',
      reportDiv: listOptions(s, 'reportDiv')[0]?.value || '',
      statutModifieLe: state.today,
    };
  }

  /** Crée un contrat ; retourne son identifiant. */
  async function createContract(values = {}, opts = {}) {
    const id = uid();
    const start = await reserveRefs(1);
    const v = { ...defaultNewValues(), ...deepClone(values), ref: formatRef(start) };
    const meM = meMember();
    if (isEmpty(v.cm) && meM && opts.assignMe !== false) v.cm = meM.id;
    const contract = { id, values: v };
    const history = [historyEntry(contract, { action: 'create' })];
    if (opts.undo !== false) pushUndo({ label: 'Création', undo: () => deleteContracts([id], { undo: false }), redo: () => restoreContracts([deepClone(contract)]) });
    applyOptimisticCreate([contract]);
    await guardWrite(backend.createContracts([contract], history, me()), 'la création');
    return id;
  }

  async function restoreContracts(contracts) {
    const history = contracts.map((c) => historyEntry(c, { action: 'restore' }));
    applyOptimisticCreate(contracts);
    await guardWrite(backend.createContracts(contracts.map((c) => ({ id: c.id, values: c.values })), history, me()), 'la restauration');
  }

  async function duplicateContract(id) {
    const c = getContract(id);
    if (!c) return null;
    const values = deepClone(c.values);
    delete values.ref;
    values.client = `${values.client || 'Sans nom'} (copie)`;
    return createContract(values, { assignMe: false });
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
  async function importContracts(rows, { mode = 'append', source = 'Excel', undoable = false } = {}) {
    // L'étape DIV fait foi : REPORT GEN en est déduit.
    rows = rows.map((v) => {
      const gen = isEmpty(v.reportDiv) ? null : genForStep(state.settings, v.reportDiv);
      return gen ? { ...v, statut: gen } : v;
    });
    let toCreate = []; const updates = [];
    const actor = me();
    if (mode === 'update') {
      // Une ligne par compte et par division : reconnue par sa référence, sinon par le couple client + division.
      const byRef = new Map(state.list.filter((c) => c.values.ref).map((c) => [norm(c.values.ref), c]));
      const pair = (v) => `${norm(v.client)}|${norm(v.division)}`;
      const byPair = new Map(state.list.filter((c) => c.values.client).map((c) => [pair(c.values), c]));
      for (const values of rows) {
        const sameRef = values.ref && byRef.get(norm(values.ref));
        const match = (sameRef && norm(sameRef.values.client) === norm(values.client) ? sameRef : null) || (values.client && byPair.get(pair(values)));
        if (match) {
          const patch = {};
          for (const [k, v] of Object.entries(values)) {
            if (k === 'ref' || isEmpty(v) || sameValue(match.values[k], v)) continue;
            if ((k === 'client' || k === 'division') && norm(v) === norm(match.values[k])) continue; // même compte, autre casse
            patch[k] = v;
          }
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
    const created = toCreate.map((values) => {
      const v = { ...values };
      if (isEmpty(v.ref) || taken.has(norm(v.ref))) v.ref = formatRef(next++);
      taken.add(norm(v.ref));
      return { id: uid(), values: v };
    });
    const maxImported = Math.max(0, ...created.map((c) => Number(String(c.values.ref).match(/(\d+)\s*$/)?.[1] || 0)));
    if (maxImported) { try { await backend.setCounterAtLeast(maxImported); } catch { /* sans incidence */ } }
    const summary = historyEntry(null, {
      action: 'import',
      to: `${source} : ${created.length} ligne(s) ajoutée(s)${updates.length ? `, ${updates.length} mise(s) à jour` : ''}${mode === 'replace' ? ' (remplacement complet)' : ''}`,
    });
    for (let i = 0; i < created.length; i += 400) {
      await guardWrite(backend.createContracts(created.slice(i, i + 400), i === 0 ? [summary] : [], actor), 'l’import');
    }
    if (!created.length) await backend.addHistory([summary]);
    for (let i = 0; i < updates.length; i += 400) {
      await guardWrite(backend.updateContracts(updates.slice(i, i + 400), [], actor), 'l’import');
    }
    if (undoable && mode === 'append' && !updates.length) {
      const ids = created.map((c) => c.id);
      pushUndo({ label: 'Création par collage', undo: () => deleteContracts(ids, { undo: false }), redo: () => restoreContracts(created.map(deepClone)) });
    } else {
      undoStack.length = 0; redoStack.length = 0; emit('undo');
    }
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
    return remapListValues(listKey, { [oldValue]: newValue ?? null });
  }

  /**
   * Applique en une seule passe un ensemble de renommages / remplacements { ancienne: nouvelle|null }
   * (une permutation A↔B est donc correcte).
   */
  async function remapListValues(listKey, map) {
    const has = (v) => typeof v === 'string' && Object.prototype.hasOwnProperty.call(map, v);
    if (!Object.keys(map).length) return 0;
    const cols = state.settings.columns.filter((c) => (c.type === 'select' || c.type === 'multiselect') && c.list === listKey);
    if (!cols.length) return 0;
    return bulkUpdate(state.list.map((c) => c.id), (c) => {
      const patch = {};
      for (const col of cols) {
        const v = c.values[col.key];
        if (col.type === 'select' && has(v)) patch[col.key] = map[v] ?? null;
        if (col.type === 'multiselect' && Array.isArray(v) && v.some(has)) {
          patch[col.key] = [...new Set(v.map((x) => (has(x) ? map[x] : x)).filter(Boolean))];
        }
      }
      return patch;
    }, { automations: false, undo: false, label: 'Mise à jour de liste' });
  }

  /** Ajoute une valeur à une liste (choix « Ajouter… » d'un sélecteur). */
  async function addListValue(listKey, value) {
    const lists = deepClone(state.settings.lists);
    const list = lists[listKey] || (lists[listKey] = []);
    if (list.some((o) => norm(o.value) === norm(value))) return;
    list.push({ value: String(value).trim(), color: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'][list.length % 8] });
    await saveSettings({ lists }, `Valeur « ${value} » ajoutée`);
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

  /* ----------------------------------------------- Journal à la demande */

  const dedupe = (lists) => {
    const seen = new Map();
    for (const l of lists) for (const h of l || []) if (h && !seen.has(h.id)) seen.set(h.id, h);
    return [...seen.values()].sort((a, b) => b.ts - a.ts || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  };

  /** Historique complet d'un contrat (entrées récentes + anciennes). */
  async function contractHistory(contractId) {
    const recent = state.history.filter((h) => h.contractId === contractId);
    try { return dedupe([recent, await backend.loadHistory({ contractId })]); } catch { return recent; }
  }

  /** Page d'entrées plus anciennes que la plus ancienne connue. */
  async function olderHistory(before, max = 500) {
    const beforeTs = before && typeof before === 'object' ? before.ts : before;
    const beforeId = before && typeof before === 'object' ? before.id : null;
    try { return await backend.loadHistory({ beforeTs, beforeId, max }); } catch (err) { emit('error', { message: errorMessage(err, 'le chargement du journal'), err }); return []; }
  }

  /** Tout le journal (exports). */
  async function fullHistory() {
    let all = state.history.slice();
    if (!backend.historyIsPartial) return all;
    for (let guard = 0; guard < 40; guard++) {
      const oldest = all.length ? all[all.length - 1] : null;
      const page = await olderHistory(oldest, 1000);
      all = dedupe([all, page]);
      if (page.length < 1000) break;
    }
    return all;
  }

  /* ---------------------------------------------- Sauvegarde et démonstration */

  async function exportBackup() {
    const history = await fullHistory();
    return {
      format: 'suivi-saison-contractuelle',
      version: 2,
      exportedAt: new Date().toISOString(),
      seasonId,
      settings: deepClone(state.settings),
      contracts: state.list.map(deepClone),
      comments: deepClone(state.comments),
      history: deepClone(history),
    };
  }

  /**
   * Prépare la saison suivante : mêmes comptes et mêmes réglages ; les dates et statuts de la saison
   * passent dans l'historique N-1 ; jalons, statuts et suivi de la nouvelle saison sont remis à zéro.
   * Retourne un fichier de sauvegarde à restaurer dans la nouvelle saison.
   */
  function nextSeasonBackup() {
    const s = deepClone(state.settings);
    const year = Number(s.season.year || new Date().getFullYear()) + 1;
    const shiftYears = (text) => String(text || '').replace(/\b(20\d{2})\b/g, (m) => String(Number(m) + 1));
    const shift = (iso) => (iso ? `${Number(iso.slice(0, 4)) + 1}${iso.slice(4)}` : iso);
    s.season = { ...s.season, year, name: shiftYears(s.season.name) || `Saison contractuelle ${year}` };
    s.milestones = (s.milestones || []).map((m) => ({ ...m, label: shiftYears(m.label), date: shift(m.date) }));
    s.columns = s.columns.map((c) => ({ ...c, label: shiftYears(c.label) }));
    for (const key of ['statut', 'reportDiv']) {
      s.lists[key] = (s.lists[key] || []).map((o) => ({ ...o, value: shiftYears(o.value), ...(o.en ? { en: shiftYears(o.en) } : {}) }));
    }
    s.hebdo = { ...s.hebdo, start: shift(s.hebdo?.start), end: shift(s.hebdo?.end) };
    s.hebdoWeeks = {};
    s.homeNotes = '';
    const toHisto = {
      selms: 'n1Identifiant', objet: 'n1Objet', statut: 'n1ReportGen', reportDiv: 'n1ReportDiv', iso: 'n1Iso', attribution2026: 'n1Attribution',
      receptionCc: 'n1ReceptionCc', revueAttribuee: 'n1RevueAttribuee', revueTerminee: 'n1RevueTerminee', approvalLancee: 'n1ApprovalLancee',
      approvalTerminee: 'n1ApprovalTerminee', miseEnSignature: 'n1MiseEnSignature', signatureClient: 'n1SignatureClient', signatureSef: 'n1SignatureSef',
      suiviCm: 'n1SuiviCm',
    };
    const reset = new Set(['selms', 'objet', 'iso', 'suiviCm', 'statutModifieLe', 'attribution2027', 'gag2027', 'esig2027', 'contratEdite', ...JALONS]);
    const first = { statut: s.lists.statut[0]?.value || '', reportDiv: s.lists.reportDiv[0]?.value || '' };
    const contracts = state.list
      .filter((c) => accountRoleOf(state.settings, c.values.statutCompte) !== 'ferme')
      .sort((a, b) => String(a.values.ref).localeCompare(String(b.values.ref), 'fr', { numeric: true }))
      .map((c, i) => {
        const values = deepClone(c.values);
        for (const [from, to] of Object.entries(toHisto)) values[to] = deepClone(c.values[from] ?? null);
        values.n1Attribution = c.values.attribution2026 ?? null;
        values.attribution2026 = c.values.attribution2027 ?? null;
        values.gag2026 = c.values.gag2027 ?? c.values.gag2026 ?? null;
        values.esig2026 = c.values.esig2027 ?? c.values.esig2026 ?? null;
        for (const k of reset) values[k] = null;
        values.statut = c.values.statut ? first.statut : null;
        values.reportDiv = c.values.reportDiv ? first.reportDiv : null;
        values.ref = String(i + 1);
        return { id: uid(), values };
      });
    return { format: 'suivi-saison-contractuelle', version: 2, exportedAt: new Date().toISOString(), seasonId: String(year), settings: s, contracts, comments: [], history: [] };
  }

  /**
   * Macro « Trier les comptes » : comptes ouverts d'abord (par client puis division), comptes fermés en bas
   * (les plus récemment fermés d'abord), puis renumérotation de la colonne Réf.
   */
  async function sortAccounts() {
    const s = state.settings;
    const key = (c) => {
      const closed = accountRoleOf(s, c.values.statutCompte) === 'ferme';
      const year = Number(c.values.anneeFermeture) || 0;
      return [closed ? 1 : 0, closed ? -year : 0, norm(c.values.client), norm(c.values.division)];
    };
    const ordered = state.list.slice().sort((a, b) => {
      const ka = key(a); const kb = key(b);
      for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
      return 0;
    });
    const refs = new Map(ordered.map((c, i) => [c.id, formatRef(i + 1)]));
    const n = await bulkUpdate(ordered.map((c) => c.id), (c) => ({ ref: refs.get(c.id) }), { automations: false, label: 'Tri des comptes', history: false });
    if (n) await logEvent(null, { action: 'sort', to: `Comptes triés (fermés en bas) et références renumérotées : ${n} ligne(s) déplacée(s)` });
    return n;
  }

  /** Fige la ligne du suivi hebdomadaire (dernier vendredi passé) avec les chiffres du moment. */
  async function freezeWeek() {
    const date = weekToFreeze(state.settings, state.today);
    if (!date) return null;
    const k = kpis(state.settings, state.list, state.derived, state.today);
    const hebdoWeeks = { ...deepClone(state.settings.hebdoWeeks || {}), [date]: { attendus: k.attendus, signes: k.signes, figeLe: Date.now(), par: me().name } };
    await saveSettings({ hebdoWeeks }, `Semaine du ${date.split('-').reverse().join('/')} figée : ${k.signes} signés sur ${k.attendus}`);
    return { date, ...hebdoWeeks[date] };
  }

  async function restoreBackup(data) {
    if (!data || data.format !== 'suivi-saison-contractuelle' || !Array.isArray(data.contracts)) {
      throw new Error('Ce fichier n’est pas une sauvegarde de l’application.');
    }
    const settings = normalizeSettings(data.settings);
    const contracts = data.contracts.map((c) => ({ ...c, id: c.id || uid(), values: c.values || {} }));
    const counter = Math.max(0, ...contracts.map((c) => Number(String(c.values.ref || '').match(/(\d+)\s*$/)?.[1] || 0)));
    const actor = me();
    const entry = { id: uid(), ts: Date.now(), uid: actor.uid, user: actor.name, action: 'restore-all', to: `Restauration d’une sauvegarde (${contracts.length} lignes)` };
    await guardWrite(backend.replaceAll({ settings, contracts, comments: data.comments || [], history: [entry], counter }), 'la restauration');
    undoStack.length = 0; redoStack.length = 0; emit('undo');
  }

  async function loadDemo(buildDemo) {
    const settings = deepClone(state.settings);
    const demo = buildDemo(settings, state.today);
    const isDefaultTeam = (settings.team || []).every((m) => /^(CM \d|Contract Manager \d)$/.test(m.name));
    if (isDefaultTeam) settings.team = demo.team;
    const { lists, ...rest } = demo.settingsPatch || {};
    if (lists) settings.lists = { ...settings.lists, ...lists };
    Object.assign(settings, rest);
    const actor = me();
    const entry = { id: uid(), ts: Date.now(), uid: actor.uid, user: actor.name, action: 'restore-all', to: `Chargement des données de démonstration (${demo.contracts.length} lignes fictives)` };
    await guardWrite(backend.replaceAll({ settings, contracts: demo.contracts, comments: demo.comments, history: [entry, ...demo.history], counter: demo.counter }), 'le chargement de la démonstration');
    undoStack.length = 0; redoStack.length = 0; emit('undo');
  }

  async function clearAll() {
    const actor = me();
    const entry = { id: uid(), ts: Date.now(), uid: actor.uid, user: actor.name, action: 'restore-all', to: 'Suppression de toutes les lignes' };
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
        const first = !state.loaded.settings;
        state.loaded.settings = true;
        const next = s ? normalizeSettings(s) : state.settings;
        // Le document de saison change aussi quand le compteur de références avance : on ignore ces mises à jour.
        if (!first && JSON.stringify(next) === JSON.stringify(state.settings)) return;
        state.settings = next;
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
        // Création ou renumérotation reçue : une référence peut maintenant faire doublon avec une des siennes.
        if (changes.some((c) => c.type === 'added' || (c.type === 'modified' && c.remote))) scheduleRefCheck();
      },
      comments(list) { state.comments = list.slice().sort((a, b) => a.ts - b.ts); emit('comments'); },
      history(list) { state.history = list.slice().sort((a, b) => b.ts - a.ts); emit('history'); },
      presence(list) { state.presence = list; emit('presence'); },
      sync(s) { state.sync = { ...state.sync, ...s }; emit('sync', state.sync); },
      error(err) { emit('error', { message: errorMessage(err), err }); },
    });
    // Recalcule les alertes au changement de jour.
    const dayTimer = setInterval(() => {
      const t = todayISO();
      if (t !== state.today) { state.today = t; recompute(); emit('data', { reason: 'day' }); }
    }, 60000);
    dayTimer.unref?.();
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
    saveSettings, renameListValue, replaceListValueInContracts, remapListValues, addListValue, countListValueUsage, replaceMemberInContracts,
    addComment, deleteComment, logEvent, contractHistory, olderHistory, fullHistory, dedupeHistory: dedupe,
    exportBackup, restoreBackup, loadDemo, clearAll, nextSeasonBackup, sortAccounts, freezeWeek,
    setPresence, peers, formatRef,
    member: (id) => memberById(state.settings, id),
  };
}

export function errorMessage(err, what) {
  const code = err?.code || '';
  if (code.includes('permission-denied')) return /GitHub|clé/.test(err?.message || '') ? err.message : 'Accès refusé : votre clé d’accès ne permet pas de modifier ces données.';
  if (code.includes('rate-limited')) return err.message;
  if (code.includes('deleted-by-peer')) return err.message;
  if (code.includes('not-found')) return 'Cet élément n’existe plus (il a peut-être été supprimé par un autre utilisateur).';
  if (code.includes('unavailable')) return 'Connexion au serveur impossible. Les modifications seront envoyées dès le retour du réseau.';
  return `Échec de ${what || 'l’opération'} : ${err?.message || err}`;
}
