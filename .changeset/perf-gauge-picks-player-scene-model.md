---
'@be-music/player-scene-model': patch
---

Speed up the gauge and PRACTICE option helpers (`formatGaugeLabel`, `keepPracticeGauge`, `cyclePlayOptionValue`, `resolvePracticeSelection`): a bare gauge pick no longer goes through the source-qualified split, and the PRACTICE selection is built without spreads.
