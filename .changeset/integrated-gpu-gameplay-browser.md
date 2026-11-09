---
'@be-music/player-browser': minor
---

Synesthesia's play screen holds a steady frame rate on laptops with integrated graphics: on an Intel UHD laptop (WebGPU, full effects, a chart without BGA) it went from about 88 to 120–137 fps at 1280 × 720, with frames over 16.7 ms down from one in seven to under one in fifty, and from 46 to about 80 fps at 1920 × 1080.

- `PixiSceneHost.mount` takes a `renderer` option (`'webgl'` or `'webgpu'`) and renders with WebGL 2 when none is given, where it used to prefer WebGPU: on that laptop WebGPU drew the play screen at 1920 × 1080 at about 80 fps against 135 fps with WebGL 2. `?renderer=webgl` and `?renderer=webgpu` override it, and `resolveRendererPreference` takes the requested renderer as its second argument.
- Synesthesia has a "Frosted glass" setting. Its frosted panels capture and blur the backdrop every frame, a large share of the frame on an integrated GPU, so they are on by default only on macOS; elsewhere the panels are plain dark fills unless the player turns the setting on.
- The texture a Pixi skin draws into is no longer 4x multisampled. Points smaller than a device pixel grow to one pixel and fade by the area they gain, so the dust keeps its fine, soft look.
- The idle monitor's charge cloud draws its particles as indexed quads in one draw instead of one four-vertex instance each, which left most of an integrated GPU's vertex lanes idle.
- The charge cloud simulates about 30 steps a second whatever the display's rate, its particles carried on along their velocity between steps, and works out its camera's angles once a frame instead of for every vertex.
- A key press tints the sky by mixing into the ground's colours instead of filling it a second time.
- The idle monitor no longer moves or hides its cloud every frame, which made Pixi rebuild the whole background layer's draw list.
