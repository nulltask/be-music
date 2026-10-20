---
'@be-music/parser': minor
---

Parse BMS and bmson using shared chart semantics and canonical Be-Music JSON names.

- Support explicit RANDOM/SWITCH outcomes with `resolveBMSControlFlowWithDraws` and reject outcomes that do not belong to the chart.
- Decode EUC-KR Korean charts and honor EUC-KR/CP949 charset declarations.
- Read BASE declarations anywhere in a BMS file, with the last valid declaration taking precedence.
- Read bmson keyboard modes, wheel lanes, mines, hidden notes and scroll events with their specified lane mappings.
- Reuse BPM/STOP keys and support base-62 tables when needed, avoiding overwritten events in large bmson charts.
- Improve BMS parsing speed while preserving chart content and encoding detection.

Migration: use `parseBMS`, `resolveBMSControlFlow` and `resolveBMSControlFlowWithDraws`. Former Be-Music JSON keys remain accepted on input, with canonical keys taking precedence; external format spellings are unchanged.
