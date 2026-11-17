---
'@be-music/chart-model': patch
---

`#LNOBJ` now pairs only the objects left after a later line of the same measure and channel overwrites an earlier one. An end object a later line replaced with a note used to end the note before it and show up as a tap of its own, and a start replaced by an end object left both as taps; they now pair as the remaining objects say, the same objects the notes are chosen from.
