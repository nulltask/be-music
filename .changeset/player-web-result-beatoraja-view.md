---
'@be-music/player-web': minor
---

`createResultScene` takes a beatoraja kit (`{ family: 'beatoraja', kit }`, a theme's result entry, or its course-result entry for a course run, loaded with `loadBeatorajaSceneKit`) as well as a be-music or an LR2 one. The beatoraja family's result view draws the result skin through `BeatorajaPlaySkinView` from the result session's frames. It reads the `PlayResult` directly through the scene mapping (`resolveBeatorajaResult*` of `@be-music/beatoraja-skin/scene`): the score, the judgments and their timings, the gauge with its border and TOTAL (`gaugeBorder`, `gaugeTotal`), the rank, verdict and lamp ops, the graphs and the course of `result.course`. The chart's BPM graph, note kinds and `#TOTAL` come from the new `playChart` option (the chart as the play played it, carried on `ResultFrame.playChart`), and the chart's own images load from `source` before the first frame; beatoraja's scene timers are read off each frame on the screen's own clock. The screen keeps the beatoraja result screen's timing: input after the skin's `input` (500 ms without one), with Escape held back until then, the first Enter or Space leaving (`ResultViewTiming.skipsResultSteps`), and the fade-out over its `fadeout` (500 ms). R retries a single play or a NONSTOP run, as on every family. The jingle is the theme's clear, fail or generic one, or the course ones for a course run (`resolveResultJingles`), played through the audio service; the skin's Lua sounds play through the audio service's skin sounds, owned by the screen. `ResultScene.updateKit` ignores a kit of another family or skin.

`PixiBeatorajaResultScene` and its `PixiBeatorajaResultSceneOptions` type are removed; the beatoraja result screen is made with `createResultScene`. Its jingle plays on the audio service's shared context and stops through `stopOwned` as the screen leaves, as it stopped with the scene's own context before; the skin's Lua sounds stop then too.

Migration:

- `new PixiBeatorajaResultScene({ skin, textures, fonts, skinConfig, song, chart, summary, maxCombo, scoreHistory, gaugeHistory, timingHistory, chartImages, bgmBytes, courseInfo, judgeRuleset, skinAudio, onContinue, onRetry })` → `createResultScene({ family: 'beatoraja', kit }, { result, run, source, playChart: chart, sounds, audio, on: { continue: onContinue, retry: onRetry } })`, where:
  - `kit` is `loadBeatorajaSceneKit`'s;
  - `result` is `playResultFromBeatoraja({ summary, maxCombo, history }, { song, run, course: courseInfo, judgeRuleset })` of `@be-music/scene-model`, with the summary's gauge border and TOTAL;
  - `sounds` is the theme's `SystemSoundSet` (`systemSoundSetFromBeatoraja({ bgm })`): the screen picks the jingle itself, so `bgmBytes` has no counterpart;
  - `source` is the chart's files (the scene loads `#STAGEFILE`, `#BACKBMP` and `#BANNER` itself);
  - `audio` is the host's `createAudioService()` with the theme's files set (`audio.setTheme({ files })`) for the skin's Lua sounds.
- `run` (`'single'`, `'stage'` or `'course'`) decides the course jingles and the quick retry: R retries only a single play (or a NONSTOP run), whatever `on.retry` is given.
