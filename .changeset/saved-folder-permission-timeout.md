---
'@be-music/app-play': patch
---

Fix the player staying on the drop zone at startup, with no saved folders, Bemuse servers, difficulty tables or new drops loading, when Chrome never answers the read-permission query of a saved folder. A folder whose permission or identity check does not answer within 3 seconds now waits for its Reconnect button, and the other sources load as usual.
