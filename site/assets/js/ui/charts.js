// Graphiques du tableau de bord : barres horizontales, barres empilées, courbe de signatures,
// frise de la saison. Marques fines, grille discrète, infobulles au survol et au clavier.

import { esc, fmtDate, fmtNumber, diffDays, inkOn, isoToUTC, utcToISO } from '../core/utils.js';

/* ------------------------------------------------------- Infobulle unique */

let tt = null;
function tooltipEl() {
  if (!tt) {
    tt = document.createElement('div');
    tt.className = 'chart-tt';
    tt.setAttribute('role', 'status');
    document.body.appendChild(tt);
  }
  return tt;
}

/** rows : [{ value, label, color }] — la valeur est mise en avant, le libellé suit. */
export function showChartTip(x, y, title, rows) {
  const el = tooltipEl();
  el.innerHTML = `${title ? `<div class="chart-tt-title">${esc(title)}</div>` : ''}${rows.map((r) => `<div class="chart-tt-row">${r.color ? `<span class="chart-tt-key" style="--c:${esc(r.color)}"></span>` : ''}<strong>${esc(r.value)}</strong><span>${esc(r.label)}</span></div>`).join('')}`;
  el.classList.add('show');
  const w = el.offsetWidth; const h = el.offsetHeight;
  let left = x + 14; let top = y - h - 12;
  if (left + w > window.innerWidth - 8) left = x - w - 14;
  if (top < 8) top = y + 16;
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
}
export function hideChartTip() { tt?.classList.remove('show'); }

/** Branche les infobulles sur les marques portant data-tt (JSON { title, rows }). */
export function bindMarkTips(container) {
  const show = (target, x, y) => {
    try {
      const d = JSON.parse(target.getAttribute('data-tt'));
      showChartTip(x, y, d.title, d.rows);
      target.classList.add('hover');
    } catch { /* données invalides */ }
  };
  container.addEventListener('pointermove', (e) => {
    const t = e.target.closest('[data-tt]');
    container.querySelectorAll('[data-tt].hover').forEach((x) => { if (x !== t) x.classList.remove('hover'); });
    if (t) show(t, e.clientX, e.clientY); else hideChartTip();
  });
  container.addEventListener('pointerleave', () => { hideChartTip(); container.querySelectorAll('[data-tt].hover').forEach((x) => x.classList.remove('hover')); });
  container.addEventListener('focusin', (e) => {
    const t = e.target.closest('[data-tt]');
    if (!t) return;
    const r = t.getBoundingClientRect();
    show(t, r.left + r.width / 2, r.top);
  });
  container.addEventListener('focusout', hideChartTip);
}

const tip = (title, rows) => esc(JSON.stringify({ title, rows }));

/* --------------------------------------------- Barres horizontales simples */

/**
 * rows : [{ label, value, color, sub, onClickId }]
 * Une seule série : pas de légende, la valeur est écrite au bout de la barre.
 */
export function barListHTML(rows, { format = (v) => fmtNumber(v), max = null, unit = '' } = {}) {
  const m = max ?? Math.max(1, ...rows.map((r) => r.value));
  return `<div class="hbars" role="list">${rows.map((r) => {
    const pct = m ? (r.value / m) * 100 : 0;
    return `<div class="hbar-row${r.value ? '' : ' is-zero'}" role="listitem" ${r.key !== undefined ? `data-key="${esc(r.key)}"` : ''}>
      <span class="hbar-label">${r.color ? `<span class="chip-dot" style="--c:${esc(r.color)}"></span>` : ''}<span class="clip">${esc(r.label)}</span></span>
      <span class="hbar-track" tabindex="0" data-tt="${tip(r.label, [{ value: `${format(r.value)}${unit}`, label: r.tipLabel || 'contrats' }, ...(r.sub ? [{ value: r.sub, label: r.subLabel || '' }] : [])])}">
        <span class="hbar-fill" style="width:${Math.max(r.value ? 1.5 : 0, pct)}%;--c:${esc(r.color || 'var(--brand)')}"></span>
        <span class="hbar-value">${esc(format(r.value))}${r.sub ? `<span class="hbar-sub">${esc(r.sub)}</span>` : ''}</span>
      </span>
    </div>`;
  }).join('')}</div>`;
}

