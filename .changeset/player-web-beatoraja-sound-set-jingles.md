---
'@be-music/player-web': patch
---

Fix a beatoraja theme playing a voice clip instead of its clear jingle (ModernChic: `Root/sounds/vo/<voice>/clear/clear.ogg` sorted before `Sound/clear.ogg`): `pickBeatorajaThemeBgmPaths` now takes a result / decide stem from the folder holding the most of those files, as beatoraja plays them from one sound set, then the shallowest one.
