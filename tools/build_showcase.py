"""Build the one-page showcase of Samsung Pulsar: the open space, alive, on a phone.

    python tools/build_showcase.py --out <file.html>

The preview built by build_preview.py stacks the seven screens of the platform for someone at a desk. This is the
other need: one page to show the project from a phone, where the animated open space is the whole argument and
everything else is a caption. It carries no data of the department, only the simulation of preview.js.

The file it writes is meant to be published as an Artifact, so it starts at <title> and has no <html> wrapper.
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
STATIC = ROOT / "pulsar" / "static"

# the nine steps of scenarios/selms_extraction.py, in French for the people this page is shown to
STEPS = [
    ("Ouvrir le portail Knox", "w1.samsung.net/portalapp/home"),
    ("Entrer dans SELMS+", "le lien du menu ouvre un onglet"),
    ("Confirmer la connexion", "bouton Confirm"),
    ("Ouvrir Mes contrats", "Gestion de contrats, puis Mes contrats"),
    ("Poser les filtres", "du 01/01/2016 à la fin du mois, Closed = N"),
    ("Lancer la recherche", "et attendre que la page réponde"),
    ("Télécharger l'export Excel", "récupéré avec les cookies de la session"),
    ("Vérifier le fichier", "ouvert et compté, ligne par ligne"),
    ("Envoyer le fichier par mail", "par Outlook, depuis le poste"),
]

FIGURES = [
    ("9", "étapes", "un écran traversé chacune"),
    ("8", "tâches", "un geste précis chacune"),
    ("3", "robots", "trois scénarios à la fois"),
    ("19", "tests", "au vert à chaque version"),
]


def data_uri(path: Path) -> str:
    kind = "image/svg+xml" if path.suffix == ".svg" else f"image/{path.suffix.lstrip('.')}"
    return f"data:{kind};base64," + base64.b64encode(path.read_bytes()).decode()


def openspace_config() -> dict:
    """The rooms, the sprites and the walk graph, with every image turned into a data URI so the page stands alone."""
    from pulsar.app import create_app
    from pulsar.config import Settings

    settings = Settings.from_env()
    settings = type(settings)(workspace=(ROOT / "workspace").resolve(), scenarios_dir=(ROOT / "scenarios").resolve(),
                              demo=True)
    config = create_app(settings, start_scheduler=False).state.platform.openspace_config()
    for theme in ("light", "dark"):
        if config.get(theme):
            config[theme]["background"] = data_uri(STATIC / "openspace" / Path(config[theme]["background"]).name)
            for occluder in config[theme]["scene"].get("occluders", []):
                occluder["image"] = data_uri(STATIC / "openspace" / Path(occluder["image"]).name)
    for character in config["characters"]:
        character["sheet"] = data_uri(STATIC / "openspace" / Path(character["sheet"]).name)
    config["avatars"] = [data_uri(STATIC / "openspace" / Path(a).name) for a in config["avatars"]]
    return config


def steps_html() -> str:
    rows = []
    for i, (title, note) in enumerate(STEPS, 1):
        rows.append(f'<li><span class="no">{i:02d}</span><span class="what">{title}'
                    f'<span class="note">{note}</span></span></li>')
    return "\n".join(rows)


def figures_html() -> str:
    return "\n".join(f'<div class="fig"><b>{n}</b><span class="unit">{unit}</span>'
                     f'<span class="gloss">{gloss}</span></div>' for n, unit, gloss in FIGURES)


def build(target: Path) -> Path:
    page = (TEMPLATE
            .replace("__STEPS__", steps_html())
            .replace("__FIGURES__", figures_html())
            .replace("__ENGINE__", (STATIC / "openspace.js").read_text(encoding="utf-8"))
            .replace("__SIMULATION__", (STATIC / "preview.js").read_text(encoding="utf-8"))
            .replace("__CONFIG__", json.dumps(openspace_config())))
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(page, encoding="utf-8")
    return target


TEMPLATE = r"""<title>Samsung Pulsar</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;700&family=IBM+Plex+Mono:wght@400;500&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap">
<style>
/* Palette lifted from the artwork: the blue of the HUD labels, the cyan of the strip lights, the tan of the floor. */
:root{
  --ground:#edeae3; --surface:#faf9f6; --sunk:#e3dfd6;
  --ink:#12161c; --ink-2:#4a5058; --ink-3:#7c8189;
  --line:#d6d1c6; --accent:#1b3fb8; --live:#1f7d79; --sand:#b9996f;
  --frame:#10141a;
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    --ground:#0e1218; --surface:#161b23; --sunk:#0a0d12;
    --ink:#e9e6df; --ink-2:#a7adb6; --ink-3:#767d87;
    --line:#262d38; --accent:#7fa0ff; --live:#55cfca; --sand:#c3a67c;
    --frame:#05070a;
  }
}
:root[data-theme="dark"]{
  --ground:#0e1218; --surface:#161b23; --sunk:#0a0d12;
  --ink:#e9e6df; --ink-2:#a7adb6; --ink-3:#767d87;
  --line:#262d38; --accent:#7fa0ff; --live:#55cfca; --sand:#c3a67c;
  --frame:#05070a;
}

