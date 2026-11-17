---
'@be-music/app-play': patch
---

Fix the well-known difficulty tables not showing for players who had used the player before: earlier builds stored an empty table list with every Options save (and synced it to the account), which read as a list of no tables. A stored empty list now reads as none, so it gets the well-known tables.
