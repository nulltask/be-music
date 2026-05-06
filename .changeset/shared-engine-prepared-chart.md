---
'@be-music/player': minor
'@be-music/player-web': minor
---

Make the renderer and the shared engine share a single
`PreparedPlaybackChartData` instance so view ↔ engine note-array drift is
structurally impossible, and fix the cluster of regressions that drift
caused on the web runtime.

## What changed

### `@be-music/player`

- New `PlayerOptions.preparedChart` option lets the host hand the engine
  a pre-built `PreparedPlaybackChartData`. When provided,
  `autoPlay` / `manualPlay` use it verbatim and skip their own internal
  `preparePlaybackChartData` pass. Hosts that omit the option keep the
  prior behavior — the engine builds its own chart data.
- Re-export `preparePlaybackChartData` and the
  `PreparedPlaybackChartData` type from the package root so hosts can
  build the bundle themselves before constructing the engine.
- `PlayerStateSignals` gains a `drainPendingJudgeCombos()` method that
  returns every `publishJudgeCombo` event since the previous drain in
  publish order. The legacy `getJudgeCombo()` latch still returns the
  most recent state for HUD readout. UI runtimes that need to fan out
  per-judge effects (lane bombs, NOWJUDGE plate restarts, FC timer
  evaluations) for simultaneously-judged notes should drain the queue
  instead of polling the latch — otherwise simultaneous-press chords
  surface only the right-most lane's judge state to the host because
  every prior publish in the same engine tick is overwritten on the
  latch.

### `@be-music/player-web`

- `PixiGameplayView.prepareSong` now calls `preparePlaybackChartData`
  itself, keeps the result on `this.preparedChart`, and forwards it to
  the engine through `engineOptions.preparedChart`. The renderer's
  `this.notes` / `this.mineNotes` / `this.invisibleNotes` are
  references into that bundle, so the engine and the renderer hold the
  same `TimedPlayableNote[]` / `TimedLandmineNote[]` instances.
- The renderer reads `note.judged` directly off the shared instance
  instead of mirroring it onto a parallel `note.hit` flag through an
  index-based sync in `applyEngineFrame`. The sync block is gone.
- `drainWebUiSignals` consumes the new `drainPendingJudgeCombos`
  queue, so simultaneously-judged AUTO PLAY chords now produce one
  bomb sprite per chord note instead of only the right-most one.
- `score.total` is initialized from `prepared.scorableNotes.length`
  (matching the engine's `summary.total`) so the full-combo predicate
  is reachable on Free-Zone charts.
- `buildSharedEngineChart` is reduced to clearing `bms.controlFlow`
  before handing the chart to the engine. The previous post-shuffle
  `events.map` remap (the cause of the `random1P: 'OFF'` truthy-check
  channel-class drift bug) is no longer needed because the engine
  consumes the renderer's already-shuffled note array via
  `preparedChart`.

## Regressions fixed (all rooted in the same drift)

These all surfaced during Phase-4c shared-engine playthroughs and were
each caused by the renderer's `extractTimedNotes` call disagreeing with
the engine's. Sharing the prepared-chart instance removes the entire
class:

- **HIDE-on-judge dropouts**: notes vanishing partway down the lane
  before reaching the judgment line, because a `judged=true` flag from
  a different note crossed over via index mismatch
  (`#LNTYPE 1` charts, `random1P: 'OFF'` truthy-check).
- **Mid-chart full-combo cue**: the engine's `combo` counter advanced
  faster than the renderer's `score.total` because LNs were counted
  twice on the engine side (`#LNTYPE` mismatch) or because the
  Free-Zone count inflated `score.total` past the engine's scorable
  population.
- **AUTO PLAY exScore < 200_000**: some auto judges landed on
  already-judged duplicates and were dropped by `markScorableJudged`
  (`bms.controlFlow` re-resolved on the engine side, doubling captured
  notes). AUTO PLAY now lands on the EX-MAX 200_000 ceiling.
- **PMS keys 6-9 mapped to IIDX 2P keys** (`j k l ;`) instead of
  `f v g b`: the engine's `resolveLaneMode` couldn't see the chart's
  `.pms` extension and fell through to `'5-key-dp'`. The renderer now
  forwards the right `laneModeExtension` baked into the prepared
  bundle.
- **AUTO PLAY chord bombs only on the right-most lane**: the
  state-signals latch was overwriting itself; the queue surfaces every
  publish.
- **AUTO LN sustain glow / lane laser staying lit indefinitely after
  the LN tail**: `drainPendingAutoLongNotes` (autoplay) and
  `drainPendingAutoScratchLongNotes` (manual auto-scratch) now emit
  `release-lane` after the auto judge so the LR2 LN-hold timer (70..89)
  and the lane laser (100..117) actually fade out at the LN tail.
- **MANUAL LN BAD-failing ~380 ms into the sustain even with the key
  held**, **lane laser collapsing to a brief flash instead of staying
  lit while the key is held**: the Web input runtime now synthesizes a
  `kitty-state` press alongside `lane-input` on every keydown so the
  engine's `activeKittyPressedChannels` set keeps refreshing
  `longHoldUntilMsByChannel` for the lane.
