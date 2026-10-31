---
'@be-music/chart-writer': patch
---

Changing bmson output resolution no longer shortens long notes or moves BGA cues. Scale absolute LN endpoints, every BGA event plane and default-resolution barlines consistently; retain millisecond sequence timings and explicit empty barlines. Reject a pulse grid that would turn a positive LN into a tap.
