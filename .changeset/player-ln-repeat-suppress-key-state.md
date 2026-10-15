---
'@be-music/player': patch
---

Fix presses on a lane after its long note was let go never charging an empty POOR until the note's tail: the terminal key-repeat workaround also ran for key-state input and replays, where LR2 and beatoraja judge every press. It now applies only to input without release events.
