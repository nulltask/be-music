---
'@be-music/parser': patch
---

Fix bmson charts with more than 1,295 BPM or STOP changes, or more than 1,295 sound channels, playing the wrong tempos, stops and samples: each event got its own 2-char key, which wrapped round after `ZZ` and overwrote earlier values (a gimmick chart's first STOP lasted 39 minutes instead of 1.1 seconds). BPM and STOP values now share one key per distinct value, and a chart that still needs more than 1,295 keys in one table switches to base-62 keys (`bms.base = 62`). Of several BPM changes on one pulse, the later one in the list still wins.

For bmson charts that repeat BPM or STOP values, the parsed JSON changes even though the timing does not:

- `resources.bpm` / `resources.stop` hold one key per distinct value (fewer keys), and the `08` / `09` event values change with them.
- BMS written from such a chart (`stringifyBMS`) has fewer `#BPMxx` / `#STOPxx` lines.
- A JSON IR saved by an older parser no longer matches a re-parse of its bmson source, so writing it back as bmson falls back to the document regenerated from the IR instead of the preserved one.
