---
'@be-music/player-skin-sdk': patch
---

A chart whose only tails are FREE ZONE notes (channel `17` / `27`, as in BM98-era charts) no longer counts long notes in `resolveChartStats`, so the built-in skins stop tagging it `LN`.
