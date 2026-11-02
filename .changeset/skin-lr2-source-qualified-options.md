---
'@be-music/skin-lr2': minor
---

LR2's RANDOM buttons (42 / 43) step only through LR2's own six lane options: `@be-music/skin-lr2/state` adds `stepLR2LaneOption`, which moves to the next of OFF, MIRROR, RANDOM, S-RANDOM, SCATTER and CONVERGE, stepping on from another source's RANDOM, S-RANDOM or CONVERGE by its name and moving any other value to OFF (ADR 0019). The buttons draw SCATTER and CONVERGE on cells 4 and 5, and the buttons and labels read a source-qualified value by its bare name, so `beatoraja:S-RANDOM` draws the S-RANDOM cell and label and another source's one-player BATTLE reads as BATTLE.
