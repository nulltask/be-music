---
'@be-music/player-web': patch
---

Fix a replay of a `#RANDOM` / `#SWITCH` chart in the core gameplay scene drawing new branches, which made `prepare` reject the log whenever the new draw differed from the recorded run: the scene now resolves the chart with the log's `play.randomDraws`, so the replay plays the recorded branches.
