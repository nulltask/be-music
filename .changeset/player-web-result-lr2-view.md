---
'@be-music/player-web': minor
---

`createResultScene` takes an LR2 kit (`{ family: 'lr2', skin }`, the theme's result skin, or its course-result skin for a course run) as well as a be-music one. The LR2 family's result view draws the result skin from the result session's frames, through `resolveLr2ResultState` (the course from `result.course`, the skin's `#FLIPRESULT` and its custom options' defaults) and LR2's result timers read off each frame: timer 0 from the entry, timers 1 and 150 once input opens, timer 151 once the graphs have drawn or been skipped (`graphShownAtMs`) and timer 152 once the record update shows (`updateShownAtMs`). Input opens after the skin's `#STARTINPUT` (1500 ms without one), as before. `ResultScene.updateKit` ignores a kit of another family.

`PixiResultView` and its `PixiResultViewOptions` type are removed, with `CoreResultView`, the base it was the last user of; the LR2 result screen is made with `createResultScene`. Its be-music panel for a missing result skin goes with it: an LR2 kit always carries a skin. `@be-music/player-web/scenes` no longer re-exports `Lr2ImageRect`; import it from `@be-music/lr2-skin`. The jingle now plays on the audio service's shared context and stops through `stopOwned` as the screen leaves, as it stopped with the scene's own context before.

Migration:

- `new PixiResultView({ skin, collection, clearBgm, failBgm, resultBgm, courseInfo, onContinue, onRetry })`, then `view.setResult(result)` → `createResultScene({ family: 'lr2', skin }, { result: { ...result, course: courseInfo }, run, source: resolveSongSource(collection, result.song), sounds, audio, on: { continue: onContinue, retry: onRetry } })`, where `audio` is the host's `createAudioService()`, `sounds` the theme's `SystemSoundSet` (its `clear`, `fail`, `result`, `courseClear` and `courseFail` slots, the course ones picked for a course run) and `run` which play the result is of (`'single'`, `'stage'`, `'course'` or `'nonstop'`) when `result.run` does not say.
- R only retries when the run offers a quick retry (`resolveResultPresentation(run).quickRetry`: a single play or a NONSTOP run) as well as `on.retry` being given.
- A host that showed `PixiResultView` without a skin shows the built-in result screen instead (`createResultScene` with a be-music kit).
