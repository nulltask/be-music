---
'@be-music/player-web': patch
---

Fix the beatoraja select and decide screens showing the header BPM as the chart's main BPM (number 92): they now show the BPM the most judged notes sit at (`resolveChartMainBpm`), the rule the play screen reads, on the chart as the play resolves it. The decide screen reads it off the chart with its `#RANDOM` branches drawn for the play.
