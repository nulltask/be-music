---
'@be-music/beatoraja-skin': patch
---

Take the LR2-compatible ids from `@be-music/lr2-skin/ids` (now a dependency) instead of numbering them again: the `BEATORAJA_OP`, `BEATORAJA_NUM`, `BEATORAJA_TEXT` and `BEATORAJA_BUTTON` entries and the `TIMER_*` constants beatoraja shares with LR2 read their value from `LR2_OP` / `LR2_NUM` / `LR2_TEXT` / `LR2_BUTTON` / `LR2_TIMER`, and `LR2_LANE_INDEX_MAX` is re-exported from there. Every exported name and value stays the same; beatoraja's own ids are still numbered here.
