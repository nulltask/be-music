---
'@be-music/player': minor
---

Add the designed entries `@be-music/player/signals`, `@be-music/player/lanes` and `@be-music/player/display`, which gather what hosts imported from file-named subpaths (ADR 0005). The old subpaths keep working for now and are retired before 1.0.

- `./signals`: the input and UI signal buses, their commands and frames (with `PlayerGaugeSummary`), the state signals, and the high-speed range and actions (`core/input-signal-bus`, `core/ui-signal-bus`, `state-signals`, `core/high-speed-control`).
- `./lanes`: lane layout and slots, scratch and wheel lanes, key bindings, FREE ZONE input and the lanes the lane options permute (`core/lane-layout`; `ChartPlayVariant` comes from `@be-music/chart`).
- `./display`: what a host shows: the timed play notes (`extract*`, `toTimed*`), `ScrollDistanceMapper`, `pickActiveBgaCue` / `pickActiveBgaKey` / `DEFAULT_POOR_BGA_DISPLAY_SECONDS`, the `resolveDisplayed*` chart facts, `formatSeconds`, `resolveAltModifierLabel`, the TUI note heights and the BGA resize algorithms (`playable-notes`, `core/scroll-distance`, `core/bga-timeline`, `utils`, `core/ui-options`, `image-resize-algorithm`). The chart-layer names those subpaths re-exported (`LongNoteMode`, the timeline points, `BgaCue` and the BGA timeline builders) come from `@be-music/chart`, and `resolveChartVolWavGain(chart)` is `volWavToLinearGain(chart.bms.volWav)` there.
- `./ruleset` also exports the judge windows (`resolveJudgeWindowsMs`, `JudgeWindowsMs`, `JudgeWindowSetUs`, `RulesetWindowTables`, `WindowPairUs`) and the judge ruleset ids `PLAYLOG_RULESET_IDS` with `isPlaylogRulesetId`. `JUDGE_WINDOW_RULESETS` (`core/judge-window`), which lists the same ids, is deprecated in favour of `PLAYLOG_RULESET_IDS`.
