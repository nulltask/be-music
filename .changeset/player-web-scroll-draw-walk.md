---
'@be-music/player-web': patch
---

Stop drawing notes, mines and bar lines far ahead in gimmick charts: a chart with `#SCROLL` / `#SPEED` (and any chart judged under the `beatoraja` ruleset) is now walked as beatoraja's `LaneRenderer` walks it, from the playhead up to and including the first timeline past the lane top (so notes still enter through the band above the lane rather than appearing at its top). Objects a later negative `#SCROLL` brings back into the lane (often mines 1–20 s ahead) no longer appear before their turn. A chart whose `#SCROLL` / `#SPEED` points are all 1 scrolls as a plain chart and keeps its ruleset's drawing rules.
