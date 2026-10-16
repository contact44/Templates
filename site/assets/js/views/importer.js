// Import (fichier Excel/CSV ou collage depuis Excel) avec correspondance des colonnes,
// et export (Excel mis en forme, CSV, impression).

import { icon } from '../ui/icons.js';
import { confirmDialog, menu, modal, toast } from '../ui/overlay.js';
import { COLUMN_TYPES } from '../core/schema.js';
import {
  autoMap, buildImport, detectHeaderRow, exportCSV, exportWorkbook, ImportError, readSpreadsheet,
} from '../core/excel.js';
import { downloadBlob, esc, fmtDate, parseTSV, pluralize, todayISO } from '../core/utils.js';
import { filtersActive } from './filterbar.js';

/* ------------------------------------------------------------------ Export */

function fileStamp() { return todayISO(); }

function baseName(store) {
  return (store.state.settings.season.name || 'Suivi').replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '');
}

export async function exportExcel(ctx, ids = null) {
  const { store } = ctx;
  const all = store.state.list.slice().sort((a, b) => String(a.values.ref).localeCompare(String(b.values.ref), 'fr', { numeric: true }));
  const contracts = ids ? ids.map((id) => store.getContract(id)).filter(Boolean) : all;
  const close = toast('Préparation du fichier Excel…', { timeout: 0 });
  try {
    const history = await store.fullHistory();
    const blob = await exportWorkbook({
      settings: store.state.settings, contracts, derived: store.state.derived, history,
      filtersLabel: ids && ids.length !== all.length ? 'sélection filtrée' : '', today: store.state.today,
    });
    downloadBlob(blob, `${baseName(store)}_${fileStamp()}.xlsx`);
    close();
    toast(`Fichier Excel exporté (${pluralize(contracts.length, 'contrat', 'contrats')}).`, { type: 'success' });
  } catch (err) {
    close();
    toast(`Export impossible : ${err.message}`, { type: 'error' });
  }
}

export function exportMenu(anchor, ctx, { ids = null } = {}) {
  const { store } = ctx;
  const visible = ids || ctx.navIds || store.filtered().map((c) => c.id);
  const scoped = ids || filtersActive(store) || Object.keys(store.state.prefs.columnFilters || {}).length;
  const items = [
    { header: 'Exporter' },
    ...(scoped ? [{ label: `Excel – ${ids ? 'sélection' : 'contrats affichés'} (${visible.length})`, icon: 'sheet', onClick: () => exportExcel(ctx, visible) }] : []),
    { label: `Excel – tous les contrats (${store.state.list.length})`, icon: 'sheet', onClick: () => exportExcel(ctx) },
    { label: 'CSV pour Excel (séparateur ;)', icon: 'fileText', onClick: () => {
      const list = (scoped ? visible : store.state.list.map((c) => c.id)).map((id) => store.getContract(id)).filter(Boolean);
      downloadBlob(exportCSV({ settings: store.state.settings, contracts: list, derived: store.state.derived }), `${baseName(store)}_${fileStamp()}.csv`);
    } },
    { divider: true },
    { label: 'Imprimer ou enregistrer en PDF', icon: 'print', onClick: () => window.print() },
  ];
  menu(anchor, items, { placement: 'bottom-end' });
}

/* ------------------------------------------------------------------ Import */

