---
'@be-music/player-web': patch
---

Fix the beatoraja timing visualizer drawing LR2's judge windows on every play: its bands now show the windows of the play's own judge ruleset (beatoraja, IIDX or LR2), as the engine judges the play, which the session passes to the view. Each band reaches its window's early side and its late side separately, so beatoraja's BAD (220 ms early, 280 ms late on 7 KEY) shows as it judges. The bands appear once the engine has started.
