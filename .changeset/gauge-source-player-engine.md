---
'@be-music/player-engine': minor
---

A gauge pick can now name its source (`lr2:HARD`, `beatoraja:EX-HARD`, `____:ASSIST-EASY`) and keeps it under every judge ruleset: that source's gauge table and TOTAL reading, auto-shift ladder, fallback gauge, course gauges and clear lamp. `PlayerOptions.gauge`, replays (`play.gauge`, `play.gauge2P`) and re-judging accept it, a result names the source in `gauge.source`, and `splitGaugePick`, `isGaugePick`, `gaugePickType`, `resolveGaugePickSource` and `qualifyGaugePick` are exported. A bare gauge still means the judge ruleset's own.
