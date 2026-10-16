---
'@be-music/player-web': patch
---

On the built-in and LR2 select screens, a 24-key chart (a bmson `keyboard-24k` chart or its double) is no longer listed under the 7-key or 14-key filter. The key filter now uses the browse model's key mode (`@be-music/scene-model`), where a 24-key chart is its own mode; LR2's key filter has no 24-key choice, so such a chart is listed only under ALL. It used to be folded onto 7 or 14 keys, as LR2's key-mode ops fold it for the skin.
