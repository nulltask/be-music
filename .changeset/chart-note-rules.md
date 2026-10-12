---
'@be-music/chart': minor
---

Add the note rules every consumer shares: `resolveLandmineDamage` (a BMS mine value read as a base-36 gauge percentage, bmson `damage`, otherwise `DEFAULT_LANDMINE_DAMAGE`), `resolveChartLongNoteMode` (`#LNMODE` / bmson `info.ln_type`, otherwise `DEFAULT_LONG_NOTE_MODE`) and the `LongNoteMode` type. They moved here from `@be-music/player`, which keeps exporting `resolveLandmineGaugeEffect` and `resolveChartLongNoteMode` on top of them.
