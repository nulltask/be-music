---
'@be-music/player': patch
---

Fix Hell Charge notes judging and scoring differently in live play and in play-log re-simulations, and both differently from beatoraja: the engine drained or filled a raw 2.5 %/s from the press and kept a released HCN open until its tail, while the simulator ended the ticks at the release. Both now run beatoraja's 200 ms ticks through the gauge's judge table (GREAT ×0.5 gaining, BAD ×0.5 draining) from the judged head until the tail passes, gaining while a key is down on the lane or after a GOOD-or-better tail, and judge the tail at the release like a charge note.
