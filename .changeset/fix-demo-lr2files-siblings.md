---
'@be-music/player-web-demo': patch
---

`discoverLr2Themes` scopes its return to `LR2files/Theme/<name>/`, which dropped shared `LR2files/` siblings (`WallPaper/`, `Bgm/`, `Sound/`, …) from the file list handed to the skin loader. The LR2 default select skin references its backdrop via the wildcard `LR2files/WallPaper/Select/*.bmp`; without the siblings the lookup failed and the select scene painted black. Union the theme's own files with all other files under `LR2files/` that aren't part of any other theme subtree, so wildcard `#CUSTOMFILE` assets resolve as before.
