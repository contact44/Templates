// Modèle de données par défaut, calqué sur le classeur « Suivi CM — saison contractuelle 2027 » :
// une ligne par compte client et par division, colonnes regroupées par thématique (Clé, Équipe,
// Suivi, Jalons, Contrat, Signature, Client, Juridique, Historique N-1, Pilotage), listes de valeurs
// de l'onglet « Listes déroulantes », statuts REPORT GEN / REPORT PAR DIV et seuils de pilotage.
// Tout est modifiable dans « Paramètres ».

import { deepClone } from './utils.js';

export const SCHEMA_VERSION = 2;

/**
 * Étapes de synthèse (onglet « 3.Rep Gen SYNTHESE ») auxquelles chaque statut est rattaché :
 * attente des CC (1-2), traitement (3-6), signature (7-8), signés / clôturés (9-10).
 */
export const STAGES = [
  { id: 'none', label: 'Sans statut', en: 'No status', color: '#c4c7cc', darkColor: '#4b4f57' },
  { id: 'todo', label: 'Attente CC {annee}', en: 'Awaiting CC {annee}', color: '#8d9099', darkColor: '#7a7e87' },
  { id: 'active', label: 'En cours de traitement', en: 'Processing', color: '#eda100', darkColor: '#f0b429' },
  { id: 'signature', label: 'Signature en cours', en: 'Pending signature', color: '#1428a0', darkColor: '#6f86ff' },
  { id: 'done', label: 'Contrats/PAF signés', en: 'Contracts/PAF signed', color: '#0ca30c', darkColor: '#2fbf4a' },
];
/** Étapes comptées dans les reportings (les comptes sans statut n'y figurent pas, comme dans Excel). */
export const REPORT_STAGES = ['todo', 'active', 'signature', 'done'];

export const COLUMN_TYPES = [
  { id: 'text', label: 'Texte court' },
  { id: 'longtext', label: 'Texte long' },
  { id: 'number', label: 'Nombre' },
  { id: 'percent', label: 'Pourcentage' },
  { id: 'date', label: 'Date' },
  { id: 'select', label: 'Liste déroulante' },
  { id: 'multiselect', label: 'Liste à choix multiples' },
  { id: 'person', label: 'Contract manager (équipe)' },
  { id: 'url', label: 'Lien (URL)' },
  { id: 'email', label: 'Adresse e-mail' },
  { id: 'checkbox', label: 'Case à cocher (X)' },
];

/** Thématiques du suivi (couleurs des en-têtes du classeur, boutons d'affichage des macros). */
export const FIELD_GROUPS = [
  { id: 'cle', label: 'Clé', short: 'Clé', color: '#1f3864' },
  { id: 'equipe', label: 'Équipe & attribution', short: 'Équipe', color: '#2e75b6' },
  { id: 'suivi', label: 'Suivi saison', short: 'Suivi', color: '#00796b' },
  { id: 'jalons', label: 'Jalons & délais (jours calendaires)', short: 'Jalons', color: '#548235' },
  { id: 'contrat', label: 'Caractéristiques du contrat', short: 'Contrat', color: '#7030a0' },
  { id: 'signature', label: 'Signature', short: 'Signature', color: '#bf8f00' },
  { id: 'client', label: 'Identification client', short: 'Client', color: '#44546a' },
  { id: 'juridique', label: 'Identité juridique', short: 'Juridique', color: '#843c0c' },
  { id: 'histo', label: 'Historique N-1', short: 'Historique', color: '#6e6e6e' },
  { id: 'pilotage', label: 'Pilotage (auto)', short: 'Pilotage', color: '#5b5f68' },
  { id: 'autres', label: 'Autres champs', short: 'Autres', color: '#8d9099' },
];

/** Vues prédéfinies (boutons « Vue suivi », « Tout afficher », « Tout replier » du classeur). */
export const VIEW_PRESETS = {
  suivi: ['cle', 'equipe', 'suivi', 'pilotage'],
  tout: FIELD_GROUPS.map((g) => g.id),
  replier: ['cle'],
};

