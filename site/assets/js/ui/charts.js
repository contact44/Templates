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
