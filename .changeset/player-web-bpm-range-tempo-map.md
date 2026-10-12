---
'@be-music/player-web': patch
---

The LR2 select screen's BPM range (numbers 90 / 91) and the beatoraja skin's max / min BPM now come from the chart's tempo map instead of a scan of channels `03` / `08`, so they follow the BPM rules play uses: a channel `03` value that a `#BPMxx` change overrides at the same position no longer widens the range.
