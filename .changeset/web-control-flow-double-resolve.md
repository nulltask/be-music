---
'@be-music/player-web': patch
---

Fix view ↔ engine note-array length divergence caused by control-flow
re-resolution.

`PixiGameplayView.prepareSong` runs `resolveBmsControlFlow(song.chart)`
once, which walks `bms.controlFlow` and pushes every active `#xxx` header /
object entry into `json.events`. The resolver does not clear
`bms.controlFlow` afterwards — it stays populated on the resolved chart.
`buildSharedEngineChart` was handing that resolved chart straight to the
engine, where `resolveBmsControlFlowForPlayback` walked the same
`controlFlow` array a second time and `applyActiveControlFlowEntry`
duplicated every `kind: 'object'` entry into `json.events`, so notes that
the parser captured into a control-flow entry (which includes some
`#LNTYPE 1` LN markers, even on charts without `#RANDOM` / `#IF`) ended
up as two entries by the time `extractTimedNotes` ran on the engine side.

The view's `this.notes` therefore ran shorter than the engine's
`frame.notes`, and the index-based sync in `applyEngineFrame`
(`frameNotes[i].judged → this.notes[i].hit = true`) flipped the wrong
notes' hit flag. Symptoms:

- Approaching notes disappeared off the lane in HIDE-on-judge mode.
- The full-combo cue fired mid-chart (engine combo raced ahead of the
  view's `score.total`).
- AUTO PLAY exScore landed below the EX-MAX 200_000 ceiling because some
  auto judges collided with already-judged duplicates and got dropped by
  `markScorableJudged`.

`buildSharedEngineChart` now zeros out `bms.controlFlow` before handing
the chart to the engine, so the engine takes the
`controlFlow.length === 0` clone-and-return short-circuit and the events
array stays in sync with the view's.
