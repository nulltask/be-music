---
'@be-music/player-browser': patch
---

Show the image file named by the chart before trying same-stem alternatives, so a chart that names `foo.jpg` no longer displays a different `foo.webp` beside it. WebP remains the first alternate format when the named file is missing. This applies to BGA images, `#STAGEFILE`, `#BANNER` and `#BACKBMP`.
