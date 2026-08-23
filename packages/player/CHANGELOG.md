# @be-music/player

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
