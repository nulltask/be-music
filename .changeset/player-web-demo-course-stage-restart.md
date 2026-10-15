---
'@be-music/player-web-demo': patch
---

Fix a click (or Enter / Space / Escape) during a course stage fading it out and starting it over: the previous stage's result screen stayed alive behind the stage and took the input as "continue", which started the unfinished stage again. The result screen is now dropped before the next stage starts. NONSTOP courses and beatoraja skins were not affected.
