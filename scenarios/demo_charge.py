"""Scénario de démonstration : simule une charge de travail pour alimenter le tableau de bord et l'open space.

À désactiver ou supprimer dès qu'un vrai scénario est en place.
"""

import random
import time

KEY = "demo_charge"
NAME = "Démo · charge simulée"
DESCRIPTION = "Traite un lot d'éléments fictifs, en déclarant ses actions, avec une durée et un taux d'échec réglables."
SCHEDULE = "*/10 * * * *"
PARAMS = [
    {"name": "count", "label": "Nombre d'éléments", "type": "int", "default": 12},
    {"name": "delay_ms", "label": "Délai par élément (ms)", "type": "int", "default": 40},
    {"name": "failure_rate", "label": "Taux d'échec par élément", "type": "float", "default": 0.05, "help": "Entre 0 et 1."},
    {"name": "crash", "label": "Provoquer une erreur fatale", "type": "bool", "default": False},
]


def run(ctx):
    count = max(0, ctx.params["count"])
    delay = max(0, ctx.params["delay_ms"]) / 1000
    rate = min(1.0, max(0.0, ctx.params["failure_rate"]))
    ctx.info(f"{count} élément(s) à traiter, délai {delay * 1000:.0f} ms, taux d'échec {rate:.0%}")
    with ctx.step("mail.lire", "Boîte de démonstration"):
        time.sleep(delay * 3)
    if ctx.params["crash"]:
        raise RuntimeError("Erreur fatale demandée par la configuration (paramètre « crash »).")
    for i in ctx.step("doc.lire", "Lot fictif", range(1, count + 1)):
        time.sleep(delay)
        if random.random() < rate:
            ctx.item_failed(f"élément {i} : donnée manquante (simulé)")
        else:
            ctx.item_done()
    with ctx.step("archiver", "Classement"):
        time.sleep(delay * 2)
    ctx.metric("elements_par_seconde", round(count / max(0.001, count * delay), 1) if delay else "n/a")
