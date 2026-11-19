---
'@be-music/app-play': patch
---

Remove saved folders that the browser no longer answers for, instead of offering to pick them again. Such a folder could never load or be stored again, so the player now takes it out of the folders to load at startup (or when its Reconnect request does not answer) and says which folders were removed; add the folder again to load it.
