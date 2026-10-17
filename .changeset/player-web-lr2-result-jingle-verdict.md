---
'@be-music/player-web': patch
---

The LR2 result screen no longer plays the fail jingle on a clear, or the clear jingle on a failure, when the theme has neither the verdict's jingle nor a generic result one. It plays the verdict's jingle, else the generic one, and nothing otherwise (`resolveResultJingle`), as LR2 does and as the built-in result screen already does.
