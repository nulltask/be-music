---
'@be-music/chart-model': patch
---

Resolve duplicate BPM, STOP, SCROLL and SPEED objects on one channel at one position by file order, so the later line wins as in beatoraja, instead of by the larger object id. `#xxx08` still beats `#xxx03` at one position, as in LR2, and a duplicated STOP still applies once.
