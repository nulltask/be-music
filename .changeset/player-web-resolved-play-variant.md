---
'@be-music/player-web': patch
---

Fix the gameplay scene classifying the play variant from the unresolved chart: lanes that only a `#RANDOM` / `#SWITCH` branch adds were ignored, so such a chart could be laid out and judged as 5 KEY instead of 7 KEY. The scene now classifies the chart it resolved for the play, through a new optional `chart` argument on `resolveChartPlayVariant(song, chart?)`. A `.bme` chart without a 6 / 7 key column is now 7 / 14 KEY here too, matching the engine and the CLI.
