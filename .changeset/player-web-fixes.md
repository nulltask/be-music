---
'@be-music/player-web': patch
---

Song-select preview, skinless DP chrome, same-slot retrigger, and audio-bus fixes for the browser player.

- Song-select chart preview now auditions AUTO PLAY-style — visible play-lane keysounds and BGM are audible, while invisible `3x` / `4x` objects are excluded (they only update lane keysound state during gameplay, not the preview), and previews fade out over 250 ms when switching or stopping instead of cutting abruptly.
- Skinless (default-skin) DP gameplay chrome reworked: dropped the top info bar, added a dedicated score panel, and made the fallback playfield layout side-aware so 2P / DP charts render their lanes correctly.
- Retriggering the same `#WAV` slot now stops the previously playing BMS source instead of letting both ring out, fixing the doubled/overlapping sample on rapid same-slot retrigger.
- Rebalanced the Web Audio bus gain staging: a -3 dB input trim ahead of the per-bus / master compressors with a matching +3 dB makeup after, plus retuned compressor params (higher thresholds, gentler ratios, softer knees), so hot source files keep headroom and the compressors act on real overloads instead of smashing normal hits. `off` mode still bypasses trim, compressors, and makeup.
- Bump pixi.js to 8.19.0.
