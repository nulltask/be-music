---
'@be-music/lr2-skin': patch
---

Pick a play skin for 24-key charts instead of returning nothing.

LR2 never shipped a keyboard-mode skin, so `pickLr2PlaySkin` now maps the `'24'` / `'48'` chart variants onto the SP / DP IIDX fallback chains (`play_7` first for 24 keys, `play_14` first for 48). The mounted skin supplies the frame, gauge, and judge graphics while the 24 lanes themselves render through the host's fallback playfield.
