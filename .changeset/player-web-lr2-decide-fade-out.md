---
'@be-music/player-web': patch
---

The LR2 decide screen fades out as it leaves, as LR2's does: it starts timer 2 when it moves on to the play or backs out to select, draws the skin's fade-out elements on it, and moves on once the skin's `#FADEOUT` has run. It used to move on at once and never start timer 2.
