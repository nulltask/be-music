---
'@be-music/lr2-skin': minor
---

Fix the LR2 select, decide and result screens drawing the chart's file name on texts 16 / 26: LR2 draws the chart's tag there, a field of its own song database (OpenLR2 `ProcS_Select` sets them from `cur.tag`). be-music keeps no tags, so they now read empty on every screen. `LR2_TEXT.FULL_ARTIST` / `FULL_ARTIST_ALT` are renamed `TAG` / `TAG_ALT` for what LR2 draws there; beatoraja's `fullartist` keeps number 16 under its own name (`BEATORAJA_TEXT.FULLARTIST`).
