---
'@be-music/player': patch
---

Fix a Hell Charge note pressed early losing its gauge ticks in live play when the HCN ahead of it on the same lane was missed afterwards: the late miss took over the lane's ticks, while play-log re-simulations kept them. Both sides now tick only the HCN crossing the judge line, as beatoraja does: a note judged early waits for the one ahead to pass, and a head missed after its tail passed has no ticks.
