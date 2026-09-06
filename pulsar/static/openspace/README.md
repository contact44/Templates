# Open space artwork

Generated with Higgsfield from the client's references, then cut and downscaled here.

- `background-light.png` · `background-dark.png` — the isometric room, 1200 px wide, one per theme.
- `anchors-light.json` · `anchors-dark.json` — where a robot stands to use each station, as fractions of the
  image (`x`, `y` = feet position; `face` = 1 looks right, -1 looks left; `lx`, `ly` = label position),
  plus `bg`, the colour painted around the room.
- `char-andromede.png` · `char-orion.png` · `char-sirius.png` — the three characters, transparent background,
  200 px tall; they are drawn 60 logical pixels tall in the scene, flipped when walking left.

Remove the background files to fall back to the room drawn in code.