export const MILESTONE_ROLES = [
  { id: '', label: 'Jalon informatif' },
  { id: 'signature', label: 'Date butoir de signature' },
];

/** Couleurs proposées pour les valeurs de listes (palette catégorielle validée, dans l'ordre). */
export const SWATCHES = [
  '#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948',
  '#1428a0', '#93a6ee', '#4b67d3', '#a3a7af', '#5b5f68', '#0ca30c', '#d03b3b', '#ec835a',
];

const opts = (values, colors = SWATCHES) => values.map((v, i) => ({ value: v, color: colors[i % colors.length] }));
const shades = {
  todo: ['#a3a7af', '#8d9099'],
  active: ['#f5c451', '#eda100', '#e19500', '#d08700', '#c27c00', '#b37000', '#a56600'],
  signature: ['#6d86e1', '#4b67d3', '#2a43b6', '#1428a0'],
  done: ['#0ca30c', '#008300'],
};
function staged(values, stages, en = []) {
  const seen = {};
  return values.map((value, i) => {
    const stage = stages[i];
    const k = seen[stage] = (seen[stage] || 0) + 1;
    return { value, stage, color: shades[stage][Math.min(k - 1, shades[stage].length - 1)], ...(en[i] ? { en: en[i] } : {}) };
  });
}

export const REPORT_GEN = [
  '1.Attente CC 2027', '2.Attente Contrat Client', '3.Attente accord client sur contrat SEF', '4.Revue en cours',
  '5.CC Locales validées / Attente CC EU', '6.Approval en cours', '7.Attente Mise en signature', '8.Signature en cours',
  '9.Contrats/PAF signé', '10.Clôturé SELMS',
];
const REPORT_GEN_EN = [
  '1.Awaiting 2027 T&Cs', '2.Awaiting Customer Contract', '3.Waiting for customer agreement on SEF contract', '4.Pending SEF legal review',
  '5.Local CC approved / Waiting for EU CC', '6.Pending approval in SELMS+', '7.Waiting for signature launch', '8.Pending client signature',
  '9.Contracts/PAF signed', '10.Closed in SELMS',
];
export const REPORT_DIV = [
  '1.Attente CC 2027', '2.Attente Contrat Client', '3.Revue juriste/CM', '4.Revue Client', '5.Attente retour DIV sur PAF',
  '6.Attente retour DIV sur Annexe PAF', '7.Attente retour DIV sur contrat', '8.CC Locales validées / Attente CC EU', '9.Approval en cours',
  '10.Attente Mise en signature', '11.Attente signature client/SEF', '12.Attente signature Client', '13.Attente signature SEF',
  '14.Contrats/PAF signé', '15.Clôturé SELMS',
];

/**
 * REPORT PAR DIV = l'étape réelle du dossier ; REPORT GEN n'en est que la synthèse.
 * Pour chaque étape DIV, statut REPORT GEN correspondant (index dans REPORT_GEN), modifiable dans Paramètres.
 */
const DIV_TO_GEN = [0, 1, 3, 2, 3, 3, 3, 4, 5, 6, 7, 7, 7, 8, 9];

const DIVISIONS = [
  { value: 'AV', color: '#833c0c', group: 'AV' },
  { value: 'DA', color: '#595959', group: 'DA' },
  { value: 'MO (LCD)', color: '#e0a800', group: 'MO' },
  { value: 'MO (LED)', color: '#e0a800', group: 'MO' },
  { value: 'MO (LFD)', color: '#e0a800', group: 'MO' },
  { value: 'HO', color: '#1baf7a', group: 'HO' },
  { value: 'HME', color: '#5b9bd5', group: 'HME' },
  { value: 'TE', color: '#7030a0', group: 'TE' },
  { value: 'TA', color: '#70ad47', group: 'TA' },
  { value: 'PC', color: '#4f8a2b', group: 'PC' },
  { value: 'OC', color: '#ed7d31', group: 'OC' },
  { value: 'AC', color: '#c55a11', group: 'AC' },
  { value: 'DS', color: '#e6007e', group: 'DS' },
];