/* ------------------------------------------------------ Barres empilées */

/**
 * groups : [{ key, label, counts: { segKey: n }, total, extra }]
 * segments : [{ key, label, color }] dans l'ordre d'empilement.
 */
export function stackedHTML(groups, segments, { showLegend = true, mode = 'count' } = {}) {
  const max = Math.max(1, ...groups.map((g) => g.total));
  const legend = showLegend ? `<div class="legend">${segments.map((s) => `<span class="legend-item"><span class="legend-swatch" style="--c:${esc(s.color)}"></span>${esc(s.label)}</span>`).join('')}</div>` : '';
  const rows = groups.map((g) => {
    const width = mode === 'percent' ? 100 : (g.total / max) * 100;
    const segs = segments.map((s) => {
      const n = g.counts[s.key] || 0;
      if (!n) return '';
      const share = g.total ? n / g.total : 0;
      const rows2 = [{ value: `${n} contrat${n > 1 ? 's' : ''}`, label: s.label, color: s.color }, { value: `${Math.round(share * 100)} %`, label: `de ${g.label}` }];
      return `<span class="seg" style="flex:${n} 1 0;--c:${esc(s.color)}" tabindex="0" data-tt="${tip(g.label, rows2)}"><span class="seg-label" style="color:${inkOn(s.color)}">${n}</span></span>`;
    }).join('');
    const done = g.counts.done || 0;
    return `<div class="stack-row" data-key="${esc(g.key)}">
      <span class="stack-label clip" title="${esc(g.label)}">${esc(g.label)}</span>
      <span class="stack-track"><span class="stack-bar" style="width:${Math.max(g.total ? 2 : 0, width)}%">${segs}</span>
      <span class="stack-total">${g.total}${g.total ? `<span class="stack-pct">${Math.round((done / g.total) * 100)} % signés</span>` : ''}</span></span>
    </div>`;
  }).join('');
  return `${legend}<div class="stacks">${rows || '<p class="muted small">Aucune donnée.</p>'}</div>`;
}

/** Masque les étiquettes qui ne tiennent pas dans leur segment (jamais tronquées). */
export function fitSegmentLabels(container) {
  container.querySelectorAll('.seg').forEach((seg) => {
    const lab = seg.querySelector('.seg-label');
    if (!lab) return;
    lab.style.visibility = 'hidden';
    lab.style.display = '';
    const fits = seg.clientWidth >= lab.scrollWidth + 10;
    lab.style.display = fits ? '' : 'none';
    lab.style.visibility = '';
  });
}

/* ----------------------------------------------------- Courbe de signatures */

/**
 * series = { points:[{date,value}], target:[{date,value}], start, end, total }
 * marks = [{ date, label }] (jalons), today
 */
