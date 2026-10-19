---
'@be-music/player': minor
---

Add `@be-music/player/ruleset`, the one vocabulary for how a play is judged that hosts, skins and the Leaderboard share, so each no longer keeps its own copy:

- `GaugeType` and `GAUGE_TYPES` / `isGaugeType`: the gauge the player picks (`GROOVE`, `HARD`, `DEATH`, `EASY`, in LR2's button order).
- `ClearLamp` and `CLEAR_LAMPS` / `isClearLamp` / `clearLampRank` / `clearLampAtRank` / `betterClearLamp` / `topClearLamp`: the clear lamps from `NO_PLAY` to `MAX`, ranked 0–9.
- `resolveClearLamp` (a single play) and `resolveCourseClearLamp` (a course run): the one clear-lamp rule, which keeps each judge ruleset's own lamps (LR2 and IIDX top out at FULL COMBO; under LR2 a DEATH clear is NORMAL, since LR2 awards HARD only for its HARD-family gauges), with `isFullCombo`.
- `resolveMissCount`: BP, BAD + POOR + empty POOR, plus the notes a play never judged where a course counts them.
- The score vocabulary: `ScoreSummary`, `JudgeKind`, `createEmptyScore`, `computeScoreRate`, `resolveIIDXRankIndexFromScore`, `resolveIIDXRankLabel`, `IIDX_RANK_LABELS` / `IIDXRankLabel` (the DJ Ranks, best first), `resolveLR2MoneyScore` and `resolveDisplayedPoor`.
- The judge windows (`resolveJudgeWindowsMs`, `JudgeWindowsMs`, `JudgeWindowSetUs`, `RulesetWindowTables`, `WindowPairUs`) and `LongNoteStyle`, how a judge ruleset plays a chart's long notes (LR2's LN, beatoraja's per-note mode, IIDX's charge notes).
- The judge ruleset ids: `PlaylogRulesetId`, `PLAYLOG_RULESET_IDS` and `isPlaylogRulesetId`. `PlayerOptions.judgeRuleset`, `PlaylogPlay.judgeRuleset` and `PlaylogRecorderPlaySettings.judgeRuleset` are typed `PlaylogRulesetId`.

`resolveRulesetResultLamp` (`@be-music/player/playlog`) lamps a play log's ruleset result, simulated or the engine's own, under a judge ruleset by the same rule, so the Leaderboard lamps ranked plays as the client's result does.
