[Japanese version](./architecture.ja.md)

# Architecture

This document covers how a chart becomes something to play (the Source and Resolved layers), how the engine judges a play (a deterministic judge core and the drivers around it), and the rules that keep these parts runtime-neutral and small.

be-music reads a chart in two layers. The **Source layer** says what the file says. The **Resolved layer** says what the player plays. Exactly one function, `resolveChart`, turns the first into the second, and every format default and de facto reading is applied there or in a helper it calls. Consumers read the Resolved layer and do not interpret the format again.

```text
 .bms / .bme / .pms / .bmson / .json
            │  @be-music/parser (parseChart, parseBms, parseBmson)
            ▼
 BeMusicJson ─────────────────────────────── Source layer (@be-music/json)
            │  drawRandomOutcomes(chart, random)  → RandomDraws      (@be-music/chart)
            │  resolveBmsControlFlowWithDraws(chart, draws)          (@be-music/parser)
            │    (hosts: resolvePlayChart(chart) → { chart, randomDraws }, @be-music/player)
            ▼
 BeMusicJson without control flow
            │  resolveChart(chart, { randomDraws, chartPath, playVariant, inferBmsLnTypeWhenMissing })
            ▼
 ResolvedChart ───────────────────────────── Resolved layer (@be-music/chart)
            │
            ├─ @be-music/player        engine bootstrap (preparePlaybackChart), ruleset facts, play log
            ├─ @be-music/audio-renderer renderJson
            ├─ @be-music/player-tui     chart list, preview signature, BGA, UI worker
            ├─ @be-music/player-web     gameplay scene, beatoraja prep, audio preview, song collection
            └─ @be-music/skin-sdk       song facts
```

## Source layer

`BeMusicJson` ([JSON spec](./json-spec.md)) represents a BMS or bmson file faithfully: raw channels and object values, header tables, measure lengths, the `#RANDOM` / `#SWITCH` blocks (`bms.controlFlow`), the bmson extensions, and the preservation data a round trip needs. Only `@be-music/parser` and `@be-music/stringifier` write it, and only they need to know how a file spells something.

A parsed chart still carries its control flow. Its `events` hold only the unconditional objects.

## Control flow and `RandomDraws`

The `#RANDOM` / `#SETRANDOM` / `#SWITCH` / `#SETSWITCH` outcomes of one play are a value, `RandomDraws`: one entry per line in file order. A host draws them once with `drawRandomOutcomes` (`@be-music/chart`) and resolves the chart with `resolveBmsControlFlowWithDraws` (`@be-music/parser`), or does both with `resolvePlayChart` (`@be-music/player`). It then hands the same chart and draws to every consumer of the play: the scene, the engine, the result screen and the play log. `evaluateControlFlow` in `@be-music/chart` is the only evaluator of the branch semantics. Applying the active header lines stays in the parser, because it reuses the parser's directive table. See [Player spec — Handling control syntax](./player-spec.md#handling-control-syntax).

## Resolved layer

`resolveChart(chart, options)` in `@be-music/chart` ([`resolved-chart.ts`](../packages/chart/src/resolved-chart.ts)) returns a `ResolvedChart`. The function is pure: the same chart and options always give the same value. The heavy parts are computed on first access and then kept, so a consumer pays only for what it reads.

