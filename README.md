# Astrée

Plate-forme RPA locale pour une direction juridique : des scénarios Python déposés dans l'interface, une équipe de
robots nommés qui les exécute en arrière-plan, un open space en 2D pour voir qui travaille sur quoi, et un
tableau de bord de performance. Un processus Python, une base SQLite, un navigateur. Sans serveur ni cloud.

## Démarrer

```bash
python -m venv .venv
.venv\Scripts\activate          # Windows   (Linux/macOS : source .venv/bin/activate)
pip install -e .[dev]
astree demo-data                # optionnel : 14 jours d'exécutions fictives pour voir le tableau de bord
astree                          # http://127.0.0.1:8765
```

Autres commandes : `astree list` (scénarios chargés), `astree run <clé>` (une exécution sur le terminal),
`astree demo-data --reset`, `astree -v` (journal détaillé).

Variables d'environnement optionnelles : `ASTREE_WORKSPACE` (données, défaut `./workspace`), `ASTREE_SCENARIOS`
(scénarios livrés, défaut `./scenarios`), `ASTREE_HOST`, `ASTREE_PORT`, `ASTREE_TZ` (défaut `Europe/Paris`).

## Les onglets

- **Dashboard** : l'équipe (qui est occupé, sur quoi, à quelle action), exécutions du jour, réussite et durée moyenne
  sur 7 jours, exécutions par jour sur 14 jours, une carte par scénario, les échecs à regarder.
- **Scénarios** : liste, dépôt d'un fichier `.py` ou du code collé, contrôles automatiques (syntaxe, contrat, clé,
  planification, actions déclarées, accès réseau, envois sortants), versions conservées et restaurables,
  activation, planification cron, paramètres.
- **Open space** : la vue pixel art en direct, un poste par scénario, le nom du robot qui s'en occupe et l'action
  en cours. Cliquer un poste lance le scénario.
- **Paramètres** : noms des robots (le nombre de robots = le nombre de scénarios simultanés), emplacements,
  identifiants du coffre.
- **Historique** : toutes les exécutions, filtrables ; chaque exécution a sa frise d'actions et son journal.

## L'équipe et le coffre

Les robots (Vega, Altaïr, Deneb par défaut) sont des postes d'exécution : un scénario planifié ou lancé à la main
entre dans une file, le premier robot libre le prend et le mène jusqu'au bout.

Les identifiants (Paramètres › Identifiants) sont des couples utilisateur / mot de passe nommés. Le nom d'utilisateur
est en base ; le mot de passe va dans le gestionnaire d'identifiants du système (Windows Credential Manager via
`keyring`), ou à défaut dans un fichier chiffré du workspace. Un scénario y accède avec `ctx.credentials("selms")` ;
la valeur du mot de passe est masquée dans le journal.

## Écrire un scénario

```python
KEY = "extraction_selms"                 # identifiant stable
NAME = "Extraction mensuelle SELMS+"
DESCRIPTION = "Une phrase."
SCHEDULE = "0 7 28 * *"                  # cron local, ou None pour « à la demande »
ENABLED_BY_DEFAULT = False               # optionnel
PARAMS = [{"name": "dossier", "label": "Dossier de dépôt", "type": "str", "default": "sorties/selms"}]

def run(ctx):
    cred = ctx.credentials("selms")                       # cred.username, cred.password
    with ctx.step("web.consulter", "SELMS+ · connexion"):  # action déclarée : visible dans l'open space et mesurée
        ...
    for fichier in ctx.step("doc.lire", "Exports", fichiers):
        ctx.item_done()                                    # ou ctx.item_failed("motif") → « avec réserves »
    ctx.metric("contrats", 142)
    chemin = ctx.output_path("export.xlsx")                # workspace/sorties/<clé>/
```

Actions du catalogue : `mail.lire`, `mail.repondre`, `doc.lire`, `doc.remplir`, `web.consulter`, `verifier`,
`propose`, `envoyer`, `archiver`, `attendre`. Une exception non rattrapée met l'exécution en échec, avec l'action
fautive et la trace dans le journal.

## Arborescence

```
astree/         socle : app.py (routes), db.py, registry.py, runner.py, team.py, scheduler.py, vault.py, stats.py, templates/, static/
scenarios/      scénarios livrés avec le code (deux démos + le squelette de l'extraction SELMS+)
workspace/      données locales, hors git : astree.db, scenarios/ déposés et leurs versions, sorties/, coffre
tests/          pytest
docs/           cadrage et prévisualisations
```

## Tests

```bash
pytest
```
