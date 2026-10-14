---
'@be-music/player-web': patch
---

The beatoraja skin's bar-line layer no longer visits every bar, BPM, STOP and time marker of the chart each frame under LR2's drawing rules: the walk starts at the first marker not yet passed (a binary search) and stops once a marker is above the lane top's lead-in band.
