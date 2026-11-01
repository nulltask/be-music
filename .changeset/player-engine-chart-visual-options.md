---
'@be-music/player-engine': minor
---

Replays record chart-authored HIDDEN, CHANGE-HS and CRAZY size / wave in `chart.chartOptions` version 2, and engine frames publish them in `chartOptions`. Replay parsing still accepts version 1 and rejects a version-1 program that carries a version-2 field, so an older recording never activates them. NONSTOP stage programs carry them too. They change no judgments, score or record eligibility.
