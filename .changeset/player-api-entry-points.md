---
'@be-music/player': minor
---

Export designed entry points instead of the file layout (ADR 0005). The package now exports `.` (the engine), `./signals`, `./lanes`, `./display`, `./ruleset`, `./playlog`, `./records`, `./course` and `./audio-sink`, and the file-named subpaths are removed: `./core/engine`, `./core/input-signal-bus`, `./core/ui-signal-bus`, `./core/high-speed-control`, `./core/lane-layout`, `./core/scroll-distance`, `./core/bga-timeline`, `./core/timeline`, `./core/ui-options`, `./core/judge-window`, `./core/scoring`, `./core/groove-gauge`, `./playable-notes`, `./state-signals`, `./image-resize-algorithm`, `./utils` and `./judging`. The root keeps only the engine, so the names it re-exported from other modules and its internals go too. The chart-layer names those subpaths re-exported now come from `@be-music/chart`.

- `./signals`: the input and UI signal buses, their commands and frames (with `PlayerGaugeSummary`), the state signals, and the high-speed range and actions.
- `./lanes`: lane layout and slots, scratch and wheel lanes, key bindings, FREE ZONE input and the lanes the lane options permute.
- `./display`: what a host shows: the timed play notes (`extract*`, `toTimed*`), `ScrollDistanceMapper`, `pickActiveBgaCue` / `pickActiveBgaKey` / `DEFAULT_POOR_BGA_DISPLAY_SECONDS`, the `resolveDisplayed*` chart facts, `formatSeconds`, `resolveAltModifierLabel`, the TUI note heights and the BGA resize algorithms.
- `./ruleset` (the judge vocabulary), `./records` (best records) and `./course` (courses) are new; see their own entries.

Migration:

- `@be-music/player/core/engine` → `@be-music/player`.
- `JudgeWindowSetUs`, `RulesetWindowTables`, `WindowPairUs`, `LongNoteStyle`, `PlaylogRulesetId`, `resolveJudgeWindowsMs` from `@be-music/player` → `@be-music/player/ruleset` (`PlaylogRulesetId` is also exported from `@be-music/player/playlog`).
- `applyHighSpeedControlAction`, `resolveHighSpeedControlActionFromLaneChannels`, `HighSpeedControlAction` from `@be-music/player` → `@be-music/player/signals`.
- `extractTimedNotes`, `extractPlayableNotes`, `extractLandmineNotes`, `extractInvisiblePlayableNotes` from `@be-music/player` → `@be-music/player/display`.
- `PlayerGrooveGaugeSummary` from `@be-music/player` → `PlayerGaugeSummary` from `@be-music/player/signals`.
- `resolveBmsControlFlowForPlayback(json, random)` → `resolvePlayChart(json, { random })`, which returns the resolved `chart` with its `randomDraws`; hand both to the engine.
- `preparePlaybackChartData(json, options, inferBmsLnTypeWhenMissing, auxiliarySeconds)` → `preparePlaybackChart(resolveChart(json, { chartPath: options.laneModeExtension, playVariant: options.playVariant, inferBmsLnTypeWhenMissing }), options, auxiliarySeconds)`, with `resolveChart` from `@be-music/chart`.
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
- `GrooveGaugeType` from `/core/groove-gauge` → `GaugeType` from `@be-music/player/ruleset`, which names the same four gauges.
- `GrooveGaugeJudgeKind` from `/core/groove-gauge` → `JudgeKind | 'EMPTY_POOR'`, with `JudgeKind` from `@be-music/player/ruleset`.
- `findClosestCandidateInWindow`, `findBestCandidate`, `findLaneSoundCandidate`, `lowerBoundBySeconds`, `JudgeCandidate`, `FindClosestCandidateOptions` from `/judging` → removed (internal to the judge core).
