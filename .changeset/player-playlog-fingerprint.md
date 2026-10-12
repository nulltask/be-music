---
'@be-music/player': minor
---

Play logs now record the play fingerprint (`bmfp1:…`) of the chart that was played as the optional `chart.fingerprint`, so logs can be matched to a chart by what was played even after keysound / BGA / metadata edits or a BMS ↔ bmson conversion, where `chart.sha256` no longer matches. `createPlaylogRecorder` computes it from the post-`#RANDOM` chart before lane options such as MIRROR are applied, hosts need no change, the field is omitted when it cannot be computed, and `parsePlaylog` keeps it while still accepting logs without it.
