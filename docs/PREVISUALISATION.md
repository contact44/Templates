# Greffier — prévisualisation v0 (à valider avant tout code)

Plate-forme RPA locale (un PC Windows, sans serveur, sans cloud) pour la direction
juridique de Samsung France. Un greffier exécute les actes et en tient le registre :
la plate-forme lance des robots, journalise chaque action et ne rend aucun acte
définitif sans validation d'un juriste.

Version visuelle complète (maquettes d'écrans, architecture) :
https://claude.ai/code/artifact/83d09277-ee0a-4f4b-bbdc-85828f82920e

## Principes

- **Local d'abord** : SQLite, modèles Word, journaux et sorties dans un dossier `workspace/`.
- **Proposer, pas décider** : toute action sortante (e-mail, alerte, contestation) passe
  par une file de validation approuvée par un juriste.
- **Registre opposable** : chaque exécution est horodatée, reconstituable, exportable.
- **Dont overcode** : un processus Python, une base, pas de file de messages, pas de
  conteneur, pas de framework front. Un robot = un fichier.

## Les 5 robots

| # | Robot | Entrées | Sorties | Cadence |
|---|-------|---------|---------|---------|
| R1 | Guichet des demandes juridiques | Boîte Outlook partagée / dossier `inbox/` | Registre des dossiers, accusé de réception (brouillon), affectation | 15 min, jours ouvrés |
| R2 | Rédacteur d'actes standards | Formulaire ou ligne Excel | NDA / procuration / avenant en .docx + .pdf, nomenclature, brouillon d'envoi | À la demande |
| R3 | Vérification des tiers (KYC) | SIREN / raison sociale | Fiche KYC, score vert/ambre/rouge, registre des tiers | À la demande + nuit |
| R4 | Sentinelle des échéances contractuelles | Registre des contrats (Excel) | Rapport hebdo, alertes J-90/60/30 (brouillons) | Lundi 7h |
| R5 | Contrôleur des honoraires | Factures PDF, référentiel cabinets | Tableau des écarts, contestation pré-rédigée, suivi budgétaire | Quotidien 18h |

Alternatives : registre RGPD / demandes d'accès, suivi des audiences, secrétariat juridique.

## Architecture

```
Interface (navigateur, localhost:8765) : tableau de bord · file de validation · fiche robot · registre
Socle (un processus Python)           : registre des robots · planificateur · exécuteur · validation · journal · coffre
Robots (un fichier chacun)            : describe() · run(ctx) · propose(ctx)
Connecteurs partagés                  : Outlook · Word/Excel/PDF · dossiers · web (API publiques)
```

## Stack

Python 3.12 · FastAPI + Jinja2 + HTMX · SQLite · APScheduler · python-docx / openpyxl /
pdfplumber · pywin32 (Outlook) · httpx · Playwright (si aucune API) · keyring · pytest.

```
greffier/
├── greffier/            # socle : app.py, core/, connectors/, templates/, static/
├── robots/              # r1_intake.py … r5_spend.py
├── workspace/           # données locales, hors git (db, modèles Word, inbox, factures, sorties)
├── tests/
├── pyproject.toml
└── README.md
```

## Garde-fous

Aucune action sortante sans validation · données à demeure (seuls appels réseau : registres
publics) · journal exportable CSV/PDF · rétention paramétrée · panne visible · modèles Word
sous contrôle du juridique, jamais modifiés par le robot.

## Plan de livraison

1. Socle vide qui tourne (tableau de bord, planificateur, journal, validation, robot d'exemple)
2. R4 Échéances  3. R2 Rédacteur  4. R3 Tiers  5. R1 Guichet  6. R5 Honoraires

## Points à valider

- **A** Nom « Greffier » et renommage du dépôt (`greffier` ou `rpa-legal-ops-platform`)
- **B** Les cinq robots ci-dessus
- **C** Sources réelles ou jeux de données fictifs en v1 (recommandé : fictifs, branchement robot par robot)
- **D** Stack Python / FastAPI / HTMX / SQLite (recommandé : oui)
- **E** Interface FR, code EN (recommandé)
- **F** Ordre de livraison socle → R4 → R2 → R3 → R1 → R5 (recommandé)
