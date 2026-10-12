---
'@be-music/chart': minor
---

Add `resolveChart(chart, options)`, the single step from a parsed chart to the chart a player plays. Its `ResolvedChart` carries the play variant and its play-mode layouts, the judged notes (`tap` / `ln`, one per lane and position, with LN / CN / HCN mode and FREE ZONE tails), the shadowed duplicate keysounds, mines with their gauge damage, invisible objects, every sample trigger, the tempo map, SCROLL / SPEED keyframes, bar lines, BGA cues, the judge-rank and TOTAL inputs and the `RandomDraws` the chart was resolved with. Every format default and de facto rule is applied there once, and the parts are computed on first access.
