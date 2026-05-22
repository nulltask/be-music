---
'@be-music/player-web': patch
---

Skip beatoraja sprite props whose `src` index points at a missing image entry so a malformed theme no longer renders a placeholder rectangle in its place.
