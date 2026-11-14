---
'@be-music/chart-writer': minor
---

`stringifyBMS` and `stringifyBmson` now report conversion losses that change gameplay through `onDiagnostic`, with the new `ChartExportDiagnostic` codes `mine-damage` (a bmson mine damage BMS cannot hold, or a missing one), `total` (a TOTAL the other format's unit cannot express) and `long-note-mode` (long notes of different types under one `#LNMODE`). The output is unchanged; a caller can throw from the handler to refuse a lossy conversion.
