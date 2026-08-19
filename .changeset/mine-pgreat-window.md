---
'@be-music/player': patch
---

Detonate mines the way real LR2 does: a held crossing of the judge line, or a press within PGREAT.

LR2's own changelog (the 080114 mine-implementation entry) gives two detonation conditions — passing
a mine with the key held, or pressing within the PGREAT (ピカグレ) range — and no later entry revises
it. The previous implementation followed losak's secondary writeup and used the GOOD window
(±40-120 ms depending on rank) for both legs. Now the press leg uses the PGREAT window (±8-21 ms)
and the hold-through leg anchors to the crossing itself, so a held mine can no longer slip through
undetonated between two frame ticks when the window is narrower than the tick interval.
`goodWindowReachUs` is renamed to `pgreatWindowReachUs` accordingly.
