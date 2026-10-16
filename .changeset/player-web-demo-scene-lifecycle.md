---
'@be-music/player-web-demo': patch
---

With both an LR2 and a beatoraja theme loaded, a beatoraja select screen followed by an LR2 or built-in decide or play screen stayed live behind it, playing its BGM and preview and taking keys, until the select screen came back. Every screen change now goes through the scene host, so the select screen stops as the next screen shows.