/** Regroupements des reportings (onglets 2 à 7) : familles CE / IM et libellés anglais. */
const REPORTING = {
  families: [
    { key: 'CE', label: 'TOTAL CE', en: 'TOTAL CE' },
    { key: 'IM', label: 'TOTAL IM', en: 'TOTAL IM' },
  ],
  groups: [
    { key: 'AV', label: 'AV', en: 'AV', family: 'CE' },
    { key: 'DA', label: 'DA', en: 'DA', family: 'CE' },
    { key: 'MO', label: 'MO', en: 'MONITORS', family: 'CE' },
    { key: 'HO', label: 'HO', en: 'HOSPITALITY', family: 'CE' },
    { key: 'HME', label: 'HME', en: 'HME', family: 'CE' },
    { key: 'TE', label: 'TE', en: 'SMARTPHONES', family: 'IM' },
    { key: 'TA', label: 'TA', en: 'TABLETS', family: 'IM' },
    { key: 'PC', label: 'PC', en: 'PC', family: 'IM' },
    { key: 'OC', label: 'OC', en: 'WEARABLES', family: 'IM' },
    { key: 'AC', label: 'AC', en: 'ACCESSORIES', family: 'IM' },
    { key: 'DS', label: 'DS', en: 'STORAGE', family: 'IM' },
  ],
};

const col = (key, label, type, group, extra = {}) => ({ key, label, type, group, width: 120, ...extra });