| Field                                               | Contents                                                                                                                                                                                                                                                       |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `source`, `sourceFormat`, `idBase`                  | The control-flow-resolved source chart (metadata, resources, raw sections) and its object-ID base                                                                                                                                                              |
| `randomDraws`, `hasUnresolvedControlFlow`           | The draws the chart was resolved with, and whether control flow is still on the chart. If it is, only the unconditional content is resolved: this is what a song list shows before any draw                                                                    |
| `playVariant`, `layouts`                            | The lane mode (the host's `playVariant`, otherwise `resolveChartPlayVariant` over the lanes in use and `chartPath`) and its play-mode table layouts                                                                                                            |
| `notes`                                             | Judged notes, `kind: 'tap' \| 'ln'`, with `channel` (the playable `1x` / `2x` lane), `beat`, `seconds`, `endBeat` / `endSeconds` / `lnMode` for long notes, `freeZone` for FREE ZONE tails, `sampleKey` and the source `event`. One note per lane and position |
| `shadowedNotes`                                     | Duplicate notes that lost their lane and position to a judged note and carry a different keysound                                                                                                                                                              |
| `mines`, `invisibleNotes`                           | `kind: 'mine'` with `damage` (gauge %), and `kind: 'invisible'`, both on the playable lane they sit on                                                                                                                                                         |
| `sampleTriggers`                                    | Every sound the chart triggers by itself or from a lane, with `#LNOBJ` ends and suppressed `#LNTYPE` halves left out and bmson slices (`c`) resolved                                                                                                           |
| `volumeChanges`                                     | BMS `#xxx97` / `#xxx98` dynamic volume changes with their bus and linear gain                                                                                                                                                                                  |
| `timing`, `beatResolver`, `sortedEvents`            | The tempo map (BPM points, STOP and `#STP` points, beat → seconds), measure-aware beat resolution, and the events in chart order                                                                                                                               |
| `reversal`                                          | Where the first negative `#BPMxx` arms LR2's reverse-scroll gimmick (`timing.reversal`, beat and seconds), if the chart has one ([BMS spec — Negative BPM](./bms-spec.md#negative-bpm-bpmxx-via-channel-08-basis))                                             |
| `scroll`, `speed`, `barLines`, `barLinesSuppressed` | SCROLL / SPEED keyframes and bar-line beats (none when bmson `lines: []` suppresses them)                                                                                                                                                                      |
| `bga`                                               | BGA cues (base, layer, layer 2, POOR) from BMS channels and bmson `bga` alike                                                                                                                                                                                  |
| `judgeRank`, `total`, `lnMode`                      | Inputs for the rulesets: `#RANK`, `#DEFEXRANK` / bmson `judge_rank`, the `#EXRANKxx` changes; `#TOTAL` (`absolute`) or bmson `total` (`percent`); the chart-level LN mode                                                                                      |
| `lastNoteSeconds`                                   | When the last judged note, mine or invisible object ends                                                                                                                                                                                                       |

Resolved notes keep a reference to the source `event`. The engine uses it to look up keysounds, and the logs use it to name objects. Play state is not part of the Resolved layer. The engine copies the notes into mutable play notes (`preparePlaybackChart` in `@be-music/player`, which adds `judged` and lets lane options rewrite `channel`) and binds keys to lanes there.

### What stays outside

- **Ruleset choices** belong to `@be-music/player`'s rulesets (`lr2`, `beatoraja`, `iidx`): judge windows from the judge-rank inputs, the default TOTAL and how bmson's percentage applies to it, gauge curves, and how an LN mode request plays (LN / CN / HCN). The Resolved layer gives them the chart's raw inputs.
- **Judge-rank defaults**: `judgeRank` holds only what the chart sets. The bmson `judge_rank` default (100) and the BMS `#RANK` default (NORMAL) are filled by each ruleset and, for song screens, by `resolveDisplayedJudgeRankValue` / `Label` (`@be-music/player/utils`), which read the same facts. A play log records the chart's own values (`sourceRank` / `sourceExRank`), and a log without them must replay to the same windows, so the rulesets need the defaults anyway; filling them here would also change the recorded facts of every bmson chart without `judge_rank`.
- **Lane bindings and input**: key assignment, FREE ZONE aliases, scorable notes and lane options (RANDOM, MIRROR, FLIP) are play settings in `@be-music/player`.
- **Rendering and audio output**: how the hosts draw and mix what the Resolved layer lists.

## Play-mode table

Every play mode (5 / 7 / 9 PMS / 9 BME / 10 / 14 / 24 / 48 KEY) is declared once in `PLAY_MODE_LAYOUTS` ([`play-modes.ts`](../packages/chart/src/play-modes.ts)): each lane's kind, side, display slot and BMS channels (visible, invisible, `#LNTYPE`, mine), plus FREE ZONE channels. The bmson `mode_hint` tables, the stringifier's `x` map, the play-variant lane sets, the engine's lane layout, the TUI lane colours and the skin lane kinds are all derived from it. `ResolvedChart.layouts` is the entry for the chart's variant. See [Player spec — Play-mode table](./player-spec.md#play-mode-table).

## Where the rules live

| Rule                                                                                                                                                  | Module (`@be-music/chart`)                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Branch semantics (`#RANDOM`, `#SWITCH`, nesting, unclosed `#IF`)                                                                                      | [`control-flow.ts`](../packages/chart/src/control-flow.ts)                                                   |
| Lane mode (`resolveChartPlayVariant`), lanes per mode, bmson `mode_hint` lanes                                                                        | [`index.ts`](../packages/chart/src/index.ts), [`play-modes.ts`](../packages/chart/src/play-modes.ts)         |
| Beats from measure lengths, event order                                                                                                               | [`index.ts`](../packages/chart/src/index.ts) (`createBeatResolver`, `sortEvents`)                            |
| BPM (`03` / `08`; zero ignored, a negative `#BPMxx` at its absolute value), the LR2 negative-BPM reversal, STOP and `#STP`, STOP at a note's position | [`timing.ts`](../packages/chart/src/timing.ts)                                                               |
| `#LNOBJ`, `#LNTYPE 1` / `2` (and inference), bmson `l` / `t` / `ln_type`, FREE ZONE tails, one judged note per lane and position                      | [`index.ts`](../packages/chart/src/index.ts), [`resolved-notes.ts`](../packages/chart/src/resolved-notes.ts) |
| Mine damage (base-36 value, bmson `damage`, default 4 %), chart LN mode                                                                               | [`note-rules.ts`](../packages/chart/src/note-rules.ts)                                                       |
| Sample triggers, bmson slices and `c`                                                                                                                 | [`sample-triggers.ts`](../packages/chart/src/sample-triggers.ts)                                             |
| SCROLL / SPEED keyframes, bar lines, BPM / measure / STOP timelines                                                                                   | [`timelines.ts`](../packages/chart/src/timelines.ts)                                                         |
| BGA cues                                                                                                                                              | [`bga.ts`](../packages/chart/src/bga.ts)                                                                     |

The [Be-Music Fingerprint](./fingerprint-spec.md) reads its items through these same modules, so it identifies a chart by exactly what the Resolved layer plays; it only keeps exact measure positions where the Resolved layer has beats and seconds, and drives `control-flow.ts`'s frame operations for every outcome at once.

The reasons behind each reading, and every place where be-music departs from a specification on purpose, are recorded in [BMS / bmson compatibility notes](./format-compat.md) (§5 lists the decisions) and in the [BMS](./bms-spec.md) and [bmson](./bmson-spec.md) specs.

## Checking the layer

`tests/regression/resolved-chart.test.ts` resolves every chart in `examples/test`, for each `#RANDOM` draw the regression corpus pins. It checks the result against the consumer helpers (`extractTimedNotes`, `collectSampleTriggers`, `createTimingResolver`) and against the pinned engine note list, triggers, tempo map and chart facts in `tests/regression/__expected__` (see the [regression corpus](../tests/regression/README.md)).

## The engine: judge core and drivers

`@be-music/player`'s engine ([`core/`](../packages/player/src/core)) is a deterministic judge core with drivers around it.

```text
            clock / key input / recorded play log
                          │
   manual-play.ts ────────┼──────── auto-play.ts                 drivers
                          ▼
      step(state, input) → effects                               judge core
   judge-core.ts (+ judge-core-{types,score,advance,press}.ts)   (manual play)
   auto-judge-core.ts                                            (AUTO play)
                          │
                          ▼
   engine-effects.ts → audio session, UI buses, play log, no-TUI trace
```

- **The judge core** holds everything that decides a judgment in an explicit state object: note selection, the ruleset windows, long-note holds and tails, HCN gauge ticks, mines, auto-scratch, misses, combo, score and gauge. `runJudgeCoreStep(state, input, emit)` (or `stepJudgeCore(state, input)`, which returns the effects as an array) applies one input — `advance`, `press`, `hold`, `release` or `finish`, stamped with chart seconds — and reports what happened as effects: sounds and sound stops, gauge / combo / long-note changes, UI cues, play-log records and trace lines. The core reads no clock, sets no timer and does no I/O, so the same state and inputs always give the same effects. `auto-judge-core.ts` does the same for AUTO play. The LR2 negative-BPM reversal reaches the cores as chart data (`reversalSeconds`, from `ResolvedChart.reversal`): past it they stop sweeping misses and mines and judge presses and releases on the mirrored clock `2R − now`, computed from the input's own chart time.
- **The drivers** (`manualPlay`, `autoPlay`) own the clock, the input runtimes, audio scheduling, pause and HIGH-SPEED, and map the core's effects onto the host through `engine-effects.ts`. Live play steps the core from the playback clock once per frame and on every key event. A replay (`PlayerOptions.replayInputs`) steps it with `advanceJudgeCoreReplay` on a fixed 1 ms chart-time grid merged with the recorded inputs, so a replay's judgments do not depend on tick timing or `speed`.
- **Shared rules.** The rules both the judge core and the play-log simulator (`playlog/simulate.ts`) apply live in the ruleset: windows and classification (`ruleset/judge.ts`), candidate selection (`ruleset/selection.ts`), the gauge (`ruleset/gauge.ts`), and the long-note rules — the mode a ruleset plays, the missed-charge-tail POOR, LR2's late LN-head BAD and the multi-BAD pruning (`ruleset/long-note.ts`). The simulator keeps its own microsecond event queue, so `playlog/equivalence.test.ts` checks that the two reach the same judgments on the same input stream.
- **Driver services** sit beside the drivers: `engine-preparation.ts` (chart resolution for play, load progress, runtime start-up), `engine-audio.ts` (the built-in Node audio session and mixing), `engine-clock.ts`, `engine-trace.ts` (no-TUI output) and `engine-types.ts` (the public types). `engine.ts` is the public facade; its exports did not change with the split.

## Layering and size guards

`pnpm run check` enforces these structural rules besides format, lint and types.

- **Runtime-neutral code.** `@be-music/chart`, `@be-music/json`, `@be-music/parser` and `@be-music/player`'s `core/`, `playlog/` and `ruleset/` run unchanged in the browser and in Node. Oxlint's `no-restricted-imports` and `no-restricted-globals` (configured in [`vite.config.ts`](../vite.config.ts)) reject Node built-in imports (`node:*` and bare names) and DOM / Node-only globals (`window`, `document`, `process`, `Buffer`, …) there. Runtime services come in through adapters instead: `PlayerOptions.createAudioSession` / `createUiRuntime` / `createInputRuntime`, the optional-module loader for the Node audio sink, and the parser's [`node-file.ts`](../packages/parser/src/node-file.ts) (`parseChartFile`), which with the parser CLI is exempt. Tests are exempt too.
- **Deterministic judge.** `core/judge-*.ts`, `core/auto-judge-core.ts`, `ruleset/` and `playlog/simulate.ts` additionally may not read `Date` or `performance`, set timers, or call `Math.random`: time and randomness are inputs.
- **File-size budget.** [`scripts/lint/file-size-budget.ts`](../scripts/lint/file-size-budget.ts) fails when a package source file (tests, declarations and fixtures excluded) grows past 1,500 lines. Files that were already larger are on its allowlist and only produce warnings; an allowlisted file that drops under the budget must be taken off the list. Run it alone with `pnpm run check:file-size`.
