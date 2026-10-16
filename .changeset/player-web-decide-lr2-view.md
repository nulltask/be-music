---
'@be-music/player-web': minor
---

`createDecideScene` takes an LR2 kit (`{ family: 'lr2', skin }`, the theme's decide skin) as well as a be-music one. The LR2 family's decide view draws the decide skin over the chart's `#STAGEFILE` from the decide session's frames, through `resolveLr2DecideState` and LR2's scene timers (timer 0 from the entry, timer 1 once input opens). The screen keeps the LR2 decide screen's timing: input opens after the skin's `#STARTINPUT` (1500 ms without one), and the screen moves on to the play 1200 ms later. `DecideScene.updateKit` ignores a kit of another family.

`PixiDecideView` and its `PixiDecideViewOptions` and `PixiDecideTarget` types are removed; the LR2 decide screen is made with `createDecideScene`. Its panel for a missing decide skin goes with it: an LR2 kit always carries a skin. The screen now takes its keys as the decide session does: an auto-repeated key no longer continues or backs out (a key held down from the select screen does not skip the screen once `#STARTINPUT` has passed, as on LR2), and a key typed into a text field is the field's.

Migration:

- `new PixiDecideView({ skin, onContinue, onCancel })`, then `view.setTarget({ song, collection })` → `createDecideScene({ family: 'lr2', skin }, { chart: song, source: resolveSongSource(collection, song), sounds, audio, on: { continue: onContinue, cancel: onCancel } })`, where `audio` is the host's `createAudioService()` and `sounds` its theme's `SystemSoundSet` (`{}` to play no jingle).
- A host that showed `PixiDecideView` without a skin shows no LR2 decide screen, or the built-in one (`createDecideScene` with a be-music kit).
