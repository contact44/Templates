// Modèle de données par défaut : colonnes du suivi, listes de valeurs, jalons de la saison,
// équipe, modèles de relance et automatisations. Tout est modifiable dans « Paramètres ».

import { deepClone } from './utils.js';

export const SCHEMA_VERSION = 1;

/** Étapes génériques auxquelles chaque statut est rattaché (calculs, couleurs, tableau de bord). */
export const STAGES = [
  { id: 'todo', label: 'À lancer', color: '#a3a7af', darkColor: '#6b6f78' },
  { id: 'active', label: 'En cours', color: '#2a43b6', darkColor: '#6f86ff' },
  { id: 'blocked', label: 'Bloqué', color: '#d03b3b', darkColor: '#e05252' },
  { id: 'done', label: 'Signé', color: '#0ca30c', darkColor: '#0ca30c' },
  { id: 'cancelled', label: 'Abandonné', color: '#5b5f68', darkColor: '#8d9099' },
];
export const STAGE_ORDER_FOR_BARS = ['done', 'active', 'todo', 'blocked'];

export const COLUMN_TYPES = [
  { id: 'text', label: 'Texte court' },
  { id: 'longtext', label: 'Texte long' },
  { id: 'number', label: 'Nombre' },
  { id: 'date', label: 'Date' },
  { id: 'select', label: 'Liste déroulante' },
  { id: 'multiselect', label: 'Liste à choix multiples' },
  { id: 'person', label: "Membre de l'équipe" },
  { id: 'url', label: 'Lien (URL)' },
  { id: 'email', label: 'Adresse e-mail' },
  { id: 'checkbox', label: 'Case à cocher' },
];

export const FIELD_GROUPS = [
  { id: 'ident', label: 'Identification' },
  { id: 'equipe', label: 'Équipe' },
  { id: 'nego', label: 'Négociation et calendrier' },
  { id: 'suivi', label: 'Suivi et actions' },
  { id: 'refs', label: 'Références' },
  { id: 'autres', label: 'Autres champs' },
];

export const MILESTONE_ROLES = [
  { id: '', label: 'Jalon informatif' },
  { id: 'cgv', label: "Date limite d'envoi des CGV" },
  { id: 'target', label: 'Objectif interne de signature' },
  { id: 'signature', label: 'Date butoir de signature' },
];

/** Couleurs proposées pour les valeurs de listes (palette catégorielle validée, dans l'ordre). */
export const SWATCHES = [
  '#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948',
  '#1428a0', '#93a6ee', '#4b67d3', '#a3a7af', '#5b5f68', '#0ca30c', '#d03b3b', '#ec835a',
];

const CAT = SWATCHES;

function opts(values, colors = CAT) {
  return values.map((v, i) => ({ value: v, color: colors[i % colors.length] }));
}

