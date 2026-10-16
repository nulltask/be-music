---
'@be-music/lr2-skin': minor
---

Add the play screen to `@be-music/lr2-skin/state`, lifted from `@be-music/player-web`'s LR2 gameplay scene:

- `resolveLr2PlayState(setup, frame)`: from the play's setup (the chart, its lanes and features, the options, the gauge, the course; `Lr2PlaySetup`) and a frame (a `PlayState`-shaped play view, the score, the chart time, loading, a NONSTOP play's stage, the score readout, the BPM, the frame rate; `Lr2PlayFrame`), the ops that hold and the value each number, text, slider and bar graph draws. Time comes in with the frame.
- `resolveLr2PlayTimers(event)`: the LR2 timers a moment of the play starts and stops: the scene stages, judgements, a full combo, the gauge rising and reaching 100 %, and a lane's bomb, long-note hold, key on or key off.
- `resolveLr2LaneTimer`, `resolveLr2PlayKeyModeOp`, `resolveLr2GaugeTypeOps`, `resolveLr2GaugeRangeOp` and `resolveLr2RankOp`: a lane's timer in a timer bank, the key-mode op of the lanes in use, and the gauge-type, gauge-range and rank ops.
