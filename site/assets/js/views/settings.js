// Paramètres : saison et jalons, équipe, listes de valeurs, colonnes, automatisations,
// modèles de relance, données (import, export, sauvegarde) et connexion.

import { icon } from '../ui/icons.js';
import { avatar, dateField } from '../ui/components.js';
import { confirmDialog, modal, popover, toast } from '../ui/overlay.js';
import {
  COLUMN_TYPES, FIELD_GROUPS, MILESTONE_ROLES, STAGES, SWATCHES, defaultSettings, normalizeSettings,
} from '../core/schema.js';
import { buildDemo } from '../core/demo.js';
import {
  deepClone, downloadBlob, esc, fmtDate, initials, norm, slugKey, todayISO, uid,
} from '../core/utils.js';
import { exportExcel, openImportDialog } from './importer.js';

const SECTIONS = [
  { id: 'saison', label: 'Saison et échéances', icon: 'calendar', keys: ['season', 'milestones', 'alerts'] },
  { id: 'equipe', label: 'Équipe', icon: 'users', keys: ['team'] },
  { id: 'listes', label: 'Listes de valeurs', icon: 'layers', keys: ['lists', 'listLabels'] },
  { id: 'colonnes', label: 'Colonnes', icon: 'columns', keys: ['columns', 'lists', 'listLabels'] },
  { id: 'automatisations', label: 'Automatisations', icon: 'zap', keys: ['automations'] },
  { id: 'modeles', label: 'Modèles de relance', icon: 'mail', keys: ['emailTemplates'] },
  { id: 'donnees', label: 'Import, export et sauvegarde', icon: 'database', keys: [] },
  { id: 'connexion', label: 'Connexion et partage', icon: 'cloud', keys: [] },
];

