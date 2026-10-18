---
'@be-music/player': minor
---

Remove the file-named subpaths (ADR 0005): `./core/engine`, `./core/input-signal-bus`, `./core/ui-signal-bus`, `./core/high-speed-control`, `./core/lane-layout`, `./core/scroll-distance`, `./core/bga-timeline`, `./core/timeline`, `./core/ui-options`, `./core/judge-window`, `./core/scoring`, `./playable-notes`, `./state-signals`, `./image-resize-algorithm`, `./utils` and `./judging`. The package now exports `.` (the engine), `./signals`, `./lanes`, `./display`, `./ruleset`, `./playlog`, `./records`, `./course` and `./audio-sink`. The root keeps only the engine, so the names it re-exported from the other entries and its unused internals go too, as do the compatibility aliases (`JudgeWindowRuleset`, `JUDGE_WINDOW_RULESETS`, `PlayerGrooveGaugeSummary`, `resolveChartVolWavGain` and the chart re-exports).

Migration:

- `@be-music/player/core/engine` → `@be-music/player`.
- `JudgeWindowSetUs`, `RulesetWindowTables`, `WindowPairUs`, `LongNoteStyle`, `PlaylogRulesetId`, `resolveJudgeWindowsMs` from `@be-music/player` → `@be-music/player/ruleset`.
- `applyHighSpeedControlAction`, `resolveHighSpeedControlActionFromLaneChannels`, `HighSpeedControlAction` from `@be-music/player` → `@be-music/player/signals`.
- `extractTimedNotes`, `extractPlayableNotes`, `extractLandmineNotes`, `extractInvisiblePlayableNotes` from `@be-music/player` → `@be-music/player/display`.
- `PlayerGrooveGaugeSummary` from `@be-music/player` → `PlayerGaugeSummary` from `@be-music/player/signals`.
- `resolveBmsControlFlowForPlayback`, `preparePlaybackChartData` from `@be-music/player` → `resolvePlayChart`, `preparePlaybackChart` from `@be-music/player`.
- `applyFastSlowForJudge`, `resolveBgmHeadroomGain`, `shouldUseAutoMixBgmHeadroomControl`, `formatRandomPatternSummary` from `@be-music/player` → removed (engine internals).
- `@be-music/player/core/input-signal-bus`, `/core/ui-signal-bus`, `/state-signals`, `/core/high-speed-control` → `@be-music/player/signals`.
- `@be-music/player/core/lane-layout` → `@be-music/player/lanes`; `ChartPlayVariant` → `@be-music/chart`.
- `@be-music/player/core/scroll-distance` → `@be-music/player/display`; `ScrollTimelinePoint`, `SpeedTimelinePoint` → `@be-music/chart`.
- `@be-music/player/playable-notes` → `@be-music/player/display`; `LongNoteMode` → `@be-music/chart`.
- `pickActiveBgaCue`, `pickActiveBgaKey`, `DEFAULT_POOR_BGA_DISPLAY_SECONDS` from `/core/bga-timeline` → `@be-music/player/display`.
- `buildBgaTimelines`, `buildBmsBgaTimeline`, `BgaCue`, `BgaTimelines`, `BgaTimingResolver` from `/core/bga-timeline`, and all of `/core/timeline` (`createMeasureTimeline`, `createBpmTimeline`, `createScrollTimeline`, `createSpeedTimeline`, `createStopBeatWindows`, `createMeasureBoundariesBeats`, `createBeatAtSecondsResolver`, `createBeatAtSecondsResolverFromTimingResolver` and their point types) → `@be-music/chart`.
- `@be-music/player/core/ui-options`, `/image-resize-algorithm` → `@be-music/player/display`.
- `resolveDisplayedJudgeRankValue`, `resolveDisplayedJudgeRankLabel`, `resolveDisplayedPlayLevelValue`, `resolveDisplayedDifficultyValue`, `formatSeconds`, `resolveAltModifierLabel` from `/utils` → `@be-music/player/display`.
- `resolveChartVolWavGain(chart)` from `/utils` → `volWavToLinearGain(chart.bms.volWav)` from `@be-music/chart`.
- `resolveJudgeWindowsMs`, `JudgeWindowsMs` from `/core/judge-window` → `@be-music/player/ruleset`.
- `JUDGE_WINDOW_RULESETS` from `/core/judge-window` → `PLAYLOG_RULESET_IDS` from `@be-music/player/ruleset`.
- `JudgeWindowRuleset` from `/core/judge-window` → `PlaylogRulesetId` from `@be-music/player/ruleset`.
- `bmsExRankValueToJudgeRankPercent`, `resolveJudgeRankPercent`, `resolveBmsJudgeWindowsMsForPercent`, `resolveBmsJudgeWindowsMsForExRankValue` from `/core/judge-window` → removed (internal to the LR2 ruleset).
- `ScoreSummary`, `JudgeKind`, `createEmptyScore`, `computeScoreRate`, `resolveIidxRankIndexFromScore`, `resolveIidxRankLabel`, `resolveDisplayedPoor`, `resolveLr2MoneyScore` from `/core/scoring` → `@be-music/player/ruleset`.
- `createScoreTracker`, `applyJudgeToSummary`, `ScoreTracker`, `resolveIidxRankIndexFromRate`, `resolveIidxSelectRankOp`, `IIDX_EX_SCORE_PER_PGREAT`, `IIDX_EX_SCORE_PER_GREAT`, `LR2_MONEY_SCORE_MAX` from `/core/scoring` → removed, with no replacement (compare `computeScoreRate` with the ninths for a rank index).
- `findClosestCandidateInWindow`, `findBestCandidate`, `findLaneSoundCandidate`, `lowerBoundBySeconds`, `JudgeCandidate`, `FindClosestCandidateOptions` from `/judging` → removed (internal to the judge core).
