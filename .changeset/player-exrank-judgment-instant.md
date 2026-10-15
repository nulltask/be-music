---
'@be-music/player': patch
---

Fix LR2 plays with `#EXRANK` changes judging presses and releases with the wrong widths: the engine chose a press's note with the widths at the note's time and judged an LN release with the widths at the tail, so a width change between them could turn a BAD into an empty POOR or keep a release from holding the head judgment. Presses and releases now use the widths in force at that instant, as LR2 reads them; the play-log simulator also reads a charge tail's late window and a mine's press leg at their own instants.
