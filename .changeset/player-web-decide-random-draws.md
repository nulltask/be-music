---
'@be-music/player-web': minor
---

The decide scene draws the chart's `#RANDOM` / `#SWITCH` branches once, when it is made, as beatoraja's decide screen already did: `DecideScene.resolved` is the resolved chart with its draws, for the host to hand to the play (`preResolved`), and `DecideFrame.playChart` gives the view the same chart, so the screen's graphs show the branches the play plays. `createDecideScene` takes a `random` source for the draws (`Math.random` by default). The draws follow the chart's own ranges, so how often each branch comes up does not change.
