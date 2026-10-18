---
'@be-music/player-tui': patch
---

Fix the lane view on charts with scroll gimmicks:

- Past an LR2 negative-BPM reversal (#134) the grid scrolls from the engine's mirrored display beat, so charts like Sofa $15 → $1 or U9 visibly run backwards instead of continuing forward. The BGA stops changing cues at the reversal while a movie that is already playing keeps running, and the BPM readout holds the reversal value.
- Charts that scroll both ways no longer show notes far ahead early: the grid ends where the chart first runs past its top, as beatoraja's `LaneRenderer` does, so notes a later negative `#SCROLL` brings back wait for their time.
- A bmson chart with `lines: []`, which asks for no bar lines, drew them: the lane view now takes its bar lines from the resolved chart, as the web player does.
