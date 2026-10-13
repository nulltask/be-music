---
'@be-music/player': minor
---

Record the chart's level in play logs: `PlaylogChart` gains optional `playLevel` (`#PLAYLEVEL` / bmson `info.level`, as text) and `difficulty` (`#DIFFICULTY`, 1 BEGINNER .. 5 INSANE), filled by the recorder and read back by `parsePlaylog`, so a leaderboard can show how hard a played chart is.
