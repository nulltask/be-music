---
'@be-music/player-engine': minor
---

The automatic judge timing is now a mode, `judgeTimingAutoAdjust: 'OFF' | 'BEATORAJA' | 'LR2-ON' | 'LR2-SILENT'`, instead of beatoraja's on / off switch, and runs under every judge ruleset (beatoraja's calibration ran only under beatoraja rules). LR2's ON and SILENT follow LR2 beta3: every PGREAT to BAD hit of a normal note adds its offset to a sum, and once per judging pass with more than nine hits the timing moves 1 ms by the sign of the sum; misses, empty POORs, long notes, AUTO, replays and a two-player BATTLE never adjust. Each step goes to the replay's `play.optionChanges`, and the mode to `play.options`. `@be-music/player-engine/display` exports `JudgeTimingAutoAdjust`, `JUDGE_TIMING_AUTO_ADJUST_MODES`, `resolveJudgeTimingAutoAdjust` (which reads an older replay's `true` as `'BEATORAJA'`) and `isLR2JudgeTimingAutoAdjust`. A judge-combo effect marks a long note's judgment with `longNote` and a BAD carries its instant (#777).
