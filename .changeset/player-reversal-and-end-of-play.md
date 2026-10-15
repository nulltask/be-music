---
'@be-music/player': patch
---

Fix the end of a play and the LR2 negative-BPM reversal edges judging differently in live play and in play-log re-simulations: the engine charged every note still pending at the end in one batch instead of settling each miss, tail, AUTO SCRATCH note, mine and Hell Charge tick at its own instant, ignored an AUTO SCRATCH long note left open past the reversal (LR2 fails such a run), and dropped a mine press at the reversal instant itself. Both sides now agree on all three.