export function renderBurnup(el, series, { marks = [], today, colors }) {
  const W = Math.max(300, el.clientWidth || 600);
  const H = 240;
  const m = { l: 34, r: 16, t: 26, b: 28 };
  const iw = W - m.l - m.r; const ih = H - m.t - m.b;
  const t0 = isoToUTC(series.start); const t1 = isoToUTC(series.end);
  const span = Math.max(1, t1 - t0);
  const x = (iso) => m.l + ((isoToUTC(iso) - t0) / span) * iw;
  const maxY = Math.max(4, series.total, ...series.points.map((p) => p.value));
  const step = niceStep(maxY);
  const top = Math.ceil(maxY / step) * step;
  const y = (v) => m.t + ih - (v / top) * ih;
  const ticksY = [];
  for (let v = 0; v <= top; v += step) ticksY.push(v);

  // Graduations mensuelles.
  const months = [];
  const d0 = new Date(t0);
  let cur = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, 1);
  while (cur <= t1) { months.push(utcToISO(cur)); const d = new Date(cur); cur = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); }

  const pts = series.points;
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
  const area = pts.length ? `${line}L${x(pts[pts.length - 1].date).toFixed(1)},${y(0)}L${x(pts[0].date).toFixed(1)},${y(0)}Z` : '';
  const target = series.target.length === 2 ? `M${x(series.target[0].date).toFixed(1)},${y(series.target[0].value).toFixed(1)}L${x(series.target[1].date).toFixed(1)},${y(series.target[1].value).toFixed(1)}` : '';
  const last = pts[pts.length - 1];

  el.innerHTML = `
    <div class="legend">
      <span class="legend-item"><span class="legend-line" style="--c:${colors.actual}"></span>Contrats signés (cumul)</span>
      <span class="legend-item"><span class="legend-line" style="--c:${colors.target}"></span>Trajectoire cible jusqu’à la date butoir</span>
    </div>
    <svg class="burnup" viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Courbe des signatures cumulées">
      <g class="grid">${ticksY.map((v) => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/><text class="tick" x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('')}</g>
      <g class="xaxis">${months.map((iso) => `<line class="mtick" x1="${x(iso)}" x2="${x(iso)}" y1="${y(0)}" y2="${y(0) + 4}"/><text class="tick" x="${x(iso) + 3}" y="${H - 8}">${esc(fmtDate(iso, 'monthShort'))}</text>`).join('')}</g>
      <g class="marks">${marks.filter((mk) => mk.date >= series.start && mk.date <= series.end).map((mk, i) => `<line x1="${x(mk.date)}" x2="${x(mk.date)}" y1="${m.t - 6}" y2="${y(0)}"/><text x="${Math.min(W - m.r, x(mk.date) + 4)}" y="${m.t - 10 + (i % 2) * 0}" class="mark-label" text-anchor="${x(mk.date) > W - 120 ? 'end' : 'start'}" dx="${x(mk.date) > W - 120 ? -8 : 0}">${esc(mk.label)}</text>`).join('')}</g>
      ${target ? `<path d="${target}" class="target-line" style="stroke:${colors.target}"/>` : ''}
      ${area ? `<path d="${area}" class="actual-area" style="fill:${colors.actual}"/>` : ''}
      ${line ? `<path d="${line}" class="actual-line" style="stroke:${colors.actual}"/>` : ''}
      ${today >= series.start && today <= series.end ? `<line class="today-line" x1="${x(today)}" x2="${x(today)}" y1="${m.t}" y2="${y(0)}"/>` : ''}
      ${last ? `<circle class="end-dot" cx="${x(last.date)}" cy="${y(last.value)}" r="4.5" style="fill:${colors.actual}"/><text class="end-label" x="${x(last.date) + 9}" y="${y(last.value) - 8}">${last.value}</text>` : ''}
      <line class="crosshair" x1="0" x2="0" y1="${m.t}" y2="${y(0)}" visibility="hidden"/>
      <rect class="hit" x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent" tabindex="0" role="img" aria-label="Zone de lecture des valeurs : survolez ou parcourez au clavier"/>
    </svg>`;

  const svg = el.querySelector('svg');
  const hit = el.querySelector('.hit');
  const cross = el.querySelector('.crosshair');
  const targetAt = (iso) => {
    if (series.target.length !== 2) return null;
    const [a, b] = series.target;
    if (iso < a.date) return 0;
    if (iso > b.date) return b.value;
    return (b.value * diffDays(a.date, iso)) / Math.max(1, diffDays(a.date, b.date));
  };
  const onMove = (clientX, clientY) => {
    const r = svg.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * W;
    const t = t0 + ((px - m.l) / iw) * span;
    const iso = utcToISO(Math.max(t0, Math.min(t1, Math.round(t / 86400000) * 86400000)));
    const p = pts.find((q) => q.date === iso) || (iso > (last?.date || '') ? null : pts[0]);
    cross.setAttribute('x1', x(iso)); cross.setAttribute('x2', x(iso)); cross.setAttribute('visibility', 'visible');
    const rows = [];
    if (p) rows.push({ value: `${p.value}`, label: 'signés (cumul)', color: colors.actual });
    const tv = targetAt(iso);
    if (tv !== null) rows.push({ value: `${Math.round(tv)}`, label: 'objectif à date', color: colors.target });
    showChartTip(clientX, clientY, fmtDate(iso, 'weekday'), rows);
  };
  hit.addEventListener('pointermove', (e) => onMove(e.clientX, e.clientY));
  hit.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); hideChartTip(); });
  hit.addEventListener('focus', () => { const r = hit.getBoundingClientRect(); onMove(r.left + (x(today) - m.l) / iw * r.width, r.top + 20); });
  hit.addEventListener('blur', () => { cross.setAttribute('visibility', 'hidden'); hideChartTip(); });
}

