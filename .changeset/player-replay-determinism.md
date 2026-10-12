---
'@be-music/player': patch
---

Make `manualPlay` replays deterministic on long-note charts: the same chart and `replayInputs` now produce the same summary, gauge and re-recorded play log on every run and at every `speed`. Replays used to resolve long-note holds, tails, misses and mines at wall-clock tick time, so the order judgments reached the clamped gauge (and, at high `speed`, the judgments themselves) depended on where the ticks landed, and a release queued after the last note could be dropped from the re-recorded play log when the loop exited first. A replay now advances its judge state on a fixed chart-time grid and at each input's own timestamp, keeps its hold-grace windows in chart time, and drains every queued input before finishing.

The LR2 rule that a long-note head has no late BAD now follows the long-note mode the ruleset plays rather than the chart's `#LNMODE`, so a `#LNMODE 2` / `3` note played as a plain LN under LR2 skips the late BAD exactly as the play-log simulator does.
