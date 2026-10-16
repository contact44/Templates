// Données de démonstration FICTIVES (clients, sociétés, interlocuteurs et numéros inventés),
// dans la structure du classeur « Suivi CM » : une ligne par compte et par division, à différents
// stades de la saison, avec leurs jalons, notes de suivi et historique N-1. Les dates sont calculées par
// rapport au jour courant pour que l'aperçu reste cohérent.

import { listOptions } from './schema.js';
import { addDays, todayISO } from './utils.js';

export const DEMO_TEAM = [
  { id: 'camille', name: 'Camille Laurent', email: 'camille.laurent@exemple.fr', github: '', initials: 'CL', color: '#1428a0', role: 'Contract Manager' },
  { id: 'julien', name: 'Julien Moreau', email: 'julien.moreau@exemple.fr', github: '', initials: 'JM', color: '#eb6834', role: 'Contract Manager' },
];
const JURISTES = ['Sophie Martin', 'Thomas Bernard', 'Léa Petit (cabinet)', 'Hugo Roux (cabinet)'];

// [client, activité, forme sociale, ville, divisions]
const CLIENTS = [
  ['ALTO DISTRIBUTION', 'grossiste', 'Société par Actions Simplifiée', 'Nanterre', ['AV', 'DA', 'TE']],
  ['BRIO ÉLECTRO', 'détaillant', 'Société Anonyme', 'Lyon', ['AV', 'DA']],
  ['COBALT HYPERMARCHÉS', 'centrale de référencement', 'Société par Actions Simplifiée', 'Évry', ['AV', 'DA', 'TA', 'PC']],
  ['DELTA HI-FI', 'détaillant', 'Société à Responsabilité Limitée', 'Rennes', ['AV']],
  ['ÉCHO MULTIMÉDIA', 'détaillant', 'Société par Actions Simplifiée', 'Bordeaux', ['AV', 'MO (LCD)']],
  ['FUSION STORE', 'entreprise de ventes évènementielles sur Internet', 'Société par Actions Simplifiée', 'Paris', ['TE', 'OC']],
  ['GRANIT TÉLÉCOM', 'opérateur de services de communications électroniques mobiles', 'Société Anonyme', 'Paris', ['TE', 'TA', 'OC', 'AC']],
  ['HÉLIOS MARKET', 'détaillant', 'Société Anonyme Coopérative', 'Lille', ['DA']],
  ['IRIS ONLINE', 'détaillant', 'Société par Actions Simplifiée', 'Marseille', ['TE', 'PC']],
  ['JADE PRO SOLUTIONS', 'intégrateur', 'Société à Responsabilité Limitée', 'Toulouse', ['MO (LFD)', 'MO (LED)', 'HO']],
  ['KAPPA MOBILE', 'opérateur de services de communications électroniques mobiles', 'Société Anonyme', 'Nantes', ['TE', 'AC']],
  ['LUMEN COOPÉRATIVE', 'coopérative de commerçants détaillants', 'Société Coopérative de Commerçants Détaillants', 'Rungis', ['AV', 'DA', 'TE']],
  ['MISTRAL ÉLECTROMÉNAGER', 'grossiste', 'Société par Actions Simplifiée', 'Grenoble', ['DA']],
  ['NOVA MARKETPLACE', 'détaillant', 'Société par Actions Simplifiée', 'Paris', ['AV', 'TE', 'TA', 'PC', 'DS']],
  ['OPALE CUISINES', 'cuisiniste', 'Société par Actions Simplifiée', 'Angers', ['DA']],
  ['PRISME INFORMATIQUE', 'intégrateur', 'Société Anonyme', 'Montpellier', ['PC', 'MO (LCD)', 'DS']],
  ['QUARTZ DISTRIBUTION', 'grossiste', 'Société par Actions Simplifiée', 'Strasbourg', ['TE', 'TA', 'AC']],
  ['RUBIS HYPER', 'centrale d\'achat', 'Société Anonyme', 'Massy', ['AV', 'DA']],
  ['SAPHIR CONNECT', 'distributeur', 'Société à Responsabilité Limitée', 'Nice', ['OC', 'AC']],
  ['TOPAZE ÉLECTRO', 'détaillant', 'Société par Actions Simplifiée', 'Dijon', ['AV', 'DA']],
  ['ULTRA BUREAU', 'intégrateur', 'Société par Actions Simplifiée', 'Clermont-Ferrand', ['PC', 'MO (LCD)']],
  ['VEGA RETAIL', 'détaillant', 'Société par Actions Simplifiée', 'Reims', ['AV']],
  ['WAPITI MAISON', 'cuisiniste', 'Société à Responsabilité Limitée', 'Tours', ['DA']],
  ['XÉNON GAMING', 'détaillant', 'Société par Actions Simplifiée', 'Lyon', ['MO (LCD)', 'DS']],
  ['YUZU STORE', 'détaillant', 'Société par Actions Simplifiée', 'Caen', ['TE']],
  ['ZÉNITH HÔTELLERIE', 'distributeur', 'Société par Actions Simplifiée', 'Cannes', ['HO']],
  ['ARCADE NUMÉRIQUE', 'détaillant', 'Société Anonyme', 'Metz', ['AV', 'TE']],
  ['BORÉAL MÉDICAL', 'distributeur de dispositifs médicaux', 'Société par Actions Simplifiée', 'Limoges', ['HME']],
  ['CÈDRE SANTÉ', 'distributeur d\'appareils médicaux', 'Société par Actions Simplifiée', 'Poitiers', ['HME']],
  ['DUNE ACCESSOIRES', 'grossiste', 'Société à Responsabilité Limitée', 'Perpignan', ['AC', 'OC']],
];
const KAMS = ['Paul Durand', 'Inès Lefèvre', 'Marc Garnier', 'Nadia Faure', 'Yanis Chevalier', 'Chloé Robin', 'Victor Lambert', 'Emma Fontaine'];

