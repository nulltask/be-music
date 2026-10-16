---
'@be-music/player-web': patch
---

The built-in result screen no longer plays the fail jingle on a clear, or the clear jingle on a failure, when the theme has neither the verdict's jingle nor a generic result one: it plays the verdict's jingle, else the generic one, and nothing otherwise (`resolveResultJingle`), as LR2 and beatoraja do and as the beatoraja result screen already did.
