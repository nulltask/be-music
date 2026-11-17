---
'@be-music/player-engine': patch
---

A host that aborts `holdAfterChart` before the chart is over now ends the play as soon as nothing is left to judge, instead of running on to the chart's end, so a play finished by ESC after its last judgment reaches its result without waiting out the remaining background sounds.
