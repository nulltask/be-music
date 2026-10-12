---
'@be-music/player': minor
---

Play logs now record the play fingerprint (`bmfp1:…`) of the chart that was played as the optional `chart.fingerprint`, so logs can be matched to a chart by what was played even after keysound / BGA / metadata edits or a BMS ↔ bmson conversion, where `chart.sha256` no longer matches. `createPlaylogRecorder` computes it from the post-`#RANDOM` chart before lane options such as MIRROR are applied, with the engine's `laneModeExtension` as its lane-mode input, and omits the field when it cannot be computed.
Play logs also record the value of every `#RANDOM` / `#SWITCH` line as the optional `play.randomOutcomes`, so a verifier with the chart file can rebuild the chart that was played and recompute the fingerprint. The engine fills it when it resolves the chart itself, and a host that resolves the chart beforehand passes it in `recordPlaylog.randomOutcomes`. `parsePlaylog` keeps both fields while still accepting logs without them.
