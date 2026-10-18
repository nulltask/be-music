---
'@be-music/player': patch
---

Fix AUTO scoring both PGREATs of a charge note (CN / HCN) at its tail, so the combo and the gauge stood still at the head and jumped by two at the tail. AUTO now clears the head at the head and the tail at the tail, as AUTO SCRATCH, the play-log simulator and beatoraja's autoplay do. An LN still scores its one PGREAT at the tail.
