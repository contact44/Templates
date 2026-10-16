// Paramètres : saison, jalons et seuils, équipe, listes de valeurs (statuts GEN / DIV, divisions…),
// colonnes, regroupements des reportings, accueil, automatisations,
// données (import, export, sauvegarde) et connexion au dépôt GitHub (lien d'accès d'équipe).

import { icon } from '../ui/icons.js';
import { avatar, dateField } from '../ui/components.js';
import { confirmDialog, modal, popover, toast } from '../ui/overlay.js';
import { accessLink } from '../core/backend-github.js';
import {
  COLUMN_TYPES, FIELD_GROUPS, MILESTONE_ROLES, STAGES, SWATCHES, defaultSettings, normalizeSettings,
} from '../core/schema.js';
import { buildDemo } from '../core/demo.js';
import {
  copyText, deepClone, downloadBlob, esc, fmtDate, initials, norm, slugKey, todayISO, uid,
} from '../core/utils.js';
import { exportExcel, openImportDialog } from './importer.js';

const SECTIONS = [
  { id: 'saison', label: 'Saison, jalons et seuils', icon: 'calendar', keys: ['season', 'milestones', 'alerts'] },
  { id: 'equipe', label: 'Équipe (CM)', icon: 'users', keys: ['team'] },
  { id: 'listes', label: 'Listes de valeurs', icon: 'layers', keys: ['lists', 'listLabels'] },
  { id: 'colonnes', label: 'Colonnes', icon: 'columns', keys: ['columns', 'lists', 'listLabels'] },
  { id: 'reportings', label: 'Regroupements des reportings', icon: 'target', keys: ['reporting'] },
  { id: 'accueil', label: 'Accueil et liens', icon: 'dashboard', keys: ['home'] },
  { id: 'automatisations', label: 'Automatisations', icon: 'zap', keys: ['automations'] },
  { id: 'donnees', label: 'Import, export et sauvegarde', icon: 'database', keys: [] },
  { id: 'connexion', label: 'Connexion et partage', icon: 'cloud', keys: [] },
];

