// Suivi hebdomadaire (onglet « 8.Suivi hebdo » du classeur) : e-mail du vendredi (destinataires, objet,
// textes), situation à l'instant, avancement semaine par semaine comparé à la saison précédente,
// gel de la semaine et préparation de l'e-mail avec ses images (brouillon Outlook).

import { icon } from '../ui/icons.js';
import { bindMarkTips, linesSVG } from '../ui/charts.js';
import { dateField } from '../ui/components.js';
import { modal, toast } from '../ui/overlay.js';
import { kpis, weeklyRows, weekToFreeze } from '../core/compute.js';
import { buildWeeklyMail, mailtoHref, toEml } from '../core/mail.js';
import { copyText, deepClone, downloadBlob, esc, fmtDate, fmtDateTime, fmtNumber } from '../core/utils.js';

export function mount(el, ctx) {
  const { store } = ctx;
  el.innerHTML = '<div class="page page-hebdo"></div>';
  const page = el.firstElementChild;
  let draft = null; // réglages de l'e-mail en cours de modification
  bindMarkTips(page);

  const pctTxt = (v) => (v === null || v === undefined ? '—' : `${Math.round(v * 100)} %`);

  function render() {
    const s = store.state.settings;
    const today = store.state.today;
    const year = Number(s.season.year);
    const k = kpis(s, store.state.list, store.state.derived, today);
    const rows = weeklyRows(s, store.state.list);
    const h = draft || s.hebdo;
    const freeze = weekToFreeze(s, today);
    const dark = document.documentElement.dataset.theme === 'dark';
    page.innerHTML = `
      <section class="card form-card mail-settings">
        <header class="card-head"><div><h2>${icon('mail')}E-mail du vendredi</h2><p class="card-sub">Renseignez ces champs une fois pour toutes, puis cliquez sur « Préparer l’e-mail du vendredi ». Réglages partagés avec l’équipe.</p></div></header>
        <div class="form-grid cols-2">
          <label class="field"><span class="field-label">Destinataires (À)</span><input class="input" data-h="to" value="${esc(h.to || '')}" placeholder="prenom.nom@samsung.com ; …"><span class="field-help">Adresses séparées par un point-virgule</span></label>
          <label class="field"><span class="field-label">Copie (Cc)</span><input class="input" data-h="cc" value="${esc(h.cc || '')}" placeholder="Facultatif"></label>
          <label class="field span-2"><span class="field-label">Objet</span><input class="input" data-h="subject" value="${esc(h.subject || '')}"><span class="field-help">{date} = date du jour, {annee} = année de la saison</span></label>
          <label class="field"><span class="field-label">Texte avant les graphiques</span><textarea class="input textarea" rows="4" data-h="before">${esc(h.before || '')}</textarea></label>
          <label class="field"><span class="field-label">Texte après les graphiques</span><textarea class="input textarea" rows="4" data-h="after">${esc(h.after || '')}</textarea><span class="field-help">Votre signature Outlook s’ajoute à l’ouverture du brouillon</span></label>
          <label class="field"><span class="field-label">Premier vendredi suivi</span><span class="slot" data-date="start"></span></label>
          <label class="field"><span class="field-label">Dernier vendredi suivi</span><span class="slot" data-date="end"></span></label>
        </div>
        <div class="pop-actions">${draft ? `<span class="muted small">Modifications non enregistrées</span><button class="btn btn-ghost btn-sm" data-act="discard">Annuler</button><button class="btn btn-primary btn-sm" data-act="save">${icon('check')}<span>Enregistrer</span></button>` : '<span></span>'}</div>
      </section>

      <section class="card hebdo-now">
        <div class="now-figs">
          <div><span class="kpi-label">Situation à l’instant · attendus</span><span class="kpi-value">${fmtNumber(k.attendus)}</span></div>
          <div><span class="kpi-label">Signés / clôturés</span><span class="kpi-value good">${fmtNumber(k.signes)}</span></div>
          <div><span class="kpi-label">% signés</span><span class="kpi-value">${pctTxt(k.signedPct)}</span></div>
        </div>
        <div class="btn-row">
          <button class="btn btn-secondary" data-act="freeze" ${freeze ? '' : 'disabled'} data-tip="${freeze ? `Enregistre les chiffres du moment pour le vendredi ${fmtDate(freeze)}` : 'Le suivi commence plus tard'}">${icon('lock')}<span>Figer la semaine</span></button>
          <button class="btn btn-primary" data-act="mail">${icon('send')}<span>Préparer l’e-mail du vendredi</span></button>
        </div>
      </section>

      <section class="card report-card">
        <header class="card-head"><div><h2>Avancement semaine par semaine</h2><p class="card-sub">Chaque vendredi, « Préparer l’e-mail » fige la ligne de la semaine. Signés = signés + clôturés SELMS. Référence ${year - 1} : PAF entièrement signés à la même date un an plus tôt.</p></div></header>
        <div class="grid-2 hebdo-grid">
          <div class="table-scroll" tabindex="0" role="region" aria-label="Avancement semaine par semaine"><table class="report-table">
            <thead><tr><th scope="col">Vendredi</th><th scope="col">Attendus ${year}</th><th scope="col">Signés ${year}</th><th scope="col">% signés ${year}</th><th scope="col">% signés ${year - 1} (même date)</th><th scope="col">Figé le</th></tr></thead>
            <tbody>${rows.map((r) => `<tr class="${r.date === freeze ? 'row-current' : ''}"><th scope="row">${esc(fmtDate(r.date))}</th><td>${r.attendus ?? ''}</td><td>${r.signes ?? ''}</td><td>${r.pct === null ? '' : pctTxt(r.pct)}</td><td class="muted">${pctTxt(r.pctN1)}</td><td class="small muted">${r.figeLe ? `${esc(fmtDateTime(r.figeLe))}${r.par ? ` · ${esc(r.par)}` : ''}` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Définissez la période du suivi ci-dessus.</td></tr>'}</tbody>
          </table></div>
          <div class="hebdo-chart">${rows.length ? linesSVG([
            { label: `% signés ${year}`, color: dark ? '#6f86ff' : '#1428a0', values: rows.map((r) => r.pct) },
            { label: `% signés ${year - 1} (même date)`, color: dark ? '#979aa3' : '#8d9099', values: rows.map((r) => r.pctN1), dashed: true },
          ], rows.map((r) => fmtDate(r.date, 'dm')), { width: 560, height: 260 }) : ''}</div>
        </div>
      </section>`;
    page.querySelectorAll('[data-date]').forEach((slot) => {
      const key = slot.dataset.date;
      slot.replaceWith(dateField(h[key], (v) => { draft = draft || deepClone(s.hebdo); draft[key] = v || ''; render(); }, { ariaLabel: key === 'start' ? 'Premier vendredi' : 'Dernier vendredi' }));
    });
  }

  page.addEventListener('input', (e) => {
    const f = e.target.closest('[data-h]');
    if (!f) return;
    const wasDirty = !!draft;
    draft = draft || deepClone(store.state.settings.hebdo);
    draft[f.dataset.h] = f.value;
    if (!wasDirty) {
      const bar = page.querySelector('.mail-settings .pop-actions');
      bar.innerHTML = `<span class="muted small">Modifications non enregistrées</span><button class="btn btn-ghost btn-sm" data-act="discard">Annuler</button><button class="btn btn-primary btn-sm" data-act="save">${icon('check')}<span>Enregistrer</span></button>`;
    }
  });

  page.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'discard') { draft = null; render(); }
    if (act === 'save') {
      await store.saveSettings({ hebdo: draft }, 'Réglages de l’e-mail du vendredi');
      draft = null;
      toast('Réglages enregistrés pour toute l’équipe.', { type: 'success' });
      render();
    }
    if (act === 'freeze') {
      const r = await store.freezeWeek();
      if (r) toast(`Semaine du ${fmtDate(r.date)} figée : ${r.signes} signés sur ${r.attendus}.`, { type: 'success' });
    }
    if (act === 'mail') await prepareMail();
  });

  async function prepareMail() {
    if (draft) { await store.saveSettings({ hebdo: draft }, 'Réglages de l’e-mail du vendredi'); draft = null; }
    const s = store.state.settings;
    if (!String(s.hebdo?.to || '').trim()) {
      toast('Renseignez d’abord les destinataires de l’e-mail du vendredi.', { type: 'warning' });
      page.querySelector('[data-h="to"]')?.focus();
      return;
    }
    const frozen = await store.freezeWeek();
    const mail = buildWeeklyMail(store.state.settings, store.state.list, store.state.derived, store.state.today);
    const body = document.createElement('div');
    body.className = 'mail-preview';
    body.innerHTML = `
      <dl class="mail-head"><dt>À</dt><dd>${esc(mail.to)}</dd>${mail.cc ? `<dt>Cc</dt><dd>${esc(mail.cc)}</dd>` : ''}<dt>Objet</dt><dd><strong>${esc(mail.subject)}</strong></dd></dl>
      <div class="mail-body">${mail.htmlData}</div>
      <p class="muted small">${frozen ? `Semaine du ${esc(fmtDate(frozen.date))} figée. ` : ''}Le brouillon Outlook (.eml) s’ouvre comme un nouveau message, images comprises : vérifiez, ajoutez votre signature si besoin, puis envoyez.</p>`;
    const log = (how) => store.logEvent(null, { action: 'mail', to: `E-mail du vendredi préparé (${how})` });
    modal({
      title: 'E-mail du vendredi',
      size: 'lg',
      body,
      actions: [
        { label: 'Ouvrir la messagerie (texte seul)', kind: 'ghost', icon: 'mail', onClick: () => { window.location.href = mailtoHref(mail); log('messagerie'); return false; } },
        {
          label: 'Copier l’e-mail', kind: 'secondary', icon: 'copy', onClick: async () => {
            let ok = false;
            try {
              await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([mail.htmlData], { type: 'text/html' }), 'text/plain': new Blob([mail.text], { type: 'text/plain' }) })]);
              ok = true;
            } catch { ok = await copyText(mail.text); }
            toast(ok ? 'E-mail copié : collez-le dans un nouveau message (Ctrl+V).' : 'Copie impossible depuis ce navigateur.', { type: ok ? 'success' : 'error' });
            if (ok) log('copie');
            return false;
          },
        },
        { label: 'Télécharger le brouillon Outlook', kind: 'primary', icon: 'download', onClick: () => { downloadBlob(new Blob([toEml(mail)], { type: 'message/rfc822' }), `Suivi_hebdo_${store.state.today}.eml`); log('brouillon Outlook'); return false; } },
      ],
    });
  }

  render();
  const schedule = (() => { let t = null; return () => { if (t) return; t = requestAnimationFrame(() => { t = null; if (!page.contains(document.activeElement) || !document.activeElement.matches('input, textarea')) render(); }); }; })();
  return { update(evt) { if (evt === 'data' || evt === 'settings') schedule(); } };
}
