// Parcours d'un dossier : les étapes REPORT PAR DIV (l'avancement réel) regroupées par phase
// (Attente CC, En cours de traitement, Signature, Signé), REPORT GEN n'étant que leur synthèse.

import { icon } from './icons.js';
import { popover } from './overlay.js';
import { stageColor } from './components.js';
import { stepInfo, stepStage } from '../core/compute.js';
import { listOptions, REPORT_STAGES, stageLabel, stepName } from '../core/schema.js';
import { esc, inkOn } from '../core/utils.js';

/** Phases consécutives des étapes DIV : [{ stage, steps: [{ option, index }] }]. */
export function phases(settings) {
  const out = [];
  listOptions(settings, 'reportDiv').forEach((o, index) => {
    const stage = stepStage(settings, o);
    const last = out[out.length - 1];
    if (last && last.stage === stage) last.steps.push({ option: o, index }); else out.push({ stage, steps: [{ option: o, index }] });
  });
  return out;
}

/** Libellé court d'une phase (« Attente CC », « En cours », « Signature », « Signé »). */
export function phaseShort(settings, stage) {
  return { todo: 'Attente CC', active: 'En cours', signature: 'Signature', done: 'Signé', none: 'Non renseigné' }[stage] || stageLabel(settings, stage);
}

/**
 * Barre de progression du dossier.
 * size : 'lg' (fiche du compte, étapes cliquables et noms des phases), 'sm' (liste des comptes).
 */
export function trackHTML(settings, contract, { size = 'sm', interactive = false, closed = false } = {}) {
  const info = stepInfo(settings, contract);
  const cur = info.index;
  const groups = phases(settings);
  const seg = ({ option, index }, stage) => {
    const state = cur < 0 ? 'todo' : index < cur ? 'past' : index === cur ? 'current' : 'todo';
    const tip = `${option.value}${index === cur ? ' (étape actuelle)' : ''}`;
    const attrs = `class="tk-step tk-${state}" style="--c:${esc(stageColor(stage))}" data-tip="${esc(tip)}"`;
    return interactive
      ? `<button type="button" ${attrs} data-step="${esc(option.value)}" aria-label="${esc(`Passer à l’étape ${option.value}`)}" aria-pressed="${index === cur}"></button>`
      : `<span ${attrs}></span>`;
  };
  const bar = groups.map((g) => `<span class="tk-phase" style="flex:${g.steps.length}">${g.steps.map((x) => seg(x, g.stage)).join('')}</span>`).join('');
  const labels = size === 'lg'
    ? `<div class="tk-labels">${groups.map((g) => `<span style="flex:${g.steps.length}" class="${info.stage === g.stage ? 'on' : ''}">${esc(phaseShort(settings, g.stage))}</span>`).join('')}</div>`
    : '';
  return `<div class="track track-${size}${closed ? ' is-closed' : ''}" role="${interactive ? 'group' : 'img'}" aria-label="${esc(cur < 0 ? 'Étape non renseignée' : `Étape ${cur + 1} sur ${info.count} : ${info.name}`)}">
    <div class="tk-bar">${bar}</div>${labels}</div>`;
}

/** Pastille de phase (couleur + libellé). */
export function phaseBadge(settings, stage, { label = null } = {}) {
  return `<span class="phase-badge" style="--c:${esc(stageColor(stage))}">${esc(label || stageLabel(settings, stage))}</span>`;
}

/** Choix de l'étape : liste des étapes groupées par phase. onPick(value|null). */
export function stepPicker(anchor, settings, current, onPick) {
  const wrap = document.createElement('div');
  wrap.className = 'step-picker';
  const groups = phases(settings);
  wrap.innerHTML = `<div class="picker-title">Étape du dossier (REPORT PAR DIV)</div>
    ${groups.map((g) => `<div class="sp-group"><div class="sp-phase" style="--c:${esc(stageColor(g.stage))}">${esc(stageLabel(settings, g.stage))}</div>
      ${g.steps.map(({ option, index }) => `<button type="button" class="sp-opt${option.value === current ? ' selected' : ''}" data-step="${esc(option.value)}"><span class="sp-num">${index + 1}</span><span class="sp-name">${esc(stepName(option.value))}</span><span class="sp-gen" data-tip="REPORT GEN correspondant">${esc(stepName(option.gen || ''))}</span>${option.value === current ? icon('check', 'sp-check') : ''}</button>`).join('')}</div>`).join('')}
    ${current ? '<button type="button" class="sp-opt sp-clear" data-step="">Effacer l’étape</button>' : ''}`;
  const p = popover(anchor, wrap, { className: 'popover-steps', width: 420 });
  wrap.addEventListener('click', (e) => {
    const b = e.target.closest('[data-step]');
    if (!b) return;
    p.close();
    onPick(b.dataset.step || null);
  });
  wrap.querySelector('.sp-opt.selected')?.scrollIntoView({ block: 'nearest' });
  wrap.querySelector('.sp-opt.selected, .sp-opt')?.focus();
  return p;
}

/** Barre empilée des phases (un segment par dossier ou par effectif). parts : { stage: n }. */
export function phaseBarHTML(settings, counts, { height = 10, labels = false } = {}) {
  const total = REPORT_STAGES.reduce((a, st) => a + (counts[st] || 0), 0);
  if (!total) return `<span class="phase-bar empty" style="height:${height}px"></span>`;
  return `<span class="phase-bar" style="height:${height}px">${REPORT_STAGES.filter((st) => counts[st]).map((st) => `<span class="pb-seg" style="flex:${counts[st]};--c:${esc(stageColor(st))}" data-tip="${esc(`${stageLabel(settings, st)} : ${counts[st]}`)}">${labels && counts[st] / total > 0.06 ? `<span style="color:${inkOn(stageColor(st))}">${counts[st]}</span>` : ''}</span>`).join('')}</span>`;
}

export { stepName };