function niceStep(max) {
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return Math.max(1, step * pow);
}

/* ------------------------------------------------------- Frise de la saison */

/** Frise : jalons, aujourd'hui, avancement du temps entre premier et dernier jalon.
 *  Les étiquettes trop proches passent sur une seconde ligne (jamais superposées). */
export function timelineHTML(milestones, today, { width = 1000 } = {}) {
  const ms = milestones.filter((m) => m.date).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  if (ms.length < 2) return '';
  const start = ms[0].date; const end = ms[ms.length - 1].date;
  const total = Math.max(1, diffDays(start, end));
  const pos = (iso) => Math.max(0, Math.min(100, (diffDays(start, iso) / total) * 100));
  const tpos = pos(today);
  const inRange = today >= start && today <= end;
  const W = Math.max(320, width);
  const rowsEnd = [];
  const placed = ms.map((m, i) => {
    const align = i === 0 ? 'start' : i === ms.length - 1 ? 'end' : 'mid';
    const textW = Math.max(fmtDate(m.date, 'dm').length * 8 + 44, Math.min(190, m.label.length * 6.4)) + 16;
    const wPct = (textW / W) * 100;
    const p = pos(m.date);
    const range = align === 'start' ? [p, p + wPct] : align === 'end' ? [p - wPct, p] : [p - wPct / 2, p + wPct / 2];
    let row = rowsEnd.findIndex((e) => range[0] > e);
    if (row < 0) { row = rowsEnd.length; rowsEnd.push(range[1]); } else rowsEnd[row] = range[1];
    return { m, align, row, p };
  });
  const rows = Math.max(1, rowsEnd.length);
  return `<div class="season-line" role="img" aria-label="Frise de la saison" style="--rows:${rows}">
    <div class="season-track"><div class="season-elapsed" style="width:${tpos}%"></div></div>
    ${placed.map(({ m, align, row, p }) => {
      const passed = today >= m.date;
      const d = diffDays(today, m.date);
      return `<div class="ms ms-${align}${passed ? ' passed' : ''}${m.role ? ` ms-role-${esc(m.role)}` : ''}" style="left:${p}%;--row:${row}" tabindex="0" data-tip="${esc(`${m.label} — ${fmtDate(m.date, 'long')}${m.note ? `\n${m.note}` : ''}`)}">
        <span class="ms-dot"></span>
        ${row ? '<span class="ms-leader"></span>' : ''}
        <span class="ms-text"><span class="ms-date">${esc(fmtDate(m.date, 'dm'))}${!passed ? `<span class="ms-count">J-${d}</span>` : ''}</span><span class="ms-label">${esc(m.label)}</span></span>
      </div>`;
    }).join('')}
    ${inRange ? `<div class="today-pin" style="left:${tpos}%"><span>Aujourd’hui</span></div>` : ''}
  </div>`;
}

/* ---------------------------------------------- Colonnes empilées (reporting) */

/**
 * Une colonne par groupe (division), segments empilés par statut (onglet « 5.Rep Gen GRAPH »).
 * groups : [{ key, label, counts: { seg: n }, total }] ; segments : [{ key, label, color }].
 */
