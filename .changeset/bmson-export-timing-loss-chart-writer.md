---
'@be-music/chart-writer': patch
---

Converting BMS to bmson now reports what it silently dropped before: a BPM change to a negative or undefined `#BPMxx` (code `bpm`, LR2's reverse scroll) and a STOP without a positive `#STOPxx` (code `stop`, which moves the later notes 1/192 of a measure earlier). bmson can hold neither, so the output still leaves them out, but `onDiagnostic` now says so.
