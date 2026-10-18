---
'@be-music/player-web': patch
---

Take the play log's `visibleMs` at one main BPM on every family's play screen: the BPM the most judged notes sit at (`resolveChartMainBpm`, beatoraja's main BPM), the one HS-FIX `AVERAGE` already pegged the hi-speed to. On gimmick charts the recorded `visibleMs` depended on the family, as the built-in and LR2 screens took the BPM held longest and the beatoraja screen counted mines and every long-note end as well. The built-in HUD's `mainBpm` and the beatoraja skins' main BPM (number 92), their white and green numbers at it and their BPM graph now read the same value. An older log of such a chart may scroll at a slightly different hi-speed when it is replayed on another hi-speed scale.
