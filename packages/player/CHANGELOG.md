# @be-music/player

## 0.7.0

### Minor Changes

- d9958ac: Show empty POORs in the LR2 POOR counter, as real LR2 does.
  
  `RulesetConfig` gains `emptyPoorCountsInPoorDisplay` — a presentation rule, not a scoring one. LR2 is `true`:
  OpenLR2's `ApplyJudgeNote` increments `playerstat.poor` for the empty-POOR branch and LR2 exposes no separate stat,
  so a run judged under LR2 now folds `emptyPoor` into the POOR figure its result screen, BP, and per-judge rates
  read. beatoraja shows an empty-POOR figure of its own and IIDX's counter is unmeasured, so both keep them apart.
  
  `ScoreSummary` gains `emptyPoor` and `@be-music/player/core/scoring` exports `resolveDisplayedPoor`.
  `PlayerSummary` always reports the split; only the display copy folds.
- 202a28b: Drive 24 KEY SP / 48 KEY DP charts end to end — the extended lane channels are now scorable notes, not just a display-mode guess.
  
  `extractTimedNotes` / `extractPlayableNotes` accept objects on the extended lane columns (`1A..1O` / `2A..2O`, plus the matching `3X`/`4X` invisible, `5X`/`6X` long-note, and `DX`/`EX` landmine families), so they land in `summary.total`, get judged, and reach the renderer. `ChartPlayVariant` gains `'24'` / `'48'`, and `resolveSideKeySlot`, `resolveLaneChannels`, and `createLaneBindings` resolve the 24 scratch-less columns per side in ascending channel order. `resolveLr2LaneIndex` returns `-1` for these variants because LR2 skins only define the 20 IIDX lane rects — hosts fall back to their own playfield instead of squeezing 24 lanes into the 7-key table.
  
  FREE ZONE is now variant-aware. Channels `17` / `27` only get the quarter-note FREE ZONE tail on the IIDX families; under `9 KEY` and the keyboard modes they are ordinary key columns, so a tap stays a tap and a `#LNOBJ` tail is no longer shadowed by the phantom one-beat tail. The variant is taken from the new `playVariant` extraction option when the host supplies one (`preparePlaybackChartData` forwards `PlayerOptions.playVariant`), and is otherwise classified from the chart the first time a `17` / `27` object appears.
- 750c47d: Add `resolvePlayVariantLaneChannels` to `@be-music/player/core/lane-layout`: the full lane set of a chart's play variant (5 / 7 / 9 / 10 / 14 / 24 / 48 KEY) in rendering order, whether or not the chart puts notes on every lane. 9 KEY picks the PMS layout when the chart uses `22..25` and the BME layout otherwise, and lanes in use outside the variant are kept.
- 2d7652c: Charge empty POORs from the ruleset's own miss window, and surface the count.
  
  The engine hardcoded LR2's one-second early window for every ruleset and never reported the tally. It now reads the
  active ruleset's miss (`ms`) window — LR2's is early-only (`{0, 1 s}`), beatoraja's reaches 500 ms early and 150 ms
  late — and checks both neighbours of the press so the late side is honoured where a ruleset has one. Whether an empty
  POOR breaks the combo is the ruleset's call too: beatoraja's five-key and PMS rules say yes, LR2 and IIDX say no.
  
  `PlayerSummary` and the UI frame summary gain a required `emptyPoor` field. It is tracked apart from `poor` because an
  empty POOR consumes no note and never reaches EX-SCORE; whether a player's POOR counter displays the two summed is a
  presentation choice, and LR2's does (OpenLR2 `ApplyJudgeNote` increments `playerstat.poor` for it).
