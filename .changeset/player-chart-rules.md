---
'@be-music/player': patch
---

Fix chart values the engine read differently from the reference players:

- bmson charts played with an almost flat gauge under the `lr2` and `iidx` rulesets: `info.total` was read as an absolute TOTAL, so a chart without `total` (pinned to the spec default `100`) played at TOTAL 100. Every ruleset now treats bmson `total` as a percentage of its own default TOTAL (`total / 100 ×` the LR2 curve for `lr2` / `iidx`, beatoraja's formula for `beatoraja`), with a value ≤ 0 meaning 100 %, as beatoraja does. BMS `#TOTAL` is unchanged, and play logs still record the raw value and resolve it the same way on replay.
- The beatoraja ruleset judged a bmson chart without `judge_rank` as BMS `#RANK 2` (judgerank 75, PGREAT ±15 ms in 7 KEY) instead of the bmson default `judge_rank: 100` (±20 ms). The default is applied in the ruleset, so a play-log replay of such a chart resolves the same windows.
- `#SPEEDxx` before the first `SP` keyframe held the first value (Bemuse's reading): it now ramps from 1.0 at beat 0 to that keyframe's value, as beatoraja ramps from 1.0 at time 0, so charts authored for beatoraja that open with a `SPEED` change space their opening notes the way their authors saw them. A keyframe on beat 0 still applies at once.
- `#VOLWAV 0` muted a chart and `#VOLWAV 200` or above amplified it: `#VOLWAV` now applies only for `0 < n < 200`, and other values play at the original volume, as beatoraja does (LR2 ignores `#VOLWAV`).
