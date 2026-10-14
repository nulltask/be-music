---
'@be-music/player-web': patch
---

The beatoraja skin's note layer no longer walks every note of the chart every frame under LR2's drawing rules (every chart without `#SCROLL` / `#SPEED`). Like the core scene, it now keeps LR2's `draw_count` between frames, starting past the notes already gone, and stops once a note is past the lane top's lead-in band.