export function columnsHTML(groups, segments, { height = 260, unit = 'contrats / PAF' } = {}) {
  const max = Math.max(1, ...groups.map((g) => g.total));
  const step = niceStep(max);
  let top = Math.ceil(max / step) * step;
  if (top - max < step / 2) top += step; // place pour le total au-dessus de la plus haute colonne
  const ticks = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  const cols = groups.map((g) => {
    const segs = segments.map((s) => {
      const n = g.counts[s.key] || 0;
      if (!n) return '';
      return `<span class="vseg" style="flex:${n} 1 0;--c:${esc(s.color)}" tabindex="0" data-tt="${tip(g.label, [{ value: `${n}`, label: s.label, color: s.color }, { value: `${Math.round((n / g.total) * 100)} %`, label: `des ${g.total} ${unit}` }])}">${n / top * height >= 16 ? `<span class="vseg-label" style="color:${inkOn(s.color)}">${n}</span>` : ''}</span>`;
    }).join('');
    return `<div class="vcol" role="listitem"><div class="vcol-plot" style="height:${height}px"><div class="vcol-stack" style="height:${(g.total / top) * 100}%">${segs}</div><span class="vcol-total" style="bottom:calc(${(g.total / top) * 100}% + 4px)">${g.total || ''}</span></div><span class="vcol-label">${esc(g.label)}</span></div>`;
  }).join('');
  return `<div class="vchart">
    <div class="vaxis" style="height:${height}px">${ticks.map((v) => `<span style="bottom:${(v / top) * 100}%">${v}</span>`).join('')}</div>
    <div class="vcols" role="list" style="--h:${height}px">${ticks.map((v) => `<span class="vgrid" style="bottom:calc(${(v / top) * height}px + 22px)"></span>`).join('')}${cols}</div>
  </div>
  <div class="legend legend-wrap">${segments.map((s) => `<span class="legend-item"><span class="legend-swatch" style="--c:${esc(s.color)}"></span>${esc(s.label)}</span>`).join('')}</div>`;
}

/* ------------------------------------------- Barre 100 % (synthèse générale) */

/** parts : [{ label, value, color }] — une barre 100 % avec valeurs et légende (onglet « 3.Rep Gen SYNTHESE »). */
export function stack100HTML(parts) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  const segs = parts.map((p) => {
    if (!p.value) return '';
    const share = total ? p.value / total : 0;
    return `<span class="seg" style="flex:${p.value} 1 0;--c:${esc(p.color)}" tabindex="0" data-tt="${tip(p.label, [{ value: `${p.value}`, label: 'contrats / PAF', color: p.color }, { value: `${Math.round(share * 100)} %`, label: 'du total' }])}"><span class="seg-label" style="color:${inkOn(p.color)}">${p.value}</span></span>`;
  }).join('');
  return `<div class="stack100"><span class="stack-bar">${segs || '<span class="seg empty"></span>'}</span></div>
    <div class="legend legend-wrap">${parts.map((p) => `<span class="legend-item"><span class="legend-swatch" style="--c:${esc(p.color)}"></span>${esc(p.label)} <strong>${p.value}</strong>${total ? ` <span class="muted">(${Math.round((p.value / total) * 100)} %)</span>` : ''}</span>`).join('')}</div>`;
}

/* ------------------------------------------------------ Anneau (répartition) */

