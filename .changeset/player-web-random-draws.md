---
'@be-music/player-web': patch
---

Draw a chart's `#RANDOM` / `#SWITCH` branches once per play and play that draw:

- On beatoraja skins a chart could play, score and log both branches' notes and keysounds, or the same branch twice, while the skin's graphs, markers and BGA showed only the first draw: the engine was handed a chart that still carried its control flow and drew again. Every family now hands the engine the drawn chart with its draws, so its RANDOM summary names the branches that play.
- The play variant was classified from the undrawn chart, so lanes only a branch adds were ignored and such a chart could be laid out and judged as 5 KEY instead of 7 KEY. It is now classified from the drawn chart.
- The decide screen draws the branches and hands them to the play (`DecideScene.resolved` → `preResolved`), so its graphs show what the play plays. The draws follow the chart's own ranges, so how often each branch comes up does not change.
- A replay drew new branches, and `prepare` rejected the log whenever they differed from the recorded run; it now plays the log's draws (`play.randomDraws`).
