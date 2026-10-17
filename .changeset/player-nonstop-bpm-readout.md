---
'@be-music/player': minor
---

A stitched NONSTOP play's BPM readout no longer has to read 150: `stitchNonstopCourse`'s map now carries `tempo`, each stage's own BPM scaled by its FIT rate as LR2 shows it (`resolveNonstopTempo`, looked up with `nonstopBpmAt`), over each stage's window by default or in LR2's event order with the `lr2` placement.
