# Test Chart Fixtures

[日本語版はこちら](./README.ja.md)

Shared chart and audio fixtures for the be-music test suite. Every chart here targets one coherent feature cluster, and
every chart is read by at least one test — a fixture no test reads goes stale without anyone noticing, which is how the
problems fixed in this directory got in.

The corpus-level guard lives in [`packages/parser/src/fixtures.test.ts`](../../packages/parser/src/fixtures.test.ts). It
scans this directory, parses every chart off disk, and requires each one to yield playable events after control-flow
resolution. Add a chart here and it is picked up automatically; break one and that test fails.

## Conventions

- Name a chart after the feature it exercises, in kebab-case.
- Pick the extension deliberately. `.bms` / `.bme` / `.bml` / `.pms` feed lane-mode detection, so the extension is part
  of what a fixture asserts.
- Open with the `*---------------------- ... FIELD` section banners the existing charts use, and explain in a `*`
  comment block what the chart is for and which behaviour would break if it changed.
- Reference only audio files that already exist in this directory, so every chart is actually playable by hand.

## Charts by feature

### Header and directive coverage

| File                                   | Covers                                                                                                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `four-measure-command-combo-test.bms`  | Every extension header and object channel the parser routes, one 4-measure block per command group. Proves routing and roundtrip preservation, not payload validity. |
| `extended-directives.bms`              | The same directive family with payloads the `@be-music/chart` value parsers accept: `#EXWAV` `pvf`, `#EXBMP` ARGB tuple, `#ARGB` hex and decimal, `#BGA` sub-region, `#SWBGA` animation, `#WAVCMD` pitch/volume/loop, `#EXRANK` on channel `A0`, `#CHANGEOPTION` on channel `A6`, `#STP`. |
| `base62-ids.bms`                       | `#BASE 62` — upper, lower and mixed case object IDs as distinct slots, in indexed headers, channel streams, `#LNOBJ`, and inside a `#RANDOM` / `#IF` block.          |
| `sjis-encoding-test.bms`               | Shift_JIS auto-detection. Its parsed IR is pinned in `sjis-encoding-test.json`.                                                                                     |
| `benchmark-command-mix-100.bms`        | Parser throughput over 100 measures with a mixed command load. Not wired to `pnpm bench`, which uses its own inline chart.                                           |

### Timing and drawing gimmicks

| File                        | Covers                                                                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scroll-speed-gimmick.bms`  | One measure per gimmick: `#xxx02` measure length, `#xxx03` hex BPM, `#xxx08` `#BPMxx` reference, `#xxx09` STOP, `#xxxSC` `#SCROLLxx` (including `0` and negative), `#xxxSP` `#SPEEDxx`, then all of them in one measure. |
| `measure-length.bms`        | A single shortened measure surrounded by normal ones.                                                                                                          |
| `bus-volume-channels.bms`   | Channels `97` (BGM bus) and `98` (key bus) dynamic volume, including both buses moving on the same beat.                                                       |
| `nonpositive-bpm.bms`       | Channel `08` pointed at a zero slot, a negative slot, and an undefined slot — the tempo points the timeline has to drop while still leaving a playable chart.   |

### Long notes

| File                              | Covers                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------- |
| `ln-mode-1-long-note.bms`         | `#LNMODE 1` (LN) with `#LNOBJ` head/tail pairs. Also the 7 KEY SP lane fixture.  |
| `ln-mode-2-charge-note.bms`       | `#LNMODE 2` (CN) — same chart data, different mode.                              |
| `ln-mode-3-hell-charge-note.bms`  | `#LNMODE 3` (HCN) — same chart data, different mode.                             |
| `lntype2-long-note.bms`           | `#LNTYPE 2` continuous runs: one run in a measure, two runs split by a gap, and a run crossing a measure boundary. |
| `ln-9key-popn.bms`                | Long notes on all nine POPN lanes with `#PLAYER 3`.                              |

### Lane modes

One fixture per branch of `resolveChartPlayVariant`.

