---
'@be-music/player-web': minor
---

Name the LR2 ops, timers, numbers, texts, buttons and sliders the scenes light and read after the `@be-music/lr2-skin/ids` tables instead of bare numbers; what each scene lights is unchanged. Migration: `RESULT_DYNAMIC_OPS` is no longer exported from `@be-music/player-web/scenes`; use `LR2_OP` from `@be-music/lr2-skin/ids` (`RESULT_CLEARED` is `RESULT_CLEAR`, `RANK_NOW_*` / `RANK_PREV_*` / `RANK_NEXT_*` are `RESULT_RANK_*` / `PREVIOUS_RANK_*` / `UPDATED_RANK_*`, `RESULT_FLIP_DISABLED` / `_ENABLED` are `RESULT_FLIP_OFF` / `_ON`, `KEYCONFIG_*` are `KEY_CONFIG_*`).