*{box-sizing:border-box}
body{
  background:var(--ground); color:var(--ink);
  font-family:"Source Serif 4",Georgia,"Times New Roman",serif;
  font-size:17px; line-height:1.6;
  -webkit-font-smoothing:antialiased;
}
.wrap{max-width:640px; margin:0 auto; padding-inline:20px; padding-block:28px 56px;
      display:flex; flex-direction:column; gap:40px}

.eyebrow{font-family:"IBM Plex Mono",ui-monospace,Menlo,monospace; font-size:.68rem; font-weight:500;
         letter-spacing:.18em; text-transform:uppercase; color:var(--ink-3)}

/* --- masthead ------------------------------------------------------------ */
.mast{display:flex; flex-direction:column; gap:10px}
.mast h1{font-family:Archivo,"Helvetica Neue",Arial,sans-serif; font-weight:700; font-size:clamp(1.8rem,7.2vw,2.25rem);
         line-height:1.05; letter-spacing:-.022em; margin:0; text-wrap:balance}
.mast h1 em{font-style:normal; color:var(--accent)}
.mast .thesis{color:var(--ink-2); margin:0; max-width:34em}

/* --- the screen ---------------------------------------------------------- */
.screen{display:flex; flex-direction:column; background:var(--frame); border-radius:6px; overflow:hidden}
.hud{display:flex; align-items:center; gap:12px; padding:9px 12px; background:var(--frame);
     border-bottom:1px solid rgba(255,255,255,.09);
     font-family:"IBM Plex Mono",ui-monospace,Menlo,monospace; font-size:.66rem; letter-spacing:.1em;
     text-transform:uppercase; color:#8fa6c4}
.hud .on{color:var(--live); display:flex; align-items:center; gap:6px}
.hud .on i{width:6px; height:6px; border-radius:50%; background:currentColor; flex:none}
@media (prefers-reduced-motion:no-preference){ .hud .on i{animation:pulse 2.4s ease-in-out infinite} }
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.25}}
.hud button{margin-left:auto; font:inherit; letter-spacing:.1em; text-transform:uppercase;
            color:#8fa6c4; background:transparent; border:1px solid rgba(255,255,255,.18);
            border-radius:3px; padding:3px 9px; cursor:pointer}
.hud button:hover{color:#fff; border-color:rgba(255,255,255,.4)}
.hud button:focus-visible{outline:2px solid var(--live); outline-offset:2px}
#openspace{display:block; width:100%; height:auto; max-width:100% !important;
           image-rendering:pixelated; background:var(--frame)}
.caption{font-family:"IBM Plex Mono",ui-monospace,Menlo,monospace; font-size:.72rem; line-height:1.5;
         color:var(--ink-3); margin:10px 2px 0}

/* --- the run ------------------------------------------------------------- */
section h2{font-family:Archivo,"Helvetica Neue",Arial,sans-serif; font-weight:600; font-size:1.22rem;
           letter-spacing:-.012em; margin:0 0 4px}
section > p{color:var(--ink-2); margin:0 0 18px; max-width:34em}
ol.run{list-style:none; margin:0; padding:0; display:flex; flex-direction:column}
ol.run li{display:flex; gap:14px; padding:11px 0; border-top:1px solid var(--line); align-items:baseline}
ol.run li:last-child{border-bottom:1px solid var(--line)}
ol.run .no{font-family:"IBM Plex Mono",ui-monospace,Menlo,monospace; font-size:.78rem; font-variant-numeric:tabular-nums;
           color:var(--sand); flex:none; width:2.2em}
ol.run .what{display:flex; flex-direction:column; gap:1px}
ol.run .note{font-family:"IBM Plex Mono",ui-monospace,Menlo,monospace; font-size:.72rem; color:var(--ink-3);
             line-height:1.45; word-break:break-word}

/* --- figures ------------------------------------------------------------- */
.figures{display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:1px; background:var(--line);
         border:1px solid var(--line); border-radius:4px; overflow:hidden}
@media (min-width:560px){ .figures{grid-template-columns:repeat(4,minmax(0,1fr))} }
.fig{background:var(--surface); padding:14px 14px 12px; display:flex; flex-direction:column; gap:1px}
.fig b{font-family:Archivo,"Helvetica Neue",Arial,sans-serif; font-size:1.7rem; font-weight:700;
       font-variant-numeric:tabular-nums; line-height:1; letter-spacing:-.02em}
