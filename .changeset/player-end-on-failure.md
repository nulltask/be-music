---
'@be-music/player': minor
---

A play now ends the moment its survival gauge empties, as LR2 and beatoraja do: HARD / EX-HARD / DEATH runs used to keep judging to the end of the chart on a dead gauge. The judgment that emptied the gauge is the last one counted, on the engine and in play-log re-simulations alike. `PlayerOptions.endOnFailure: false` keeps the old behaviour. The play log records `play.endOnFailure`, and logs without it still re-simulate to the end.
