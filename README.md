# Greffier

Plate-forme RPA locale : configuration des robots et tableau de bord de performance.
Tourne sur un seul PC, sans serveur ni cloud. Un processus Python, une base SQLite, un navigateur.

## Démarrer

```bash
python -m venv .venv
.venv\Scripts\activate          # Windows   (Linux/macOS : source .venv/bin/activate)
pip install -e .[dev]
greffier demo-data              # optionnel : 14 jours d'exécutions fictives pour voir le tableau de bord
greffier                        # http://127.0.0.1:8765
```

Autres commandes : `greffier list` (robots chargés), `greffier run <key>` (une exécution en ligne de commande),
`greffier demo-data --reset` (régénère l'historique de démonstration), `greffier -v` (journal détaillé).

Variables d'environnement optionnelles : `GREFFIER_WORKSPACE` (dossier des données, défaut `./workspace`),
`GREFFIER_ROBOTS` (dossier des robots, défaut `./robots`), `GREFFIER_HOST`, `GREFFIER_PORT`, `GREFFIER_TZ` (défaut `Europe/Paris`).

## Ce que fait la plate-forme

- **Tableau de bord** : exécutions du jour, taux de réussite et durée moyenne sur 7 jours, éléments traités,
  exécutions par jour sur 14 jours, une carte par robot avec sa tendance, les échecs à regarder, les dernières exécutions.
- **Configuration** : par robot, activation, planification cron (heure locale) et paramètres déclarés par le robot.
- **Exécution** : planifiée (dans le même processus) ou manuelle, un seul passage à la fois par robot.
- **Journal** : chaque exécution garde ses lignes de journal, ses compteurs, ses métriques et son message de fin.
- **API JSON** : `/api/dashboard`, `/api/robots`, `/health`.

## Écrire un robot

Un robot est un fichier Python dans `robots/`. Le nom du fichier n'a pas d'importance, sauf s'il commence par `_` (ignoré).

```python
KEY = "mon_robot"                    # identifiant stable, utilisé dans les URL et la base
NAME = "Mon robot"
DESCRIPTION = "Ce qu'il fait, en une phrase."
SCHEDULE = "*/15 8-19 * * 1-5"       # cron par défaut, ou None pour « à la demande »
PARAMS = [                           # facultatif ; types : str, int, float, bool, text, choice
    {"name": "dossier", "label": "Dossier à lire", "type": "str", "default": "inbox"},
    {"name": "mode", "label": "Mode", "type": "choice", "choices": ["rapide", "complet"], "default": "rapide"},
]

def run(ctx):
    ctx.info("Démarrage")                    # ctx.info / ctx.warn / ctx.error écrivent dans le journal
    for element in lire(ctx.workspace / ctx.params["dossier"]):
        try:
            traiter(element)
            ctx.item_done()                  # compteur d'éléments traités
        except Exception as e:
            ctx.item_failed(f"{element}: {e}")   # compteur d'échecs ; le passage finit « avec réserves »
    ctx.metric("taille_lot", 42)             # affiché sur la page de l'exécution
    chemin = ctx.output_path("rapport.csv")  # workspace/sorties/mon_robot/rapport.csv
```

Une exception non rattrapée met le passage en **échec** et conserve la trace dans le journal.
Après avoir ajouté ou modifié un fichier, cliquer sur « Recharger les robots » dans la page Robots.

## Arborescence

```
greffier/           socle : app.py (routes), db.py, registry.py, runner.py, scheduler.py, stats.py, templates/, static/
robots/             un fichier par robot (deux robots de démonstration fournis)
workspace/          données locales, hors git : greffier.db, inbox/, sorties/
tests/              pytest
```

## Tests

```bash
pytest
```