.fig .unit{font-family:Archivo,"Helvetica Neue",Arial,sans-serif; font-size:.82rem; color:var(--ink-2)}
.fig .gloss{font-family:"IBM Plex Mono",ui-monospace,Menlo,monospace; font-size:.65rem; color:var(--ink-3);
            line-height:1.4; margin-top:3px}

/* --- how ----------------------------------------------------------------- */
dl.how{margin:0; display:flex; flex-direction:column; gap:16px}
dl.how dt{font-family:Archivo,"Helvetica Neue",Arial,sans-serif; font-weight:600; font-size:.98rem; margin-bottom:1px}
dl.how dd{margin:0; color:var(--ink-2)}

/* --- status -------------------------------------------------------------- */
.status{border-left:2px solid var(--accent); padding:2px 0 2px 16px; display:flex; flex-direction:column; gap:6px}
.status p{margin:0; color:var(--ink-2)}
.status strong{color:var(--ink); font-weight:600}
footer{border-top:1px solid var(--line); padding-top:16px; color:var(--ink-3);
       font-family:"IBM Plex Mono",ui-monospace,Menlo,monospace; font-size:.7rem; line-height:1.7}
</style>

<div class="wrap">

  <header class="mast">
    <span class="eyebrow">Direction Juridique &middot; Samsung Electronics France</span>
    <h1>Trois robots qui font le travail <em>que personne ne veut refaire</em></h1>
    <p class="thesis">Pulsar est une plateforme d'automatisation qui tourne sur un poste, sans cloud et sans
      licence. Les robots ci-dessous ne sont pas une métaphore : c'est l'écran de supervision, et il montre en
      direct qui exécute quoi.</p>
  </header>

  <div>
    <div class="screen">
      <div class="hud">
        <span class="on"><i></i>En direct</span>
        <span>Open space</span>
        <button id="toggle" type="button" aria-pressed="false">Pause</button>
      </div>
      <canvas id="openspace" aria-label="L'open space : Andromède, Orion et Sirius au travail"></canvas>
    </div>
    <p class="caption">Journée simulée dans votre navigateur. Sur le poste, ces memes robots bougent au rythme
      des vraies executions.</p>
  </div>

  <section>
    <h2>Ce qu'un robot fait, concrètement</h2>
    <p>L'extraction mensuelle SELMS+ : la même suite de gestes qu'un humain, écrite une fois, rejouée le 28 de
      chaque mois à 7 h.</p>
    <ol class="run">
__STEPS__
    </ol>
  </section>

  <section>
    <h2>L'état du chantier</h2>
    <div class="figures">
__FIGURES__
    </div>
  </section>

  <section>
    <h2>Comment ça tient</h2>
    <dl class="how">
      <div>
        <dt>Un employé virtuel par tâche</dt>
        <dd>Le robot n'attaque pas les bases par une porte dérobée : il utilise le navigateur de l'entreprise,
          avec le compte de l'utilisateur, comme un collaborateur ordinaire.</dd>
      </div>
      <div>
        <dt>Un carnet de bord</dt>
        <dd>Chaque geste est daté, consigné, et photographié. Quand quelque chose échoue, on sait où et pourquoi.</dd>
      </div>
      <div>
        <dt>Rien ne quitte le poste</dt>
        <dd>La base, le coffre à identifiants et les exports restent sur la machine. Aucun serveur à financer,
          aucune licence à renouveler.</dd>
      </div>
    </dl>
  </section>

  <section class="status">
    <span class="eyebrow">Où nous en sommes</span>
    <p><strong>Plateforme et premier scénario écrits</strong>, couverts par 19 tests automatiques qui rejouent le
      parcours complet sur une copie des écrans SELMS+.</p>
    <p><strong>Première exécution sur le vrai site : à venir.</strong> C'est le jalon qui reste, et il se joue sur
      le poste de travail Samsung.</p>
  </section>

  <footer>
    Samsung Pulsar &middot; CA Consulting<br>
    Données de démonstration : aucun contrat, aucun identifiant sur cette page.
  </footer>

</div>

<script>
__ENGINE__
</script>
<script>
__SIMULATION__
</script>
<script>
(function () {
  var canvas = document.getElementById("openspace");
  var scene = Openspace.start({canvas: canvas, config: __CONFIG__, poll: PulsarPreview.poll, interval: 2000});
  var button = document.getElementById("toggle");
  var paused = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function apply() {
    scene.paused = paused;
    canvas.style.opacity = paused ? ".6" : "";
    button.textContent = paused ? "Reprendre" : "Pause";
    button.setAttribute("aria-pressed", String(paused));
  }
  apply();                       // a visitor who asked for reduced motion gets the room still, and a way to start it
  button.addEventListener("click", function () { paused = !paused; apply(); });
})();
</script>
"""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default=str(ROOT / "docs" / "showcase.html"))
    target = build(Path(parser.parse_args().out).resolve())
    print(f"{target} written, {target.stat().st_size // 1024} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