const COLUMNS = [
  // Clé
  col('ref', 'Réf.', 'text', 'cle', { width: 78, system: true, readonly: true, frozen: true, align: 'right' }),
  col('client', 'CLIENT', 'text', 'cle', { width: 230, system: true, required: true, frozen: true }),
  col('division', 'DIVISION', 'select', 'cle', { list: 'division', width: 128, system: true, frozen: true }),
  col('statutCompte', 'Statut du compte 2027', 'select', 'cle', { list: 'statutCompte', width: 130, system: true }),
  col('anneeFermeture', 'Année de fermeture', 'number', 'cle', { width: 112, integer: true }),
  // Équipe & attribution
  col('kam', 'KAM', 'text', 'equipe', { width: 200 }),
  col('divLeader', 'DIV Leader', 'select', 'equipe', { list: 'divLeader', width: 90 }),
  col('cm', 'CM référent', 'person', 'equipe', { width: 180, system: true }),
  col('juristesBinome', 'Juriste(s) référent(s) (binôme)', 'text', 'equipe', { width: 240 }),
  col('juriste', 'JURISTE', 'select', 'equipe', { list: 'juriste', width: 180, system: true }),
  col('attribution2026', 'Attribution CM/Juriste 2026', 'select', 'equipe', { list: 'attribution', width: 110 }),
  col('attribution2027', 'Attribution CM/Juriste 2027', 'select', 'equipe', { list: 'attribution', width: 110, system: true }),
  // Suivi saison
  col('selms', 'N° requête SELMS 2027', 'text', 'suivi', { width: 140 }),
  col('objet', 'Objet de la requête', 'select', 'suivi', { list: 'objet', width: 130 }),
  col('reportDiv', 'REPORT PAR DIV', 'select', 'suivi', { list: 'reportDiv', width: 240, system: true }),
  col('statut', 'REPORT GEN', 'select', 'suivi', { list: 'statut', width: 250, system: true, readonly: true, derived: true }),
  col('iso', 'PAF 2027 ISO 2026 ?', 'select', 'suivi', { list: 'iso', width: 96 }),
  col('suiviCm', 'Suivi du CM 2027', 'longtext', 'suivi', { width: 340 }),
  // Jalons & délais
  col('receptionCc', 'Réception CC', 'date', 'jalons', { width: 108, system: true, jalon: 1 }),
  col('revueAttribuee', 'Revue attribuée', 'date', 'jalons', { width: 108, system: true, jalon: 2 }),
  col('revueTerminee', 'Revue terminée', 'date', 'jalons', { width: 108, system: true, jalon: 3 }),
  col('_dureeRevue', 'Durée revue (j, auto)', 'computed', 'jalons', { computed: 'dureeRevue', width: 90, align: 'right' }),
  col('approvalLancee', 'Approval lancée', 'date', 'jalons', { width: 108, system: true, jalon: 4 }),
  col('approvalTerminee', 'Approval terminée', 'date', 'jalons', { width: 108, system: true, jalon: 5 }),
  col('_dureeApproval', 'Durée approval (j, auto)', 'computed', 'jalons', { computed: 'dureeApproval', width: 96, align: 'right' }),
  col('miseEnSignature', 'Mise en signature', 'date', 'jalons', { width: 108, system: true, jalon: 6 }),
  col('signatureClient', 'Signature client', 'date', 'jalons', { width: 108, system: true, jalon: 7 }),
  col('signatureSef', 'Signature SEF', 'date', 'jalons', { width: 108, system: true, jalon: 7 }),
  col('_dureeSignature', 'Durée signature (j, auto)', 'computed', 'jalons', { computed: 'dureeSignature', width: 96, align: 'right' }),
  col('_dureeTotale', 'Durée totale (j, auto)', 'computed', 'jalons', { computed: 'dureeTotale', width: 90, align: 'right' }),
  // Caractéristiques du contrat
  col('typeContrat', 'Contrat SEF / Client', 'select', 'contrat', { list: 'typeContrat', width: 120 }),
  col('signaturePafSef', 'Signature PAF SEF ?', 'select', 'contrat', { list: 'ouiNon', width: 96 }),
  col('multiDivisions', 'Contrat multi-divisions', 'checkbox', 'contrat', { width: 96 }),
  col('pluriannuel', 'Contrat pluriannuel', 'text', 'contrat', { width: 170 }),
  col('periode', 'Période contractuelle', 'select', 'contrat', { list: 'periode', width: 120 }),
  col('annexeGag', 'Annexe GàG N-1', 'checkbox', 'contrat', { width: 90 }),
  col('gag2026', '% max GàG 2026', 'percent', 'contrat', { width: 96 }),
  col('gag2027', '% max GàG 2027', 'percent', 'contrat', { width: 96 }),
  col('rsfOnly', 'RSF only', 'checkbox', 'contrat', { width: 80 }),
  col('delaiPaiement', 'Délai de paiement dérogatoire', 'text', 'contrat', { width: 120 }),
  col('voletLogistique', 'Volet logistique', 'checkbox', 'contrat', { width: 90 }),
  col('voletSav', 'Volet SAV', 'checkbox', 'contrat', { width: 80 }),
  col('documentation', 'Documentation attendue pour la signature', 'longtext', 'contrat', { width: 220 }),
  col('specificite', 'Spécificité client', 'longtext', 'contrat', { width: 280 }),
  // Signature
  col('signataire', 'Signataire contrat (côté client)', 'longtext', 'signature', { width: 240 }),
  col('esig2026', 'Signature électr. gérée par (2026)', 'select', 'signature', { list: 'esig', width: 110 }),
  col('esig2027', 'Signature électr. gérée par (2027)', 'select', 'signature', { list: 'esig', width: 110 }),
  col('contratEdite', 'Contrat édité ?', 'select', 'signature', { list: 'ouiNon', width: 90 }),
  // Identification client
  col('activite', 'Activité', 'select', 'client', { list: 'activite', width: 170 }),
  col('codeGerp', 'Code GERP', 'text', 'client', { width: 96 }),
  col('top30', 'Client TOP 30', 'checkbox', 'client', { width: 90, trueLabel: 'TOP 30' }),
  col('independant', 'Indépendant', 'checkbox', 'client', { width: 96, trueLabel: 'INDEP' }),
  col('centraleRef', 'Contrat avec centrale de référencement', 'checkbox', 'client', { width: 110 }),
  col('entiteSignataire', 'Entité signataire du contrat', 'text', 'client', { width: 150 }),
  col('accordInternational', 'Accord international', 'checkbox', 'client', { width: 96 }),
  col('commentairesBase', 'Commentaires (base Comptes Clients)', 'longtext', 'client', { width: 300 }),
  // Identité juridique
  col('formeSociale', 'Forme sociale', 'text', 'juridique', { width: 220 }),
  col('capital', 'Capital social (€)', 'number', 'juridique', { width: 120, unit: '€' }),
  col('villeRcs', 'Ville RCS', 'text', 'juridique', { width: 120 }),
  col('rcs', 'N° RCS', 'text', 'juridique', { width: 110 }),
  col('siege', 'Siège social', 'text', 'juridique', { width: 200 }),
  col('codePostal', 'Code postal', 'text', 'juridique', { width: 90 }),
  col('ville', 'Ville', 'text', 'juridique', { width: 140 }),
  // Historique N-1
  col('n1Identifiant', 'Identifiant contrat 2026', 'text', 'histo', { width: 140 }),
  col('n1Objet', 'Objet de la requête 2026', 'select', 'histo', { list: 'objet', width: 130 }),
  col('n1ReportGen', 'Report GEN 2026', 'select', 'histo', { list: 'statut', width: 200 }),
  col('n1ReportDiv', 'Report par DIV 2026', 'select', 'histo', { list: 'reportDiv', width: 200 }),
  col('n1Iso', 'PAF ISO 2025 ?', 'select', 'histo', { list: 'iso', width: 90 }),
  col('n1Attribution', 'Attribution CM/Juriste 2025', 'select', 'histo', { list: 'attribution', width: 110 }),
  col('n1ReceptionCc', 'Réception CC 2026', 'date', 'histo', { width: 108, system: true }),
  col('n1RevueAttribuee', 'Revue attribuée 2026', 'date', 'histo', { width: 108 }),
  col('n1RevueTerminee', 'Revue terminée 2026', 'date', 'histo', { width: 108 }),
  col('n1ApprovalLancee', 'Approval lancée 2026', 'date', 'histo', { width: 108 }),
  col('n1ApprovalTerminee', 'Approval terminée 2026', 'date', 'histo', { width: 108 }),
  col('n1MiseEnSignature', 'Mise en signature 2026', 'date', 'histo', { width: 108 }),
  col('n1SignatureClient', 'Signature client 2026', 'date', 'histo', { width: 108, system: true }),
  col('n1SignatureSef', 'Signature SEF 2026', 'date', 'histo', { width: 108, system: true }),
  col('_n1DureeTotale', 'Durée totale 2026 (j, auto)', 'computed', 'histo', { computed: 'n1DureeTotale', width: 96, align: 'right' }),
  col('n1SuiviCm', 'Suivi du CM 2026', 'longtext', 'histo', { width: 320 }),
  // Pilotage (auto)
  col('statutModifieLe', 'Statut modifié le (auto)', 'date', 'pilotage', { width: 116, system: true, readonly: true }),
  col('_joursStade', 'Jours au stade actuel (auto)', 'computed', 'pilotage', { computed: 'joursStade', width: 104, align: 'right' }),
  col('_sigN1Plus1', 'Signature 2026 + 1 an (auto)', 'computed', 'pilotage', { computed: 'sigN1Plus1', width: 116 }),
  col('_ecartN1', 'Écart vs 2026 (j, auto)', 'computed', 'pilotage', { computed: 'ecartN1', width: 100, align: 'right' }),
  col('_controleJalons', 'Contrôle des jalons (auto)', 'computed', 'pilotage', { computed: 'controle', width: 140 }),
  col('_alerts', 'Alertes', 'computed', 'pilotage', { computed: 'alerts', width: 140, hidden: true }),
  col('_updated', 'Dernière modif.', 'computed', 'pilotage', { computed: 'updated', width: 150, hidden: true }),
];