| File                          | Lane mode   |
| ----------------------------- | ----------- |
| `5key-sp.bms`                 | 5 KEY SP    |
| `ln-mode-1-long-note.bms`     | 7 KEY SP    |
| `9key-all-keys-quarter.pms`   | 9 KEY (PMS-STD) |
| `ln-9key-popn.bms`            | 9 KEY (`#PLAYER 3` + channel `17`) |
| `10key-dp.bms`                | 10 KEY DP   |
| `lane-order-test.bms`         | 14 KEY DP — also the lane-ordering chart, every classic column on both sides |
| `24key-keyboard-sp.bme`       | 24 KEY SP — extended `1A..1O` columns |
| `48key-keyboard-dp.bme`       | 48 KEY DP — extended columns on both sides |
| `7key-longnote.bml`           | 7 KEY SP — the `.bml` extension, which carries no parsing rule of its own but is on every chart-file allow-list |

### Lanes and hazards

| File                    | Covers                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| `invisible-notes.bms`   | Invisible keysound channels `3x` / `4x` — they sound but are neither drawn nor judged, and the 2P-side `4x` channels must not turn a single-player chart into a DP chart. |

### Control flow

| File                             | Covers                                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `control-flow-random-demo.bms`   | `#RANDOM` / `#IF` / `#ELSE` with a metadata override, plus two `#SWITCH` / `#CASE` / `#DEF` blocks. Every object lives inside a branch, so the chart is empty until control flow is resolved. |

### bmson

| File                                | Covers                                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------------------------- |
| `bmson-strict-features.bmson`       | The full `info` block, `bga` headers and events, `lines`, and `notes[].l` / `.c`.                  |
| `bmson-lines-resolution-test.bmson` | Non-uniform `lines` and the resolution-dependent conversion of `stop_events.duration`.             |
| `bmson-key-channels-mines.bmson`    | beatoraja extensions: `key_channels` mines routed through the `mode_hint` lane map onto `Dx` / `Ex`, `info.ln_type`, and `notes[].t`. |

### Format round trips

These five files only mean anything as a set, and
[`packages/editor/src/index.test.ts`](../../packages/editor/src/index.test.ts) checks them against the live pipeline:

| File                     | Role                                                    |
| ------------------------ | ------------------------------------------------------- |
| `sample.bms`             | The source chart.                                       |
| `sample.json`            | What `importChart` produces from it.                    |
| `sample.roundtrip.bmson` | The same chart exported to bmson.                       |
| `sample.edit.json`       | The chart after one retitle and one added note.         |
| `sample.edited.bms`      | What `exportChart` writes back out from that edit.      |

Regenerate them through the editor API rather than by hand — that is what keeps them honest.

### Audio playback

| File                                    | Covers                                                                                        |
| --------------------------------------- | --------------------------------------------------------------------------------------------- |
| `retrigger-same-key-cut.bms`            | BMS monophonic playback: a second trigger on the same lane cuts the first voice.               |
| `retrigger-different-key-overlap.bms`   | A different lane does not cut, even when both slots point at the same file.                    |
| `ogg-test.bms`                          | A chart whose `#WAV` names a non-wav codec, so the loader has to reach the Vorbis decoder.     |

## Audio assets

| File                                                       | Used by                                                                          |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `sample.wav`                                               | The default keysound for most charts, and the audio-renderer's reference sample.  |
| `branch.wav`, `right.wav`, `wrong.wav`                     | Secondary keysounds, mostly for telling control-flow branches apart by ear.       |
| `retrigger_a.wav`, `retrigger_b.wav`                       | The 2.2 s samples the retrigger charts need in order to overlap at all.           |
| `ogg-test.ogg`                                             | The Vorbis sample `ogg-test.bms` declares.                                        |
| `ogg-test.wav`                                             | The uncompressed source for `ogg-test.ogg`. Kept as source material; no test reads it. |
| `render-codec-test.mp3` / `.ogg` / `.opus`                 | The audio-renderer's per-codec decode cases, and its missing-`.wav` fallback case. |