/** Générateur pseudo-aléatoire déterministe (la démonstration est identique à chaque chargement). */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Statut REPORT GEN (index 0-9) → statut REPORT PAR DIV correspondant (index 0-14).
const GEN_TO_DIV = [[0], [1], [3], [2, 4, 5, 6], [7], [8], [9], [10, 11, 12], [13], [14]];
// Répartition de démonstration des statuts (index REPORT GEN), une valeur par ligne active.
const PLAN = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 5, 5, 5, 5, 5, 6, 6, 6, 7, 7, 7, 7, 7, 8, 8, 8, 9, 9];

export function buildDemo(settings, today = todayISO()) {
  const rand = rng(2027);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const between = (a, b) => a + Math.floor(rand() * (b - a + 1));
  const year = Number(settings.season?.year || 2027);
  const gen = listOptions(settings, 'statut').map((o) => o.value);
  const div = listOptions(settings, 'reportDiv').map((o) => o.value);
  const statutCompte = Object.fromEntries(listOptions(settings, 'statutCompte').map((o) => [o.role, o.value]));
  const contracts = [];
  let ref = 0;
  let planIdx = 0;
  const lines = CLIENTS.flatMap(([client, activite, forme, ville, divisions], ci) => divisions.map((d, di) => ({ client, activite, forme, ville, division: d, ci, di })));
  lines.forEach((l, i) => {
    ref++;
    const multi = CLIENTS[l.ci][4].length > 1;
    const v = {
      ref: String(ref), client: l.client, division: l.division,
      kam: pick(KAMS), divLeader: l.di === 0 ? 'X' : (rand() < 0.2 ? 'ALL' : null),
      cm: l.ci % 2 === 0 ? 'camille' : 'julien',
      juriste: JURISTES[l.ci % JURISTES.length],
      attribution2026: rand() < 0.5 ? 'CM' : 'JURISTE',
      typeContrat: pick(['SEF', 'SEF', 'SEF Négocié', 'Client']),
      signaturePafSef: rand() < 0.8 ? 'OUI' : 'NON',
      multiDivisions: multi,
      periode: rand() < 0.88 ? '01/01 - 31/12' : '01/03 - 28/02',
      annexeGag: rand() < 0.7,
      gag2026: rand() < 0.7 ? Math.round((0.04 + rand() * 0.18) * 1000) / 1000 : null,
      rsfOnly: rand() < 0.2,
      documentation: pick(['Contrat Cadre SEF\nPAF SEF\nAnnexe GàG', 'PAF SEF\nAnnexe GàG', 'PAF SEF', 'Contrat Cadre SEF négocié\nPAF SEF']),
      signataire: `${pick(['Mme', 'M.'])} ${pick(['Claire', 'Antoine', 'Julie', 'Nicolas', 'Sarah', 'Olivier'])} ${pick(['DUBOIS', 'MERCIER', 'BLANC', 'GIRARD', 'BONNET', 'ROUSSEL'])}\n${pick(['Directeur des achats', 'Président', 'Directrice commerciale'])}`,
      esig2026: rand() < 0.8 ? 'SEF' : 'CLIENT',
      activite: l.activite,
      codeGerp: String(2000000 + l.ci * 731 + l.di),
      top30: l.ci < 14,
      independant: rand() < 0.1,
      centraleRef: l.activite === 'centrale de référencement' || l.activite.startsWith('coopérative'),
      formeSociale: l.forme,
      capital: [10000, 37000, 150000, 1000000, 2500000][l.ci % 5],
      villeRcs: l.ville,
      rcs: String(300000000 + l.ci * 1234567).slice(0, 9),
      siege: `${between(1, 120)} ${pick(['rue de la République', 'avenue des Champs', 'boulevard Industriel', 'rue du Commerce', 'allée des Lilas'])}`,
      codePostal: String(10000 + l.ci * 2731).slice(0, 5),
      ville: l.ville,
      // Historique N-1 : saison précédente, signée entre janvier et début mars.
      n1Identifiant: `SEF${String(year - 2).slice(2)}12${String(between(1, 28)).padStart(2, '0')}_${String(i + 1).padStart(4, '0')}`,
      n1Objet: multi && l.di === 0 ? 'Contrat cadre' : 'PAF',
      n1ReportGen: gen[9] || null,
      n1ReportDiv: div[14] || null,
      n1Iso: pick(['OUI', 'NON']),
      n1Attribution: rand() < 0.5 ? 'CM' : 'JURISTE',
    };
    const n1Rec = `${year - 2}-12-${String(between(10, 30)).padStart(2, '0')}`;
    const n1Sig = addDays(`${year - 1}-01-15`, between(0, 44));
    Object.assign(v, {
      n1ReceptionCc: n1Rec, n1RevueTerminee: addDays(n1Rec, between(5, 20)), n1ApprovalLancee: addDays(n1Rec, between(20, 25)),
      n1ApprovalTerminee: addDays(n1Rec, between(26, 32)), n1MiseEnSignature: addDays(n1Sig, -between(2, 8)),
      n1SignatureClient: n1Sig, n1SignatureSef: addDays(n1Sig, between(0, 3)),
      n1SuiviCm: `Requête ${v.n1Objet === 'PAF' ? 'portant le PAF' : 'portant le contrat cadre'} - documents reçus le ${n1Rec.slice(8)}/${n1Rec.slice(5, 7)} - signé le ${n1Sig.slice(8)}/${n1Sig.slice(5, 7)}`,
    });

    // Comptes fermés et à l'étude (hors suivi de la saison).
    if (i % 23 === 7) { contracts.push(row({ ...v, statutCompte: statutCompte.ferme, anneeFermeture: year - 1 })); return; }
    if (i % 29 === 11) { contracts.push(row({ ...v, statutCompte: statutCompte.etude, gag2026: null })); return; }
    const g = PLAN[planIdx++ % PLAN.length];
    v.statutCompte = i % 31 === 3 ? statutCompte.nouveau : statutCompte.actif;
    v.statut = gen[g];
    v.reportDiv = div[GEN_TO_DIV[g][Math.floor(rand() * GEN_TO_DIV[g].length)]];
    v.attribution2027 = g >= 1 || rand() < 0.6 ? (rand() < 0.5 ? 'CM' : 'JURISTE') : null;
    v.objet = v.n1Objet;
    v.iso = g >= 2 ? pick(['OUI', 'OUI', 'NON']) : null;
    v.esig2027 = g >= 7 ? v.esig2026 : null;
    v.gag2027 = g >= 4 && v.gag2026 ? Math.round((v.gag2026 + (rand() - 0.5) * 0.04) * 1000) / 1000 : null;
    if (g >= 1) v.selms = `SEF${today.slice(2, 4)}${today.slice(5, 7)}${String(between(1, 28)).padStart(2, '0')}_${String(i + 1).padStart(4, '0')}`;
    // Jalons : plus le statut est avancé, plus la réception des CC est ancienne.
    if (g >= 2) {
      const rec = addDays(today, -between(8 + g * 3, 14 + g * 5));
      v.receptionCc = rec;
      if (g >= 3) v.revueAttribuee = addDays(rec, between(1, 4));
      if (g >= 4) v.revueTerminee = addDays(rec, between(5, 9));
      if (g >= 5) v.approvalLancee = addDays(v.revueTerminee, between(0, 2));
      if (g >= 6) v.approvalTerminee = addDays(v.approvalLancee, between(2, 6));
      if (g >= 7) v.miseEnSignature = addDays(v.approvalTerminee, between(0, 3));
      if (g >= 8) { v.signatureClient = addDays(v.miseEnSignature, between(1, 4)); v.signatureSef = addDays(v.signatureClient, between(0, 2)); }
      for (const k of ['revueAttribuee', 'revueTerminee', 'approvalLancee', 'approvalTerminee', 'miseEnSignature', 'signatureClient', 'signatureSef']) if (v[k] && v[k] > today) v[k] = today;
    }
    // Dernier changement de statut : quelques comptes restés longtemps au même stade (à surveiller, bloqués).
    const last = [v.receptionCc, v.revueAttribuee, v.revueTerminee, v.approvalLancee, v.approvalTerminee, v.miseEnSignature, v.signatureClient, v.signatureSef].filter(Boolean).sort().pop();
    v.statutModifieLe = g >= 8 ? last : addDays(today, -(i % 9 === 0 ? between(21, 30) : i % 7 === 0 ? between(11, 18) : between(1, 8)));
    if (last && v.statutModifieLe < last && g < 8) v.statutModifieLe = last;
    if (g < 8) {
      v.suiviCm = g === 0 ? 'En attente des conditions commerciales de la division.'
        : g === 1 ? 'Contrat client demandé au KAM, envoi annoncé pour la fin du mois.'
          : g <= 3 ? `Revue en cours${v.juriste ? ` avec ${v.juriste}` : ''} : points ouverts sur les pénalités logistiques.`
            : g <= 5 ? 'Revue terminée, approval lancé dans SELMS.'
              : 'Documents envoyés en signature électronique.';
    } else {
      v.suiviCm = `Signé le ${v.signatureClient?.slice(8)}/${v.signatureClient?.slice(5, 7)}${g === 9 ? ', clôturé dans SELMS' : ''}.`;
    }
    contracts.push(row(v));
  });
  // Une anomalie de saisie, pour illustrer le contrôle des jalons.
  const odd = contracts.find((c) => c.values.statut === gen[5] && c.values.revueTerminee);
  if (odd) odd.values.revueTerminee = addDays(odd.values.receptionCc, -2);

  // Quelques entrées de journal et commentaires fictifs, pour illustrer le travail à plusieurs.
  const comments = [];
  const history = [];
  const at = (iso, h, m) => Date.parse(`${iso}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`);
  const label = (c) => `${c.values.client} (${c.values.division})`;
  const who = (c) => DEMO_TEAM.find((t) => t.id === c.values.cm) || DEMO_TEAM[0];
  const moved = contracts.filter((c) => c.values.statutModifieLe && c.values.statutModifieLe < today && c.values.statut !== gen[0]).slice(0, 14);
  moved.forEach((c, i) => {
    const t = who(c);
    const prev = div[Math.max(0, div.indexOf(c.values.reportDiv) - 1)];
    history.push({ id: `demoh${i}`, ts: at(c.values.statutModifieLe, 9 + (i % 8), (i * 7) % 60), uid: `demo:${t.id}`, user: t.name, contractId: c.id, contractRef: c.values.ref, contractLabel: label(c), action: 'update', field: 'reportDiv', fieldLabel: 'REPORT PAR DIV', from: prev, to: c.values.reportDiv });
  });
  contracts.filter((c) => c.values.suiviCm && c.values.statutModifieLe && c.values.statutModifieLe < today).slice(2, 6).forEach((c, i) => {
    const t = DEMO_TEAM[(i + 1) % 2];
    const text = ['Le KAM confirme l’envoi des conditions commerciales cette semaine.', 'Point juridique fait avec le juriste : les clauses de pénalités sont acceptables.', 'Attention : signataire absent jusqu’à la fin du mois.', 'Version signée reçue par e-mail, à déposer dans SELMS.'][i];
    const ts = at(addDays(today, -(i + 1)), 14 + i, 10);
    comments.push({ id: `democ${i}`, contractId: c.id, text, uid: `demo:${t.id}`, user: t.name, ts });
    history.push({ id: `demohc${i}`, ts, uid: `demo:${t.id}`, user: t.name, contractId: c.id, contractRef: c.values.ref, contractLabel: label(c), action: 'comment', to: text });
  });
  history.sort((a, b) => b.ts - a.ts);
  const settingsPatch = {
    homeNotes: `Saison ${year} — démonstration\n${today.split('-').reverse().join('/')} : données fictives chargées pour découvrir l’outil.`,
    homeVigilance: 'GRANIT TÉLÉCOM TE & TA : mêmes conditions dans les deux PAF (contrat commun).\nLUMEN COOPÉRATIVE : les PAF SEF doivent être signés par les deux parties.\nNOVA MARKETPLACE : requête à compléter avec l’annexe GàG.',
    lists: { juriste: JURISTES.map((v, i) => ({ value: v, color: ['#7030a0', '#6250d6', '#e87ba4', '#2a78d6'][i % 4] })) },
  };
  return { team: DEMO_TEAM, contracts, history, comments, counter: contracts.length, settingsPatch };

  function row(values) {
    const clean = {};
    for (const [k, x] of Object.entries(values)) if (x !== null && x !== undefined && x !== '' && x !== false) clean[k] = x;
    const by = DEMO_TEAM.find((t) => t.id === clean.cm) || DEMO_TEAM[0];
    const at = Date.parse(`${clean.statutModifieLe || today}T${String(9 + (contracts.length % 9)).padStart(2, '0')}:${String((contracts.length * 7) % 60).padStart(2, '0')}:00`);
    return { id: `demo${String(contracts.length + 1).padStart(3, '0')}`, values: clean, updatedAt: at, updatedByName: by.name, createdAt: at, createdByName: by.name };
  }
}