export function defaultSettings() {
  return deepClone({
    schemaVersion: SCHEMA_VERSION,
    season: {
      name: 'Saison contractuelle 2027',
      year: 2027,
      refPrefix: 'SC27',
      entity: 'Samsung Electronics France · Direction juridique',
    },
    milestones: [
      { id: 'ms_kickoff', label: 'Lancement de la saison', date: '2026-10-01', role: '', note: 'Préparation des CGV 2027 et des trames de conventions.' },
      { id: 'ms_cgv', label: "Date limite d'envoi des CGV", date: '2026-12-01', role: 'cgv', note: 'Art. L441-3 IV du Code de commerce : CGV communiquées au plus tard trois mois avant le 1er mars.' },
      { id: 'ms_target', label: 'Objectif interne de signature', date: '2027-02-15', role: 'target', note: 'Marge de sécurité avant la date butoir légale.' },
      { id: 'ms_deadline', label: 'Date butoir de signature des conventions', date: '2027-03-01', role: 'signature', note: 'Art. L441-3 III du Code de commerce : convention conclue au plus tard le 1er mars.' },
    ],
    team: [
      { id: 'cm1', name: 'Contract Manager 1', email: '', initials: 'CM1', color: '#1428a0', role: 'Contract Manager' },
      { id: 'cm2', name: 'Contract Manager 2', email: '', initials: 'CM2', color: '#eb6834', role: 'Contract Manager' },
    ],
    lists: {
      statut: [
        { value: 'À lancer', color: '#a3a7af', stage: 'todo', progress: 0, dateField: '' },
        { value: 'CGV envoyées', color: '#93a6ee', stage: 'active', progress: 15, dateField: 'dateCgv' },
        { value: 'Négociation en cours', color: '#6d86e1', stage: 'active', progress: 35, dateField: '' },
        { value: 'Revue juridique', color: '#4b67d3', stage: 'active', progress: 55, dateField: '' },
        { value: 'Validation interne', color: '#3050c4', stage: 'active', progress: 75, dateField: '' },
        { value: 'En signature', color: '#1f3bb0', stage: 'active', progress: 90, dateField: '' },
        { value: 'Signé', color: '#0ca30c', stage: 'done', progress: 100, dateField: 'dateSignature' },
        { value: 'Bloqué / Escalade', color: '#d03b3b', stage: 'blocked', progress: null, dateField: '' },
        { value: 'Abandonné', color: '#5b5f68', stage: 'cancelled', progress: null, dateField: '' },
      ],
      canal: opts(['Spécialiste (GSS)', 'Grande distribution (GSA)', 'E-commerce', 'Opérateur télécom', 'B2B / Intégrateur', 'Grossiste', 'Cuisiniste / Installateur', 'Autre']),
      division: opts(['Mobile (MX)', 'TV & Audio (VD)', 'Électroménager (DA)', 'IT & Moniteurs', 'Enterprise / B2B']),
      typeContrat: opts([
        'Convention unique annuelle (L441-3)',
        'Accord-cadre + avenant annuel',
        'Contrat de distribution sélective',
        'Contrat de coopération commerciale',
        'Contrat de prestation de services',
        'Avenant',
        'Autre',
      ]),
      priorite: [
        { value: 'P1 – Critique', color: '#d03b3b' },
        { value: 'P2 – Haute', color: '#ec835a' },
        { value: 'P3 – Normale', color: '#a3a7af' },
      ],
    },
    listLabels: {
      statut: 'Statuts',
      canal: 'Canaux',
      division: 'Divisions',
      typeContrat: 'Types de contrat',
      priorite: 'Priorités',
    },
    columns: [
      { key: 'ref', label: 'Réf.', type: 'text', width: 92, group: 'refs', system: true, readonly: true, frozen: true },
      { key: 'client', label: 'Client / Enseigne', type: 'text', width: 210, group: 'ident', system: true, required: true, frozen: true },
      { key: 'groupe', label: 'Groupe / Centrale', type: 'text', width: 160, group: 'ident' },
      { key: 'canal', label: 'Canal', type: 'select', list: 'canal', width: 170, group: 'ident' },
      { key: 'division', label: 'Division(s)', type: 'multiselect', list: 'division', width: 190, group: 'ident' },
      { key: 'typeContrat', label: 'Type de contrat', type: 'select', list: 'typeContrat', width: 220, group: 'ident' },
      { key: 'cm', label: 'Contract manager', type: 'person', width: 170, group: 'equipe', system: true },
      { key: 'kam', label: 'KAM / Commercial', type: 'text', width: 150, group: 'equipe' },
      { key: 'contactClient', label: 'Contact client (e-mail)', type: 'email', width: 190, group: 'equipe', hidden: true },
      { key: 'priorite', label: 'Priorité', type: 'select', list: 'priorite', width: 130, group: 'ident' },
      { key: 'ca', label: 'CA N-1 (k€)', type: 'number', width: 110, group: 'ident', align: 'right' },
      { key: 'statut', label: 'Statut', type: 'select', list: 'statut', width: 190, group: 'nego', system: true },
      { key: '_progress', label: 'Avancement', type: 'computed', computed: 'progress', width: 120, group: 'nego' },
      { key: '_alerts', label: 'Alertes', type: 'computed', computed: 'alerts', width: 120, group: 'nego' },
      { key: 'dateCgv', label: 'Envoi des CGV', type: 'date', width: 120, group: 'nego', system: true },
      { key: 'dateRetourCgv', label: 'Retour client sur CGV', type: 'date', width: 120, group: 'nego' },
      { key: 'version', label: 'Version en cours', type: 'text', width: 110, group: 'nego' },
      { key: 'dateVersion', label: 'Envoi dernière version', type: 'date', width: 120, group: 'nego' },
      { key: 'dateSignature', label: 'Date de signature', type: 'date', width: 120, group: 'nego', system: true },
      { key: 'prochaineAction', label: 'Prochaine action', type: 'text', width: 230, group: 'suivi', system: true },
      { key: 'echeance', label: 'Échéance', type: 'date', width: 120, group: 'suivi', system: true },
      { key: 'blocage', label: 'Points de blocage', type: 'longtext', width: 220, group: 'suivi' },
      { key: 'commentaires', label: 'Commentaires', type: 'longtext', width: 240, group: 'suivi' },
      { key: 'refSelms', label: 'N° SELMS+', type: 'text', width: 120, group: 'refs' },
      { key: 'lienDossier', label: 'Lien dossier', type: 'url', width: 110, group: 'refs' },
      { key: '_updated', label: 'Dernière modif.', type: 'computed', computed: 'updated', width: 150, group: 'refs' },
    ],
    alerts: {
      dueSoonDays: 7,
      cgvWarnDays: 21,
      deadlineWarnDays: 30,
      deadlineRiskProgress: 55,
    },
    automations: {
      statusStampsDate: true,
      dateAdvancesStatus: true,
      followUpDays: 7,
    },
    emailTemplates: [
      {
        id: 'tpl_cgv',
        name: 'Relance – retour sur les CGV',
        subject: '{saison} – {client} : vos retours sur nos CGV',
        body: "Bonjour,\n\nNous vous avons adressé le {dateCgv} nos conditions générales de vente pour l'année {annee}.\n\nSauf erreur de notre part, nous n'avons pas encore reçu vos éventuels commentaires. Pourriez-vous nous les transmettre afin que nous puissions avancer sur la convention {annee}, qui doit être signée au plus tard le {dateButoir} ?\n\nBien cordialement,\n{moi}",
      },
      {
        id: 'tpl_version',
        name: 'Envoi d’une nouvelle version',
        subject: '{saison} – {client} : convention {annee}, version {version}',
        body: "Bonjour,\n\nVeuillez trouver ci-joint la version {version} de la convention {annee}, qui intègre les points discutés lors de notre dernier échange.\n\nNous restons à votre disposition pour en discuter.\n\nBien cordialement,\n{moi}",
      },
      {
        id: 'tpl_signature',
        name: 'Relance signature avant la date butoir',
        subject: '{saison} – {client} : signature de la convention avant le {dateButoir}',
        body: "Bonjour,\n\nLa convention {annee} doit être signée au plus tard le {dateButoir} (article L441-3 du Code de commerce), soit dans {joursButoir} jours.\n\nPourriez-vous nous indiquer la date à laquelle nous pouvons attendre votre signature ?\n\nBien cordialement,\n{moi}",
      },
      {
        id: 'tpl_kam',
        name: 'Point interne avec le KAM',
        subject: '[Interne] {client} – point sur la négociation {annee}',
        body: "Bonjour {kam},\n\nPeux-tu me faire un point sur la négociation avec {client} ?\n\nStatut actuel : {statut}\nProchaine action : {prochaineAction} (échéance {echeance})\nPoints de blocage : {blocage}\n\nMerci,\n{moi}",
      },
    ],
  });
}

