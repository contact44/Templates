// E-mail du vendredi (macro « PreparerEmailVendredi » du classeur) : images de la synthèse et du
// graphique par division dessinées sur un canevas, brouillon Outlook (.eml) avec images intégrées,
// copie HTML pour un collage dans la messagerie, lien mailto en dernier recours.

import { REPORT_STAGES, stageById, stageLabel, listOptions } from './schema.js';
import { reportByGroup } from './compute.js';
import { esc, fmtDate } from './utils.js';

const FONT = '"Inter", "Segoe UI", Arial, sans-serif';

function dateTitle(today, lang) {
  const [y, m, d] = today.split('-');
  return lang === 'en' ? `${y}/${m}/${Number(d)}` : `${Number(d)}/${m}/${y}`;
}

function canvas(w, h) {
  const scale = 2;
  const c = document.createElement('canvas');
  c.width = w * scale; c.height = h * scale;
  const g = c.getContext('2d');
  g.scale(scale, scale);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, w, h);
  return { c, g };
}

function ink(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  const [r, gg, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * gg + 0.0722 * b > 0.4 ? '#0b0b0c' : '#ffffff';
}

/** Image de la synthèse (onglet « 3.Rep Gen SYNTHESE »). */
export function drawSynthese(settings, rep, today, lang = 'fr') {
  const W = 960; const H = 330;
  const { c, g } = canvas(W, H);
  const L = (fr, en) => (lang === 'en' ? en : fr);
  g.fillStyle = '#1428a0';
  g.fillRect(0, 0, W, 6);
  g.fillStyle = '#0b0b0c';
  g.font = `700 22px ${FONT}`;
  g.fillText(L(`État d’avancement SEF au ${dateTitle(today, 'fr')}`, `SEF progress report on ${dateTitle(today, 'en')}`), 32, 50);
  const parts = REPORT_STAGES.map((st) => ({ label: stageLabel(settings, st, lang), value: rep.all.stages[st], color: stageById(st).color }));
  const total = Math.max(1, parts.reduce((a, p) => a + p.value, 0));
  // Barre 100 %.
  let x = 32; const y = 84; const bw = W - 64; const bh = 46;
  for (const p of parts) {
    if (!p.value) continue;
    const w = (p.value / total) * bw;
    g.fillStyle = p.color; g.fillRect(x, y, w, bh);
    if (w > 34) { g.fillStyle = ink(p.color); g.font = `700 16px ${FONT}`; g.textAlign = 'center'; g.fillText(String(p.value), x + w / 2, y + 29); g.textAlign = 'left'; }
    x += w;
  }
  if (!parts.some((p) => p.value)) { g.fillStyle = '#eef0f4'; g.fillRect(32, y, bw, bh); }
  // Légende.
  let lx = 32;
  g.font = `500 14px ${FONT}`;
  for (const p of parts) {
    g.fillStyle = p.color; g.fillRect(lx, 152, 14, 14);
    g.fillStyle = '#43464e';
    const label = `${p.label} : ${p.value}`;
    g.fillText(label, lx + 20, 164);
    lx += g.measureText(label).width + 44;
  }
  // Chiffres clés.
  const big = [
    [rep.all.signed, L('contrats / PAF signés', 'contracts / PAF signed'), '#0ca30c'],
    [rep.all.total, L('contrats / PAF attendus', 'contracts / PAF to be signed'), '#1428a0'],
    [`${Math.round(rep.all.pct * 100)} %`, L('de contrats signés', 'signed'), '#0b0b0c'],
  ];
  big.forEach(([v, label, color], i) => {
    const bx = 32 + i * 300;
    g.fillStyle = '#f4f5f7'; g.fillRect(bx, 196, 280, 104);
    g.fillStyle = color; g.font = `800 40px ${FONT}`; g.fillText(String(v), bx + 20, 250);
    g.fillStyle = '#43464e'; g.font = `500 15px ${FONT}`; g.fillText(label, bx + 20, 280);
  });
  return c;
}

/** Image du graphique « statut par division » (onglet « 5.Rep Gen GRAPH »), en anglais par défaut. */
export function drawDivisionChart(settings, rep, today, lang = 'en') {
  const W = 960; const H = 520;
  const { c, g } = canvas(W, H);
  const L = (fr, en) => (lang === 'en' ? en : fr);
  const statuses = listOptions(settings, 'statut');
  const segs = [];
  for (const o of statuses) {
    if (o.stage === 'done') { if (!segs.some((x) => x.done)) segs.push({ done: true, label: `${segs.length + 1}.${stageLabel(settings, 'done', lang)}`, color: o.color, values: statuses.filter((x) => x.stage === 'done').map((x) => x.value) }); } else segs.push({ label: lang === 'en' && o.en ? o.en : o.value, color: o.color, values: [o.value] });
  }
  g.fillStyle = '#1428a0'; g.fillRect(0, 0, W, 6);
  g.fillStyle = '#0b0b0c'; g.font = `700 20px ${FONT}`;
  g.fillText(L(`STATUT PAR DIVISION AU ${dateTitle(today, 'fr')}`, `DIV STATUS REPORT ON ${dateTitle(today, 'en')}`), 32, 44);
  g.fillStyle = '#676b74'; g.font = `500 13px ${FONT}`;
  g.fillText(L('Nombre de contrats / PAF', 'Number of contracts / PAF'), 32, 66);
  const groups = rep.groups;
  const max = Math.max(1, ...groups.map((x) => x.total));
  const plot = { x: 70, y: 86, w: W - 100, h: 280 };
  const step = max <= 10 ? 2 : max <= 25 ? 5 : max <= 60 ? 10 : 20;
  const top = Math.ceil(max / step) * step;
  g.strokeStyle = '#eceef2'; g.fillStyle = '#9a9da5'; g.font = `500 11px ${FONT}`; g.textAlign = 'right';
  for (let v = 0; v <= top; v += step) {
    const yy = plot.y + plot.h - (v / top) * plot.h;
    g.beginPath(); g.moveTo(plot.x, yy); g.lineTo(plot.x + plot.w, yy); g.stroke();
    g.fillText(String(v), plot.x - 8, yy + 4);
  }
  const slot = plot.w / Math.max(1, groups.length);
  const bw = Math.min(46, slot * 0.6);
  groups.forEach((grp, i) => {
    const cx = plot.x + slot * i + slot / 2;
    let yy = plot.y + plot.h;
    for (const sg of segs) {
      const n = sg.values.reduce((a, v) => a + (grp.statuses[v] || 0), 0);
      if (!n) continue;
      const h = (n / top) * plot.h;
      g.fillStyle = sg.color; g.fillRect(cx - bw / 2, yy - h, bw, h - 1);
      if (h > 16) { g.fillStyle = ink(sg.color); g.font = `700 11px ${FONT}`; g.textAlign = 'center'; g.fillText(String(n), cx, yy - h / 2 + 4); }
      yy -= h;
    }
    g.fillStyle = '#0b0b0c'; g.font = `700 12px ${FONT}`; g.textAlign = 'center';
    if (grp.total) g.fillText(String(grp.total), cx, yy - 6);
    g.fillStyle = '#43464e'; g.font = `600 11px ${FONT}`;
    g.fillText(lang === 'en' ? grp.en : grp.label, cx, plot.y + plot.h + 18);
  });
  g.textAlign = 'left';
  let lx = 32; let ly = plot.y + plot.h + 50;
  g.font = `500 12px ${FONT}`;
  for (const sg of segs) {
    const w = g.measureText(sg.label).width + 40;
    if (lx + w > W - 20) { lx = 32; ly += 22; }
    g.fillStyle = sg.color; g.fillRect(lx, ly - 10, 12, 12);
    g.fillStyle = '#43464e'; g.fillText(sg.label, lx + 18, ly);
    lx += w;
  }
  return c;
}

export function fillMailText(text, settings, today) {
  return String(text || '').replace(/\{annee\}/g, String(settings.season.year || '')).replace(/\{date\}/g, `${Number(today.slice(8))}/${today.slice(5, 7)}/${today.slice(0, 4)}`);
}

const b64 = (text) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));
const wrap76 = (s) => s.replace(/(.{76})/g, '$1\r\n');
const mimeWord = (text) => (/^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${b64(text)}?=`);
const htmlText = (t) => esc(t).replace(/\r?\n/g, '<br>');

/** Prépare l'e-mail : objet, destinataires, HTML (images en cid: ou en data:) et images PNG. */
export function buildWeeklyMail(settings, contracts, derived, today) {
  const h = settings.hebdo || {};
  const rep = reportByGroup(settings, contracts, derived);
  const synth = drawSynthese(settings, rep, today, 'fr');
  const chart = drawDivisionChart(settings, rep, today, 'en');
  const images = [
    { cid: 'synthese@suivi-cm', name: 'Synthese.png', dataUrl: synth.toDataURL('image/png'), width: 760 },
    { cid: 'graphique@suivi-cm', name: 'Graph_ENG.png', dataUrl: chart.toDataURL('image/png'), width: 760 },
  ];
  const subject = fillMailText(h.subject, settings, today);
  const before = fillMailText(h.before, settings, today);
  const after = fillMailText(h.after, settings, today);
  const html = (src) => `<div style="font-family:Arial,sans-serif;font-size:10pt">${htmlText(before)}</div>`
    + images.map((im) => `<p><img src="${src(im)}" width="${im.width}" alt="${esc(im.name)}"></p>`).join('')
    + `<div style="font-family:Arial,sans-serif;font-size:10pt">${htmlText(after)}</div>`;
  const text = `${before}\n\n[Synthèse et graphique par division en images]\n\n${after}`;
  return { to: h.to || '', cc: h.cc || '', subject, before, after, images, htmlCid: html((im) => `cid:${im.cid}`), htmlData: html((im) => im.dataUrl), text, rep };
}

/** Brouillon Outlook (.eml) : s'ouvre comme un nouveau message prêt à envoyer, images intégrées. */
export function toEml(mail) {
  const boundary = `----=_suivi_${Date.now().toString(36)}`;
  const addr = (s) => String(s || '').split(/[;,]/).map((x) => x.trim()).filter(Boolean).join(', ');
  const lines = [
    'MIME-Version: 1.0',
    'X-Unsent: 1',
    `To: ${addr(mail.to)}`,
    ...(mail.cc ? [`Cc: ${addr(mail.cc)}`] : []),
    `Subject: ${mimeWord(mail.subject)}`,
    `Content-Type: multipart/related; boundary="${boundary}"; type="text/html"`,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(b64(`<html><body>${mail.htmlCid}</body></html>`)),
  ];
  for (const im of mail.images) {
    lines.push(`--${boundary}`, `Content-Type: image/png; name="${im.name}"`, 'Content-Transfer-Encoding: base64', `Content-ID: <${im.cid}>`, `Content-Disposition: inline; filename="${im.name}"`, '', wrap76(im.dataUrl.split(',')[1]));
  }
  lines.push(`--${boundary}--`, '');
  return lines.join('\r\n');
}

export function mailtoHref(mail) {
  const to = String(mail.to || '').split(/[;,]/).map((x) => x.trim()).filter(Boolean).join(';');
  const params = [`subject=${encodeURIComponent(mail.subject)}`, `body=${encodeURIComponent(mail.text)}`];
  if (mail.cc) params.unshift(`cc=${encodeURIComponent(mail.cc)}`);
  return `mailto:${to}?${params.join('&')}`;
}

export { fmtDate };
