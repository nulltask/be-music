---
'@be-music/lr2-skin': minor
---

Add `@be-music/lr2-skin/state`, the pure resolvers that map the scene models of `@be-music/scene-model` to LR2's skin vocabulary: the ops that hold and the value each number, text, slider, bar graph and button draws, and the timers a moment starts and stops. Time comes in as an input, and the resolvers are held to the deterministic-judge lint. The package now depends on `@be-music/scene-model` and `@be-music/player`.

- Select: `resolveLr2SelectState(input)` for the bar under the cursor (a `LibraryEntry`, whose chart bar is `{ kind: 'chart', chart }`), the player's `PlayOptions` and record, the open panels, the skin's custom options and the screen's facts (readme, BPM range, search word, list position, clock, frame rate, course maker); `resolveLr2SelectButton(type)`, what a select button asks for; `resolveLr2SelectTimers(event)`; `pickLr2BarBody`, `resolveLr2BarLevel` and `resolveLr2BarLamp` for a bar of the list; `resolveLr2KeyModeOp`, `resolveLr2ChartFeatures` and `resolveLr2LampOp`.
- Decide: `resolveLr2DecideState({ chart, course?, customOps? })`, the chart's difficulty and key-mode ops and texts, and for a course stage the course ops, numbers and texts.
- Play: `resolveLr2PlayState(setup, frame)` from the play's setup (`Lr2PlaySetup`) and a `PlayState`-shaped frame (`Lr2PlayFrame`); `resolveLr2PlayTimers(event)` for the scene stages, judgements, a full combo, the gauge rising and reaching 100 % and a lane's bomb, long-note hold, key on or key off; `resolveLr2LaneTimer`, `resolveLr2PlayKeyModeOp`, `resolveLr2GaugeTypeOps`, `resolveLr2GaugeRangeOp`, `resolveLr2RankOp` and `isLr2AutoLane` (the 1P scratch while 1P auto scratch, op 55, is on).
- Result: `resolveLr2ResultState({ result, course?, flipResult?, customOps? })` from a `PlayResult`: cleared / failed, the key mode in the select and key-config ranges, the difficulty, the clear lamp, the ranks and updates, the result flip and the course.
- Courses: the course ops, numbers and texts of a `CourseView` (`resolveLr2CourseOps`, `resolveLr2CourseStageDifficultyOps`, `resolveLr2CourseNumber`, `resolveLr2CourseText`, `resolveLr2CourseConnectionText`), the course combo LR2 shows (`lr2ShowsCourseCombo`, `resolveLr2JudgeCombo`), the stage a NONSTOP play shows (`resolveLr2NonstopStage`) and the course maker's ops, texts and buttons (`resolveLr2CourseMakerOps`, `resolveLr2CourseMakerText`, `resolveLr2CourseMakerAction`, `resolveLr2CourseMakerButtonState`, `resolveLr2CourseDraftInfo`).

The values follow OpenLR2 where the web player's LR2 screens used to read them otherwise:

- The play screen's 1P rank ops (200-207) rank the EX score over the notes judged so far, and none is lit before the first judgement; numbers 109 / 154 read the distance to the next DJ Rank; 102 / 103 draw the score rate over the notes judged so far, and 115 / 116 the rate over every note, truncated.
- The result's best-record rates (73, 85-89) are truncated to whole percents, and text 20 reads empty (LR2's internet-ranking message).
- A folder bar lights op 1, and an open option panel lights LR2's panel ops instead of its number as an op.
- Texts 16 / 26 read empty (LR2's tag, which be-music does not keep), texts 18 / 28 draw the `#DIFFICULTY` number, and text 29 (the INSANE level) draws on the decide, play and result screens too.
- Op 53 (EXTRA MODE) no longer makes every lane draw the AUTO note graphics.
