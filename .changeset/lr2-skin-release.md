---
'@be-music/lr2-skin': minor
---

Provide `@be-music/lr2-skin/ids` and `@be-music/lr2-skin/state` for named LR2 skin vocabulary and deterministic scene-state resolution.

- Resolve screen options, numbers, text, sliders, graphs, buttons and timers from shared select, decide, play, result and course models.
- Load course-screen definitions and theme system sounds.
- Select keyboard-mode skin fallbacks using bmson's mode hint, including charts that use only a subset of keyboard lanes.

Migration: use canonical names such as `LR2Skin` and `LR2BGAElement`. LR2 CSV commands retain their specification spellings.
