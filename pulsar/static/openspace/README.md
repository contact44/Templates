# Open space background

Drop the generated isometric scene here as `background.png` (or `.webp` / `.jpg`), 1200 px wide is enough.
When the file exists the dashboard draws it instead of the procedural room, and reads `anchors.json`:

```json
{
  "anchors": {
    "desk0": {"x": 0.32, "y": 0.62, "face": 1},
    "desk1": {"x": 0.50, "y": 0.62, "face": 1},
    "desk2": {"x": 0.68, "y": 0.62, "face": 1},
    "selms": {"x": 0.18, "y": 0.40, "face": 1},
    "outlook": {"x": 0.12, "y": 0.58, "face": -1},
    "docusign": {"x": 0.88, "y": 0.52, "face": -1},
    "shared": {"x": 0.86, "y": 0.36, "face": 1},
    "coffee": {"x": 0.60, "y": 0.88, "face": 1}
  }
}
```

`x` and `y` are fractions of the image size (0 to 1) and mark where a robot stands to use the station;
`face` is 1 to look right, -1 to look left. Without this file the procedural room is used.
