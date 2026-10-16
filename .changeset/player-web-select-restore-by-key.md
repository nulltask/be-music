---
'@be-music/player-web': patch
---

On the built-in and LR2 select screens, a restored place puts the cursor back on the bar it was on (the snapshot's `focusKey`) when the list moved under it, such as a course folder listed again with a course of the player's added, and brings back the search it was saved with. It used to restore the cursor's index, which could land on a neighbouring bar, and kept whatever search was in force. The sort and the filters stay the play options' and are not restored.
