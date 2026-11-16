---
'@be-music/player-engine': patch
---

Under the `plugout` ruleset, a press with nothing to judge plays plugout's lane sound cursor: the last note a press judged, the lane's next note after a long note is let go, or a hidden note that played since, starting from the lane's first note. Before, it played LR2's choice, which sounds nothing before the first note's window opens and moves on to missed notes.
