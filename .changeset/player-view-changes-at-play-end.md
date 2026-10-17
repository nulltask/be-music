---
'@be-music/player': patch
---

A view change (hi-speed, covers) made as a play ended, after the engine's last input drain or still held back by the coalescer, was missing from the play log. The engine now records the view changes left on its input bus when the play ends (`recordPendingViewChanges`), and `PlaylogViewCoalescer.flush` returns a change still held back.
