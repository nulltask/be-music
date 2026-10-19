---
'@be-music/beatoraja-skin': minor
---

Add `@be-music/beatoraja-skin/scene`, which maps the scene models of `@be-music/scene-model` to a beatoraja skin's ids, so a skin view reads beatoraja's state from the one play state, play result, library entry and course view instead of keeping its own. It is pure and deterministic: time, the clock and the frame rate are inputs, and a lint rule keeps clocks, timers and `Math.random` out of it.

- Play: `resolveBeatorajaPlayNumber` (the whole number table: hi-speed, white / green numbers, BPMs at the playhead, time, judgment counts and their early / late split, …), `resolveBeatorajaPlayText`, the start, score and lane cover ops, the timers to start and stop as data (`resolveBeatorajaJudgeEffect`, `resolveBeatorajaLaneTimers`, `resolveBeatorajaFrameTimers`), the gauge with its mode (`resolveBeatorajaGaugeState`), the bar, line and judge graphs, the judge-state graph and the live offsets (`writeBeatorajaPlayOffset`).
- Result: `resolveBeatorajaResultNumber`, `resolveBeatorajaResultOps`, `resolveBeatorajaResultText` and the result graphs, from a `PlayResult`. Without the engine's gauge, the gauge is drawn with the result's clear border (`BeatorajaResultFacts.gaugeBorder`) and the TOTAL readout (368) reads the TOTAL the play ran on (`gaugeTotal`).
- Select: `resolveBeatorajaSelectBarOps`, `resolveBeatorajaSelectNumber`, `resolveBeatorajaSelectText` and `resolveBeatorajaSelectRefValue` for the focused library entry (a chart bar is `{ kind: 'chart', chart }`), with the MODE / SORT / LNMODE button orders.
- Decide: from the chart about to be played and how far the play behind the screen has loaded (`BeatorajaDecideInput`), `resolveBeatorajaDecideOps` lights the chart's difficulty ops and `NOW_LOADING`, then `LOADED`; `resolveBeatorajaDecideNumber` reads the chart's `#PLAYLEVEL`, its BPMs and the loading progress in percent (165); `resolveBeatorajaDecideGraphValue` fills the loading bar (graph type 102).
- Course: the course bar, stage and title ids from a `LibraryCourse` / `CourseView` (`beatorajaMissingCourseStages` reads each stage's `chart`), and `beatorajaClearLampOp`.
- System sounds: `discoverBeatorajaSystemSoundPaths`, `discoverBeatorajaSelectBGMPath` and `pickBeatorajaThemeBGMPaths`.

The values follow beatoraja:

- The 1P rank ops (200-207) and the "now" rank ops (340-347) rank the EX score over the notes judged so far, as `createNowRank` reads `ScoreDataProperty.nowrate`, which is 100 % before the first note, so a play starts on AAA.
- The generic rank ops (220-227) light every rank the EX score reaches over the chart's notes, as `ScoreDataProperty.qualifyRank` does (an AAA lights all eight, so a skin can stack its rank letters on them); `beatorajaGenericRankOps(score)` gives them. A chart without notes lights none of these.
- The main BPM (number 92) on the select and decide screens is the main BPM a play shows, the BPM the most judged notes sit at (`BeatorajaSelectChartFacts.mainBPM`, `BeatorajaDecideInput.mainBPM`), falling back to the header BPM without one.
