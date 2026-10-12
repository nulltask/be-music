---
'@be-music/player-web': patch
---

The beatoraja skin TOTAL readout (ref 368) now shows the effective TOTAL the gauge runs on during play and on the result screen, as beatoraja does after `BMSPlayerRule.validate`, instead of the raw header: a bmson `total` is a percentage of the ruleset default, and a BMS chart without `#TOTAL` shows its default rather than 0. The result screen previously always showed 0.
