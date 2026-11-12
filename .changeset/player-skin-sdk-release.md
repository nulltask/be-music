---
'@be-music/player-skin-sdk': minor
---

Add the judge detail, the judgment position, the course result card and the NONSTOP song info to the skin API.

- Add `resolveResultCourseScroll` and `BeMusicResultFrame.shownMs`: a course card whose stages, laid out at their usual height, run past the card scrolls its stage list up (`offsetPx`), resting at the top and bottom, then fades out (`alpha`) and back in at the top to start over, by the time the result has been shown (`shownMs` goes on after the entrance, where `elapsedMs` turns `Infinity`).
- Add `resolveResultCourseCard`, which gives a course run's result (an EXPERT, GRADE or NONSTOP run) as a skin's track column shows it: the course's kind and name, the stages reached out of the course's with the trophy earned, and every stage chart with its title, subtitle, artist, genre, level and difficulty, marked unplayed when the run never reached it. `COURSE_KIND_LABELS` (`DAN` / `COURSE` / `NONSTOP`) is exported too.
- Expose the chart’s effective charatbeatHDX BGA placement mode to skins that draw their own BGA.
- Hold effects can stay on the held long note: `BeMusicLaneFrame.holdTop` is the held note's top this frame, `holdSparks` takes a `maxRise` that keeps sparks under it (fading over the last `HOLD_SPARK_CEILING_FADE` pixels), and `clampHoldSparkX` keeps a spark inside the lane's width.
- Add the judge detail to the gameplay runtime: `BeMusicJudgmentState.details` (the FAST / SLOW or ±ms text a skin draws with the judgment, from `formatJudgeDetail`) and `hidesJudgeCounts`, set when the player turned the judgment counts off.
- Add `playfield.judgeOffsetY` to `BeMusicGameplayLayout` (how far the player moved the judgment and combo from the skin's own position, in stage pixels) and `resolveJudgeWordY`, which applies it and keeps the judgment inside the lanes. A Be-Music Skin places its judgment through it.
- Add `BeMusicGameplayRuntime.songInfoFade` and `resolveSongInfoLayers`: while a NONSTOP play's song info crossfades into the next stage's, the runtime carries the song being replaced and the crossfade's progress, and `resolveSongInfoLayers(runtime)` returns the layers to draw, each with its opacity, so a skin crossfades its title block by drawing it once per layer.
- Add `formatPacemakerLabel`: the score graph's pacemaker box leads a short name with PACEMAKER and lets a longer one (a score rate, a ranking place) stand alone, so it is not cut off.
