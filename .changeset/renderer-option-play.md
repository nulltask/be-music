---
'@be-music/app-play': minor
---

Options → Skin & display → Renderer picks WebGL 2 or WebGPU, and the player now draws with WebGL 2 by default: on a laptop's integrated GPU the play screen held its frame rate at 1920 × 1080 with WebGL 2 (135 fps) but not with WebGPU (about 80 fps). The pick is kept per browser and takes effect on the next load; `?renderer=` in the URL still overrides it.