- 0103435: Run the selected gauge through the active compat ruleset instead of a hardcoded LR2 groove curve.
  
  `PlayerOptions.gauge` now picks a gauge out of the ruleset's own line-up (LR2 `GROOVE` / `EASY` / `HARD` / `EX-HARD` /
  `DEATH`, beatoraja `NORMAL` / `ASSIST-EASY` / `EASY` / `HARD` / `EX-HARD` / `HAZARD`, IIDX `NORMAL` / `EASY` /
  `ASSISTED-EASY` / `HARD` / `EX-HARD`) and the engine runs that gauge's real curve — per-judge deltas, TOTAL scaling,
  guts softening, death border, and the survival-vs-threshold clear rule. Previously the picker was cosmetic: HARD
  rendered red but ran GROOVE's numbers and reported CLEARED at 2 %.
  
  Consequences:
  
  - `PlayerSummary.gauge` gains `survival` and `failedMidPlay`, and its `type` widens from the LR2-only union to the
    ruleset-scoped gauge id.
  - The LR2 `#TOTAL` default is now LR2's note-count formula (`LR2_bmsload.cpp`) rather than a flat 160.
  - `@be-music/player/core/groove-gauge` keeps only `GrooveGaugeType` / `GrooveGaugeJudgeKind`; the gauge state helpers
    (`createGrooveGaugeState`, `applyGrooveGaugeJudge`, `applyGrooveGaugeRawDelta`, `isGrooveGaugeCleared`) are removed
    in favour of the ruleset's `RulesetGauge`.
  - `beatorajaGaugeModeFromString` and `computeClearLampOp` accept every ruleset's gauge id, so beatoraja skins show the
    ASSIST-EASY and EX-HARD lamps instead of collapsing them onto NORMAL.
