// Données de démonstration FICTIVES (clients, interlocuteurs, montants inventés),
// générées de façon cohérente avec la date du jour et les jalons de la saison.

import { listOptions, milestoneByRole } from './schema.js';
import { addDays, clamp, diffDays, todayISO, uid } from './utils.js';

const CLIENTS = [
  ['Alto Distribution', 'Groupe Alto', 'Spécialiste (GSS)'],
  ['Brio Électro', 'Centrale Brio', 'Spécialiste (GSS)'],
  ['Cobalt Hypermarchés', 'Cobalt Achats', 'Grande distribution (GSA)'],
  ['Delta Hi-Fi', '', 'Spécialiste (GSS)'],
  ['Écho Multimédia', 'Groupe Écho', 'Spécialiste (GSS)'],
  ['Fusion Store', '', 'E-commerce'],
  ['Granit Télécom', 'Granit Group', 'Opérateur télécom'],
  ['Hélios Market', 'Cobalt Achats', 'Grande distribution (GSA)'],
  ['Iris Online', '', 'E-commerce'],
  ['Jade Pro Solutions', '', 'B2B / Intégrateur'],
  ['Kappa Mobile', 'Granit Group', 'Opérateur télécom'],
  ['Lumen Supermarchés', 'Lumen Coopérative', 'Grande distribution (GSA)'],
  ['Mistral Électroménager', '', 'Spécialiste (GSS)'],
  ['Nova Marketplace', '', 'E-commerce'],
  ['Opale Cuisines', 'Réseau Opale', 'Cuisiniste / Installateur'],
  ['Prisme Informatique', '', 'B2B / Intégrateur'],
  ['Quartz Distribution', '', 'Grossiste'],
  ['Rubis Hyper', 'Lumen Coopérative', 'Grande distribution (GSA)'],
  ['Saphir Connect', '', 'Opérateur télécom'],
  ['Topaze Électro', 'Groupe Alto', 'Spécialiste (GSS)'],
  ['Ultra Bureau', '', 'B2B / Intégrateur'],
  ['Vega Retail', 'Centrale Brio', 'Spécialiste (GSS)'],
  ['Wapiti Maison', '', 'Spécialiste (GSS)'],
  ['Xénon Gaming', '', 'E-commerce'],
  ['Yuzu Store', '', 'E-commerce'],
  ['Zénith Grossiste', '', 'Grossiste'],
  ['Arcade Numérique', 'Groupe Écho', 'Spécialiste (GSS)'],
  ['Boréal Habitat', 'Réseau Opale', 'Cuisiniste / Installateur'],
  ['Cèdre Collectivités', '', 'B2B / Intégrateur'],
  ['Dune Mobile', '', 'Opérateur télécom'],
  ['Émeraude Proxi', 'Lumen Coopérative', 'Grande distribution (GSA)'],
  ['Falcon IT Services', '', 'B2B / Intégrateur'],
  ['Galet Électroménager', 'Centrale Brio', 'Spécialiste (GSS)'],
  ['Horizon Duty Free', '', 'Autre'],
  ['Indigo Hôtellerie', '', 'B2B / Intégrateur'],
  ['Jasmin Express', '', 'E-commerce'],
  ['Koala Électro', '', 'Spécialiste (GSS)'],
  ['Lagon Outre-mer', '', 'Grossiste'],
  ['Mosaïque Retail', 'Groupe Alto', 'Spécialiste (GSS)'],
  ['Nacre Télécom Pro', 'Granit Group', 'Opérateur télécom'],
  ['Onyx Éducation', '', 'B2B / Intégrateur'],
  ['Pollen Drive', 'Cobalt Achats', 'Grande distribution (GSA)'],
];

const KAMS = ['Sophie Lefèvre', 'Marc Dupuis', 'Inès Roche', 'Thomas Girard', 'Nadia Benali', 'Hugo Perrin', 'Léa Fontaine'];

const ACTIONS = {
  'À lancer': ['Préparer et envoyer les CGV 2027', 'Valider la trame de convention avec le KAM', 'Confirmer les interlocuteurs côté client'],
  'CGV envoyées': ['Relancer pour accusé de réception des CGV', 'Obtenir les commentaires du client sur les CGV', 'Planifier le premier rendez-vous de négociation'],
  'Négociation en cours': ['Envoyer la contre-proposition sur les services', 'Analyser la demande de remise de fin d’année', 'Point de négociation avec l’acheteur', 'Chiffrer la coopération commerciale demandée'],
  'Revue juridique': ['Finaliser la revue des clauses de pénalités', 'Valider la clause de réserve de propriété', 'Retour juridique sur la version client'],
  'Validation interne': ['Obtenir la validation Finance', 'Faire approuver par la Direction commerciale'],
  'En signature': ['Relancer la signature côté client', 'Envoyer la version finale en signature électronique'],
  'Bloqué / Escalade': ['Organiser une réunion d’escalade', 'Préparer la note d’escalade pour la Direction'],
};