/** Complète des paramètres stockés avec les valeurs par défaut manquantes (sans rien écraser). */
export function normalizeSettings(stored) {
  const def = defaultSettings();
  if (!stored || typeof stored !== 'object') return def;
  const s = deepClone(stored);
  s.schemaVersion = s.schemaVersion || SCHEMA_VERSION;
  s.season = { ...def.season, ...(s.season || {}) };
  s.alerts = { ...def.alerts, ...(s.alerts || {}) };
  s.automations = { ...def.automations, ...(s.automations || {}) };
  if (!Array.isArray(s.milestones)) s.milestones = def.milestones;
  if (!Array.isArray(s.team)) s.team = def.team;
  if (!Array.isArray(s.emailTemplates)) s.emailTemplates = def.emailTemplates;
  s.lists = s.lists && typeof s.lists === 'object' ? s.lists : {};
  for (const [k, v] of Object.entries(def.lists)) if (!Array.isArray(s.lists[k])) s.lists[k] = v;
  s.listLabels = { ...def.listLabels, ...(s.listLabels || {}) };
  if (!Array.isArray(s.columns) || !s.columns.length) s.columns = def.columns;
  // Colonnes système toujours présentes (les calculs en dépendent).
  for (const col of def.columns.filter((c) => c.system || c.type === 'computed')) {
    if (!s.columns.some((c) => c.key === col.key)) s.columns.push(col);
  }
  for (const col of s.columns) {
    if (col.type === 'select' || col.type === 'multiselect') {
      if (!col.list) col.list = col.key;
      if (!Array.isArray(s.lists[col.list])) s.lists[col.list] = [];
      if (!s.listLabels[col.list]) s.listLabels[col.list] = col.label;
    }
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

export function milestoneByRole(settings, role) {
  return (settings.milestones || []).find((m) => m.role === role && m.date) || null;
}

export function memberById(settings, id) {
  return (settings.team || []).find((m) => m.id === id) || null;
}

export const COLUMN_GROUP_LABEL = Object.fromEntries(FIELD_GROUPS.map((g) => [g.id, g.label]));
