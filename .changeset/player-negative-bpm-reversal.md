---
'@be-music/player': minor
---

Reproduce LR2's negative-BPM reverse-scroll gimmick (#134) in `manualPlay` / `autoPlay`, under every judge ruleset. From the first negative `#BPMxx` on, judging (presses, empty POORs, miss sweeps, mines, holds) and realtime audio freeze; notes behind the reversal end the run unjudged instead of being swept into POORs, and presses replay the latest pre-reversal lane keysound. UI frames carry a mirrored `displayBeat` / `displaySeconds` clock plus `reversalSeconds`, so renderers scroll backwards at |BPM|. Playlogs record `chart.reversalTimeUs` and the simulator applies the same cutoff, so re-simulations reproduce the live verdicts.