export function defaultSettings() {
  return deepClone({
    schemaVersion: SCHEMA_VERSION,
    season: {
      name: 'Saison contractuelle 2027',
      year: 2027,
      refPrefix: '',
      entity: 'Direction juridique SEF · Pôle Contract Management',
    },
    milestones: [
      { id: 'ms_cc', label: 'Communication des conditions 2027', date: '2026-12-01', role: '', note: 'Art. L441-3 IV du Code de commerce : CGV communiquées au plus tard trois mois avant le 1er mars.' },
      { id: 'ms_deadline', label: 'Date butoir de signature', date: '2027-03-01', role: 'signature', note: 'Art. L441-3 III du Code de commerce : convention conclue au plus tard le 1er mars.' },
    ],
    team: [
      { id: 'cm1', name: 'CM 1', email: '', github: '', initials: 'CM1', color: '#1428a0', role: 'Contract Manager' },
      { id: 'cm2', name: 'CM 2', email: '', github: '', initials: 'CM2', color: '#eb6834', role: 'Contract Manager' },
    ],
    lists: {
      statut: staged(REPORT_GEN, ['todo', 'todo', 'active', 'active', 'active', 'active', 'signature', 'signature', 'done', 'done'], REPORT_GEN_EN),
      reportDiv: staged(REPORT_DIV, ['todo', 'todo', 'active', 'active', 'active', 'active', 'active', 'active', 'active', 'signature', 'signature', 'signature', 'signature', 'done', 'done'])
        .map((o, i) => ({ ...o, gen: REPORT_GEN[DIV_TO_GEN[i]] })),
      statutCompte: [
        { value: 'Actif', color: '#4b67d3', role: 'actif' },
        { value: 'À l\'étude', color: '#eda100', role: 'etude' },
        { value: 'Nouveau', color: '#1baf7a', role: 'nouveau' },
        { value: 'Fermé', color: '#8d9099', role: 'ferme' },
      ],
      division: deepClone(DIVISIONS),
      divLeader: opts(['X', 'ALL'], ['#2a78d6', '#1428a0']),
      juriste: opts(['Juriste 1', 'Juriste 2'], ['#7030a0', '#6250d6', '#e87ba4', '#2a78d6', '#1baf7a', '#eb6834']),
      attribution: [{ value: 'CM', color: '#2a78d6' }, { value: 'JURISTE', color: '#7030a0' }],
      objet: opts(['Contrat cadre', 'PAF', 'Contrat PAF', 'Avenant']),
      iso: [{ value: 'OUI', color: '#0ca30c' }, { value: 'NON', color: '#e34948' }, { value: 'NEW', color: '#2a78d6' }],
      ouiNon: [{ value: 'OUI', color: '#0ca30c' }, { value: 'NON', color: '#e34948' }],
      typeContrat: [{ value: 'SEF', color: '#1428a0' }, { value: 'SEF Négocié', color: '#6250d6' }, { value: 'Client', color: '#eb6834' }],
      esig: [{ value: 'SEF', color: '#1428a0' }, { value: 'CLIENT', color: '#eb6834' }],
      periode: opts(['01/01 - 31/12', '01/03 - 28/02', '01/03 - 31/12']),
      activite: opts([
        'centrale d\'achat', 'centrale de référencement', 'coopérative de commerçants détaillants', 'cuisiniste', 'distributeur',
        'distributeur d\'appareils médicaux', 'distributeur de dispositifs médicaux', 'distributeur de meubles de cuisine', 'détaillant',
        'entreprise de ventes évènementielles sur Internet', 'grossiste', 'intégrateur',
        'opérateur de services de communications électroniques mobiles', 'société de conseil',
      ]),
    },
    listLabels: {
      statut: 'REPORT GEN (synthèse)',
      reportDiv: 'Étapes (REPORT PAR DIV)',
      statutCompte: 'Statut du compte',
      division: 'Divisions',
      divLeader: 'DIV Leader',
      juriste: 'Juristes',
      attribution: 'Attribution CM / Juriste',
      objet: 'Objet de la requête',
      iso: 'PAF ISO N-1',
      ouiNon: 'Oui / Non',
      typeContrat: 'Contrat SEF / Client',
      esig: 'Signature électronique',
      periode: 'Période contractuelle',
      activite: 'Activités',
    },
    columns: deepClone(COLUMNS),
    reporting: deepClone(REPORTING),
    alerts: {
      vigilanceDays: 10,
      blocageDays: 20,
      gagMax: 0.15,
    },
    automations: {
      stampStatusChange: true,
    },
    home: {
      title: 'Suivi Contract Management — Contrats clients',
      version: '',
      links: [
        { label: 'Contrats / PAF signés', url: '' },
        { label: 'Distribution classique', url: '' },
      ],
    },
    hebdo: {
      to: '',
      cc: '',
      subject: 'Suivi des contrats clients {annee} – point au {date}',
      before: 'Bonjour à tous,\n\nVeuillez trouver ci-dessous le point hebdomadaire sur l’avancement de la saison contractuelle {annee}.',
      after: 'Je reste à votre disposition pour tout complément.\n\nBien cordialement,',
      start: '2026-12-04',
      end: '2027-03-12',
    },
    // Clés séparées : deux personnes peuvent modifier l'une et l'autre en même temps sans s'écraser.
    homeNotes: '',
    homeVigilance: '',
    hebdoWeeks: {},
  });
}

