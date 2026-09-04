"""Robot de démonstration : simule une charge de travail pour alimenter le tableau de bord.

À supprimer ou désactiver dès qu'un vrai robot est en place.
"""

import random
import time

KEY = "demo_ping"
NAME = "Démo · charge simulée"
DESCRIPTION = "Traite un lot d'éléments fictifs avec une durée et un taux d'échec réglables. Sert à vérifier la plate-forme."
SCHEDULE = "*/10 * * * *"
PARAMS = [
    {"name": "count", "label": "Nombre d'éléments", "type": "int", "default": 12, "help": "Éléments fictifs traités par passage."},
    {"name": "delay_ms", "label": "Délai par élément (ms)", "type": "int", "default": 40},
    {"name": "failure_rate", "label": "Taux d'échec par élément", "type": "float", "default": 0.05, "help": "Entre 0 et 1. Un élément en échec passe le résultat en « avec réserves »."},
    {"name": "crash", "label": "Provoquer une erreur fatale", "type": "bool", "default": False, "help": "Pour tester l'affichage d'un échec complet."},
]


def run(ctx):
    count = max(0, ctx.params["count"])
    delay = max(0, ctx.params["delay_ms"]) / 1000
    rate = min(1.0, max(0.0, ctx.params["failure_rate"]))
    ctx.info(f"{count} élément(s) à traiter, délai {delay * 1000:.0f} ms, taux d'échec {rate:.0%}")
    if ctx.params["crash"]:
        raise RuntimeError("Erreur fatale demandée par la configuration (paramètre « crash »).")
    for i in range(1, count + 1):
        time.sleep(delay)
        if random.random() < rate:
            ctx.item_failed(f"élément {i} : donnée manquante (simulé)")
        else:
            ctx.item_done()
    ctx.metric("elements_par_seconde", round(count / max(0.001, count * delay), 1) if delay else "n/a")
