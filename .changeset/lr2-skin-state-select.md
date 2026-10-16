---
'@be-music/lr2-skin': minor
---

Add the select screen to `@be-music/lr2-skin/state`, lifted from `@be-music/player-web`'s LR2 select scene:

- `resolveLr2SelectState(input)`: for the bar under the cursor (a `LibraryEntry`), the player's `PlayOptions` and record, the open panels, the skin's custom options and the screen's facts (readme, BPM range, search word, list position, clock, frame rate, course maker), the ops that hold and the value each number, text, slider and button cell draws (an `Lr2SceneState` with `button`).
- `resolveLr2SelectButton(type)`: what a select button asks for (toggle a panel, step the hi-speed, cycle or set a play option, play, AUTOPLAY, show the text file, …).
- `resolveLr2SelectTimers(event)`: the LR2 timers the screen starts and stops as it appears, as the cursor moves, as a panel opens or closes and as making a course starts or ends (`Lr2TimerUpdate`).
- `pickLr2BarBody`, `resolveLr2BarLevel` and `resolveLr2BarLamp`: what a bar of the list draws.
- `resolveLr2KeyModeOp`, `LR2_KEYS_FILTER_OPS`, `lr2CourseMatchesKeysFilter`, `resolveLr2ChartFeatures` and `resolveLr2LampOp`: a chart's key-mode op and features, a key-mode filter's op and a record's clear-lamp op.
