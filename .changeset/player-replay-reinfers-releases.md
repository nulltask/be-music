---
'@be-music/player': patch
---

A replay of a play log recorded before the engine inferred key releases, from a terminal without the kitty keyboard protocol, held every key from its press to the end of the play, so its long notes, mines and Hell Charge notes replayed nothing like the play. A replay now recognises such a log (presses only, with a lane pressed again and no release in between) and sends its presses through the same key-state inference a live play uses, with the graces on chart time, and the re-recorded log carries the releases it infers. The play-log simulators still read such a log as it is.