const BLOCAGES = [
  'Demande de pénalités logistiques jugées disproportionnées',
  'Remise de fin d’année sans contrepartie identifiée',
  'Désaccord sur la rémunération des services de coopération commerciale',
  'Clause de préavis de rupture contestée',
];

const COMMENTS = [
  'Client satisfait des conditions 2026, négociation attendue sans difficulté.',
  'Nouvel acheteur depuis septembre : prévoir un rendez-vous de présentation.',
  'Demande d’intégrer un plan d’affaires trimestriel.',
  'Le client souhaite signer électroniquement.',
  '',
  '',
];

const DEMO_TEAM = [
  { id: 'cm1', name: 'Camille Laurent', email: 'camille.laurent@exemple.fr', initials: 'CL', color: '#1428a0', role: 'Contract Manager' },
  { id: 'cm2', name: 'Julien Moreau', email: 'julien.moreau@exemple.fr', initials: 'JM', color: '#eb6834', role: 'Contract Manager' },
];

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Répartition des statuts à trois moments de la saison (début, milieu, fin).
const ANCHORS = [
  [0.30, 0.30, 0.17, 0.07, 0.04, 0.02, 0.04, 0.05, 0.01],
  [0.03, 0.10, 0.28, 0.15, 0.10, 0.10, 0.17, 0.05, 0.02],
  [0.00, 0.00, 0.03, 0.03, 0.03, 0.06, 0.80, 0.03, 0.02],
];

function weightsAt(phase) {
  const p = clamp(phase, 0, 1);
  const [a, b, t] = p < 0.5 ? [ANCHORS[0], ANCHORS[1], p / 0.5] : [ANCHORS[1], ANCHORS[2], (p - 0.5) / 0.5];
  return a.map((x, i) => x + (b[i] - x) * t);
}

