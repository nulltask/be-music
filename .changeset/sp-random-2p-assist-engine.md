---
'@be-music/player-engine': patch
---

Fix a single-play chart being recorded as assisted because of the Random 2P option, which arranges nothing on it: a beatoraja or AC lane option on 2P now counts only on a chart with a 2P side, as beatoraja builds its 2P modifier only for two-player modes. LR2's 2P SCATTER and CONVERGE still cap the lamp on any chart, as in LR2.