export function mount(el, ctx, { sub } = {}) {
  const { store } = ctx;
  let section = SECTIONS.some((s) => s.id === sub) ? sub : 'saison';
  let draft = deepClone(store.state.settings);
  let dirty = false;
  let remoteChanged = false;
  let listKey = 'reportDiv';
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
      if (draft.milestones.filter((m) => m.role === 'signature').length > 1) errs.push(`Un seul jalon peut avoir le rôle « ${MILESTONE_ROLES.find((r) => r.id === 'signature').label} ».`);
      if (draft.alerts.blocageDays <= draft.alerts.vigilanceDays) errs.push('Le seuil « bloqué » doit être supérieur au seuil « à surveiller ».');
    }
    if (section === 'equipe' && draft.team.some((m) => !m.name.trim())) errs.push('Chaque membre doit avoir un nom.');
    if (section === 'reportings') {
      const keys = draft.reporting.groups.map((g) => g.key.trim());
      if (keys.some((k) => !k)) errs.push('Chaque regroupement doit avoir un code.');
      if (new Set(keys).size !== keys.length) errs.push('Deux regroupements ont le même code.');
    }
    if (section === 'listes' || section === 'colonnes') {
      for (const [k, list] of Object.entries(draft.lists)) {
        const seen = new Set();
        for (const o of list) {
          if (!o.value.trim()) errs.push(`Une valeur vide existe dans la liste « ${draft.listLabels[k] || k} ».`);
          if (seen.has(norm(o.value))) errs.push(`La valeur « ${o.value} » est en double dans la liste « ${draft.listLabels[k] || k} ».`);
          seen.add(norm(o.value));
        }
      }
      if (!draft.lists.statut?.some((o) => o.stage === 'done')) errs.push('Le REPORT GEN doit contenir au moins un statut rattaché à l’étape « Contrats/PAF signés ».');
      if (!draft.lists.statutCompte?.some((o) => o.role === 'actif')) errs.push('La liste « Statut du compte » doit contenir une valeur au rôle « Actif ».');
      if (!draft.lists.statutCompte?.some((o) => o.role === 'ferme')) errs.push('La liste « Statut du compte » doit contenir une valeur au rôle « Fermé ».');
      if (draft.columns.some((c) => !c.label.trim())) errs.push('Chaque colonne doit avoir un intitulé.');
    }
    return errs;
  }

  /* ----------------------------------------------------------- Rendu */

  function render() {
    el.querySelectorAll('[data-sec]').forEach((a) => { a.classList.toggle('active', a.dataset.sec === section); if (a.dataset.sec === section) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    const fn = { saison: renderSeason, equipe: renderTeam, listes: renderLists, colonnes: renderColumns, reportings: renderReporting, accueil: renderHome, automatisations: renderAuto, donnees: renderData, connexion: renderConnection }[section];
    bodyEl.innerHTML = '';
    fn();
  }

  function head(title, text) {
    return `<header class="settings-head"><h2>${esc(title)}</h2>${text ? `<p class="muted">${text}</p>` : ''}</header>`;
  }

  /* Saison */
  function renderSeason() {
    const s = draft;
    bodyEl.innerHTML = `${head('Saison, jalons et seuils', 'Le jalon « Date butoir de signature » alimente le compte à rebours (J-…). Les seuils signalent les dossiers restés trop longtemps à la même étape.')}
      <section class="card form-card">
        <div class="form-grid cols-2">
          <label class="field"><span class="field-label">Nom de la saison</span><input class="input" data-bind="season.name" value="${esc(s.season.name)}"></label>
          <label class="field"><span class="field-label">Entité / direction</span><input class="input" data-bind="season.entity" value="${esc(s.season.entity || '')}"></label>
          <label class="field"><span class="field-label">Année des conventions</span><input class="input" type="number" data-bind="season.year" value="${esc(s.season.year)}"></label>
          <label class="field"><span class="field-label">Préfixe des références</span><input class="input" data-bind="season.refPrefix" value="${esc(s.season.refPrefix || '')}"><span class="field-help">${s.season.refPrefix ? `Exemple : ${esc(s.season.refPrefix)}-001` : 'Vide : numéros simples (1, 2, 3…), comme la colonne « Réf. » du classeur'}</span></label>
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
        <h3 class="form-title">Seuils de pilotage</h3>
        <div class="form-grid cols-2">
          <label class="field"><span class="field-label">Seuil « à surveiller » (jours au même stade)</span><input class="input" type="number" min="1" max="120" data-bind="alerts.vigilanceDays" value="${esc(s.alerts.vigilanceDays)}"></label>
          <label class="field"><span class="field-label">Seuil « bloqué » (jours au même stade)</span><input class="input" type="number" min="1" max="180" data-bind="alerts.blocageDays" value="${esc(s.alerts.blocageDays)}"></label>
          <label class="field"><span class="field-label">« % max GàG » signalé au-delà de (%)</span><input class="input" type="number" min="0" max="100" step="0.5" data-pct="alerts.gagMax" value="${esc(Math.round((s.alerts.gagMax ?? 0.15) * 1000) / 10)}"></label>
        </div>
      </section>`;
    bodyEl.querySelectorAll('[data-bind]').forEach((inp) => inp.addEventListener('input', () => { setPath(draft, inp.dataset.bind, inp.type === 'number' ? Number(inp.value) : inp.value); markDirty(); }));
    bodyEl.querySelectorAll('[data-pct]').forEach((inp) => inp.addEventListener('input', () => { setPath(draft, inp.dataset.pct, Number(inp.value) / 100); markDirty(); }));
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
    bodyEl.innerHTML = `${head('Équipe (contract managers)', 'Les membres apparaissent dans la colonne « CM référent » et dans la charge de l’équipe. Renseignez l’identifiant GitHub de chacun : l’application reconnaît alors qui est connecté (filtre « Mes comptes », journal). Les juristes se gèrent dans Listes de valeurs › Juristes.')}
      <section class="card form-card">
        <div class="edit-table team-table">
          <div class="et-head"><span></span><span>Nom</span><span>Identifiant GitHub</span><span>Rôle</span><span>Initiales</span><span>Couleur</span><span></span></div>
          ${team.map((m, i) => `<div class="et-row" data-i="${i}">
            ${avatar(m, { title: false })}
            <input class="input" data-tm="name" value="${esc(m.name)}" aria-label="Nom">
            <input class="input" data-tm="github" value="${esc(m.github || '')}" placeholder="identifiant-github" aria-label="Identifiant GitHub" autocomplete="off" spellcheck="false">
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
        const repl = await chooseReplacement(`Retirer ${m.name}`, `${used} ligne(s) ont ${m.name} comme CM référent. À qui les réassigner ?`, draft.team.filter((x) => x.id !== m.id).map((x) => ({ value: x.id, label: x.name })), 'Laisser sans CM référent');
        if (repl === undefined) return;
        memberRemovals.push({ id: m.id, replacement: repl });
      }
      draft.team.splice(i, 1); markDirty(); renderTeam();
    }));
    bodyEl.querySelector('[data-act="add-tm"]').addEventListener('click', () => {
      draft.team.push({ id: uid(8), name: 'Nouveau membre', email: '', github: '', initials: '', color: SWATCHES[draft.team.length % 8], role: 'Contract Manager' });
      markDirty(); renderTeam();
      const inputs = bodyEl.querySelectorAll('[data-tm="name"]');
      inputs[inputs.length - 1]?.select();
    });
  }

  /* Listes */
  function renderLists() {
    const keys = ['reportDiv', 'statut', ...Object.keys(draft.lists).filter((k) => k !== 'reportDiv' && k !== 'statut')].filter((k) => draft.lists[k]);
    if (!keys.includes(listKey)) listKey = keys[0];
    const list = draft.lists[listKey];
    const extra = listKey === 'reportDiv' ? 'gen' : listKey === 'statut' ? 'stage' : listKey === 'statutCompte' ? 'role' : listKey === 'division' ? 'group' : '';
    const genOpts = draft.lists.statut || [];
    const ROLES = [{ id: 'actif', label: 'Actif (suivi, charge équipe)' }, { id: 'etude', label: 'À l’étude (surligné en jaune)' }, { id: 'nouveau', label: 'Nouveau (surligné en vert)' }, { id: 'ferme', label: 'Fermé (grisé, hors alertes)' }, { id: '', label: 'Autre' }];
    const help = {
      gen: 'Les <strong>étapes REPORT PAR DIV</strong> sont celles que l’équipe renseigne pour chaque division. Chacune correspond à un statut <strong>REPORT GEN</strong>, mis à jour automatiquement : REPORT GEN n’est que la synthèse de l’étape réelle.',
      stage: 'Chaque statut REPORT GEN est rattaché à une <strong>phase</strong> (attente CC, en cours de traitement, signature, signés) : elle donne les couleurs et alimente le tableau de bord et les reportings. Le <strong>libellé anglais</strong> sert aux reportings en anglais. Les statuts REPORT GEN ne se saisissent pas : ils découlent des étapes REPORT PAR DIV.',
      role: 'Le <strong>rôle</strong> indique comment le statut du compte est compté : seuls les comptes « Actif » entrent dans la charge de l’équipe ; les comptes « Fermé » sont grisés et sans alerte.',
      group: 'Chaque division est rattachée à un <strong>regroupement</strong> des reportings (ex. MO (LCD), MO (LED) et MO (LFD) → MO). Les regroupements se gèrent dans « Regroupements des reportings ».',
    }[extra] || '';
    bodyEl.innerHTML = `${head('Listes de valeurs', 'Valeurs proposées dans les listes déroulantes (onglet « Listes déroulantes » du classeur). Renommer une valeur met à jour toutes les lignes concernées à l’enregistrement.')}
      <div class="seg-ctrl wrap" role="tablist">${keys.map((k) => `<button role="tab" class="${k === listKey ? 'active' : ''}" data-list="${esc(k)}">${esc(draft.listLabels[k] || k)}</button>`).join('')}</div>
      <section class="card form-card">
        ${help ? `<p class="muted small">${help}</p>` : ''}
        <div class="edit-table list-table ${extra ? `has-${extra}` : ''}">
          <div class="et-head"><span>Ordre</span><span>Couleur</span><span>Valeur</span>${extra === 'gen' ? '<span>REPORT GEN correspondant</span><span></span>' : extra === 'stage' ? '<span>Phase</span><span>Libellé anglais</span>' : extra === 'role' ? '<span>Rôle</span>' : extra === 'group' ? '<span>Regroupement</span>' : ''}<span>Lignes</span><span></span></div>
          ${list.map((o, i) => `<div class="et-row" data-i="${i}">
            <span class="order-btns"><button class="icon-btn" data-up="${i}" aria-label="Monter" ${i === 0 ? 'disabled' : ''}>${icon('chevronUp')}</button><button class="icon-btn" data-down="${i}" aria-label="Descendre" ${i === list.length - 1 ? 'disabled' : ''}>${icon('chevronDown')}</button></span>
            <button class="swatch-btn" data-color="${i}" style="--c:${esc(o.color)}" aria-label="Couleur"></button>
            <input class="input" data-opt="value" value="${esc(o.value)}" aria-label="Valeur">
            ${extra === 'gen' ? `<select class="input" data-opt="gen" aria-label="REPORT GEN correspondant">${genOpts.map((g) => `<option value="${esc(g.value)}" ${o.gen === g.value ? 'selected' : ''}>${esc(g.value)}</option>`).join('')}</select><span></span>` : ''}
            ${extra === 'stage' ? `<select class="input" data-opt="stage" aria-label="Phase">${STAGES.filter((st) => st.id !== 'none').map((st) => `<option value="${st.id}" ${o.stage === st.id ? 'selected' : ''}>${esc(st.label.replace('{annee}', String(draft.season.year)))}</option>`).join('')}</select>
              ${listKey === 'statut' ? `<input class="input" data-opt="en" value="${esc(o.en || '')}" placeholder="English label" aria-label="Libellé anglais">` : '<span></span>'}` : ''}
            ${extra === 'role' ? `<select class="input" data-opt="role" aria-label="Rôle">${ROLES.map((r) => `<option value="${r.id}" ${(o.role || '') === r.id ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}</select>` : ''}
            ${extra === 'group' ? `<select class="input" data-opt="group" aria-label="Regroupement"><option value="">— Aucun —</option>${(draft.reporting?.groups || []).map((g) => `<option value="${esc(g.key)}" ${o.group === g.key ? 'selected' : ''}>${esc(g.label)}${g.en && g.en !== g.label ? ` (${esc(g.en)})` : ''}</option>`).join('')}</select>` : ''}
            <span class="muted small">${o._orig ? store.countListValueUsage(listKey, o._orig) : 0} ligne(s)</span>
            <button class="icon-btn" data-del-opt="${i}" aria-label="Supprimer la valeur" data-tip="Supprimer">${icon('trash')}</button>
          </div>`).join('')}
        </div>
        <button class="btn btn-ghost btn-sm" data-act="add-opt">${icon('plus')}Ajouter une valeur</button>
      </section>`;
    bodyEl.querySelectorAll('[data-list]').forEach((b) => b.addEventListener('click', () => { listKey = b.dataset.list; renderLists(); }));
    bodyEl.querySelectorAll('[data-opt]').forEach((inp) => inp.addEventListener('input', () => {
      const o = draft.lists[listKey][Number(inp.closest('[data-i]').dataset.i)];
      const k = inp.dataset.opt;
      o[k] = inp.value;
      markDirty();
    }));
    bodyEl.querySelectorAll('[data-opt="value"]').forEach((inp) => {
      inp.addEventListener('focus', () => { inp.dataset.prev = inp.value; });
      inp.addEventListener('change', () => {
        const o = draft.lists[listKey][Number(inp.closest('[data-i]').dataset.i)];
        o.value = inp.value.trim();
        // Un statut REPORT GEN renommé : les étapes DIV qui y menaient suivent.
        if (listKey === 'statut') for (const d of draft.lists.reportDiv || []) if (d.gen === inp.dataset.prev || (o._orig && d.gen === o._orig)) d.gen = o.value;
        inp.dataset.prev = o.value;
      });
    });
    bodyEl.querySelectorAll('[data-opt="gen"]').forEach((sel) => sel.addEventListener('change', () => {
      const o = draft.lists.reportDiv[Number(sel.closest('[data-i]').dataset.i)];
      o.stage = (draft.lists.statut || []).find((g) => g.value === sel.value)?.stage || o.stage;
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
        replacement = await chooseReplacement(`Supprimer « ${o.value} »`, `${used} ligne(s) utilisent cette valeur. Par quoi la remplacer ?`, draft.lists[listKey].filter((x) => x !== o).map((x) => ({ value: x.value, label: x.value })), 'Laisser vide');
        if (replacement === undefined) return;
      }
      if (o._orig) removals.push({ list: listKey, value: o._orig, replacement: used ? replacement : undefined });
      draft.lists[listKey].splice(i, 1); markDirty(); renderLists();
    }));
    bodyEl.querySelector('[data-act="add-opt"]').addEventListener('click', () => {
      const l = draft.lists[listKey];
      l.push({ value: `Nouvelle valeur ${l.length + 1}`, color: SWATCHES[l.length % 8], ...(listKey === 'statut' ? { stage: 'active' } : {}), ...(listKey === 'reportDiv' ? { stage: 'active', gen: (draft.lists.statut || [])[0]?.value || '' } : {}), ...(listKey === 'statutCompte' ? { role: '' } : {}), _orig: null });
      markDirty(); renderLists();
      const inputs = bodyEl.querySelectorAll('[data-opt="value"]');
      inputs[inputs.length - 1]?.select();
    });
  }

  /* Colonnes */
  function renderColumns() {
    const cols = draft.columns;
    const listKeys = Object.keys(draft.lists);
    bodyEl.innerHTML = `${head('Colonnes', 'Structure du suivi, partagée par toute l’équipe : ordre, intitulés, types et thématique. Chacun peut replier des thématiques ou masquer des colonnes pour lui-même depuis le suivi.')}
      <section class="card form-card">
        <div class="edit-table col-table">
          <div class="et-head"><span></span><span>Intitulé</span><span>Type</span><span>Liste</span><span>Thématique</span><span data-tip="Colonne affichée par défaut">Visible</span><span data-tip="Colonne figée à gauche">Figée</span><span></span></div>
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

  /* Regroupements des reportings */
  function renderReporting() {
    const rep = draft.reporting;
    bodyEl.innerHTML = `${head('Regroupements des reportings', 'Colonnes des reportings général et par division (onglets « Rep Gen » du classeur) : chaque regroupement réunit une ou plusieurs divisions (Listes de valeurs › Divisions) et appartient à une famille (CE ou IM). Le libellé anglais sert aux reportings en anglais.')}
      <section class="card form-card">
        <h3 class="form-title">Familles</h3>
        <div class="edit-table rep-fam-table">
          <div class="et-head"><span>Code</span><span>Libellé</span><span>Libellé anglais</span></div>
          ${rep.families.map((f, i) => `<div class="et-row" data-fi="${i}"><input class="input input-sm" data-fam="key" value="${esc(f.key)}" aria-label="Code"><input class="input" data-fam="label" value="${esc(f.label)}" aria-label="Libellé"><input class="input" data-fam="en" value="${esc(f.en || '')}" aria-label="Libellé anglais"></div>`).join('')}
        </div>
      </section>
      <section class="card form-card">
        <h3 class="form-title">Regroupements (ordre des colonnes)</h3>
        <div class="edit-table rep-group-table">
          <div class="et-head"><span>Ordre</span><span>Code</span><span>Libellé</span><span>Libellé anglais</span><span>Famille</span><span>Divisions</span><span></span></div>
          ${rep.groups.map((g, i) => `<div class="et-row" data-gi="${i}">
            <span class="order-btns"><button class="icon-btn" data-gup="${i}" aria-label="Monter" ${i === 0 ? 'disabled' : ''}>${icon('chevronUp')}</button><button class="icon-btn" data-gdown="${i}" aria-label="Descendre" ${i === rep.groups.length - 1 ? 'disabled' : ''}>${icon('chevronDown')}</button></span>
            <input class="input input-sm" data-grp="key" value="${esc(g.key)}" aria-label="Code">
            <input class="input" data-grp="label" value="${esc(g.label)}" aria-label="Libellé">
            <input class="input" data-grp="en" value="${esc(g.en || '')}" aria-label="Libellé anglais">
            <select class="input" data-grp="family" aria-label="Famille">${rep.families.map((f) => `<option value="${esc(f.key)}" ${g.family === f.key ? 'selected' : ''}>${esc(f.label)}</option>`).join('')}</select>
            <span class="muted small">${esc((draft.lists.division || []).filter((o) => (o.group || o.value) === g.key).map((o) => o.value).join(', ') || '—')}</span>
            <button class="icon-btn" data-del-grp="${i}" aria-label="Supprimer le regroupement" data-tip="Supprimer">${icon('trash')}</button>
          </div>`).join('')}
        </div>
        <button class="btn btn-ghost btn-sm" data-act="add-grp">${icon('plus')}Ajouter un regroupement</button>
      </section>`;
    bodyEl.querySelectorAll('[data-fam]').forEach((inp) => inp.addEventListener('input', () => { draft.reporting.families[Number(inp.closest('[data-fi]').dataset.fi)][inp.dataset.fam] = inp.value.trim(); markDirty(); }));
    bodyEl.querySelectorAll('[data-grp]').forEach((inp) => inp.addEventListener(inp.tagName === 'SELECT' ? 'change' : 'input', () => {
      const g = draft.reporting.groups[Number(inp.closest('[data-gi]').dataset.gi)];
      const k = inp.dataset.grp;
      if (k === 'key') {
        const old = g.key;
        g.key = inp.value.trim();
        for (const o of draft.lists.division || []) if (o.group === old) o.group = g.key;
      } else g[k] = inp.value;
      markDirty();
    }));
    bodyEl.querySelectorAll('[data-gup],[data-gdown]').forEach((b) => b.addEventListener('click', () => {
      const i = Number(b.dataset.gup ?? b.dataset.gdown);
      const j = b.dataset.gup !== undefined ? i - 1 : i + 1;
      const l = draft.reporting.groups;
      [l[i], l[j]] = [l[j], l[i]];
      markDirty(); renderReporting();
    }));
    bodyEl.querySelectorAll('[data-del-grp]').forEach((b) => b.addEventListener('click', () => { draft.reporting.groups.splice(Number(b.dataset.delGrp), 1); markDirty(); renderReporting(); }));
    bodyEl.querySelector('[data-act="add-grp"]').addEventListener('click', () => { draft.reporting.groups.push({ key: `G${draft.reporting.groups.length + 1}`, label: 'Nouveau', en: 'New', family: draft.reporting.families[0]?.key || '' }); markDirty(); renderReporting(); });
  }

  /* Accueil */
  function renderHome() {
    const h = draft.home;
    bodyEl.innerHTML = `${head('Accueil et liens', 'En-tête de la page d’accueil et liens utiles (dossiers réseau, SharePoint…). Les notes « Dernières modifications » et « Points de vigilance » se modifient directement depuis l’accueil.')}
      <section class="card form-card">
        <div class="form-grid cols-2">
          <label class="field span-2"><span class="field-label">Titre</span><input class="input" data-home="title" value="${esc(h.title || '')}"></label>
          <label class="field"><span class="field-label">Version affichée</span><input class="input" data-home="version" value="${esc(h.version || '')}" placeholder="ex. 09/10/2026"></label>
        </div>
      </section>
      <section class="card form-card">
        <h3 class="form-title">Liens utiles</h3>
        <div class="edit-table links-table">
          <div class="et-head"><span>Libellé</span><span>Adresse (https://…, file://… ou \\\\serveur\\dossier)</span><span></span></div>
          ${(h.links || []).map((l, i) => `<div class="et-row" data-li="${i}"><input class="input" data-link="label" value="${esc(l.label)}" aria-label="Libellé"><input class="input" data-link="url" value="${esc(l.url || '')}" aria-label="Adresse" spellcheck="false"><button class="icon-btn" data-del-link="${i}" aria-label="Supprimer le lien">${icon('trash')}</button></div>`).join('')}
        </div>
        <button class="btn btn-ghost btn-sm" data-act="add-link">${icon('plus')}Ajouter un lien</button>
      </section>`;
    bodyEl.querySelectorAll('[data-home]').forEach((inp) => inp.addEventListener('input', () => { draft.home[inp.dataset.home] = inp.value; markDirty(); }));
    bodyEl.querySelectorAll('[data-link]').forEach((inp) => inp.addEventListener('input', () => { draft.home.links[Number(inp.closest('[data-li]').dataset.li)][inp.dataset.link] = inp.value.trim(); markDirty(); }));
    bodyEl.querySelectorAll('[data-del-link]').forEach((b) => b.addEventListener('click', () => { draft.home.links.splice(Number(b.dataset.delLink), 1); markDirty(); renderHome(); }));
    bodyEl.querySelector('[data-act="add-link"]').addEventListener('click', () => { draft.home.links = [...(draft.home.links || []), { label: 'Nouveau lien', url: '' }]; markDirty(); renderHome(); });
  }

  /* Automatisations */
  function renderAuto() {
    const a = draft.automations;
    bodyEl.innerHTML = `${head('Automatisations', 'Règles appliquées automatiquement à chaque modification, comme les macros et formules du classeur. Les mises à jour automatiques sont tracées dans le journal avec la mention « auto ».')}
      <section class="card form-card">
        <label class="switch-row"><span><strong>Horodatage des changements de statut</strong><span class="muted small">Tout changement d’étape date la colonne « Statut modifié le » (macro « HorodaterStatut »). Cette date alimente « Jours au stade actuel ».</span></span><span class="switch"><input type="checkbox" data-auto="stampStatusChange" ${a.stampStatusChange !== false ? 'checked' : ''}><span class="switch-track"><span class="switch-thumb"></span></span></span></label>
        <div class="switch-row"><span><strong>REPORT GEN déduit de l’étape</strong><span class="muted small">L’étape saisie (REPORT PAR DIV) fait foi : REPORT GEN est mis à jour automatiquement selon la correspondance définie dans Paramètres › Listes de valeurs › REPORT PAR DIV.</span></span><span class="mini-badge">Toujours actif</span></div>
      </section>
      <section class="card form-card">
        <h3 class="form-title">Colonnes calculées</h3>
        <ul class="plain alert-rules">
          <li><strong>Durées</strong> : revue (réception CC → revue terminée), approval, signature (mise en signature → dernière des deux signatures), totale.</li>
          <li><strong>Jours au stade actuel</strong> : depuis le dernier changement de statut ou le dernier jalon daté (comptes actifs non signés).</li>
          <li><strong>Signature N-1 + 1 an</strong> et <strong>écart vs N-1</strong> : comparaison avec la date de signature de la saison précédente.</li>
          <li><strong>Contrôle des jalons</strong> : « Ordre incohérent » (dates en rouge) ou « Date future ».</li>
        </ul>
      </section>`;
    bodyEl.querySelectorAll('[data-auto]').forEach((inp) => inp.addEventListener('change', () => {
      draft.automations[inp.dataset.auto] = inp.type === 'checkbox' ? inp.checked : Number(inp.value);
      markDirty();
    }));
  }

  /* Données */
  function renderData() {
    const n = store.state.list.length;
    bodyEl.innerHTML = `${head('Import, export et sauvegarde', '')}
      <div class="tiles">
        <section class="card tile-card"><span class="tile-ico">${icon('upload')}</span><h3>Importer le fichier Excel</h3><p class="muted">Reprenez votre fichier « Suivi CM » (.xlsm, .xlsx, .csv) ou collez un tableau copié depuis Excel. Les colonnes sont reconnues automatiquement, les colonnes calculées et les séparateurs sont ignorés.</p><button class="btn btn-primary" data-act="import">${icon('upload')}<span>Importer</span></button></section>
        <section class="card tile-card"><span class="tile-ico">${icon('sheet')}</span><h3>Exporter vers Excel</h3><p class="muted">Classeur mis en forme : suivi par thématique avec filtres et listes déroulantes, reporting général, charge de l’équipe, journal et listes de valeurs.</p><button class="btn btn-secondary" data-act="export" ${n ? '' : 'disabled'}>${icon('download')}<span>Exporter ${n} ligne(s)</span></button></section>
        <section class="card tile-card"><span class="tile-ico">${icon('database')}</span><h3>Sauvegarde complète</h3><p class="muted">Fichier .json contenant paramètres, lignes et commentaires. Permet de restaurer l’outil à l’identique ou de démarrer la saison suivante.</p><div class="btn-row"><button class="btn btn-secondary" data-act="backup">${icon('download')}<span>Télécharger</span></button><label class="btn btn-ghost">${icon('upload')}<span>Restaurer…</span><input type="file" accept=".json,application/json" data-act="restore" hidden></label></div></section>
        <section class="card tile-card"><span class="tile-ico">${icon('refresh')}</span><h3>Préparer la saison suivante</h3><p class="muted">Crée le fichier de départ de la saison ${esc(String(Number(store.state.settings.season.year || 0) + 1))} : mêmes comptes et réglages ; statuts, dates et suivi ${esc(String(store.state.settings.season.year))} basculés dans l’historique N-1 ; comptes fermés retirés. À restaurer dans la nouvelle saison (voir le guide de mise en ligne).</p><button class="btn btn-secondary" data-act="next-season" ${n ? '' : 'disabled'}>${icon('download')}<span>Télécharger le fichier de départ</span></button></section>
        <section class="card tile-card"><span class="tile-ico">${icon('sparkle')}</span><h3>Données de démonstration</h3><p class="muted">Charge des comptes fictifs à différents stades de la saison, pour tester l’outil. Remplace les lignes actuelles.</p><button class="btn btn-ghost" data-act="demo">${icon('sparkle')}<span>Charger la démonstration</span></button></section>
      </div>
      <section class="card form-card danger-zone">
        <h3 class="form-title">Zone sensible</h3>
        <div class="danger-row"><div><strong>Supprimer toutes les lignes</strong><p class="muted small">Les paramètres et le journal sont conservés. Pensez à télécharger une sauvegarde avant.</p></div><button class="btn btn-danger" data-act="clear" ${n ? '' : 'disabled'}>${icon('trash')}<span>Tout supprimer</span></button></div>
        <div class="danger-row"><div><strong>Rétablir les paramètres par défaut</strong><p class="muted small">Colonnes, listes, jalons, regroupements et modèles d’origine. L’équipe, les juristes et les lignes sont conservés.</p></div><button class="btn btn-secondary" data-act="reset-settings">${icon('refresh')}<span>Rétablir</span></button></div>
      </section>`;
    bodyEl.querySelector('[data-act="restore"]').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        const ok = await confirmDialog({ title: 'Restaurer cette sauvegarde ?', message: `La sauvegarde du ${data.exportedAt ? fmtDate(data.exportedAt.slice(0, 10)) : '?'} (${(data.contracts || []).length} lignes) remplacera les paramètres et les lignes actuelles pour toute l’équipe.`, confirmLabel: 'Restaurer', danger: true, typed: 'RESTAURER' });
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
      downloadBlob(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }), `Sauvegarde_suivi_CM_${store.state.settings.season.year}_${todayISO()}.json`);
    }
    if (act === 'next-season') {
      const data = store.nextSeasonBackup();
      downloadBlob(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }), `Depart_saison_${data.seasonId}.json`);
      toast(`Fichier de départ de la saison ${data.seasonId} téléchargé (${data.contracts.length} lignes).`, { type: 'success' });
    }
    if (act === 'demo') {
      const ok = !store.state.list.length || await confirmDialog({ title: 'Charger les données de démonstration ?', message: `Les ${store.state.list.length} lignes actuelles seront remplacées par des comptes fictifs, pour toute l’équipe.`, confirmLabel: 'Charger', danger: true, typed: store.state.list.length > 20 ? 'REMPLACER' : '' });
      if (!ok) return;
      await store.loadDemo(buildDemo);
      toast('Données de démonstration chargées.', { type: 'success' });
      ctx.navigate('accueil');
    }
    if (act === 'clear') {
      const ok = await confirmDialog({ title: 'Supprimer toutes les lignes ?', message: `Les ${store.state.list.length} lignes seront supprimées pour toute l’équipe (l’historique GitHub conserve les versions précédentes).`, confirmLabel: 'Tout supprimer', danger: true, typed: 'SUPPRIMER' });
      if (!ok) return;
      await store.clearAll();
      toast('Toutes les lignes ont été supprimées.', { type: 'success' });
      render();
    }
    if (act === 'reset-settings') {
      const ok = await confirmDialog({ title: 'Rétablir les paramètres par défaut ?', message: 'Les colonnes, listes, jalons, seuils, regroupements et modèles reprendront leurs valeurs d’origine. L’équipe, les juristes et les lignes sont conservés.', confirmLabel: 'Rétablir', danger: true });
      if (!ok) return;
      const def = defaultSettings();
      const cur = store.state.settings;
      const keep = { team: cur.team, lists: { ...def.lists, juriste: cur.lists.juriste, activite: cur.lists.activite }, homeNotes: cur.homeNotes, homeVigilance: cur.homeVigilance, hebdoWeeks: cur.hebdoWeeks, hebdo: cur.hebdo };
      await store.saveSettings(normalizeSettings({ ...def, ...keep }), 'Paramètres par défaut rétablis');
      resetDraft(); render();
      toast('Paramètres par défaut rétablis.', { type: 'success' });
    }
  }

  /* Connexion */
  function renderConnection() {
    const backend = store.state.backend;
    const me = store.me();
    const gh = backend.kind === 'github';
    const loc = backend.location || {};
    const info = backend.repoInfo;
    const pending = backend.pendingCount?.() || 0;
    bodyEl.innerHTML = `${head('Connexion et partage', '')}
      <section class="card form-card">
        <div class="conn-status ${gh ? (info && info.private === false ? 'warn' : 'ok') : 'local'}">${icon(gh ? 'cloudCheck' : 'database')}<div><strong>${gh ? 'Base partagée en temps réel : dépôt GitHub' : 'Mode local : données enregistrées dans ce navigateur'}</strong><span class="muted">${gh ? `<a href="https://github.com/${esc(loc.owner)}/${esc(loc.repo)}" target="_blank" rel="noopener noreferrer">${esc(loc.owner)}/${esc(loc.repo)}</a> · branche ${esc(backend.branch || '')} · dossier ${esc(loc.root)}/${esc(store.state.seasonId)} · connecté en tant que ${esc(me.name)}${pending ? ` · ${pending} modification(s) en attente d’envoi` : ''}` : esc(backend.label)}</span></div></div>
        ${gh && info && info.private === false ? `<div class="callout callout-danger">${icon('alertCircle')}<div><strong>Ce dépôt est public :</strong> les données sont lisibles par tout le monde sur Internet. Passez-le en privé (sur GitHub : Settings › General › Danger Zone › Change visibility) ou configurez un dépôt privé dans <code>site/config.js</code>.</div></div>` : ''}
        ${gh ? `<ul class="plain checklist">
          <li>${icon('check')} Les modifications de chacun sont enregistrées dans le dépôt en quelques secondes et apparaissent chez les autres à la lecture suivante (toutes les ${Math.round((loc.pollMs || 5000) / 1000)} s).</li>
          <li>${icon('check')} Deux personnes peuvent modifier la même ligne : seuls les champs modifiés sont réécrits, les autres sont conservés.</li>
          <li>${icon('check')} Hors connexion, les modifications sont conservées sur le poste et envoyées au retour du réseau.</li>
          <li>${icon('check')} Chaque enregistrement est un commit : l’historique complet est consultable sur GitHub et dans le Journal.</li>
        </ul>` : `<div class="callout callout-warn">${icon('alert')}<div><strong>Pour travailler à plusieurs en même temps</strong>, indiquez le dépôt GitHub de données dans <code>site/config.js</code> (voir <code>docs/MISE-EN-LIGNE.md</code>).</div></div>`}
      </section>
      ${gh ? `<section class="card form-card">
        <h3 class="form-title">${icon('link')} Lien d’accès pour l’équipe</h3>
        <p class="muted">Toute personne qui ouvre ce lien peut consulter et modifier le suivi, sans compte GitHub. Créez pour cela une clé dédiée sur GitHub (« fine-grained », limitée au dépôt <strong>${esc(loc.repo)}</strong>, permission <strong>Contents : Read and write</strong>), puis générez le lien ci-dessous. Transmettez-le uniquement aux personnes concernées : pour retirer l’accès, il suffit de supprimer la clé sur GitHub.</p>
        <div class="form-grid">
          <label class="field"><span class="field-label">Clé d’accès dédiée à l’équipe</span><span class="pw-wrap"><input class="input" type="password" id="team-token" placeholder="github_pat_…" autocomplete="off" spellcheck="false"><button type="button" class="icon-btn pw-toggle" aria-label="Afficher la clé">${icon('eye')}</button></span></label>
        </div>
        <div class="btn-row"><button class="btn btn-secondary" data-act="make-link">${icon('link')}<span>Générer et copier le lien</span></button><button class="btn btn-ghost" data-act="my-link">${icon('copy')}<span>Copier le lien avec ma propre clé</span></button></div>
        <p class="muted small">Avec un lien partagé, chacun indique son nom au premier accès (« Qui suis-je ? ») pour que le journal reste nominatif.</p>
      </section>` : ''}`;
    bodyEl.querySelector('.pw-toggle')?.addEventListener('click', (e) => {
      const inp = bodyEl.querySelector('#team-token');
      inp.type = inp.type === 'password' ? 'text' : 'password';
      e.currentTarget.innerHTML = icon(inp.type === 'password' ? 'eye' : 'eyeOff');
    });
    const copyLink = async (token) => {
      const link = accessLink(`${location.origin}${location.pathname}`, token, { owner: loc.owner, repo: loc.repo, branch: backend.branch === info?.default_branch ? '' : backend.branch });
      const ok = await copyText(link);
      toast(ok ? 'Lien d’accès copié : collez-le dans un message à l’équipe.' : 'Copie impossible.', { type: ok ? 'success' : 'error' });
    };
    bodyEl.querySelector('[data-act="make-link"]')?.addEventListener('click', () => {
      const t = bodyEl.querySelector('#team-token').value.trim();
      if (!/^(github_pat_|ghp_|gho_|ghu_)[A-Za-z0-9_]{20,}$/.test(t)) { toast('Collez une clé GitHub valide (elle commence par « github_pat_ »).', { type: 'warning' }); return; }
      copyLink(t);
    });
    bodyEl.querySelector('[data-act="my-link"]')?.addEventListener('click', async () => {
      if (!(await confirmDialog({ title: 'Partager votre propre clé ?', message: 'Les personnes qui ouvriront ce lien agiront avec votre clé GitHub (les commits porteront votre nom). Préférez une clé dédiée à l’équipe.', confirmLabel: 'Copier quand même' }))) return;
      copyLink(backend.token);
    });
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

  // Écouteurs posés sur les éléments de la vue (et non sur #main, partagé entre les vues).
  el.querySelector('.page-settings').addEventListener('click', async (e) => {
    const sec = e.target.closest('[data-sec]');
    if (sec && dirty && sec.dataset.sec !== section) {
      e.preventDefault();
      const ok = await confirmDialog({ title: 'Modifications non enregistrées', message: 'Enregistrer les modifications de cette section avant de changer de section ?', confirmLabel: 'Enregistrer', cancelLabel: 'Ignorer' });
      if (ok) await save(); else resetDraft();
      ctx.navigate(`parametres/${sec.dataset.sec}`);
    }
  });
  saveBar.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
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
