---
'@be-music/player-engine': minor
---

Replays and ruleset chart facts record an LRX chart's format as `lrx` instead of `bms` (`chart.sourceFormat`). Its rank and TOTAL still read as a BMS chart's. Readers before this change reject such a replay.
