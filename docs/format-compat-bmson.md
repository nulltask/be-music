[Japanese version](./format-compat-bmson.ja.md)

# bmson compatibility

[Comparison method and evidence labels](./format-compat.md)

<details>
<summary>Table of contents</summary>

- [3. bmson](#3-bmson)
  - [3.1 `version`](#31-version)
  - [3.2 `mode_hint` and `x`](#32-mode_hint-and-x)
  - [3.3 `lines`, `resolution` and `y`](#33-lines-resolution-and-y)
  - [3.4 Long notes: `l`, `c`, `ln_type`, `t`, `up`](#34-long-notes-l-c-ln_type-t-up)
  - [3.5 Mines and hidden notes](#35-mines-and-hidden-notes)
  - [3.6 `judge_rank`](#36-judge_rank)
  - [3.7 `total`](#37-total)
  - [3.8 `bpm_events` and `stop_events`](#38-bpm_events-and-stop_events)
  - [3.9 BGA and images](#39-bga-and-images)
  - [Chart load warnings](#chart-load-warnings)

</details>

## 3. bmson

The field-by-field comparisons show the defaults Be-Music applies and which data it preserves during conversion.

Each section names the lines of the bmson spec it relies on.

### 3.1 `version`

The spec (L238-249) has one value, `"1.0.0"`; a missing `version` marks a legacy (pre-1.0) file that a player should reject or read as v0.21, and `null` is an error.
jbms-parser never reads the field [V] ([Bmson.java L8][j-bmson-model]).
Be-Music validates SemVer syntax before reading chart fields and supports stable `1.0.0` with optional build metadata. It rejects null/malformed values, prereleases and other versions, and reads missing-version v0.21 by converting its fields and timing units as [Bemuse](https://github.com/bemusic/bemuse/blob/4bf3e7d98a44841b323741cc403ecb7b41618ade/packages/bmson/src/legacy.ts) does ([bmson spec checklist](./bmson-spec.md#parser-bmson---be-musicchart-source)).

### 3.2 `mode_hint` and `x`

| Topic                         | De jure                                                                                                                                                                                           | beatoraja                                                                                                                                                   | Be-Music                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canonical hints               | `beat-5k`, `beat-7k`, `beat-10k`, `beat-14k`, `popn-5k`, `popn-9k` (L815-838); default `beat-7k` (L298-300); `generic-nkeys` in prose only (L304); a new layout should use a new hint (L306-308). | The six canonical hints plus `keyboard-24k` / `keyboard-24k-double` [V] ([Mode L10-17][j-mode-enum])                                                        | The same eight, each with a fixed lane table, plus `generic-Nkeys` ([bmson spec — conversion](./bmson-spec.md#bmson---bmsbmson-intermediate-representation-be-musicchart-source-conversion)). The tables follow the spec (L825, L827) and beatoraja ([BMSONDecoder L117-127][j-bmson-x]): `beat-5k` / `beat-10k` keep the scratch on `x` 8 (2P keys on `x` 9–13, 2P scratch on `x` 16) and leave `x` 6 / 7 / 14 / 15 empty |
| `keyboard-24k(-double)`       | Not in the spec; a de facto hint from BmsONE.                                                                                                                                                     | `x` 1–24 keys, 25 / 26 wheel up / down; the double layout repeats from `x` 27. Wheel lanes are judged like keys and stay in place under RANDOM / MIRROR [V] | Same lanes (channels `11`–`19`, `1A`–`1O`, wheel `1P` / `1Q`; 2P from `x` 27); the hint alone selects 24 / 48 KEY                                                                                                                                                                                                                                                                                                          |
| BmsONE `keyboard-36k/48k/60k` | Not in the spec.                                                                                                                                                                                  | Unknown hint [V]                                                                                                                                            | Unknown hint; `keyboard-48k` is a one-player layout and is not treated as `keyboard-24k-double`                                                                                                                                                                                                                                                                                                                            |
| Unknown hint                  | A player decides whether it can play the chart (L306-308).                                                                                                                                        | Warning; played as `beat-7k` [V] ([BMSONDecoder L107-113][j-bmson-mode])                                                                                    | `beat-7k`, as in beatoraja, when every positive `x` in use (`key_channels` and `mine_channels` included) is in its table. A chart with lanes past `x` 8 (BmsONE's keyboard hints) keeps them: the distinct `x` values are numbered in ascending order onto `11`, `12`, …, where beatoraja would play them as BGM                                                                                                           |
| `x` = 0 or `null`             | A BGM note (L622-625).                                                                                                                                                                            | Any `x` outside 1–key count is BGM, for example `x` 6 / 7 under `beat-5k` [V] ([BMSONDecoder L118-127][j-bmson-x])                                          | `x ≤ 0`, missing, or outside the hint's table is BGM, as in beatoraja ([`bmson-document.ts`][bm-bmson-document]). A non-integer `x` is floored                                                                                                                                                                                                                                                                             |
| Other players                 | —                                                                                                                                                                                                 | —                                                                                                                                                           | Bemuse ignores `mode_hint` and uses a fixed `x` 1–7 keys / 8 scratch map; Qwilight reads `generic-*`, `popn-*`, `beat-*` and the keyboard hints, with anything else (`beat-7k` included) as 7 + 1 [V]                                                                                                                                                                                                                      |

A BGM note (`x` = 0 or outside the hint's table) at the same `y` as a playable note of the same sound channel is dropped by Be-Music when parsing ([`bmson-document.ts`][bm-bmson-document]).

Be-Music keeps `generic-Nkeys` (1–70) as an explicit `generic-N` variant with N ordinary keys, even in sparse charts. Storage channels `16` / `17` and the second bank do not select scratch, FREE ZONE or double play. Browser/terminal rendering, input, AUTO/replay and fingerprints retain the layout; beatoraja themes borrow a uniform fallback note area. See [ADR 0023](./adr/0023-generic-bmson-keyboards.md) for bounds, judging and export/course policy.

### 3.3 `lines`, `resolution` and `y`

| Topic                  | De jure                                                                                                          | beatoraja                                                                                 | Be-Music                                                                                                                                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lines` missing        | 4/4: a bar line every 4 beats (L440-454).                                                                        | No bar lines [V] ([BMSONDecoder L456-458][j-bmson-lines])                                 | 4/4 bar lines                                                                                                                                                                                                            |
| `lines: []`            | No bar lines at all.                                                                                             | No bar lines [V]                                                                          | No bar lines (`bmson.barlinesSuppressed`)                                                                                                                                                                                |
| `lines` without `y: 0` | The bar line at 0 may be omitted.                                                                                | —                                                                                         | A line at 0 is added                                                                                                                                                                                                     |
| `lines` given          | A bar line at each `y`.                                                                                          | Exactly those lines [V] ([BMSONDecoder L177-185][j-bmson-lines-draw])                     | Exactly those lines, none after the last ([`timelines.ts`][bm-timelines] `createMeasureBoundariesBeats`); BMS likewise gets one line per measure start, none after the last measure, as beatoraja's sections `0..maxsec` |
| `resolution`           | Default 240 pulses per quarter note; 0 / `null` means the default; negative: take the absolute value (L419-427). | ≤ 0 means 240 [V] ([BMSONDecoder L139][j-bmson-res])                                      | `info.resolution`, then a root-level `resolution`, then 240. A negative value is read as its absolute value, as the spec says ([`bmson.ts`][bm-bmson] `resolveBmsonResolution`)                                          |
| Non-integer `y`        | `y` is an unsigned integer (L72, L83).                                                                           | `int` field; Jackson's coercion was not checked. A negative `y` invalidates the chart [V] | Rounded to the nearest pulse                                                                                                                                                                                             |

### 3.4 Long notes: `l`, `c`, `ln_type`, `t`, `up`

The spec defines `l` (L630-631: `l > 0` is a long note ending at `y + l`) and `c` (L633-636: `true` continues the sound slice; L721: if notes on one pulse disagree, treat `c` as `false`).
`ln_type`, the per-note `t` and `up` are beatoraja extensions, not spec fields.

- beatoraja: `ln_type` 1–3 sets the chart's LN / CN / HCN; `t` overrides it per note; `up` gives the LN end its own sound [V] ([BMSONDecoder L114-116, L213-296][j-bmson-ln]).
- Be-Music: `t` > `ln_type` > LN, then the ruleset maps that request as for BMS `#LNMODE` ([§2.5](./format-compat-bms.md#25-long-notes), [`resolved-notes.ts`][bm-resolved-notes]). `up` is read as the long note's end sound. `c` follows the spec, including "any `false` on the pulse restarts" ([`sample-triggers.ts`][bm-sample-triggers] `createBmsonSamplePlaybackMap`).
- Bemuse ignores `ln_type`; Qwilight plays 2 and 3 as CN-like [V].

### 3.5 Mines and hidden notes

The spec has no mines. beatoraja defines two extension arrays [V] ([Bmson.java][j-bmson-model], [BMSONDecoder L317-366][j-bmson-mine]):

- `mine_channels`: mines, with a per-note `damage` used as gauge percent. Mines inside an LN or on an occupied position are dropped.
- `key_channels`: hidden (invisible) notes, not mines.

Be-Music reads them as beatoraja does: `mine_channels` become mines (`D` / `E` channels) keeping `damage`, with zero damage when it is missing, and `key_channels` become invisible notes (`3x` / `4x`) ([`bmson-document.ts`][bm-bmson-document], [`note-rules.ts`][bm-note-rules]). Unlike beatoraja, Be-Music keeps a mine inside a long note or on a position that already has a note, as LR2 keeps such BMS mines ([§2.6](./format-compat-bms.md#26-mines), [`resolved-notes.ts`][bm-resolved-notes]). Qwilight reads `mine_channels` as traps [V].

### 3.6 `judge_rank`

The spec (L331-347) leaves the window to the player: the default `100` is the player's default window, and the percentage reading is marked non-normative. Its example uses LR2's `#RANK 2` windows. Players split into two readings, so no single value judges the same everywhere:

| Reading of `judge_rank: 100`     | Players                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| NORMAL (`#RANK 2`)               | [Bemuse](https://github.com/bemusic/bemuse/blob/4bf3e7d98a44841b323741cc403ecb7b41618ade/packages/bemuse-notechart/src/loader/BmsonNotechartLoader.ts#L35-L43) (display-only window), [Qwilight](https://github.com/thenist/Qwilight/blob/6d3887f6688a1f97c1fbe2bffd28feaedc9920b6/Qwilight/Compiler/BMSONCompiler.cs#L375), [raindrop](https://github.com/zardoru/raindrop/blob/662dd11f05994f6f36493575b04ecb64b04dcd7b/src/NoteLoaderBMSON.cpp#L200-L215), Be-Music's `lr2` / `____` rulesets |
| EASY (`#RANK 3`; NORMAL is `75`) | [beatoraja](https://github.com/exch-bms2/beatoraja/blob/8320241d8481e0826c703878c3eba01cd81ca3e4/src/bms/player/beatoraja/play/BMSPlayerRule.java#L57-L66) (the value is the judgerank itself, while `#DEFEXRANK` is scaled so that `100` = NORMAL), LR2oraja, Be-Music's `beatoraja` ruleset                                                                                                                                                                                                    |

Edge values:

- jbms-parser reads `judge_rank` 0–4 as a BMS `#RANK` with a warning, and a negative value as `#RANK 2` [V] ([BMSONDecoder L87-96][j-bmson-rank]). beatoraja's rule turns ≤ 0 into 100.
- Be-Music drops a value ≤ 0 and uses `100`; it has no 0–4 special case ([`bmson.ts`][bm-bmson], [`judge-window.ts`][bm-judge-window]). Under `beatoraja`, a missing `judge_rank` judges as `100`, never as BMS `#RANK 2` ([`definitions.ts`][bm-ruleset]).
- Distributed bmson charts almost always carry the default `100`.
- Converting BMS to bmson, Be-Music writes `#DEFEXRANK` as is and maps `#RANK 0`–`4` to `33` / `67` / `100` / `133` / `167`, and converting back it writes `judge_rank` as `#DEFEXRANK`. Under the `lr2` ruleset the two commands are scaled differently, so a value other than `100` judges differently after either conversion (`#DEFEXRANK 120` is ±21.6 / ±48 / ±120 ms; `judge_rank` 120 is ±19.8 / ±52 / ±112 ms); BmsONE writes `40` / `60` / `80` / `100` / `120` and bms2bmson-python writes nothing. The converter comparison is in [bmson spec — `judge_rank` across players and converters](./bmson-spec.md#judge_rank-across-players-and-converters).

### 3.7 `total`

The spec (L366-386): default `100`, relative to the player's default gauge rate; it must be ≥ 0, `0` means the gauge never rises, a negative value is taken as its absolute value.

| Player    | Behaviour                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| beatoraja | `total / 100 ×` its default TOTAL; ≤ 0 means 100 % [V] ([BMSONDecoder L98-103][j-bmson-total], [BMSPlayerRule L77-80][b-rule])                                                                                                                                                                                                                                                                                |
| Others    | Qwilight derives its own HP rate from `total`; raindrop multiplies its default formula; Bemuse has no gauge [V]                                                                                                                                                                                                                                                                                               |
| Be-Music  | The parser takes the absolute value and keeps `0` ([`bmson.ts`][bm-bmson]). Every ruleset reads `total` as a percentage of its own default TOTAL (`lr2`: the LR2 curve, `beatoraja`: beatoraja's formula; the `____` gauge does not use TOTAL), and ≤ 0 means the default, so `0` does not freeze the gauge as the spec says; this follows beatoraja ([`definitions.ts`][bm-ruleset] `resolveEffectiveTotal`) |

### 3.8 `bpm_events` and `stop_events`

| Topic            | De jure                                                     | beatoraja                                                                                                                                                                                          | Be-Music                                                                                                                                                    |
| ---------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init_bpm`       | Required; missing is a fatal error (L326-329).              | Not validated [V]                                                                                                                                                                                  | Missing, zero or negative is a parse error ([`bmson-document.ts`][bm-bmson-document])                                                                       |
| `bpm_events`     | The last event on a pulse wins (L490-496).                  | ≤ 0 is skipped with a warning [V] ([BMSONDecoder L146-176][j-bmson-events])                                                                                                                        | ≤ 0 is skipped; the later event on a pulse wins                                                                                                             |
| `stop_events`    | `duration` in pulses; stops on one pulse add up (L498-503). | Pulses; a negative duration is skipped [V]                                                                                                                                                         | Pulses, converted to `#STOP` units (`× 48 / resolution`); stops on one pulse add up; ≤ 0 is skipped                                                         |
| Order on a pulse | Notes and BGA, then BPM, then STOP (L505-542).              | Scroll, BPM, then stop [V]                                                                                                                                                                         | A BPM change applies before a STOP at the same pulse; a note on the STOP's pulse is hit when the stop begins                                                |
| `scroll_events`  | Not in the spec.                                            | beatoraja extension: `{ y, rate }`, set on the timeline at `y`; timelines created later for other objects start at 1.0 [V] ([BMSONDecoder L146-176][j-bmson-events], [L588-606][j-bmson-timeline]) | Read as `#SCROLL` (channel `SC`, one key per distinct rate); a rate holds until the next scroll event, as in BMS ([`bmson-document.ts`][bm-bmson-document]) |
| Event count      | Unlimited.                                                  | Unlimited: each event sets its own timeline [V]                                                                                                                                                    | Unlimited: one IR key per distinct BPM / STOP value, base-62 keys past 1,295 ([`bmson-keys.ts`][bm-bmson-keys])                                             |

### 3.9 BGA and images

The spec's `bga` (L765-806) has `bga_header`, `bga_events`, `layer_events` and `poor_events`; a duplicated header `id` lets the later one win, and black is not transparent on the layer.

- beatoraja: `bga_events` set the BGA; `layer_events` become event layers keyed by a condition, and only MISS layers are drawn; `poor_events` become the MISS layer [V] ([BMSONDecoder L369-438][j-bmson-bga], [BGAProcessor][b-bga]).
- Be-Music: ordinary `bga_events` → base, `layer_events` → layer and `poor_events` → POOR, timed by `y` ([`bga.ts`][bm-bga]). Both browser and terminal load bmson header filenames. Sequence definitions and conditional metadata survive round trips. The deterministic engine drives judgment-based sequences across terminal ANSI/Kitty and all four browser skin families under [ADR 0022](./adr/0022-bmson-bga-events.md); NONSTOP remaps sequence resources per stage, scales animation/movie time with FIT, retains trimmed ALWAYS phase and expires state at stage boundaries.
- File lookup for BGA, image and sound names follows [§2.19](./format-compat-bms.md#219-asset-file-lookup).
- Images: both read `back_image`, `eyecatch_image`, `banner_image` and `preview_music`. Be-Music maps them to `#BACKBMP`, `#STAGEFILE` (when none is set) and `#BANNER` equivalents, and additionally preserves `title_image` for the browser pre-play screen, with text fallback for missing assets.
- Text: beatoraja appends `chart_name` to the subtitle as `[name]` and joins `subartists` with commas [V]; Be-Music keeps both as structured fields ([bmson spec](./bmson-spec.md#fields-read-by-implementation-parser)).

### Chart load warnings

Be-Music reports nonfatal chart load warnings on the browser's Music Select and decide screens and on the terminal player's standard error stream. The warnings cover legacy bmson conversion, unknown or malformed bmson mode hints, stacked bmson notes dropped for a length mismatch, undefined chart references and rejected chart options. References in a BMS chart with control flow are checked after the branch is chosen.

Tools can read parser warnings from `BeMusicJSON.diagnostics` and the combined list from `resolveChart(chart).diagnostics`. Each warning provides a code, a message and a field path or measure, fraction and channel. Diagnostics have no effect on judging, playback or fingerprints.

[bm-bmson-document]: ../packages/chart-parser/src/core/bmson-document.ts
[bm-bmson]: ../packages/chart-parser/src/core/bmson.ts
[bm-bmson-keys]: ../packages/chart-parser/src/core/bmson-keys.ts
[bm-timelines]: ../packages/chart-model/src/timelines.ts
[bm-sample-triggers]: ../packages/chart-model/src/sample-triggers.ts
[bm-resolved-notes]: ../packages/chart-model/src/resolved-notes.ts
[bm-note-rules]: ../packages/chart-model/src/note-rules.ts
[bm-judge-window]: ../packages/player-engine/src/core/judge-window.ts
[bm-ruleset]: ../packages/player-engine/src/ruleset/definitions.ts
[bm-bga]: ../packages/chart-model/src/bga.ts
[j-mode-enum]: https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/Mode.java#L10-L17
[j-bmson-model]: https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/bmson/Bmson.java
[j-bmson-rank]: https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/BMSONDecoder.java#L87-L96
[j-bmson-total]: https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/BMSONDecoder.java#L98-L103
[j-bmson-mode]: https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/BMSONDecoder.java#L107-L113
[j-bmson-x]: https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/BMSONDecoder.java#L117-L127
[j-bmson-res]: https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/BMSONDecoder.java#L139
[j-bmson-events]: https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/BMSONDecoder.java#L146-L176
[j-bmson-ln]: https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/BMSONDecoder.java#L213-L296
[j-bmson-mine]: https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/BMSONDecoder.java#L317-L366
[j-bmson-bga]: https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/BMSONDecoder.java#L369-L438
[j-bmson-lines]: https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/BMSONDecoder.java#L456-L458
[j-bmson-timeline]: https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/BMSONDecoder.java#L588-L606
[j-bmson-lines-draw]: https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/BMSONDecoder.java#L177-L185
[b-rule]: https://github.com/exch-bms2/beatoraja/blob/8320241d8481e0826c703878c3eba01cd81ca3e4/src/bms/player/beatoraja/play/BMSPlayerRule.java#L57-L88
[b-bga]: https://github.com/exch-bms2/beatoraja/blob/8320241d8481e0826c703878c3eba01cd81ca3e4/src/bms/player/beatoraja/play/bga/BGAProcessor.java#L135-L209
