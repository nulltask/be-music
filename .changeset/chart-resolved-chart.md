---
'@be-music/chart': minor
---

Add `resolveChart(chart, options)`, the single step from a parsed chart to the chart a player plays. Its `ResolvedChart` carries the play variant and its play-mode layouts, the judged notes (`tap` / `ln`, one per lane and position, with LN / CN / HCN mode and FREE ZONE tails), the shadowed duplicate keysounds, mines with their gauge damage, invisible objects, every sample trigger, the BMS dynamic volume changes, the tempo map, SCROLL / SPEED keyframes, bar lines, BGA cues, the judge-rank and TOTAL inputs and the `RandomDraws` the chart was resolved with. Every format default and de facto rule is applied there once, and the parts are computed on first access.

With it come the rules every consumer shares:

- `resolveLandmineDamage` (a BMS mine value read as a base-36 gauge percentage, bmson `damage`, otherwise `DEFAULT_LANDMINE_DAMAGE`), `resolveChartLongNoteMode` (`#LNMODE` / bmson `info.ln_type`, otherwise `DEFAULT_LONG_NOTE_MODE`) and the `LongNoteMode` type, which `@be-music/player` used to export.
- `countScoredNotes(chart, options)`: how many notes a chart scores (its judged notes without FREE ZONE ones, a long note counting once) and the play variant that decided FREE ZONE, without timing every note, in about 60% of `resolveChart`'s time.
- `resolveChartMainBpm(chart)`: the BPM the most judged notes sit at (beatoraja's `MAINBPM`), counting a tap and a long-note head once and a CN / HCN tail too, with ties going to the BPM reached first; the reference HS-FIX needs for charts whose BPM × N + STOP gimmicks skew any time average.
- `volWavToLinearGain`: a BMS `#VOLWAV` value as the chart-wide linear gain, `n / 100` for `0 < n < 200` and unity otherwise, the range beatoraja applies.
- `isInvisibleNoteChannel`: whether a channel places an invisible (`3x` / `4x`) object on a lane.
- The long-note resolvers report where each tail is read from: `BmsLongNote.endEvent` is the closing object of an `#LNTYPE 1` pair or the last object of an `#LNTYPE 2` run (whose tail is one cell after it), `LnobjLongNoteResolution.startToEndEvent` maps each `#LNOBJ` start to its end object, and `BmsLongNoteResolution.lnType` is the `#LNTYPE` the `5x` / `6x` objects were read with (declared, inferred, or 1).
