"""Scénario 1 : extraction mensuelle des contrats signés dans SELMS+.

Squelette : la planification, les identifiants et les actions sont en place ; la navigation dans SELMS+
sera écrite à partir de la cartographie des écrans. Désactivé par défaut tant que cette partie manque.
"""

from datetime import date

KEY = "extraction_selms"
NAME = "Extraction mensuelle SELMS+"
DESCRIPTION = "Le 28 de chaque mois, exporte depuis SELMS+ les contrats signés dans le mois, contrôle le fichier et le dépose dans le dossier partagé."
SCHEDULE = "0 7 28 * *"
ENABLED_BY_DEFAULT = False
PARAMS = [
    {"name": "identifiant", "label": "Identifiant du coffre à utiliser", "type": "str", "default": "selms", "help": "Nom de l'entrée dans Paramètres › Identifiants."},
    {"name": "dossier_partage", "label": "Dossier de dépôt", "type": "str", "default": "sorties/selms", "help": "Relatif au workspace, ou chemin réseau complet."},
    {"name": "mois", "label": "Mois à extraire", "type": "choice", "choices": ["courant", "precedent"], "default": "courant"},
]


def periode(mois_choisi: str) -> tuple[date, date]:
    today = date.today()
    year, month = today.year, today.month
    if mois_choisi == "precedent":
        year, month = (year - 1, 12) if month == 1 else (year, month - 1)
    start = date(year, month, 1)
    end = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    return start, end


def run(ctx):
    debut, fin = periode(ctx.params["mois"])
    ctx.info(f"Période : du {debut:%d/%m/%Y} au {fin:%d/%m/%Y} (exclu)")
    with ctx.step("web.consulter", "SELMS+ · connexion"):
        cred = ctx.credentials(ctx.params["identifiant"])
        ctx.info(f"Identifiant « {cred.name} » chargé pour l'utilisateur {cred.username}")
        # La navigation (ouverture, filtre, export) sera écrite ici à partir de la cartographie SELMS+.
        raise NotImplementedError("Cartographie SELMS+ en attente : les étapes de navigation ne sont pas encore écrites.")