/** Construit l'équipe, les contrats, l'historique et les commentaires de démonstration. */
export function buildDemo(settings, today = todayISO()) {
  const rnd = mulberry32(2027);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const between = (a, b) => (b <= a ? a : addDays(a, Math.floor(rnd() * (diffDays(a, b) + 1))));
  const statuses = listOptions(settings, 'statut').map((o) => o.value);
  const divisions = listOptions(settings, 'division').map((o) => o.value);
  const types = listOptions(settings, 'typeContrat').map((o) => o.value);
  const prio = listOptions(settings, 'priorite').map((o) => o.value);
  const kickoff = (settings.milestones || []).map((m) => m.date).filter(Boolean).sort()[0] || addDays(today, -30);
  const sig = milestoneByRole(settings, 'signature')?.date || addDays(kickoff, 150);
  const cgvDeadline = milestoneByRole(settings, 'cgv')?.date || addDays(kickoff, 60);
  const phase = diffDays(kickoff, today) / Math.max(1, diffDays(kickoff, sig));
  const weights = weightsAt(phase);
  const yesterday = addDays(today, -1);
  const cap = (d) => (d > yesterday ? yesterday : d);

  // Tirage déterministe des statuts selon la phase de la saison.
  const n = CLIENTS.length;
  const counts = weights.map((w) => Math.floor(w * n));
  let rest = n - counts.reduce((a, b) => a + b, 0);
  for (let i = 0; rest > 0; i = (i + 1) % counts.length) { if (weights[i] > 0.05) { counts[i]++; rest--; } }
  const statusPool = [];
  counts.forEach((c, i) => { for (let k = 0; k < c; k++) statusPool.push(statuses[i] || statuses[0]); });
  for (let i = statusPool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [statusPool[i], statusPool[j]] = [statusPool[j], statusPool[i]]; }

  const caValues = CLIENTS.map(() => Math.round(Math.exp(5.3 + rnd() * 4.6) / 10) * 10);
  const sortedCa = [...caValues].sort((a, b) => b - a);
  const p1 = sortedCa[Math.floor(n * 0.2)];
  const p2 = sortedCa[Math.floor(n * 0.5)];

  const contracts = [];
  const history = [];
  const comments = [];
  const now = Date.now();
  const ts = (iso, h = 10) => Math.min(now - 60000, Date.parse(`${iso}T${String(h).padStart(2, '0')}:${String(Math.floor(rnd() * 59)).padStart(2, '0')}:00`));

  CLIENTS.forEach(([client, groupe, canal], i) => {
    const statut = statusPool[i] || statuses[0];
    const sIdx = statuses.indexOf(statut);
    const cm = i === 7 ? '' : DEMO_TEAM[i % 2].id;
    const ca = caValues[i];
    const nDiv = canal === 'Opérateur télécom' ? 1 : 1 + Math.floor(rnd() * 3);
    const division = canal === 'Opérateur télécom' ? [divisions[0]] : [...new Set(Array.from({ length: nDiv }, () => pick(divisions)))];
    const values = {
      ref: `${settings.season.refPrefix}-${String(i + 1).padStart(3, '0')}`,
      client, groupe, canal, division,
      typeContrat: rnd() < 0.6 ? types[0] : pick(types.slice(1, 5)),
      cm,
      kam: pick(KAMS),
      priorite: ca >= p1 ? prio[0] : ca >= p2 ? prio[1] : prio[2],
      ca,
      statut,
      commentaires: pick(COMMENTS),
    };
    const reached = (name) => sIdx >= statuses.indexOf(name) && statut !== 'Abandonné';
    const late = statut === 'Bloqué / Escalade' || statut === 'Signé';
    if (reached('CGV envoyées') || late) values.dateCgv = cap(between(addDays(kickoff, 2), cap(addDays(cgvDeadline, -5))));
    if ((reached('Négociation en cours') || late) && values.dateCgv) values.dateRetourCgv = cap(between(addDays(values.dateCgv, 2), addDays(values.dateCgv, 14)));
    if ((reached('Négociation en cours') || late) && values.dateCgv) values.version = `V${1 + Math.floor(rnd() * 4)}`;
    if ((reached('Revue juridique') || statut === 'Signé') && values.dateRetourCgv) values.dateVersion = cap(between(values.dateRetourCgv, yesterday));
    if (reached('Revue juridique') || statut === 'Signé') values.refSelms = `SELMS-27-${String(140 + i * 7).padStart(4, '0')}`;
    if (statut === 'Signé') {
      const from = values.dateVersion || values.dateRetourCgv || values.dateCgv || kickoff;
      values.dateSignature = cap(between(addDays(from, 1), yesterday));
      values.version = values.version || 'V2';
    }
    if (statut === 'Bloqué / Escalade') values.blocage = pick(BLOCAGES);
    if (ACTIONS[statut]) {
      values.prochaineAction = pick(ACTIONS[statut]);
      values.echeance = addDays(today, Math.floor(rnd() * 34) - 9);
    }
    if (rnd() < 0.35) values.lienDossier = `https://intranet.exemple.fr/juridique/saison-2027/${values.ref}`;
    const created = ts(kickoff, 9);
    const author = DEMO_TEAM[i % 2];
    const updatedDay = [values.dateSignature, values.dateVersion, values.dateRetourCgv, values.dateCgv].filter(Boolean).sort().pop() || kickoff;
    const contract = {
      id: uid(), values,
      createdAt: created, createdBy: author.id, createdByName: author.name,
      updatedAt: ts(updatedDay, 11 + Math.floor(rnd() * 6)), updatedBy: author.id, updatedByName: author.name,
    };
    contracts.push(contract);
    history.push({ id: uid(), ts: created, uid: author.id, user: author.name, action: 'create', contractId: contract.id, contractRef: values.ref, contractLabel: client });
    if (values.dateCgv) history.push({ id: uid(), ts: ts(values.dateCgv, 10), uid: author.id, user: author.name, action: 'update', contractId: contract.id, contractRef: values.ref, contractLabel: client, field: 'statut', fieldLabel: 'Statut', from: 'À lancer', to: 'CGV envoyées' });
    if (statut !== 'CGV envoyées' && statut !== 'À lancer' && values.dateCgv) history.push({ id: uid(), ts: contract.updatedAt, uid: author.id, user: author.name, action: 'update', contractId: contract.id, contractRef: values.ref, contractLabel: client, field: 'statut', fieldLabel: 'Statut', from: 'CGV envoyées', to: statut });
    if (values.echeance && rnd() < 0.5) history.push({ id: uid(), ts: Math.min(now - 120000, contract.updatedAt + 3600000), uid: author.id, user: author.name, action: 'update', contractId: contract.id, contractRef: values.ref, contractLabel: client, field: 'prochaineAction', fieldLabel: 'Prochaine action', from: '', to: values.prochaineAction });
    if (rnd() < 0.18) {
      const other = DEMO_TEAM[(i + 1) % 2];
      comments.push({ id: uid(), contractId: contract.id, text: pick(['Le KAM confirme un rendez-vous la semaine prochaine.', 'Attention : le client veut revoir la clause de pénalités.', 'Version envoyée, en attente de retour.', 'Peux-tu reprendre ce dossier pendant mes congés ?']), uid: other.id, user: other.name, ts: Math.min(now - 300000, contract.updatedAt + 7200000) });
    }
  });

  history.sort((a, b) => b.ts - a.ts);
  return { team: DEMO_TEAM, contracts, history, comments, counter: contracts.length };
}
