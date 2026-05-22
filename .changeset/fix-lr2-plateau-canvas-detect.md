---
'@be-music/lr2-skin': patch
---

`autoDetectCanvasFromObservedCoordinates` now uses a two-stage rule when picking a design canvas for `#RESOLUTION`-less themes:

1. **High inclusion (≥ 90 %)** — the candidate covers nearly all DST corners, so it's the design canvas. Handles cleanly-authored skins.
2. **Plateau** — the candidate already contains a non-trivial fraction (> 30 %) AND the next bigger tier adds little (< 10 % of total corners). The remaining uncaught corners are far-off slide-animation keyframes the next tier doesn't catch either, so the current tier is the right design canvas.

Fixes the LR2 default `decide.lr2skin` regression where slide-out keyframes flying elements off the right side dragged the detected canvas up to 1920×1080 and shrunk the on-screen chrome into the top-left quadrant.
