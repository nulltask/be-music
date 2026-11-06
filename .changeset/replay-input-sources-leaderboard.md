---
'@be-music/app-leaderboard': patch
---

Submissions now need the replay's input-source table (#605): a replay recorded before input sources, an input naming a source the table does not hold, a label that is not a normalised name, or a turntable source without a direction is refused with `invalid-replay`. The table is stored with the play as submitted and is part of the play's identity.
