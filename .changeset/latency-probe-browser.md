---
'@be-music/player-browser': minor
---

Add a developer latency probe to the audio entry: `enableLatencyProbe` records, for each lane key press, when the browser stamped it, when its handler ran, when its keysound started and when that keysound is due at the output, and samples the play's `AudioContext` latencies once a second; `summarizeLatencyPresses`, `latencyProbeCSV` and `latencyProbeClockCSV` summarise and export what it recorded.