export function mount(el, ctx, { sub } = {}) {
  const { store } = ctx;
  let section = SECTIONS.some((s) => s.id === sub) ? sub : 'saison';
  let draft = deepClone(store.state.settings);
  let dirty = false;
  let remoteChanged = false;
  let listKey = 'statut';
  const removals = []; // { list, value (valeur d'origine), replacement }
  const memberRemovals = []; // { id, replacement }

  el.innerHTML = `<div class="page page-settings">
    <nav class="settings-nav" aria-label="Sections des paramètres">${SECTIONS.map((s) => `<a href="#/parametres/${s.id}" data-sec="${s.id}" class="settings-link">${icon(s.icon)}<span>${esc(s.label)}</span></a>`).join('')}</nav>
    <div class="settings-main"><div class="settings-body"></div></div>
  </div>
  <div class="savebar" hidden><span>${icon('info')}<span class="savebar-text">Modifications non enregistrées</span></span><button class="btn btn-ghost" data-act="discard">Annuler</button><button class="btn btn-primary" data-act="save">${icon('check')}<span>Enregistrer</span></button></div>`;
  const bodyEl = el.querySelector('.settings-body');
  const saveBar = el.querySelector('.savebar');

  function markDirty() {
    dirty = true;
    saveBar.hidden = false;
    saveBar.querySelector('.savebar-text').textContent = remoteChanged ? 'Un collègue a aussi modifié les paramètres : vos changements remplaceront les siens sur cette section.' : 'Modifications non enregistrées';
  }

  function resetDraft() {
    draft = deepClone(store.state.settings);
    dirty = false; remoteChanged = false;
    removals.length = 0; memberRemovals.length = 0;
    tagOriginals();
    saveBar.hidden = true;
  }

  async function save() {
    const sec = SECTIONS.find((s) => s.id === section);
    const keys = sec.keys.length ? sec.keys : [];
    if (!keys.length) { resetDraft(); return; }
    const errors = validate();
    if (errors.length) { toast(errors[0], { type: 'warning', timeout: 6000 }); return; }
    const partial = {};
    for (const k of keys) partial[k] = cleanForSave(k, draft[k]);
    await store.saveSettings(partial, sec.label);
    // Renommages et suppressions appliqués en une seule passe par liste (une permutation A ↔ B reste correcte).
    if (keys.includes('lists')) {
      const maps = {};
      for (const [k, list] of Object.entries(draft.lists)) {
        for (const o of list) if (o._orig && o._orig !== o.value) (maps[k] = maps[k] || {})[o._orig] = o.value;
      }
      for (const r of removals) if (r.replacement !== undefined) (maps[r.list] = maps[r.list] || {})[r.value] = r.replacement;
      for (const [k, map] of Object.entries(maps)) await store.remapListValues(k, map);
    }
    for (const r of memberRemovals) await store.replaceMemberInContracts(r.id, r.replacement);
    resetDraft();
    toast('Paramètres enregistrés pour toute l’équipe.', { type: 'success' });
    render();
    ctx.refreshChrome();
  }

  function cleanForSave(key, value) {
    const v = deepClone(value);
    if (key === 'lists') for (const list of Object.values(v)) for (const o of list) delete o._orig;
    if (key === 'team') for (const m of v) { m.initials = m.initials || initials(m.name); }
    return v;
  }

  function validate() {
    const errs = [];
    if (section === 'saison') {
      if (!draft.season.name.trim()) errs.push('Le nom de la saison est obligatoire.');
      if (draft.milestones.some((m) => !m.label.trim() || !m.date)) errs.push('Chaque jalon doit avoir un libellé et une date.');
      for (const role of ['cgv', 'signature', 'target']) if (draft.milestones.filter((m) => m.role === role).length > 1) errs.push(`Un seul jalon peut avoir le rôle « ${MILESTONE_ROLES.find((r) => r.id === role).label} ».`);
    }
    if (section === 'equipe' && draft.team.some((m) => !m.name.trim())) errs.push('Chaque membre doit avoir un nom.');
    if (section === 'listes' || section === 'colonnes') {
      for (const [k, list] of Object.entries(draft.lists)) {
        const seen = new Set();
        for (const o of list) {
          if (!o.value.trim()) errs.push(`Une valeur vide existe dans la liste « ${draft.listLabels[k] || k} ».`);
          if (seen.has(norm(o.value))) errs.push(`La valeur « ${o.value} » est en double dans la liste « ${draft.listLabels[k] || k} ».`);
          seen.add(norm(o.value));
        }
      }
      if (!draft.lists.statut?.some((o) => o.stage === 'done')) errs.push('La liste des statuts doit contenir au moins un statut « Signé » (étape terminée).');
      if (draft.columns.some((c) => !c.label.trim())) errs.push('Chaque colonne doit avoir un intitulé.');
    }
    return errs;
  }

  /* ----------------------------------------------------------- Rendu */

  function render() {
    el.querySelectorAll('[data-sec]').forEach((a) => { a.classList.toggle('active', a.dataset.sec === section); if (a.dataset.sec === section) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    const fn = { saison: renderSeason, equipe: renderTeam, listes: renderLists, colonnes: renderColumns, automatisations: renderAuto, modeles: renderTemplates, donnees: renderData, connexion: renderConnection }[section];
    bodyEl.innerHTML = '';
    fn();
  }

  function head(title, text) {
    return `<header class="settings-head"><h2>${esc(title)}</h2>${text ? `<p class="muted">${text}</p>` : ''}</header>`;
  }

  /* Saison */
  function renderSeason() {
    const s = draft;
    bodyEl.innerHTML = `${head('Saison et échéances', 'Les jalons alimentent le compte à rebours, la frise, les alertes et la courbe de signature. Les rôles « Date limite d’envoi des CGV » et « Date butoir de signature » déclenchent les alertes légales.')}
      <section class="card form-card">
        <div class="form-grid cols-2">
          <label class="field"><span class="field-label">Nom de la saison</span><input class="input" data-bind="season.name" value="${esc(s.season.name)}"></label>
          <label class="field"><span class="field-label">Entité / direction</span><input class="input" data-bind="season.entity" value="${esc(s.season.entity || '')}"></label>
          <label class="field"><span class="field-label">Année des conventions</span><input class="input" type="number" data-bind="season.year" value="${esc(s.season.year)}"></label>
          <label class="field"><span class="field-label">Préfixe des références</span><input class="input" data-bind="season.refPrefix" value="${esc(s.season.refPrefix)}"><span class="field-help">Exemple : ${esc(s.season.refPrefix || 'SC27')}-001</span></label>
        </div>
      </section>
      <section class="card form-card">
        <h3 class="form-title">Jalons</h3>
        <div class="edit-table ms-table">
          <div class="et-head"><span>Libellé</span><span>Date</span><span>Rôle</span><span>Note</span><span></span></div>
          ${s.milestones.map((m, i) => `<div class="et-row" data-i="${i}">
            <input class="input" data-ms="label" value="${esc(m.label)}" aria-label="Libellé">
            <span class="ms-date-slot"></span>
            <select class="input" data-ms="role" aria-label="Rôle">${MILESTONE_ROLES.map((r) => `<option value="${r.id}" ${m.role === r.id ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}</select>
            <input class="input" data-ms="note" value="${esc(m.note || '')}" placeholder="Base légale, commentaire…" aria-label="Note">
            <button class="icon-btn" data-del-ms="${i}" aria-label="Supprimer le jalon" data-tip="Supprimer">${icon('trash')}</button>
          </div>`).join('')}
        </div>
        <button class="btn btn-ghost btn-sm" data-act="add-ms">${icon('plus')}Ajouter un jalon</button>
      </section>
      <section class="card form-card">
        <h3 class="form-title">Seuils d’alerte</h3>
        <div class="form-grid cols-2">
          <label class="field"><span class="field-label">Action « à échéance proche » (jours)</span><input class="input" type="number" min="0" max="60" data-bind="alerts.dueSoonDays" value="${esc(s.alerts.dueSoonDays)}"></label>
          <label class="field"><span class="field-label">Alerte « CGV à envoyer » (jours avant la date limite)</span><input class="input" type="number" min="0" max="120" data-bind="alerts.cgvWarnDays" value="${esc(s.alerts.cgvWarnDays)}"></label>
          <label class="field"><span class="field-label">Vigilance avant la date butoir (jours)</span><input class="input" type="number" min="0" max="120" data-bind="alerts.deadlineWarnDays" value="${esc(s.alerts.deadlineWarnDays)}"></label>
          <label class="field"><span class="field-label">Avancement minimal attendu dans cette période (%)</span><input class="input" type="number" min="0" max="100" data-bind="alerts.deadlineRiskProgress" value="${esc(s.alerts.deadlineRiskProgress)}"></label>
        </div>
      </section>`;
    bodyEl.querySelectorAll('[data-bind]').forEach((inp) => inp.addEventListener('input', () => { setPath(draft, inp.dataset.bind, inp.type === 'number' ? Number(inp.value) : inp.value); markDirty(); }));
    bodyEl.querySelectorAll('.ms-date-slot').forEach((slot) => {
      const i = Number(slot.closest('[data-i]').dataset.i);
      slot.replaceWith(dateField(draft.milestones[i].date, (v) => { draft.milestones[i].date = v || ''; markDirty(); }, { ariaLabel: 'Date du jalon' }));
    });
    bodyEl.querySelectorAll('[data-ms]').forEach((inp) => inp.addEventListener('input', () => { draft.milestones[Number(inp.closest('[data-i]').dataset.i)][inp.dataset.ms] = inp.value; markDirty(); }));
    bodyEl.querySelectorAll('[data-del-ms]').forEach((b) => b.addEventListener('click', () => { draft.milestones.splice(Number(b.dataset.delMs), 1); markDirty(); renderSeason(); }));
    bodyEl.querySelector('[data-act="add-ms"]').addEventListener('click', () => { draft.milestones.push({ id: uid(8), label: 'Nouveau jalon', date: todayISO(), role: '', note: '' }); markDirty(); renderSeason(); });
  }

  /* Équipe */
  function renderTeam() {
    const team = draft.team;
    bodyEl.innerHTML = `${head('Équipe', 'Les membres apparaissent dans la colonne « Contract manager ». Renseignez l’e-mail de connexion de chacun : l’application reconnaît alors automatiquement qui est connecté (filtre « Mes contrats », journal).')}
      <section class="card form-card">
        <div class="edit-table team-table">
          <div class="et-head"><span></span><span>Nom</span><span>E-mail de connexion</span><span>Rôle</span><span>Initiales</span><span>Couleur</span><span></span></div>
          ${team.map((m, i) => `<div class="et-row" data-i="${i}">
            ${avatar(m, { title: false })}
            <input class="input" data-tm="name" value="${esc(m.name)}" aria-label="Nom">
            <input class="input" type="email" data-tm="email" value="${esc(m.email || '')}" placeholder="prenom.nom@samsung.com" aria-label="E-mail">
            <input class="input" data-tm="role" value="${esc(m.role || '')}" aria-label="Rôle">
            <input class="input input-xs" data-tm="initials" value="${esc(m.initials || '')}" maxlength="3" aria-label="Initiales">
            <button class="swatch-btn" data-color="${i}" style="--c:${esc(m.color)}" aria-label="Couleur"></button>
            <button class="icon-btn" data-del-tm="${i}" aria-label="Retirer le membre" data-tip="Retirer">${icon('trash')}</button>
          </div>`).join('')}
        </div>
        <button class="btn btn-ghost btn-sm" data-act="add-tm">${icon('plus')}Ajouter un membre</button>
      </section>`;
    bodyEl.querySelectorAll('[data-tm]').forEach((inp) => inp.addEventListener('input', () => {
      const m = draft.team[Number(inp.closest('[data-i]').dataset.i)];
      m[inp.dataset.tm] = inp.value;
      if (inp.dataset.tm === 'name' && !inp.closest('[data-i]').querySelector('[data-tm="initials"]').value) m.initials = '';
      markDirty();
    }));
    bodyEl.querySelectorAll('[data-color]').forEach((b) => b.addEventListener('click', () => colorPicker(b, (c) => { draft.team[Number(b.dataset.color)].color = c; markDirty(); renderTeam(); })));
    bodyEl.querySelectorAll('[data-del-tm]').forEach((b) => b.addEventListener('click', async () => {
      const i = Number(b.dataset.delTm);
      const m = draft.team[i];
      const used = store.state.list.filter((c) => store.state.settings.columns.some((col) => col.type === 'person' && c.values[col.key] === m.id)).length;
      if (used) {
        const repl = await chooseReplacement(`Retirer ${m.name}`, `${used} contrat(s) sont assignés à ${m.name}. À qui les réassigner ?`, draft.team.filter((x) => x.id !== m.id).map((x) => ({ value: x.id, label: x.name })), 'Laisser sans contract manager');
        if (repl === undefined) return;
        memberRemovals.push({ id: m.id, replacement: repl });
      }
      draft.team.splice(i, 1); markDirty(); renderTeam();
    }));
    bodyEl.querySelector('[data-act="add-tm"]').addEventListener('click', () => {
      draft.team.push({ id: uid(8), name: 'Nouveau membre', email: '', initials: '', color: SWATCHES[draft.team.length % 8], role: 'Contract Manager' });
      markDirty(); renderTeam();
      const inputs = bodyEl.querySelectorAll('[data-tm="name"]');
      inputs[inputs.length - 1]?.select();
    });
  }

  /* Listes */
  function renderLists() {
    const keys = Object.keys(draft.lists);
    if (!keys.includes(listKey)) listKey = keys[0];
    const list = draft.lists[listKey];
    const isStatus = listKey === 'statut';
    const dateCols = draft.columns.filter((c) => c.type === 'date');
    bodyEl.innerHTML = `${head('Listes de valeurs', 'Valeurs proposées dans les listes déroulantes. Renommer une valeur met à jour tous les contrats concernés à l’enregistrement.')}
      <div class="seg-ctrl wrap" role="tablist">${keys.map((k) => `<button role="tab" class="${k === listKey ? 'active' : ''}" data-list="${esc(k)}">${esc(draft.listLabels[k] || k)}</button>`).join('')}</div>
      <section class="card form-card">
        ${isStatus ? `<p class="muted small">Pour chaque statut, l’<strong>étape</strong> indique comment il est compté (à lancer, en cours, bloqué, signé, abandonné) et l’<strong>avancement</strong> alimente les jauges. La <strong>date automatique</strong> est renseignée quand un contrat passe à ce statut (et inversement, voir Automatisations).</p>` : ''}
        <div class="edit-table list-table ${isStatus ? 'is-status' : ''}">
          <div class="et-head"><span>Ordre</span><span>Couleur</span><span>Valeur</span>${isStatus ? '<span>Étape</span><span>Avanc. (%)</span><span>Date automatique</span>' : ''}<span>Utilisé par</span><span></span></div>
          ${list.map((o, i) => `<div class="et-row" data-i="${i}">
            <span class="order-btns"><button class="icon-btn" data-up="${i}" aria-label="Monter" ${i === 0 ? 'disabled' : ''}>${icon('chevronUp')}</button><button class="icon-btn" data-down="${i}" aria-label="Descendre" ${i === list.length - 1 ? 'disabled' : ''}>${icon('chevronDown')}</button></span>
            <button class="swatch-btn" data-color="${i}" style="--c:${esc(o.color)}" aria-label="Couleur"></button>
            <input class="input" data-opt="value" value="${esc(o.value)}" aria-label="Valeur">
            ${isStatus ? `<select class="input" data-opt="stage" aria-label="Étape">${STAGES.map((st) => `<option value="${st.id}" ${o.stage === st.id ? 'selected' : ''}>${esc(st.label)}</option>`).join('')}</select>
              <input class="input input-xs" type="number" min="0" max="100" data-opt="progress" value="${esc(o.progress ?? '')}" placeholder="—" aria-label="Avancement en %">
              <select class="input" data-opt="dateField" aria-label="Date automatique"><option value="">—</option>${dateCols.map((c) => `<option value="${esc(c.key)}" ${o.dateField === c.key ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select>` : ''}
            <span class="muted small">${o._orig ? store.countListValueUsage(listKey, o._orig) : 0} contrat(s)</span>
            <button class="icon-btn" data-del-opt="${i}" aria-label="Supprimer la valeur" data-tip="Supprimer">${icon('trash')}</button>
          </div>`).join('')}
        </div>
        <button class="btn btn-ghost btn-sm" data-act="add-opt">${icon('plus')}Ajouter une valeur</button>
      </section>`;
    bodyEl.querySelectorAll('[data-list]').forEach((b) => b.addEventListener('click', () => { listKey = b.dataset.list; renderLists(); }));
    bodyEl.querySelectorAll('[data-opt]').forEach((inp) => inp.addEventListener('input', () => {
      const o = draft.lists[listKey][Number(inp.closest('[data-i]').dataset.i)];
      const k = inp.dataset.opt;
      o[k] = k === 'progress' ? (inp.value === '' ? null : Math.max(0, Math.min(100, Number(inp.value)))) : inp.value;
      markDirty();
    }));
    bodyEl.querySelectorAll('[data-opt="value"]').forEach((inp) => inp.addEventListener('change', () => {
      draft.lists[listKey][Number(inp.closest('[data-i]').dataset.i)].value = inp.value.trim();
    }));
    bodyEl.querySelectorAll('[data-color]').forEach((b) => b.addEventListener('click', () => colorPicker(b, (c) => { draft.lists[listKey][Number(b.dataset.color)].color = c; markDirty(); renderLists(); })));
    bodyEl.querySelectorAll('[data-up],[data-down]').forEach((b) => b.addEventListener('click', () => {
      const i = Number(b.dataset.up ?? b.dataset.down);
      const j = b.dataset.up !== undefined ? i - 1 : i + 1;
      const l = draft.lists[listKey];
      [l[i], l[j]] = [l[j], l[i]];
      markDirty(); renderLists();
    }));
    bodyEl.querySelectorAll('[data-del-opt]').forEach((b) => b.addEventListener('click', async () => {
      const i = Number(b.dataset.delOpt);
      const o = draft.lists[listKey][i];
      const used = o._orig ? store.countListValueUsage(listKey, o._orig) : 0;
      let replacement;
      if (used) {
        replacement = await chooseReplacement(`Supprimer « ${o.value} »`, `${used} contrat(s) utilisent cette valeur. Par quoi la remplacer ?`, draft.lists[listKey].filter((x) => x !== o).map((x) => ({ value: x.value, label: x.value })), 'Laisser vide');
        if (replacement === undefined) return;
      }
      if (o._orig) removals.push({ list: listKey, value: o._orig, replacement: used ? replacement : undefined });
      draft.lists[listKey].splice(i, 1); markDirty(); renderLists();
    }));
    bodyEl.querySelector('[data-act="add-opt"]').addEventListener('click', () => {
      const l = draft.lists[listKey];
      l.push({ value: `Nouvelle valeur ${l.length + 1}`, color: SWATCHES[l.length % 8], ...(listKey === 'statut' ? { stage: 'active', progress: 50, dateField: '' } : {}), _orig: null });
      markDirty(); renderLists();
      const inputs = bodyEl.querySelectorAll('[data-opt="value"]');
      inputs[inputs.length - 1]?.select();
    });
  }

  /* Colonnes */
  function renderColumns() {
    const cols = draft.columns;
    const listKeys = Object.keys(draft.lists);
    bodyEl.innerHTML = `${head('Colonnes', 'Structure du tableau de suivi, partagée par toute l’équipe : ordre, intitulés, types et rubrique de la fiche. Chacun peut masquer des colonnes pour lui-même depuis le bouton « Colonnes » du suivi.')}
      <section class="card form-card">
        <div class="edit-table col-table">
          <div class="et-head"><span></span><span>Intitulé</span><span>Type</span><span>Liste</span><span>Rubrique de la fiche</span><span data-tip="Colonne affichée par défaut">Visible</span><span data-tip="Colonne figée à gauche">Figée</span><span></span></div>
          ${cols.map((c, i) => {
            const locked = c.system || c.type === 'computed';
            return `<div class="et-row" data-i="${i}">
              <span class="order-btns"><button class="icon-btn" data-up="${i}" aria-label="Monter" ${i === 0 ? 'disabled' : ''}>${icon('chevronUp')}</button><button class="icon-btn" data-down="${i}" aria-label="Descendre" ${i === cols.length - 1 ? 'disabled' : ''}>${icon('chevronDown')}</button></span>
              <input class="input" data-col="label" value="${esc(c.label)}" aria-label="Intitulé">
              ${locked ? `<span class="locked">${icon('lock')}${esc(c.type === 'computed' ? 'Calculée' : COLUMN_TYPES.find((t) => t.id === c.type)?.label || c.type)}</span>` : `<select class="input" data-col="type" aria-label="Type">${COLUMN_TYPES.map((t) => `<option value="${t.id}" ${c.type === t.id ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select>`}
              ${c.type === 'select' || c.type === 'multiselect' ? (locked && c.key === 'statut' ? `<span class="muted small">${esc(draft.listLabels[c.list] || c.list)}</span>` : `<select class="input" data-col="list" aria-label="Liste">${listKeys.map((k) => `<option value="${esc(k)}" ${c.list === k ? 'selected' : ''}>${esc(draft.listLabels[k] || k)}</option>`).join('')}<option value="__new__">+ Nouvelle liste</option></select>`) : '<span class="muted small">—</span>'}
              <select class="input" data-col="group" aria-label="Rubrique">${FIELD_GROUPS.map((g) => `<option value="${g.id}" ${(c.group || 'autres') === g.id ? 'selected' : ''}>${esc(g.label)}</option>`).join('')}</select>
              <label class="switch sm" data-tip="Visible par défaut"><input type="checkbox" data-col="visible" ${c.hidden ? '' : 'checked'} ${c.key === 'client' ? 'disabled' : ''}><span class="switch-track"><span class="switch-thumb"></span></span></label>
              <label class="switch sm" data-tip="Figée à gauche"><input type="checkbox" data-col="frozen" ${c.frozen ? 'checked' : ''}><span class="switch-track"><span class="switch-thumb"></span></span></label>
              ${c.system || c.type === 'computed' ? `<span class="icon-btn ghost" data-tip="Colonne nécessaire aux calculs">${icon('lock')}</span>` : `<button class="icon-btn" data-del-col="${i}" aria-label="Supprimer la colonne" data-tip="Supprimer">${icon('trash')}</button>`}
            </div>`;
          }).join('')}
        </div>
        <button class="btn btn-ghost btn-sm" data-act="add-col">${icon('plus')}Ajouter une colonne</button>
      </section>`;
    bodyEl.querySelectorAll('[data-col]').forEach((inp) => inp.addEventListener(inp.type === 'checkbox' || inp.tagName === 'SELECT' ? 'change' : 'input', () => {
      const c = draft.columns[Number(inp.closest('[data-i]').dataset.i)];
      const k = inp.dataset.col;
      if (k === 'visible') c.hidden = !inp.checked;
      else if (k === 'frozen') c.frozen = inp.checked;
      else if (k === 'type') {
        c.type = inp.value;
        if ((c.type === 'select' || c.type === 'multiselect') && !c.list) { c.list = c.key; draft.lists[c.key] = draft.lists[c.key] || []; draft.listLabels[c.key] = c.label; }
        markDirty(); renderColumns(); return;
      } else if (k === 'list' && inp.value === '__new__') {
        c.list = slugKey(c.label, Object.keys(draft.lists)); draft.lists[c.list] = []; draft.listLabels[c.list] = c.label;
        markDirty(); renderColumns(); toast('Liste créée : ajoutez ses valeurs dans « Listes de valeurs ».'); return;
      } else c[k] = inp.value;
      markDirty();
    }));
    bodyEl.querySelectorAll('[data-up],[data-down]').forEach((b) => b.addEventListener('click', () => {
      const i = Number(b.dataset.up ?? b.dataset.down);
      const j = b.dataset.up !== undefined ? i - 1 : i + 1;
      [draft.columns[i], draft.columns[j]] = [draft.columns[j], draft.columns[i]];
      markDirty(); renderColumns();
    }));
    bodyEl.querySelectorAll('[data-del-col]').forEach((b) => b.addEventListener('click', async () => {
      const i = Number(b.dataset.delCol);
      const c = draft.columns[i];
      const ok = await confirmDialog({ title: `Supprimer la colonne « ${c.label} » ?`, message: 'La colonne disparaîtra du tableau pour toute l’équipe. Les valeurs déjà saisies restent conservées dans la base et réapparaîtront si vous recréez une colonne avec la même clé.', confirmLabel: 'Supprimer', danger: true });
      if (!ok) return;
      draft.columns.splice(i, 1); markDirty(); renderColumns();
    }));
    bodyEl.querySelector('[data-act="add-col"]').addEventListener('click', () => {
      const label = 'Nouvelle colonne';
      const key = slugKey(`${label} ${draft.columns.length}`, draft.columns.map((c) => c.key));
      draft.columns.push({ key, label, type: 'text', width: 150, group: 'autres' });
      markDirty(); renderColumns();
      const inputs = bodyEl.querySelectorAll('[data-col="label"]');
      inputs[inputs.length - 1]?.select();
    });
  }

  /* Automatisations */
  function renderAuto() {
    const a = draft.automations;
    const statuses = draft.lists.statut || [];
    const links = statuses.filter((o) => o.dateField).map((o) => `<li><strong>${esc(o.value)}</strong> ↔ ${esc(draft.columns.find((c) => c.key === o.dateField)?.label || o.dateField)}</li>`).join('');
    bodyEl.innerHTML = `${head('Automatisations', 'Règles appliquées automatiquement à chaque modification, comme les macros du fichier Excel. Elles sont tracées dans le journal avec la mention « auto ».')}
      <section class="card form-card">
        <label class="switch-row"><span><strong>Statut → date</strong><span class="muted small">Quand un contrat passe à un statut lié à une date (ex. « CGV envoyées »), la date correspondante est renseignée à aujourd’hui si elle est vide.</span></span><span class="switch"><input type="checkbox" data-auto="statusStampsDate" ${a.statusStampsDate ? 'checked' : ''}><span class="switch-track"><span class="switch-thumb"></span></span></span></label>
        <label class="switch-row"><span><strong>Date → statut</strong><span class="muted small">Quand une date liée à un statut est renseignée (ex. « Date de signature »), le contrat avance à ce statut s’il était à une étape antérieure.</span></span><span class="switch"><input type="checkbox" data-auto="dateAdvancesStatus" ${a.dateAdvancesStatus ? 'checked' : ''}><span class="switch-track"><span class="switch-thumb"></span></span></span></label>
        <label class="field inline"><span class="field-label">Délai proposé pour la prochaine relance après un e-mail (jours)</span><input class="input input-xs" type="number" min="1" max="60" data-auto="followUpDays" value="${esc(a.followUpDays)}"></label>
        <div class="callout">${icon('info')}<div><strong>Liens statut ↔ date actuels</strong> (modifiables dans Listes de valeurs › Statuts) :<ul class="plain">${links || '<li>Aucun</li>'}</ul></div></div>
      </section>
      <section class="card form-card">
        <h3 class="form-title">Alertes calculées</h3>
        <ul class="plain alert-rules">
          <li>${icon('alertCircle', 'lvl-critical')} CGV non envoyées après la date limite d’envoi des CGV (L441-3 IV).</li>
          <li>${icon('alertCircle', 'lvl-critical')} Contrat non signé après la date butoir (L441-3 III) ; négociation bloquée.</li>
          <li>${icon('alert', 'lvl-serious')} Action en retard ; objectif interne dépassé ; avancement insuffisant à l’approche de la date butoir.</li>
          <li>${icon('clock', 'lvl-warning')} CGV à envoyer bientôt ; action à échéance proche ; signature attendue prochainement.</li>
          <li>${icon('info', 'lvl-info')} Contrat sans contract manager ou sans prochaine action.</li>
        </ul>
      </section>`;
    bodyEl.querySelectorAll('[data-auto]').forEach((inp) => inp.addEventListener('change', () => {
      draft.automations[inp.dataset.auto] = inp.type === 'checkbox' ? inp.checked : Number(inp.value);
      markDirty();
    }));
  }

  /* Modèles */
  function renderTemplates() {
    const tpls = draft.emailTemplates;
    const vars = ['client', 'saison', 'annee', 'dateCgv', 'dateButoir', 'joursButoir', 'version', 'statut', 'prochaineAction', 'echeance', 'blocage', 'kam', 'cm', 'moi', 'ref'];
    bodyEl.innerHTML = `${head('Modèles de relance', 'Utilisés depuis l’onglet « Relance » de chaque fiche : l’e-mail s’ouvre pré-rempli dans votre messagerie (Outlook).')}
      <div class="callout">${icon('info')}<div>Variables : ${vars.map((v) => `<code>{${v}}</code>`).join(' ')} et la clé de toute colonne.</div></div>
      ${tpls.map((t, i) => `<section class="card form-card" data-i="${i}">
        <div class="form-grid">
          <label class="field"><span class="field-label">Nom du modèle</span><input class="input" data-tpl="name" value="${esc(t.name)}"></label>
          <label class="field"><span class="field-label">Objet</span><input class="input" data-tpl="subject" value="${esc(t.subject)}"></label>
          <label class="field"><span class="field-label">Message</span><textarea class="input textarea" rows="8" data-tpl="body">${esc(t.body)}</textarea></label>
        </div>
        <div class="pop-actions"><span></span><button class="btn btn-ghost btn-sm danger" data-del-tpl="${i}">${icon('trash')}Supprimer ce modèle</button></div>
      </section>`).join('')}
      <button class="btn btn-secondary" data-act="add-tpl">${icon('plus')}Ajouter un modèle</button>`;
    bodyEl.querySelectorAll('[data-tpl]').forEach((inp) => inp.addEventListener('input', () => { draft.emailTemplates[Number(inp.closest('[data-i]').dataset.i)][inp.dataset.tpl] = inp.value; markDirty(); }));
    bodyEl.querySelectorAll('[data-del-tpl]').forEach((b) => b.addEventListener('click', () => { draft.emailTemplates.splice(Number(b.dataset.delTpl), 1); markDirty(); renderTemplates(); }));
    bodyEl.querySelector('[data-act="add-tpl"]').addEventListener('click', () => { draft.emailTemplates.push({ id: uid(8), name: 'Nouveau modèle', subject: '{saison} – {client}', body: 'Bonjour,\n\n\n\nBien cordialement,\n{moi}' }); markDirty(); renderTemplates(); });
  }

  /* Données */
  function renderData() {
    const n = store.state.list.length;
    bodyEl.innerHTML = `${head('Import, export et sauvegarde', '')}
      <div class="tiles">
        <section class="card tile-card"><span class="tile-ico">${icon('upload')}</span><h3>Importer un fichier Excel</h3><p class="muted">Reprenez votre fichier de suivi (.xlsx, .xlsm, .csv) ou collez un tableau copié depuis Excel. Les colonnes sont reconnues automatiquement ; les colonnes inconnues peuvent être créées.</p><button class="btn btn-primary" data-act="import">${icon('upload')}<span>Importer</span></button></section>
        <section class="card tile-card"><span class="tile-ico">${icon('sheet')}</span><h3>Exporter vers Excel</h3><p class="muted">Classeur mis en forme : suivi avec filtres et listes déroulantes, tableau de bord, journal et listes de valeurs.</p><button class="btn btn-secondary" data-act="export" ${n ? '' : 'disabled'}>${icon('download')}<span>Exporter ${n} contrat(s)</span></button></section>
        <section class="card tile-card"><span class="tile-ico">${icon('database')}</span><h3>Sauvegarde complète</h3><p class="muted">Fichier .json contenant paramètres, contrats et commentaires. Permet de restaurer l’outil à l’identique ou de démarrer la saison suivante.</p><div class="btn-row"><button class="btn btn-secondary" data-act="backup">${icon('download')}<span>Télécharger</span></button><label class="btn btn-ghost">${icon('upload')}<span>Restaurer…</span><input type="file" accept=".json,application/json" data-act="restore" hidden></label></div></section>
        <section class="card tile-card"><span class="tile-ico">${icon('refresh')}</span><h3>Préparer la saison suivante</h3><p class="muted">Crée le fichier de départ de la saison ${esc(String(Number(store.state.settings.season.year || 0) + 1))} : mêmes clients, équipe et réglages, jalons décalés d’un an, statuts et dates de négociation remis à zéro. À restaurer dans la nouvelle saison (voir le guide de mise en ligne).</p><button class="btn btn-secondary" data-act="next-season" ${n ? '' : 'disabled'}>${icon('download')}<span>Télécharger le fichier de départ</span></button></section>
        <section class="card tile-card"><span class="tile-ico">${icon('sparkle')}</span><h3>Données de démonstration</h3><p class="muted">Charge une quarantaine de contrats fictifs cohérents avec le calendrier de la saison, pour tester l’outil. Remplace les contrats actuels.</p><button class="btn btn-ghost" data-act="demo">${icon('sparkle')}<span>Charger la démonstration</span></button></section>
      </div>
      <section class="card form-card danger-zone">
        <h3 class="form-title">Zone sensible</h3>
        <div class="danger-row"><div><strong>Supprimer tous les contrats</strong><p class="muted small">Les paramètres et le journal sont conservés. Pensez à télécharger une sauvegarde avant.</p></div><button class="btn btn-danger" data-act="clear" ${n ? '' : 'disabled'}>${icon('trash')}<span>Tout supprimer</span></button></div>
        <div class="danger-row"><div><strong>Rétablir les paramètres par défaut</strong><p class="muted small">Colonnes, listes, jalons et modèles d’origine. Les contrats sont conservés.</p></div><button class="btn btn-secondary" data-act="reset-settings">${icon('refresh')}<span>Rétablir</span></button></div>
      </section>`;
    bodyEl.querySelector('[data-act="restore"]').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        const ok = await confirmDialog({ title: 'Restaurer cette sauvegarde ?', message: `La sauvegarde du ${data.exportedAt ? fmtDate(data.exportedAt.slice(0, 10)) : '?'} (${(data.contracts || []).length} contrats) remplacera les paramètres et les contrats actuels pour toute l’équipe.`, confirmLabel: 'Restaurer', danger: true, typed: 'RESTAURER' });
        if (!ok) return;
        await store.restoreBackup(data);
        toast('Sauvegarde restaurée.', { type: 'success' });
        resetDraft(); render();
      } catch (err) { toast(err.message || 'Fichier de sauvegarde invalide.', { type: 'error' }); }
      e.target.value = '';
    });
  }

  async function onDataClick(e) {
    const act = e.target.closest('button[data-act]')?.dataset.act;
    if (!act || section !== 'donnees') return;
    if (act === 'import') openImportDialog(ctx);
    if (act === 'export') exportExcel(ctx);
    if (act === 'backup') {
      const data = await store.exportBackup();
      downloadBlob(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }), `Sauvegarde_${(store.state.settings.season.refPrefix || 'saison')}_${todayISO()}.json`);
    }
    if (act === 'next-season') {
      const data = store.nextSeasonBackup();
      downloadBlob(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }), `Depart_saison_${data.seasonId}.json`);
      toast(`Fichier de départ de la saison ${data.seasonId} téléchargé (${data.contracts.length} clients).`, { type: 'success' });
    }
    if (act === 'demo') {
      const ok = !store.state.list.length || await confirmDialog({ title: 'Charger les données de démonstration ?', message: `Les ${store.state.list.length} contrats actuels seront remplacés par des contrats fictifs, pour toute l’équipe.`, confirmLabel: 'Charger', danger: true });
      if (!ok) return;
      await store.loadDemo(buildDemo);
      toast('Données de démonstration chargées.', { type: 'success' });
      ctx.navigate('tableau-de-bord');
    }
    if (act === 'clear') {
      const ok = await confirmDialog({ title: 'Supprimer tous les contrats ?', message: `Les ${store.state.list.length} contrats seront supprimés définitivement pour toute l’équipe.`, confirmLabel: 'Tout supprimer', danger: true, typed: 'SUPPRIMER' });
      if (!ok) return;
      await store.clearAll();
      toast('Tous les contrats ont été supprimés.', { type: 'success' });
      render();
    }
    if (act === 'reset-settings') {
      const ok = await confirmDialog({ title: 'Rétablir les paramètres par défaut ?', message: 'Les colonnes, listes, jalons, seuils, automatisations et modèles reprendront leurs valeurs d’origine. L’équipe et les contrats sont conservés.', confirmLabel: 'Rétablir', danger: true });
      if (!ok) return;
      const def = defaultSettings();
      const keep = { team: store.state.settings.team };
      await store.saveSettings(normalizeSettings({ ...def, ...keep }), 'Paramètres par défaut rétablis');
      resetDraft(); render();
      toast('Paramètres par défaut rétablis.', { type: 'success' });
    }
  }

  /* Connexion */
  function renderConnection() {
    const backend = store.state.backend;
    const me = store.me();
    const isFb = backend.kind === 'firebase';
    bodyEl.innerHTML = `${head('Connexion et partage', '')}
      <section class="card form-card">
        <div class="conn-status ${isFb ? 'ok' : 'local'}">${icon(isFb ? 'cloudCheck' : 'database')}<div><strong>${isFb ? 'Base partagée en temps réel (Firebase)' : 'Mode local : données enregistrées dans ce navigateur'}</strong><span class="muted">${esc(backend.label)}${isFb ? ` · connecté en tant que ${esc(me.email || me.name)}` : ''}</span></div></div>
        ${isFb ? `<ul class="plain checklist">
          <li>${icon('check')} Les modifications de chaque utilisateur apparaissent chez les autres en une à deux secondes.</li>
          <li>${icon('check')} Chaque modification ne touche que le champ concerné : deux personnes peuvent travailler sur le même contrat.</li>
          <li>${icon('check')} Hors connexion, les modifications sont conservées et envoyées au retour du réseau.</li>
          <li>${icon('check')} Accès réservé aux comptes autorisés dans les règles de sécurité Firestore.</li>
        </ul>` : `<div class="callout callout-warn">${icon('alert')}<div><strong>Pour travailler à plusieurs en même temps</strong>, il faut relier l’application à une base Firebase (gratuite pour cet usage). La procédure complète est décrite dans le fichier <code>docs/MISE-EN-LIGNE.md</code> du dépôt : créer le projet Firebase, activer la connexion par e-mail, créer les comptes des contract managers, coller la configuration dans <code>site/config.js</code>, publier les règles de sécurité. Comptez une quinzaine de minutes.</div></div>
          <ol class="steps-list">
            <li>Créer un projet sur <strong>console.firebase.google.com</strong> (région Europe).</li>
            <li>Activer <strong>Authentication › E-mail/Mot de passe</strong> et créer un compte par utilisateur.</li>
            <li>Créer la base <strong>Firestore</strong> et publier les règles du fichier <code>firebase/firestore.rules</code> (avec vos adresses e-mail).</li>
            <li>Copier la configuration Web de l’application dans <code>site/config.js</code>, puis publier sur GitHub.</li>
            <li>Ajouter l’adresse GitHub Pages aux <strong>domaines autorisés</strong> de Firebase Authentication.</li>
          </ol>
          <p class="muted small">Ensuite, importez vos données : Paramètres › Import, export et sauvegarde (une sauvegarde .json du mode local peut être restaurée telle quelle).</p>`}
      </section>`;
  }

  /* Outils */
  function colorPicker(anchor, onPick) {
    const wrap = document.createElement('div');
    wrap.className = 'swatches';
    wrap.innerHTML = SWATCHES.map((c) => `<button class="swatch" style="--c:${c}" data-c="${c}" aria-label="${c}"></button>`).join('');
    const p = popover(anchor, wrap, { width: 236 });
    wrap.addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (b) { p.close(); onPick(b.dataset.c); } });
  }

  function chooseReplacement(title, message, options, emptyLabel) {
    return new Promise((resolve) => {
      const body = document.createElement('div');
      body.innerHTML = `<p>${esc(message)}</p><label class="field"><span class="field-label">Remplacer par</span><select class="input"><option value="">${esc(emptyLabel)}</option>${options.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}</select></label>`;
      let result;
      modal({ title, body, size: 'sm', actions: [{ label: 'Annuler', kind: 'ghost' }, { label: 'Continuer', kind: 'primary', onClick: () => { result = body.querySelector('select').value || null; } }], onClose: () => resolve(result) });
    });
  }

  /** Mémorise la valeur d'origine de chaque option de liste (renommages calculés à l'enregistrement). */
  function tagOriginals() {
    for (const list of Object.values(draft.lists || {})) for (const o of list) o._orig = o.value;
  }

  function setPath(obj, path, value) {
    const parts = path.split('.');
    let o = obj;
    for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
    o[parts[parts.length - 1]] = value;
  }

  el.addEventListener('click', async (e) => {
    const sec = e.target.closest('[data-sec]');
    if (sec && dirty && sec.dataset.sec !== section) {
      e.preventDefault();
      const ok = await confirmDialog({ title: 'Modifications non enregistrées', message: 'Enregistrer les modifications de cette section avant de changer de section ?', confirmLabel: 'Enregistrer', cancelLabel: 'Ignorer' });
      if (ok) await save(); else resetDraft();
      ctx.navigate(`parametres/${sec.dataset.sec}`);
      return;
    }
    const act = e.target.closest('.savebar [data-act]')?.dataset.act;
    if (act === 'save') save();
    if (act === 'discard') { resetDraft(); render(); }
  });

  bodyEl.addEventListener('click', onDataClick);
  tagOriginals();
  render();
  return {
    route({ sub: next }) {
      if (next && SECTIONS.some((s) => s.id === next) && next !== section) { section = next; render(); bodyEl.parentElement.scrollTop = 0; }
    },
    update(evt) {
      if (evt === 'settings') {
        if (dirty) { remoteChanged = true; markDirty(); } else { draft = deepClone(store.state.settings); tagOriginals(); render(); }
      }
      if (evt === 'data' && !dirty && (section === 'listes' || section === 'donnees')) render();
    },
    unmount() { saveBar.remove(); },
  };
}
