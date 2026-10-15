---
'@be-music/player-web': patch
---

The LR2 and default result scenes ignore input once `onContinue` has fired, so a host that leaves the scene up while it starts the next play no longer gets that play's clicks and keys (Enter / Space / Escape) as another continue.
