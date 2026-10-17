---
'@be-music/player-web-demo': patch
---

A beatoraja result's gauge and EX-score graphs now run from the start of the chart to its end. Before, they began at the first judgment and stopped at the last. They now get the starting gauge at the chart's start and the final values at its end, as `playResultFromBeatoraja` gives every beatoraja result and as the built-in and LR2 results have.