/** slices : [{ label, value, color }] ; affiche un anneau et la liste des valeurs (nombre ou %). */
export function donutHTML(slices, { size = 200, mode = 'count', center = null } = {}) {
  const total = slices.reduce((a, s) => a + s.value, 0);
  const r = size / 2 - 14; const cx = size / 2; const cy = size / 2; const w = 26;
  let a0 = -Math.PI / 2;
  const arcs = slices.filter((s) => s.value > 0).map((s) => {
    const frac = total ? s.value / total : 0;
    const a1 = a0 + frac * Math.PI * 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const gap = slices.filter((x) => x.value > 0).length > 1 ? 0.012 : 0;
    const p = (a, rr) => `${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`;
    const d = frac >= 0.9999
      ? `M${cx},${cy - r}A${r},${r} 0 1 1 ${cx - 0.01},${cy - r}L${cx - 0.01},${cy - r + w}A${r - w},${r - w} 0 1 0 ${cx},${cy - r + w}Z`
      : `M${p(a0 + gap, r)}A${r},${r} 0 ${large} 1 ${p(a1 - gap, r)}L${p(a1 - gap, r - w)}A${r - w},${r - w} 0 ${large} 0 ${p(a0 + gap, r - w)}Z`;
    a0 = a1;
    return `<path d="${d}" fill="${esc(s.color)}" tabindex="0" data-tt="${tip(s.label, [{ value: `${s.value}`, label: 'contrats / PAF', color: s.color }, { value: `${Math.round(frac * 100)} %`, label: 'du total' }])}"/>`;
  }).join('');
  const fmt = (v) => (mode === 'percent' ? `${total ? Math.round((v / total) * 100) : 0} %` : fmtNumber(v));
  return `<div class="donut-wrap">
    <svg class="donut" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Répartition">${arcs || `<circle cx="${cx}" cy="${cy}" r="${r - w / 2}" fill="none" stroke="var(--surface-3)" stroke-width="${w}"/>`}
      <text x="${cx}" y="${cy - 2}" text-anchor="middle" class="donut-value">${esc(center?.value ?? fmtNumber(total))}</text><text x="${cx}" y="${cy + 16}" text-anchor="middle" class="donut-label">${esc(center?.label ?? 'au total')}</text></svg>
    <ul class="donut-legend">${slices.map((s) => `<li class="${s.value ? '' : 'is-zero'}"><span class="legend-swatch" style="--c:${esc(s.color)}"></span><span class="clip">${esc(s.label)}</span><strong>${esc(fmt(s.value))}</strong></li>`).join('')}</ul>
  </div>`;
}

/* ------------------------------------------------- Courbes (suivi hebdo) */

/**
 * series : [{ label, color, values: [number|null], dashed }] sur des abscisses communes (labels).
 * Les valeurs sont des parts (0 à 1) affichées en pourcentage.
 */
export function linesSVG(series, labels, { height = 240, width = 720 } = {}) {
  const W = Math.max(320, width); const H = height;
  const m = { l: 40, r: 14, t: 14, b: 30 };
  const iw = W - m.l - m.r; const ih = H - m.t - m.b;
  const n = Math.max(1, labels.length - 1);
  const x = (i) => m.l + (i / n) * iw;
  const y = (v) => m.t + ih - v * ih;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const paths = series.map((s) => {
    let d = ''; let pen = false;
    s.values.forEach((v, i) => { if (v === null || v === undefined) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`; pen = true; });
    const dots = s.values.map((v, i) => (v === null || v === undefined ? '' : `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="4" fill="${esc(s.color)}" tabindex="0" data-tt="${tip(labels[i], [{ value: `${Math.round(v * 100)} %`, label: s.label, color: s.color }])}"/>`)).join('');
    return `<path d="${d}" fill="none" stroke="${esc(s.color)}" stroke-width="2.5" ${s.dashed ? 'stroke-dasharray="6 5"' : ''} stroke-linejoin="round" stroke-linecap="round"/>${dots}`;
  }).join('');
  const every = Math.ceil(labels.length / 8);
  return `<div class="legend">${series.map((s) => `<span class="legend-item"><span class="legend-line${s.dashed ? ' dashed' : ''}" style="--c:${esc(s.color)}"></span>${esc(s.label)}</span>`).join('')}</div>
    <svg class="lines" viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="${esc(series.map((s) => s.label).join(' et '))}">
      <g class="grid">${ticks.map((v) => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/><text class="tick" x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end">${v * 100} %</text>`).join('')}</g>
      <g class="xaxis">${labels.map((l, i) => (i % every === 0 || i === labels.length - 1 ? `<text class="tick" x="${x(i)}" y="${H - 8}" text-anchor="middle">${esc(l)}</text>` : '')).join('')}</g>
      ${paths}
    </svg>`;
}