const REMOVED_COLUMNS = ['derniereAction', 'prochaineRelance', '_alerte'];

/**
 * Données propres au client (identiques pour toutes ses divisions) : saisies une fois dans la fiche du compte,
 * appliquées à toutes ses lignes.
 */
export const CLIENT_FIELDS = ['activite', 'codeGerp', 'top30', 'independant', 'centraleRef', 'accordInternational', 'entiteSignataire',
  'commentairesBase', 'formeSociale', 'capital', 'villeRcs', 'rcs', 'siege', 'codePostal', 'ville'];

/** Détail d'une division, rangé par rubrique dans la fiche du compte. */
export const DIVISION_SECTIONS = [
  { id: 'dossier', label: 'Dossier 2027', keys: ['attribution2027', 'selms', 'objet', 'iso', 'kam', 'divLeader', 'juristesBinome', 'attribution2026'] },
  { id: 'jalons', label: 'Jalons', keys: ['receptionCc', 'revueAttribuee', 'revueTerminee', 'approvalLancee', 'approvalTerminee', 'miseEnSignature', 'signatureClient', 'signatureSef'] },
  { id: 'contrat', label: 'Contrat', keys: ['typeContrat', 'signaturePafSef', 'multiDivisions', 'pluriannuel', 'periode', 'annexeGag', 'gag2026', 'gag2027', 'rsfOnly', 'delaiPaiement', 'voletLogistique', 'voletSav', 'documentation', 'specificite'] },
  { id: 'signature', label: 'Signature', keys: ['signataire', 'esig2026', 'esig2027', 'contratEdite'] },
  { id: 'histo', label: 'Saison 2026', keys: ['n1Identifiant', 'n1Objet', 'n1ReportDiv', 'n1ReportGen', 'n1Iso', 'n1Attribution', 'n1ReceptionCc', 'n1RevueAttribuee', 'n1RevueTerminee', 'n1ApprovalLancee', 'n1ApprovalTerminee', 'n1MiseEnSignature', 'n1SignatureClient', 'n1SignatureSef', 'n1SuiviCm'] },
];

