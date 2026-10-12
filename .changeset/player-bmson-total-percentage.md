---
'@be-music/player': patch
---

Fix bmson charts playing with an almost flat gauge under the `lr2` and `iidx` rulesets: bmson `info.total` was read as an absolute TOTAL there, so a chart without `total` (pinned to the spec default `100`) played at TOTAL 100. Every ruleset now treats bmson `total` as a percentage of its own default TOTAL (`total / 100 ×` the LR2 curve for `lr2` / `iidx`, beatoraja's formula for `beatoraja`), with a value ≤ 0 meaning 100 %, as beatoraja does. BMS `#TOTAL` is unchanged, and play-logs still record the raw value and resolve it the same way on replay.
