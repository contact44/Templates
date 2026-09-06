"""Demonstration scenario: lists a workspace folder and writes a CSV inventory.

A minimal 'real' scenario: reads files, produces an output, counts what it did.
"""

import csv

KEY = "demo_inventory"
NAME = "Demo · folder inventory"
DESCRIPTION = "Lists the files of a workspace folder and writes a CSV inventory to outputs/demo_inventory/."
SCHEDULE = None
PARAMS = [
    {"name": "folder", "label": "Folder to list (relative to the workspace)", "type": "str", "default": "inbox"},
    {"name": "pattern", "label": "File pattern", "type": "str", "default": "*", "help": "Examples: *.pdf, *.docx, *"},
]


def run(ctx):
    folder = ctx.workspace / ctx.params["folder"]
    with ctx.step("doc.read", f"Folder {ctx.params['folder']}"):
        if not folder.exists():
            folder.mkdir(parents=True, exist_ok=True)
            ctx.warn(f"Folder created because it was missing: {folder}")
        files = sorted(p for p in folder.glob(ctx.params["pattern"]) if p.is_file())
        ctx.info(f"{len(files)} file(s) in {folder}")
    out = ctx.output_path("inventory.csv")
    with ctx.step("archive", "CSV inventory"):
        with out.open("w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f, delimiter=";")
            writer.writerow(["file", "size_bytes", "modified"])
            for p in files:
                st = p.stat()
                writer.writerow([p.name, st.st_size, int(st.st_mtime)])
                ctx.item_done()
    ctx.metric("output_file", str(out))
    ctx.info(f"Inventory written: {out}")
