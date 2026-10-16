---
'@be-music/beatoraja-skin': minor
---

Add `@be-music/beatoraja-skin/scene`, which maps the scene models of `@be-music/scene-model` to a beatoraja skin's ids, so a family view reads beatoraja's state from the one play state, play result, library entry and course view instead of keeping its own. It is pure and deterministic: time, the clock and the frame rate are inputs, and a lint rule keeps clocks, timers and `Math.random` out of it.

- Play: `resolveBeatorajaPlayNumber` (the whole number table: hi-speed, white / green numbers, BPMs at the playhead, time, judgment counts and their early / late split, …), `resolveBeatorajaPlayText`, the start, score and lane cover ops, the timers to start and stop as data (`resolveBeatorajaJudgeEffect`, `resolveBeatorajaLaneTimers`, `resolveBeatorajaFrameTimers`), the gauge with its mode (`resolveBeatorajaGaugeState`), the bar, line and judge graphs, the judge-state graph and the live offsets (`writeBeatorajaPlayOffset`).
- Result: `resolveBeatorajaResultNumber`, `resolveBeatorajaResultOps`, `resolveBeatorajaResultText` and the result graphs, from a `PlayResult`.
- Select: `resolveBeatorajaSelectBarOps`, `resolveBeatorajaSelectNumber`, `resolveBeatorajaSelectText` and `resolveBeatorajaSelectRefValue` for the focused library entry, with the MODE / SORT / LNMODE button orders.
- Course: the course bar, stage and title ids from a `LibraryCourse` / `CourseView`, and `beatorajaClearLampOp`.
- System sounds: `discoverBeatorajaSystemSoundPaths`, `discoverBeatorajaSelectBgmPath` and `pickBeatorajaThemeBgmPaths`.

`BEATORAJA_NUM` names the select screen's numbers it reads: `FOLDER_TOTALSONGS` (300), `TOTALNOTE_*` (350-353), `DENSITY_*` (360-365) and `CLEAR` (370).
