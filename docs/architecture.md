[Japanese version](./architecture.ja.md)

# Architecture: the Source layer and the Resolved layer

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

| Rule                                                                                                                             | Module (`@be-music/chart`)                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Branch semantics (`#RANDOM`, `#SWITCH`, nesting, unclosed `#IF`)                                                                 | [`control-flow.ts`](../packages/chart/src/control-flow.ts)                                                   |
| Lane mode (`resolveChartPlayVariant`), lanes per mode, bmson `mode_hint` lanes                                                   | [`index.ts`](../packages/chart/src/index.ts), [`play-modes.ts`](../packages/chart/src/play-modes.ts)         |
| Beats from measure lengths, event order                                                                                          | [`index.ts`](../packages/chart/src/index.ts) (`createBeatResolver`, `sortEvents`)                            |
| BPM (`03` / `08`, non-positive values ignored), STOP and `#STP`, STOP at a note's position                                       | [`timing.ts`](../packages/chart/src/timing.ts)                                                               |
| `#LNOBJ`, `#LNTYPE 1` / `2` (and inference), bmson `l` / `t` / `ln_type`, FREE ZONE tails, one judged note per lane and position | [`index.ts`](../packages/chart/src/index.ts), [`resolved-notes.ts`](../packages/chart/src/resolved-notes.ts) |
| Mine damage (base-36 value, bmson `damage`, default 4 %), chart LN mode                                                          | [`note-rules.ts`](../packages/chart/src/note-rules.ts)                                                       |
| Sample triggers, bmson slices and `c`                                                                                            | [`sample-triggers.ts`](../packages/chart/src/sample-triggers.ts)                                             |
| SCROLL / SPEED keyframes, bar lines, BPM / measure / STOP timelines                                                              | [`timelines.ts`](../packages/chart/src/timelines.ts)                                                         |
| BGA cues                                                                                                                         | [`bga.ts`](../packages/chart/src/bga.ts)                                                                     |

The reasons behind each reading, and every place where be-music departs from a specification on purpose, are recorded in [BMS / bmson compatibility notes](./format-compat.md) (§5 lists the decisions) and in the [BMS](./bms-spec.md) and [bmson](./bmson-spec.md) specs.

## Checking the layer

`tests/regression/resolved-chart.test.ts` resolves every chart in `examples/test`, for each `#RANDOM` draw the regression corpus pins. It checks the result against the consumer helpers (`extractTimedNotes`, `collectSampleTriggers`, `createTimingResolver`) and against the pinned engine note list, triggers, tempo map and chart facts in `tests/regression/__expected__` (see the [regression corpus](../tests/regression/README.md)).