/** Libellé court d'une étape (« 4.Revue Client » → « Revue Client »). */
export const stepName = (value) => String(value || '').replace(/^\s*\d+\s*[.)-]\s*/, '');

/** Complète des paramètres stockés avec les valeurs par défaut manquantes (sans rien écraser). */
export function normalizeSettings(stored) {
  const def = defaultSettings();
  if (!stored || typeof stored !== 'object' || (stored.schemaVersion || 1) < SCHEMA_VERSION) return def;
  const s = deepClone(stored);
  s.schemaVersion = SCHEMA_VERSION;
  s.season = { ...def.season, ...(s.season || {}) };
  s.alerts = { ...def.alerts, ...(s.alerts || {}) };
  s.automations = { ...def.automations, ...(s.automations || {}) };
  s.home = { ...def.home, ...(s.home || {}) };
  if (!Array.isArray(s.home.links)) s.home.links = def.home.links;
  s.hebdo = { ...def.hebdo, ...(s.hebdo || {}) };
  if (!s.hebdoWeeks || typeof s.hebdoWeeks !== 'object') s.hebdoWeeks = {};
  if (typeof s.homeNotes !== 'string') s.homeNotes = '';
  if (typeof s.homeVigilance !== 'string') s.homeVigilance = '';
  s.reporting = s.reporting && Array.isArray(s.reporting.groups) && Array.isArray(s.reporting.families) ? s.reporting : def.reporting;
  if (!Array.isArray(s.milestones)) s.milestones = def.milestones;
  if (!Array.isArray(s.team)) s.team = def.team;
  delete s.emailTemplates;
  s.lists = s.lists && typeof s.lists === 'object' ? s.lists : {};
  for (const [k, v] of Object.entries(def.lists)) if (!Array.isArray(s.lists[k])) s.lists[k] = v;
  s.listLabels = { ...def.listLabels, ...(s.listLabels || {}) };
  if (!Array.isArray(s.columns) || !s.columns.length) s.columns = def.columns;
  // Colonnes système toujours présentes (les calculs en dépendent), à leur place d'origine si possible.
  for (const [i, c] of def.columns.entries()) {
    if ((c.system || c.type === 'computed') && !s.columns.some((x) => x.key === c.key)) {
      const prev = def.columns[i - 1];
      const at = prev ? s.columns.findIndex((x) => x.key === prev.key) : -1;
      s.columns.splice(at >= 0 ? at + 1 : s.columns.length, 0, deepClone(c));
    }
  }
  // Colonnes retirées (suivi des relances) et REPORT GEN calculé depuis l'étape DIV.
  s.columns = s.columns.filter((c) => !REMOVED_COLUMNS.includes(c.key));
  const gen = s.columns.find((c) => c.key === 'statut');
  if (gen) { gen.readonly = true; gen.derived = true; }
  for (const key of ['statut', 'reportDiv']) {
    for (const o of s.lists[key] || []) if (!['todo', 'active', 'signature', 'done'].includes(o.stage)) o.stage = 'active';
  }
  const defDiv = def.lists.reportDiv;
  const genValues = (s.lists.statut || []).map((o) => o.value);
  (s.lists.reportDiv || []).forEach((o, i) => {
    if (o.gen && genValues.includes(o.gen)) return;
    const same = defDiv.find((d) => d.value === o.value);
    o.gen = same && genValues.includes(same.gen) ? same.gen : genValues[Math.min(genValues.length - 1, DIV_TO_GEN[i] ?? genValues.length - 1)] || '';
  });
  delete s.alerts.relanceSoonDays; delete s.alerts.sansActionDays; delete s.automations.followUpDays;
  for (const c of s.columns) {
    if (c.type === 'select' || c.type === 'multiselect') {
      if (!c.list) c.list = c.key;
      if (!Array.isArray(s.lists[c.list])) s.lists[c.list] = [];
      if (!s.listLabels[c.list]) s.listLabels[c.list] = c.label;
    }
    if (!FIELD_GROUPS.some((g) => g.id === c.group)) c.group = 'autres';
  }
  return s;
}