- 9505684: Play long notes the way the active ruleset does, and count their judgments accordingly.
  
  The engine used to read the chart's `#LNMODE` directly and always resolve a long note into a single combined
  judgment. It now maps the chart mode through the ruleset's long-note style first:
  
  - LR2 (`ln`) plays every long note as an LN — one deferred judgment, no CN or HCN, whatever `#LNMODE` asks for.
  - beatoraja (`per-note`) honours the chart: mode 1 is an LN, modes 2 and 3 are CN / HCN.
  - IIDX (`charge`) has no LN — every long note is a charge note (HCN where the chart says 3).
  
  Charge modes score the head on the press and the tail on the release, so one long note contributes two judgments,
  which is what `PlayerSummary.total` (the ruleset's EX-SCORE denominator) has always counted. Under IIDX a broken
  head cancels the tail (`headBadSkipsTail`).
  
  Two timing fixes fall out of this:
  
  - The tail is judged against the exact release instant instead of whichever frame noticed it. At high `speed` a frame
    can span hundreds of chart milliseconds, which quantized a clean release into a GOOD or worse.
  - Holding a charge note past its tail is no longer an immediate judgment: the player has until the tail's late window
    closes to let go, matching the play-log simulator and the reference players.
  
  The end-of-play backfill now counts unjudged notes instead of topping the tally up to `summary.total`, which was
  inventing a POOR for every IIDX charge note whose tail was cancelled.
- 1589105: Select the judged note with the ruleset's own algorithm, and add LR2's multi-BAD collector.
  
  The engine always resolved a press against the note closest in time (beatoraja's non-default `duration` behaviour).
  It now runs the active ruleset's `JudgeAlgorithm`: LR2 and IIDX use `lowest` (the oldest note in reach always wins),
  beatoraja uses `combo` (the press moves to the next note once the current one has fallen out of the late side of its
  GOOD window). LR2's `ignoreLateBadOnLnHead` is honoured too — a late BAD on a long-note head falls through instead of
  consuming the head.
  
  Under LR2, a press now also triggers lr2oraja's `MultiBadCollector`: every other unjudged note on the pressed lanes
  that sits inside the BAD window but outside the GOOD window resolves as a BAD, with the collector's own pruning for
  notes after the consumed one and for long notes before it.
  
  The selection primitives are exported from the ruleset module as `preferJudgeCandidate` and `selectJudgeCandidate`,
  and `lowerBoundBySeconds` is now exported from `@be-music/player/judging`.
- 1c6e7aa: Score with the active ruleset's formula instead of an invented 200000-point curve.
  
  `summary.score` was computed from a made-up model — a 150000-point judge base plus a 50000-point combo bonus that
  capped at a combo of 10 — which matches no reference player. It now follows the ruleset:
  
  - LR2 reports its money score, `floor((4×PGREAT + 2×GREAT + GOOD) × 50000 / notes)`, capped at 200000. Purely a
    function of the judge tally: no combo term.
  - beatoraja and IIDX report EX-SCORE, which is what they display (IIDX retired its own money score in BISTROVER).
  
  `createScoreTracker` takes `{ moneyScore }`, `LR2_MONEY_SCORE_MAX` replaces `IIDX_SCORE_MAX`, and the invented
  combo-bonus helpers are gone. The TUI result block prints the SCORE line only for rulesets that define one, and now
  also prints the empty-POOR count.
- 08e62d0: Judge with the active ruleset's signed, per-context judge windows instead of one symmetric width.
  
  The engine previously reduced every ruleset to a single `{pgreat, great, good, bad}` set of symmetric millisecond
  widths. It now reads the ruleset's four window tables — key vs scratch, note vs long-note end — and both legs of every
  window separately, so:
  
  - beatoraja's asymmetric BAD window is honoured: on a seven-key chart a press 250 ms late is a BAD, while the same
    press 250 ms early cannot reach the note at all and leaves it to miss on its own deadline.
  - Scratch lanes judge on the turntable tables (beatoraja's are 10 ms wider per judge than its key tables).
  - Long-note ends judge on the long-note-end tables, including LR2's GOOD-width release tolerance.
  - Each note's miss deadline comes from its own lane and its own chart time, so a mid-chart `#EXRANKxx` no longer needs
    a separate frozen-window cursor.
  - Mine detonation uses the GOOD window's early and late legs separately.
  
  A press that lands inside no window no longer consumes the note as a POOR — it falls through to the lane keysound and
  the empty-POOR path, which is what every reference player does.
  
  `resolveJudgeWindowsMsForRuleset` and `resolveBeatorajaJudgeRankPercent` are removed from
  `@be-music/player/core/judge-window`; the per-ruleset tables live in the ruleset module, which now also exports
  `classifyRulesetJudge`, `selectJudgeWindowSet`, `judgeWindowLateReachUs`, `judgeWindowEarlyReachUs`, and
  `goodWindowReachUs`.

### Patch Changes

- f24ed8b: Detonate mines the way real LR2 does: a held crossing of the judge line, or a press within PGREAT.
  
  LR2's own changelog (the 080114 mine-implementation entry) gives two detonation conditions — passing
  a mine with the key held, or pressing within the PGREAT (ピカグレ) range — and no later entry revises
  it. The previous implementation followed losak's secondary writeup and used the GOOD window
  (±40-120 ms depending on rank) for both legs. Now the press leg uses the PGREAT window (±8-21 ms)
  and the hold-through leg anchors to the crossing itself, so a held mine can no longer slip through
  undetonated between two frame ticks when the window is narrower than the tick interval.
  `goodWindowReachUs` is renamed to `pgreatWindowReachUs` accordingly.
- b3fa635: Shorten the default POOR / miss BGA display window from 2000 ms to 500 ms, matching real LR2.
  
  LR2 ships `<poorbga>500</poorbga>` in its `config.xml` and its changelog documents 500 ms as the
  miss-BGA default, so the previous 2-second window held the miss layer four times longer than LR2.
  `DEFAULT_POOR_BGA_DISPLAY_SECONDS` is shared by the TUI compositor and the web LR2 scene, so both
  runtimes pick up the corrected timing.
- 41f5efb: Cap every inner judge window at the BAD gate under the IIDX ruleset. Classification walks PGREAT → GREAT → GOOD → BAD in order, so the uncapped GOOD window (116.67 ms) swallowed every press a `judgeWindowMs` debug override below it was meant to reject — a 50 ms override left the effective window at 116.67 ms. LR2 and beatoraja already capped; all three now share one code path.
  
  Resolve each note's miss deadline from the judge rank in force at that note's own time instead of the live window. The LR2 BAD gate is rank-invariant, so this is behaviour-neutral today; it stops a rank change from retroactively moving the deadline of already-passed notes once a ruleset whose BAD width scales with judgerank is wired in.
- 40f1050: Move the LR2 / beatoraja / IIDX ruleset tables out of the play-log simulator into a shared `src/ruleset/` module so the live engine and the simulator can resolve behaviour from one source of truth. The tables now take a neutral `RulesetChartFacts` record instead of reading a `PlaylogChart` directly, and each caller supplies an adapter — `rulesetChartFactsFromPlaylog` for recorded plays. `@be-music/player/playlog` re-exports the ruleset surface unchanged, so this is behaviour-neutral for consumers.
- Updated dependencies [202a28b]
  - @be-music/chart@0.4.0
  - @be-music/audio-renderer@0.2.4
  - @be-music/parser@0.2.4

## 0.6.0

### Minor Changes

- ab210cb: Add the `@be-music/player/playlog` subpath: a play-history ("playlog") format that records the resolved chart, the raw key press/release stream, and the play settings as an input replay, plus LR2 / beatoraja / IIDX ruleset simulators (`simulatePlaylog`) that re-derive judgments, EX-SCORE, max combo, money score, and groove gauge from the same recorded inputs.

  New `PlayerOptions.onPlaylogRecorded` / `PlayerOptions.recordPlaylog` enable engine-side recording for both `manualPlay` and `autoPlay` (including ESC-aborted runs), and `PlayerOptions.replayInputs` re-drives a recorded input stream deterministically for replay playback (live lane input is ignored while a replay is active). `PlayerOptions.judgeRuleset` switches the live judge windows between LR2 (default), beatoraja, and IIDX — recorded as `play.judgeRuleset` so replays re-apply the same windows — and the playlog stamps the source chart file's SHA-256 (`chart.sha256`) when the host supplies one. `ScoreTracker` now latches `maxCombo`, `resolveJudgeRankPercent` exposes the chart's initial judgerank percent, and the landmine gauge-damage rule moved to the shared `core/landmine.ts` helper.

### Patch Changes

- Bump the `node-web-audio-api` runtime dependency from `2.0.0` to `2.2.0`.

## 0.5.0

### Minor Changes

- 7bbf052: HARD / EASY / DEATH gauges now follow the LR2 tables (beatoraja GaugeProperty HARD_LR2 / EASY_LR2 / HAZARD_LR2): HARD recovers +0.1/+0.1/+0.05 with damage scaled by the #TOTAL multiplier table and softened ×0.6 under 30%; EASY damages -3.2/-4.8/-1.6 and clears at 80%; DEATH drains -10 on an empty POOR instead of dying and recovers +0.15/+0.06. Survival gauges collapse to 0% (FAILED, no recovery) below 2%, and raw deltas such as mine damage bypass the guts/TOTAL modifiers.
- 811cdfc: Judge windows are now the measured LR2 tables instead of IIDX-baseline linear scaling: #RANK 0/1/2/3 map to ±8/±15/±18/±21ms PGREAT (±24/±30/±40/±60 GREAT, ±40/±60/±100/±120 GOOD), #RANK 4 is treated as NORMAL, the BAD gate is fixed at ±200ms for every rank, and #DEFEXRANK / #EXRANKxx / bmson judge_rank interpolate piecewise-linearly between the rank anchors (lr2oraja JudgeWindowRule.LR2 model) without ever exceeding the BAD gate.
- d0bb321: Mines now follow the LR2 detonation model: a mine explodes while its lane's key is ON and the mine is within the GOOD window of the judge line — covering both presses with a mine in range and holding through a passing mine; a mine passing with the key up is harmless. Explosions only drain the gauge (raw base36 value as the damage percent, matching LR2 / beatoraja, instead of the nanasi value/2 rule) and play #WAV00 — no BAD verdict, no combo break, and mines no longer swallow presses aimed at nearby notes. Mine damage bypasses the HARD guts softening and #TOTAL multiplier; ZZ instantly fails survival gauges.

### Patch Changes

- b9922cf: Honour beatoraja bmson long-note type extensions (`info.ln_type` and per-note `t`: 1 LN / 2 CN / 3 HCN; per-note `t` wins). Charts that specify neither now default to LN (no tail release judgment, matching the LR2-aligned BMS default) instead of always being treated as CN.
- 254e213: Empty POORs (空 POOR) now follow the LR2 trigger condition: a phantom press charges only when a note on the same lane lies within the next 1 second (early side only, fixed window). Presses after a note or on lanes with no upcoming note are harmless keysound presses — previously every phantom press drained the gauge regardless of note proximity.
- ebfdba7: Bump the `node-web-audio-api` runtime dependency from 1.0.9 to 2.0.0 (semver-major). The Node audio sink now runs on the 2.x WebAudio backend with no change to the player's public API.
- ca1012c: Load `node-web-audio-api` through the SEA-aware optional-module loader. In a single executable application the bare-specifier import always fails, which permanently disabled audio playback; the player can now pick the module up from a `node_modules` directory next to the executable (or the working directory) before falling back to silent playback.
- 6ce9173: Missing, undefined, or undecodable `#WAVxx` references are now silent by default, matching LR2 / beatoraja. The synthesized sine fallback tone is opt-in via `PlayerOptions.missingSampleToneSeconds`.
- 7802f98: Fix four spec-compliance deviations found by the BMS spec audit:

  - HARD / DEATH gauges now report FAILED when they bottom out at 0 % (previously `isGrooveGaugeCleared` treated 0 % as cleared).
  - Dynamic `#EXRANKxx` (channel `A0`) values now go through the same `RANK 2 = 100` unit conversion as `#DEFEXRANK`, so `#EXRANK 100` restores exactly the NORMAL judgment width instead of widening it by 4/3.
  - bmson `key_channels[].notes[].damage` is now applied as the mine's gauge damage, taking precedence over the BMS `value / 2` rule.
  - `#SPEEDxx` now holds the first keyframe's value before its beat (Bemuse reference semantics) instead of ramping linearly from 1.0.

- Updated dependencies [b2c4f9b]
- Updated dependencies [b9922cf]
- Updated dependencies [4d5a89e]
- Updated dependencies [6ce9173]
- Updated dependencies [cdc42a1]
- Updated dependencies [ca1012c]
  - @be-music/parser@0.2.3
  - @be-music/json@0.2.2
  - @be-music/audio-renderer@0.2.3
  - @be-music/utils@0.3.0
  - @be-music/chart@0.3.2

## 0.4.3

### Patch Changes

- 9b7f269: Align the manual-play empty-press lane keysound fallback with LR2 / beatoraja.

  - Invisible `3x` / `4x` objects now always update a lane's current keysound during manual play, decoupled from the show-invisible debug overlay, so audio semantics no longer depend on rendering settings.
  - An empty press falls back to the latest same-lane visible/invisible keysound whose early-BAD window has already opened, instead of sounding the next pending note before its judgment window opens.

## 0.4.2

### Patch Changes

- eb92249: Drop the engine's bespoke `delayImmediate` cooperative-yield helper and route the sub-8 ms tail-spin through a dedicated `input-wakeup` primitive instead. The previous `setImmediate` / `queueMicrotask` fallback path kept appending continuations to the microtask queue when no input arrived, which dragged the loop's resident heap upward over a long session (visible as creeping `playback-state` RSS growth during multi-song TUI runs). The new wakeup module suspends on the input signal directly so an idle tail-spin holds no closures.

## 0.4.1

### Patch Changes

- 69f77d1: Two hot-loop optimisations:

  - `core/engine.ts`: hoist `resolveBmsBase(resolvedJson)` and `resolvedJson.resources.wav` out of the autoplay tick into local constants. Both fields are immutable from the autoplay entry point on, but were re-walked dozens of times per second (LN body, every triggered sample, mine resolution).
  - `judging.ts`: `lowerBoundBySeconds` now binary-searches `startIndex` when the caller declares `sortedBySeconds: true` and doesn't supply an explicit `startIndex`. Drops the per-call prefix scan from O(N) to O(log N) once the judge window opens deep into the chart.

- Updated dependencies [73dff9a]
  - @be-music/utils@0.2.1
  - @be-music/audio-renderer@0.2.2
  - @be-music/json@0.2.1
  - @be-music/parser@0.2.2
  - @be-music/chart@0.3.1

## 0.4.0

### Minor Changes

- 06a2db9: Add optional `PlayerOptions.playVariant` (`'5' | '7' | '9' | '10' | '14' | '24'`) so the host can pin the engine's lane mode. BME-format POPN-9 charts can now mount with the correct `f / v / g / b` bindings instead of falling back to 7-key SP.

  The player summary's `gauge` block now exposes the gauge `type` so consumers can label the clear lamp without inferring from the threshold (EASY 60 vs DEATH 0+ε collide). Long-note handling is aligned with upstream beatoraja: silent mid-hold mines, HCN gauge gain, and drain rate.

### Patch Changes

- Updated dependencies [06a2db9]
  - @be-music/chart@0.3.0
  - @be-music/audio-renderer@0.2.1
  - @be-music/parser@0.2.1

## 0.3.1

### Patch Changes

- b9a5f51: The manual LN-head path now emits `hold-lane-until-beat` for every LN start (mode 1 / 2 / 3), and `finalizeActiveLongNote` fires the matching `release-lane` at every manual LN resolution (early release, mode-1 grace expiry, or end-beat). Hosts that key LN-hold effects off those commands — previously they only arrived on the autoplay path — can now show sustain glow for a held LN and fade it at the tail.

## 0.3.0

### Minor Changes

- 5ea9072: Add `PlayerOptions.preparedChart` so the host can hand the engine a pre-built `PreparedPlaybackChartData`. When provided, `autoPlay` / `manualPlay` use it verbatim and skip the internal prepare pass; hosts that omit the option keep the prior behavior.

  Re-export `preparePlaybackChartData` and the `PreparedPlaybackChartData` type from the package root. `PlayerStateSignals` gains `drainPendingJudgeCombos()` so hosts can fan out per-judge effects for simultaneously-judged notes; the legacy `getJudgeCombo()` latch still returns the most recent state for HUD readout.

## 0.2.0

### Minor Changes

- 632f274: Honour the chart's `#BASE 62` object-ID base when resolving WAV / BMP slot IDs at playback time, so `#WAVaA` and `#WAVAA` map to distinct samples. Charts that don't declare `#BASE 62` keep the historical 36-base behaviour.

- 632f274: Engine-side gameplay improvements:

  - Landmine notes apply the chart-encoded damage value (default 4) on a manual mine hit and play `#WAV00` as the explosion sample.
  - Empty POORs (空 POOR) fire the LR2-compatible phantom-press verdict when the player presses a lane key with no note in window — drain the gauge without breaking combo or scoring, and trigger the POOR BGA swap window.
  - Opt-in Lanczos resampling for `#STAGEFILE` / `#BANNER` / `#BACKBMP` so high-res chart graphics down-scale cleanly to skin slot sizes.

- 632f274: Split the CLI / TUI frontend out of `@be-music/player` into `@be-music/player-tui`.

  `@be-music/player` is now a pure playback-engine library: gameplay loop, scoring, lane layout, BGA timeline, signals, and the audio sink. New subpath exports land under `core/` (`bga-timeline`, `lane-layout`, `ui-options`) plus top-level `audio-sink`, `image-resize-algorithm`, `state-signals`, and `utils`. The `bms-player` bin and the Node-only dependencies (`libav.js`, `fast-bmp`, `fast-png`, `jpeg-js`) move to `@be-music/player-tui`.

- 135f822: Open the engine to host-supplied runtimes so the browser player can share judging, gauging, scoring, and chart-finish semantics with the TUI.

  - `PlayerOptions.createAudioSession` — host-supplied audio backend; defaults to the bundled Node sink when omitted.
  - `PlayerOptions.createInputRuntime` / `createUiRuntime` — host-supplied DOM / runtime adapters.
  - `PlayerInputCommand.pressedAt` — wall-clock-ms timestamp on `lane-input` and `kitty-state` so the engine judges against the physical press time, not its drain time (removes up to ~16 ms of late-bias; `worker_threads`-safe via `performance.timeOrigin + performance.now()`).
  - Event-driven drain (`createInputWakeUp`) cuts the inter-tick sleep short on input arrival.
  - The engine module no longer imports from `node:path` / `node:timers/promises`; `createNodeAudioSink` is loaded lazily only when no `createAudioSession` factory is supplied, so browser bundles can import the engine as-is.

### Patch Changes

- 632f274: Resume cleanly after a `Space` pause that overlaps a `#STOP` segment. Previously the playhead froze for the rest of the stop's duration on resume because the stop-clock baseline wasn't rolled forward across the pause.
- Updated dependencies [632f274]
- Updated dependencies [135f822]
- Updated dependencies [135f822]
  - @be-music/parser@0.2.0
  - @be-music/chart@0.2.0
  - @be-music/audio-renderer@0.2.0
  - @be-music/json@0.2.0
  - @be-music/utils@0.2.0

## 0.1.0

### Minor Changes

- Initial release.

### Patch Changes

- Updated dependencies
  - @be-music/audio-renderer@0.1.0
  - @be-music/chart@0.1.0
  - @be-music/json@0.1.0
  - @be-music/parser@0.1.0
  - @be-music/utils@0.1.0
