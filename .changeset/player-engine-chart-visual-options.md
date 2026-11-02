---
'@be-music/player-engine': minor
---

Replays record chart-authored HIDDEN (including M-SUDDEN), CHANGE-HS and the visual CRAZY options in `chart.chartOptions` version 3, and engine frames publish them in `chartOptions`. Replay parsing accepts versions 1 to 3 and rejects a field or value of a later version than the recording's own, so an older recording never activates them. NONSTOP stage programs carry them too. They change no judgments, score or record eligibility.
