---
'@be-music/player-web-demo': patch
---

Fix the play after a decide screen whose preload failed drawing its `#RANDOM` / `#SWITCH` branches afresh, so they no longer matched what the decide screen showed: the play made again now keeps the decide screen's draws. The decide screen also hands the stage to the very play it prepared, rather than to whichever play the demo held once the preload finished.
