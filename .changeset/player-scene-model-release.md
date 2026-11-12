---
'@be-music/player-scene-model': minor
---

Add the play options for the LR2 mania options, the AC and beatoraja display options, score targets and GUIDE SE.

- Add the play options `laneBrightness` (0–100, 100 by default) and `judgeDisplay` (`SKIN` or `OFF`) for AC 34's lane brightness and judgment display.
- Add the `autoScratchNotes` play option (`SHOW` by default, or `HIDE`) for AC 34's auto scratch note display.
- Add the play options `showJudgeArea` and `markProcessedNotes` (both off by default) for beatoraja's judge area display and mark processed note.
- `CourseStageView` carries each stage chart's artist and genre, so a result screen can name the charts a course run played.
- `scrollCourseStages` gives a course run's result as its stage list shows at a time into the screen, scrolling a course with more stages than a skin's rows up one stage per step and starting over once the last stage is on the bottom row.
- Add the `guideSE` play option and the six guide sound slots (`guidePG` to `guideMS`, `GUIDE_SOUND_SLOTS`), which a beatoraja sound set fills by path.
- Add the `judgeDetail` (`OFF`, `FAST_SLOW`, `MS`), `judgeDetailSplit` and `judgeCounts` play options, listed among the live display options.
- Add the `judgePosition` play option (a whole percentage of the lanes' height within ±`JUDGE_POSITION_LIMIT`, clamped by `clampJudgePosition`) and list it among the live display options.
- Add `pickLiveDisplayPlayOptions` and `LIVE_DISPLAY_PLAY_OPTION_KEYS`: the display-only play options a running play follows at once.
- Add the `lr2Gambol` play option (0 = OFF, 1, 2) for LR2's mania option GAMBOL.
- Add the play options `lr2AddNotes`, `lr2Loudness`, `lr2AddLongNotes` and `lr2AddMines` (0 = off, 10–100) for LR2's mania chart generators.
- Add the play options for LR2's mania drawing options (`lr2Acceleration`, `lr2Earthquake`, `lr2Tornado`, `lr2SuperLoop`, `lr2Char`, `lr2Heartbeat`, `lr2Nabeatsu`, `lr2SinCurve`, `lr2Wave`, `lr2SpiralEffect`, `lr2SideJump`), all off by default.
- Add the lane options `S-RANDOM-CORRECTED` and `CONVERGE-CORRECTED`, offered next to the faithful LR2 ones: LR2's nine-key S-RANDOM without the tenth destination LR2's draw reaches, and LR2's CONVERGE without that destination and with its 2P target on the key picked.
- Add `SOFTLANDING-1` and `SOFTLANDING-2` to the `scrollModifier` choices.
- The lane options offer RANDOM once instead of once per source, and S-RANDOM as LR2's (which AC shares) and beatoraja's; the LR2 RANDOM button cycle steps the shared RANDOM. Settings and replays holding `lr2:RANDOM`, `beatoraja:RANDOM`, `____:RANDOM` or `____:S-RANDOM` still validate and read as RANDOM and `lr2:S-RANDOM`.
- Add `chartSeconds` (the chart's length the histories' progress runs over) and `gaugeGraphType` (the gauge the graph shows when it was stepped off the played one) to `PlayResult`.
- Add the ranking targets (`IR_NEXT_*`, `IR_RANK_*`, `IR_RANKRATE_*`, in beatoraja's default list) and `SCORE_RATE` to `SCORE_TARGET_IDS`, with the `scoreTargetRate` play option, `parseRankingScoreTarget`, `resolveRankingTargetIndex` and `clampScoreTargetRate`. `resolveScoreTarget` takes the rate and the ranking's score.
- Add `resolveScoreTarget` and `SCORE_TARGET_IDS` (beatoraja's rank-border, MAX and NEXT RANK targets), and the `scoreTarget` play option, `RATE_AAA` by default.
- Offer the battle choice `SP-TO-DP-CORRECTED`, LR2's SP TO DP without DP FLIP on a DP-TO-SP merge.
- `formatGaugeLabel` names the new `DEATH-CORRECTED` gauge pick DEATH corrected.
