---
'@be-music/app-leaderboard': patch
---

Store each play's input sources, and name every way to keep a guest account.

- Submissions now need the replay's input-source table (#605): a replay recorded before input sources, an input naming a source the table does not hold, a label that is not a normalised name, or a turntable source without a direction is refused with `invalid-replay`. The table is stored with the play as submitted and is part of the play's identity.
- The settings page tells a guest that a passkey, Google or Discord keeps the account, not a passkey alone.