export function columnByKey(settings, key) {
  return settings.columns.find((c) => c.key === key) || null;
}

export function listOptions(settings, listKey) {
  return (settings.lists && settings.lists[listKey]) || [];
}

export function stageById(id) {
  return STAGES.find((s) => s.id === id) || STAGES[0];
}

/** Libellé d'une étape (avec l'année de la saison), en français ou en anglais. */
export function stageLabel(settings, id, lang = 'fr') {
  const st = stageById(id);
  return (lang === 'en' ? st.en : st.label).replace('{annee}', String(settings?.season?.year || ''));
}

export function milestoneByRole(settings, role) {
  return (settings.milestones || []).find((m) => m.role === role && m.date) || null;
}

export function memberById(settings, id) {
  return (settings.team || []).find((m) => m.id === id) || null;
}

export function groupById(id) {
  return FIELD_GROUPS.find((g) => g.id === id) || FIELD_GROUPS[FIELD_GROUPS.length - 1];
}

/** Option du statut du compte jouant un rôle donné (« actif », « ferme »…). */
export function accountRoleOf(settings, value) {
  return listOptions(settings, 'statutCompte').find((o) => o.value === value)?.role || '';
}

export const COLUMN_GROUP_LABEL = Object.fromEntries(FIELD_GROUPS.map((g) => [g.id, g.label]));