export function openImportDialog(ctx) {
  const { store } = ctx;
  const body = document.createElement('div');
  body.className = 'importer';
  let parsed = null; // { sheets }
  let sheetIdx = 0;
  let headerIdx = 0;
  let mapping = [];
  let source = 'Excel';

  const m = modal({ title: 'Importer des contrats', body, size: 'xl' });

  function stepSource() {
    body.innerHTML = `
      <div class="import-tabs" role="tablist">
        <button class="quick-btn active" data-src="file" role="tab" aria-selected="true">${icon('upload')}Fichier Excel ou CSV</button>
        <button class="quick-btn" data-src="paste" role="tab" aria-selected="false">${icon('clipboard')}Coller depuis Excel</button>
      </div>
      <div class="import-pane" data-pane="file">
        <label class="dropzone" tabindex="0">
          <input type="file" accept=".xlsx,.xlsm,.csv,.txt" hidden>
          <span class="dropzone-ico">${icon('sheet')}</span>
          <strong>Déposez votre fichier ici ou cliquez pour le choisir</strong>
          <span class="muted">Formats acceptés : .xlsx, .xlsm (les macros sont ignorées), .csv</span>
        </label>
        <div class="callout">${icon('info')}<div><strong>Fichier protégé par le DRM Samsung ?</strong> Le navigateur ne peut pas lire un fichier chiffré (NASCA). Ouvrez-le dans Excel, sélectionnez le tableau avec sa ligne d’en-tête, copiez (Ctrl+C) puis utilisez l’onglet « Coller depuis Excel ».</div></div>
      </div>
      <div class="import-pane" data-pane="paste" hidden>
        <textarea class="input textarea paste-area" rows="10" placeholder="Collez ici les cellules copiées depuis Excel (avec la ligne d’en-tête)…"></textarea>
        <div class="pop-actions"><span class="muted small">La première ligne doit contenir les intitulés de colonnes.</span><button class="btn btn-primary" data-act="paste-next">Continuer${icon('chevronRight')}</button></div>
      </div>`;
    const input = body.querySelector('input[type="file"]');
    const zone = body.querySelector('.dropzone');
    body.querySelectorAll('[data-src]').forEach((b) => b.addEventListener('click', () => {
      body.querySelectorAll('[data-src]').forEach((x) => { x.classList.toggle('active', x === b); x.setAttribute('aria-selected', String(x === b)); });
      body.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== b.dataset.src; });
      if (b.dataset.src === 'paste') body.querySelector('.paste-area').focus();
    }));
    zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('over'));
    zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('over'); if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); });
    input.addEventListener('change', () => { if (input.files[0]) loadFile(input.files[0]); });
    body.querySelector('[data-act="paste-next"]').addEventListener('click', () => {
      const text = body.querySelector('.paste-area').value;
      const rows = parseTSV(text).filter((r) => r.some((c) => String(c).trim()));
      if (rows.length < 2) { toast('Collez au moins une ligne d’en-tête et une ligne de données.', { type: 'warning' }); return; }
      parsed = { sheets: [{ name: 'Collage', rows }] };
      source = 'Collage depuis Excel';
      sheetIdx = 0; headerIdx = detectHeaderRow(rows);
      mapping = autoMap(rows[headerIdx] || [], store.state.settings);
      stepMapping();
    });
  }

  async function loadFile(file) {
    const zone = body.querySelector('.dropzone');
    zone.classList.add('busy');
    zone.querySelector('strong').textContent = `Lecture de « ${file.name} »…`;
    try {
      parsed = await readSpreadsheet(file);
      source = file.name;
      // Choisit la feuille qui ressemble le plus à un tableau de suivi.
      let best = 0; let bestScore = -1;
      parsed.sheets.forEach((sh, i) => {
        const h = detectHeaderRow(sh.rows);
        const mp = autoMap(sh.rows[h] || [], store.state.settings);
        const score = mp.filter((x) => x && x !== '__new__').length * 10 + Math.min(200, sh.rows.length) / 10;
        if (score > bestScore) { best = i; bestScore = score; }
      });
      sheetIdx = best;
      prepareSheet();
      stepMapping();
    } catch (err) {
      zone.classList.remove('busy');
      zone.querySelector('strong').textContent = 'Déposez votre fichier ici ou cliquez pour le choisir';
      const msg = err instanceof ImportError ? err.message : `Lecture impossible : ${err.message}`;
      showError(msg);
    }
  }

  function showError(msg) {
    let el = body.querySelector('.import-error');
    if (!el) { el = document.createElement('div'); el.className = 'callout callout-error import-error'; body.prepend(el); }
    el.innerHTML = `${icon('alertCircle')}<div>${esc(msg)}</div>`;
  }

  function prepareSheet() {
    const rows = parsed.sheets[sheetIdx].rows;
    headerIdx = detectHeaderRow(rows);
    mapping = autoMap(rows[headerIdx] || [], store.state.settings);
  }

  function stepMapping() {
    const s = store.state.settings;
    const sheet = parsed.sheets[sheetIdx];
    const headers = (sheet.rows[headerIdx] || []).map((h) => (h instanceof Date ? fmtDate(h.toISOString().slice(0, 10)) : String(h ?? '').trim()));
    const data = sheet.rows.slice(headerIdx + 1).filter((r) => r.some((v) => v !== '' && v !== null && v !== undefined));
    const sample = (i) => data.slice(0, 40).map((r) => r[i]).filter((v) => v !== '' && v !== null && v !== undefined).slice(0, 3)
      .map((v) => (v instanceof Date ? fmtDate(v.toISOString().slice(0, 10)) : String(v))).join(' · ');
    const used = new Set(mapping.filter((x) => x && x !== '__new__'));
    const clientMapped = mapping.includes('client');
    body.innerHTML = `
      <div class="import-head">
        ${parsed.sheets.length > 1 ? `<label class="field inline"><span class="field-label">Feuille</span><select class="input" data-act="sheet">${parsed.sheets.map((sh, i) => `<option value="${i}" ${i === sheetIdx ? 'selected' : ''}>${esc(sh.name)} (${sh.rows.length} lignes)</option>`).join('')}</select></label>` : ''}
        <label class="field inline"><span class="field-label">Ligne d’en-tête</span><select class="input" data-act="header">${sheet.rows.slice(0, 20).map((r, i) => `<option value="${i}" ${i === headerIdx ? 'selected' : ''}>Ligne ${i + 1} : ${esc(r.filter((x) => x !== '').slice(0, 4).map((x) => String(x)).join(' | ').slice(0, 70))}</option>`).join('')}</select></label>
        <span class="import-count">${icon('rows')}<strong>${data.length}</strong> ligne(s) de données</span>
      </div>
      ${clientMapped ? '' : `<div class="callout callout-warn">${icon('alert')}<div>Associez une colonne à <strong>Client / Enseigne</strong> : c’est le seul champ obligatoire.</div></div>`}
      <div class="map-table-wrap"><table class="map-table">
        <thead><tr><th>Colonne du fichier</th><th>Exemples de valeurs</th><th>Champ de l’application</th></tr></thead>
        <tbody>${headers.map((h, i) => `
          <tr class="${mapping[i] ? '' : 'ignored'}">
            <td><strong>${esc(h || `(colonne ${i + 1} sans titre)`)}</strong></td>
            <td class="muted small clip-2">${esc(sample(i))}</td>
            <td><select class="input" data-map="${i}">
              <option value="" ${!mapping[i] ? 'selected' : ''}>— Ignorer —</option>
              ${h ? `<option value="__new__" ${mapping[i] === '__new__' ? 'selected' : ''}>+ Nouvelle colonne « ${esc(h)} »</option>` : ''}
              <optgroup label="Champs existants">${s.columns.filter((c) => c.type !== 'computed').map((c) => `<option value="${esc(c.key)}" ${mapping[i] === c.key ? 'selected' : ''} ${used.has(c.key) && mapping[i] !== c.key ? 'disabled' : ''}>${esc(c.label)} (${esc(COLUMN_TYPES.find((t) => t.id === c.type)?.label || c.type)})</option>`).join('')}</optgroup>
            </select></td>
          </tr>`).join('')}</tbody>
      </table></div>
      <fieldset class="import-mode">
        <legend>Mode d’import</legend>
        <label class="radio"><input type="radio" name="mode" value="append" ${store.state.list.length ? '' : 'checked'}><span><strong>Ajouter</strong> les lignes comme nouveaux contrats</span></label>
        <label class="radio"><input type="radio" name="mode" value="update" ${store.state.list.length ? 'checked' : ''} ${store.state.list.length ? '' : 'disabled'}><span><strong>Mettre à jour</strong> les contrats existants (reconnus par la référence ou le nom du client) et ajouter les autres</span></label>
        <label class="radio"><input type="radio" name="mode" value="replace" ${store.state.list.length ? '' : 'disabled'}><span><strong>Remplacer</strong> tous les contrats actuels (${store.state.list.length}) par ceux du fichier</span></label>
      </fieldset>`;
    const foot = m.el.querySelector('.modal-foot') || (() => { const f = document.createElement('footer'); f.className = 'modal-foot'; m.el.appendChild(f); return f; })();
    foot.innerHTML = `<button class="btn btn-ghost" data-act="back">${icon('chevronLeft')}Retour</button><button class="btn btn-primary" data-act="go" ${clientMapped ? '' : 'disabled'}>${icon('upload')}<span>Importer ${data.length} ligne(s)</span></button>`;
    foot.querySelector('[data-act="back"]').onclick = () => { foot.innerHTML = ''; stepSource(); };
    foot.querySelector('[data-act="go"]').onclick = () => runImport(headers, data);
    body.querySelector('[data-act="sheet"]')?.addEventListener('change', (e) => { sheetIdx = Number(e.target.value); prepareSheet(); stepMapping(); });
    body.querySelector('[data-act="header"]').addEventListener('change', (e) => { headerIdx = Number(e.target.value); mapping = autoMap(sheet.rows[headerIdx] || [], s); stepMapping(); });
    body.querySelectorAll('[data-map]').forEach((sel) => sel.addEventListener('change', () => { mapping[Number(sel.dataset.map)] = sel.value; stepMapping(); }));
  }

  async function runImport(headers, data) {
    const mode = body.querySelector('input[name="mode"]:checked')?.value || 'append';
    const s = store.state.settings;
    const prep = buildImport(s, headers, data, mapping);
    if (!prep.rows.length) { showError('Aucune ligne exploitable : vérifiez la colonne associée au client.'); return; }
    if (mode === 'replace') {
      const ok = await confirmDialog({ title: 'Remplacer tous les contrats ?', message: `Les ${store.state.list.length} contrats actuels seront supprimés pour tous les utilisateurs, puis remplacés par les ${prep.rows.length} lignes du fichier.`, confirmLabel: 'Remplacer', danger: true, typed: 'REMPLACER' });
      if (!ok) return;
    }
    const foot = m.el.querySelector('.modal-foot');
    foot.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    const changedSettings = prep.newColumns.length || Object.keys(prep.addedValues).length || prep.newMembers.length;
    if (changedSettings) {
      const desc = [prep.newColumns.length ? `${prep.newColumns.length} colonne(s)` : '', Object.keys(prep.addedValues).length ? 'valeurs de listes' : '', prep.newMembers.length ? `${prep.newMembers.length} membre(s)` : ''].filter(Boolean).join(', ');
      await store.saveSettings({ columns: prep.settings.columns, lists: prep.settings.lists, listLabels: prep.settings.listLabels, team: prep.settings.team }, `Ajouts lors de l’import : ${desc}`);
    }
    const res = await store.importContracts(prep.rows, { mode, source });
    body.innerHTML = `
      <div class="import-done">
        <div class="empty-ico ok">${icon('checkCircle')}</div>
        <h3>Import terminé</h3>
        <ul class="import-summary">
          <li><strong>${res.created}</strong> contrat(s) ajouté(s)</li>
          ${res.updated ? `<li><strong>${res.updated}</strong> contrat(s) mis à jour</li>` : ''}
          ${prep.skipped ? `<li><strong>${prep.skipped}</strong> ligne(s) ignorée(s) faute de nom de client</li>` : ''}
          ${prep.newColumns.length ? `<li>Nouvelles colonnes : ${prep.newColumns.map((c) => `<strong>${esc(c.label)}</strong> (${esc(COLUMN_TYPES.find((t) => t.id === c.type)?.label || c.type)})`).join(', ')}</li>` : ''}
          ${Object.entries(prep.addedValues).map(([k, vals]) => `<li>Valeurs ajoutées à la liste « ${esc(s.listLabels?.[k] || prep.settings.listLabels?.[k] || k)} » : ${vals.map(esc).join(', ')}</li>`).join('')}
          ${prep.newMembers.length ? `<li>Membres ajoutés à l’équipe : ${prep.newMembers.map((x) => esc(x.name)).join(', ')} (complétez leurs e-mails dans Paramètres › Équipe)</li>` : ''}
        </ul>
        ${Object.keys(prep.addedValues).includes('statut') ? `<div class="callout callout-warn">${icon('alert')}<div>De nouveaux statuts ont été créés : vérifiez leur étape (en cours, signé…) dans Paramètres › Listes de valeurs pour que les indicateurs soient justes.</div></div>` : ''}
      </div>`;
    foot.innerHTML = '<button class="btn btn-primary" data-act="close">Voir les contrats</button>';
    foot.querySelector('[data-act="close"]').onclick = () => { m.close(); ctx.navigate('suivi'); };
    toast(`Import terminé : ${res.created} ajouté(s), ${res.updated} mis à jour.`, { type: 'success' });
  }

  stepSource();
  return m;
}
