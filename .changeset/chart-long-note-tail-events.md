---
'@be-music/chart': minor
---

The long-note resolvers now report where each tail is read from, so a consumer can place it exactly instead of from a beat: `BmsLongNote.endEvent` is the closing object of an `#LNTYPE 1` pair or the last object of an `#LNTYPE 2` run (whose tail is one cell after it), `LnobjLongNoteResolution.startToEndEvent` maps each `#LNOBJ` start to its end object, and `BmsLongNoteResolution.lnType` is the `#LNTYPE` the `5x` / `6x` objects were read with (declared, inferred, or 1).
