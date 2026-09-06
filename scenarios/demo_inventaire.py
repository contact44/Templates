"""Scénario de démonstration : inventorie un dossier du workspace et écrit un inventaire CSV.

Un exemple de scénario « réel » minimal : lit des fichiers, produit une sortie, compte ce qu'il a fait.
"""

import csv

KEY = "demo_inventaire"
NAME = "Démo · inventaire de dossier"
DESCRIPTION = "Liste les fichiers d'un dossier du workspace et produit un inventaire CSV dans sorties/demo_inventaire/."
SCHEDULE = None
PARAMS = [
    {"name": "folder", "label": "Dossier à inventorier (relatif au workspace)", "type": "str", "default": "inbox"},
    {"name": "pattern", "label": "Motif de fichiers", "type": "str", "default": "*", "help": "Exemples : *.pdf, *.docx, *"},
]


def run(ctx):
    folder = ctx.workspace / ctx.params["folder"]
    with ctx.step("doc.lire", f"Dossier {ctx.params['folder']}"):
        if not folder.exists():
            folder.mkdir(parents=True, exist_ok=True)
            ctx.warn(f"Dossier créé car absent : {folder}")
        files = sorted(p for p in folder.glob(ctx.params["pattern"]) if p.is_file())
        ctx.info(f"{len(files)} fichier(s) dans {folder}")
    out = ctx.output_path("inventaire.csv")
    with ctx.step("archiver", "Inventaire CSV"):
        with out.open("w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f, delimiter=";")
            writer.writerow(["fichier", "taille_octets", "modifie_le"])
            for p in files:
                st = p.stat()
                writer.writerow([p.name, st.st_size, int(st.st_mtime)])
                ctx.item_done()
    ctx.metric("fichier_sortie", str(out))
    ctx.info(f"Inventaire écrit : {out}")
