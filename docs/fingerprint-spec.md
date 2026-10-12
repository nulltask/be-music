[Japanese version](./fingerprint-spec.ja.md)

# Be-Music Fingerprint specification

> Status: implemented in `@be-music/chart` (section 6). Recording the play fingerprint in play logs is still planned. Algorithm version: `bmfp1`.

The Be-Music Fingerprint identifies a chart by **what the player plays and sees in the lanes**, not by the bytes of the file. Two chart files get the same fingerprint when they play the same, even if:

- one has no BGA, a different BGM, other keysounds, or other metadata;
- one was saved by editor A and re-saved by editor B (different line order, `#WAV` numbering, measure-position resolution, decimal precision);
- one is BMS and the other bmson.

Anything that changes judging, the gauge, timing, or how the notes look on their way down changes the fingerprint.

## 1. Two fingerprints

| Name                  | Input                                                         | Use                                                                        |
| --------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **Chart fingerprint** | The chart with its `#RANDOM` / `#SWITCH` structure unresolved | Identifying a chart file (song lists, tables, score databases)             |
| **Play fingerprint**  | The chart after every control-flow branch is chosen           | Identifying what one play actually played (play logs, replay verification) |

Both use the same canonical document (section 4). A chart without control flow has an empty `random` list, so its chart fingerprint and play fingerprint are the same.

Lane options such as MIRROR / RANDOM / DP flip are play options, not part of the chart, and are in neither fingerprint. A play log records them separately.

## 2. What is included

| Included (affects play or what the lanes show)                                        | Excluded                                                                                               |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Lane mode (5 / 7 / 9 / 10 / 14 / 24 / 48 KEY)                                         | Title, subtitle, artist, genre, `#PLAYLEVEL`, `#DIFFICULTY`, `#COMMENT`, `#TEXT`, `#PREVIEW`           |
| Visible notes: position and lane                                                      | The sample a note plays (keysound assignment)                                                          |
| Long notes: start, end, and mode (LN / CN / HCN)                                      | BGM (channel `01`), `#WAV`, `#EXWAV`, `#VOLWAV`, `#WAVCMD`, volume-change channels                     |
| Mines: position, lane, and damage                                                     | BGA, layers, POOR image, `#BMP`, `#BGA`, `#SWBGA`, `#ARGB`, `#STAGEFILE`, `#BANNER`, `#BACKBMP`, video |
| Bar lines (measure lengths)                                                           | Invisible notes (`3x` / `4x`; they are not judged)                                                     |
| Initial BPM, BPM changes, STOP, `#STP`                                                | `#LNTYPE`, `#LNOBJ`, and `5x` / `6x` as notations (the resolved long notes are included instead)       |
| SCROLL (`SC`) and SPEED (`SP`)                                                        | `#OPTION`, `#CHANGEOPTION`, `#MIDIFILE`, `#PATH_WAV`, `#MATERIALS`, `#BASE`, `#CHARSET`                |
| `#BASEBPM` (sets the reference BPM for hi-speed, so it changes how fast notes look)   | Anything a player does not draw in or over the lanes                                                   |
| Judge rank: `#RANK`, `#DEFEXRANK`, bmson `judge_rank`, and `#EXRANKxx` changes (`A0`) |                                                                                                        |
| `#TOTAL` / bmson `total`                                                              |                                                                                                        |

## 3. Normalization

The fingerprint is defined over **be-music's interpretation** of the chart: the parser decides which events exist (duplicate objects, `#LNOBJ`, `#LNTYPE`, bmson `x` to lane mapping, lane-mode detection), and this section only describes how the result is turned into a canonical form.

### 3.1 Exact numbers

Every number is handled as an exact rational. Decimal text from the file (`#xxx02`, `#BPM`, `#BPMxx`, `#STP`, `#TOTAL`, bmson numbers) is converted to a rational from its digits, never through a binary float. When only an IEEE 754 double is available, its shortest round-trip decimal text is used; the snapping below absorbs the difference.

### 3.2 Snapping

Editors print the same intended value with different precision (`0.333333`, `0.3333`), and bmson stores positions on an integer pulse grid. Values are therefore snapped to the **simplest rational** within a tolerance: the rational with the smallest denominator in the closed interval, found by walking the Stern–Brocot tree. Only integers can share the smallest denominator; when the interval holds more than one integer (a value above 10⁶, for example), the integer nearest the centre of the interval (the value itself) is taken, the one nearer zero on a tie. The snapped value is therefore unique.

| What                                                                                                                   | Interval                                                                        | Why                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Measure length, in 4/4 measures                                                                                        | `[x − ε, x + ε]`, `ε = 1/1920`                                                  | Half a pulse of bmson resolution 240 (one measure is 960 pulses), so a chart converted through bmson at resolution 240 or finer snaps back |
| Position inside a measure, as a fraction of that measure                                                               | `[x − ε, x + ε]`, `ε = 1/1920`                                                  | Same                                                                                                                                       |
| Values: BPM, `#BASEBPM`, STOP length, `#STP` length, SCROLL, SPEED, `#EXRANK` value, mine damage, `#TOTAL`, judge rank | `[x(1 − 10⁻⁶), x(1 + 10⁻⁶)]` (ordered by value for negative `x`; `0` stays `0`) | Absorbs float printing noise such as `149.99999999`                                                                                        |

Examples:

| Input                         | Snapped                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------- |
| `0.333333`, `0.3333`, `0.333` | `1/3`                                                                           |
| bmson 137/960 measure         | `1/7`                                                                           |
| `0.3`                         | `3/10`                                                                          |
| `0.75`, `0.750000`            | `3/4`                                                                           |
| `0.33`                        | `29/88` (too far from `1/3`; editors that keep only two digits are not covered) |

Consequences:

- Charts that differ only by less than the tolerance (about 1 ms per measure at 120 BPM) share a fingerprint.
- Subdivisions finer than 1/1920 of a measure can merge. No real chart is known to use them.
- Snapping is applied per measure and per value, and positions are kept as (measure, fraction) rather than summed into absolute beats, so precision differences never accumulate over a long chart.
- A measure length of at most ε is kept exact, because its interval would reach `0`, which is not a measure length. Gimmick charts do use such tiny measures.

### 3.3 Coordinates

- **Time** is a pair: the measure index and the snapped position inside it (`0 ≤ p < 1`). A position of exactly `1` moves to position `0` of the next measure.
- For bmson, measures come from `lines`: measure `n` spans `lines[n].y` to `lines[n+1].y`, and its length is that span divided by `4 × resolution`. Without `lines`, and past the last line, measures are 4 beats long.
- **Lanes** are the playable channels be-music assigns after its own mapping (`11`–`19`, `21`–`29`, and the extended 24 / 48 KEY channels), together with the lane mode. A BMS `16` and the bmson `x` that be-music maps to `16` are the same lane.

### 3.4 Events

- **Notes**: every visible playable object, as many times as be-music has it (a doubled object line gives two notes). Long notes carry their end (measure, position) and their mode, resolved per note: bmson per-note `t`, else bmson `info.ln_type`, else `#LNMODE`, else `1` (LN). be-music resolves a long note's end as a beat (`#LNOBJ`, `5x` / `6x` with `#LNTYPE`, bmson `l`); that beat is mapped back to (measure, position) through the measure lengths and snapped like any position. An end that does not come after the start leaves a normal note.
- **Mines**: lane, position, and damage. Damage is bmson `damage` when present; otherwise the BMS object value read in base 36; `4` when that value is `00` or not a valid base-36 pair.
- **BPM**: the initial BPM is a header value. Channel `03`, channel `08` with `#BPMxx`, and bmson `bpm_events` all become the same `bpm` event.
- **STOP**: in beats. BMS `#STOPxx` is in 1/192 of a 4/4 measure (beats = value / 48); bmson `duration` is in pulses (beats = duration / resolution). STOPs at one time add up, so all of them are kept, as are several `#STP`s at one time.
- **`#STP`**: kept as its own `stp` event with the length in milliseconds, at the measure and position its `xxx.yyy` names.
- **SCROLL / SPEED / EXRANK**: `scroll`, `speed`, and `exrank` events with their values. As in be-music, `exrank` events come only from BMS charts and only for a positive `#EXRANKxx` value.

Events that change nothing are dropped:

- a BPM change to the BPM already in effect, a STOP or `#STP` of length `0`;
- a SCROLL or SPEED change to the value already in effect (both start at `1`);
- an `#EXRANK` change to the value of the previous `#EXRANK` change;
- when several BPM, SCROLL, SPEED, or `#EXRANK` changes share a time, only the one be-music applies is kept: the last in be-music's event order, which sorts events of one time by channel and then by object value (so `08` wins over `03`, and `#BPM02` over `#BPM01` on one channel).

The first three rules depend on the state in effect, so they are applied only when the document has no `random` nodes (section 3.6): a branch could change that state in between.

Bar lines: the measure count is the last measure that holds an included event, plus one, and only lengths that are not `1` are listed. Measures after the last included event are not part of the fingerprint.

### 3.5 Header values and defaults

| Field      | Rule                                                                                                                                                                                                                                     |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `laneMode` | be-music's resolved lane mode, e.g. `"7"`, `"14"`, `"9"`, `"24"`                                                                                                                                                                         |
| `bpm`      | Initial BPM                                                                                                                                                                                                                              |
| `baseBpm`  | `#BASEBPM`, or `null`                                                                                                                                                                                                                    |
| `judge`    | `{"exRank": v}` from `#DEFEXRANK` (BMS) or `judge_rank` (bmson, `100` when absent); otherwise `{"rank": n}` from `#RANK`, `2` (NORMAL) when absent. A `#DEFEXRANK` or `judge_rank` that is not positive counts as absent, as in be-music |
| `total`    | `{"bms": v}` from `#TOTAL`, `{"bmson": v}` from bmson `total`, or `null` when the chart does not set it                                                                                                                                  |

`#RANK` and the `exRank` axis stay apart because the rulesets read them through different tables, so `#RANK 2` and `#DEFEXRANK 100` are not interchangeable in general. BMS `#TOTAL` and bmson `total` stay apart because bmson `total` is a percentage of a computed default. An absent `#TOTAL` stays `null` instead of being replaced by one ruleset's default.

### 3.6 Control flow (`#RANDOM` / `#SWITCH`)

For the play fingerprint, control flow is resolved with the values the play used, and the document has an empty `random` list.

For the chart fingerprint, the parts of the chart outside any control flow go into the top-level lists as usual, and each control-flow block becomes a node in `random`:

- `{"random": max, "branches": [...]}` for `#RANDOM`, `{"switch": max, "branches": [...]}` for `#SWITCH`.
- A block has a branch `{"when": value, ...}` for every value its `#IF` / `#ELSEIF` (or `#CASE`) lines test within `1..max`, and, when some values in `1..max` are tested by none of them, one `{"default": true, ...}` branch that stands for all of those values. The content of each branch is what plays for its value under be-music's rules, so `#ELSE`, `#DEF`, and `#SWITCH` fall-through land in the branches whose values reach them.
- Each branch holds the same lists as the top level (`notes`, `mines`, `timeline`, and nested `random`), normalized the same way except for the state-dependent drops of section 3.4. Its `measures` is `{"lengths": [...]}`: every measure length the branch itself sets, including `1`, without a `count`. When the branch sets header values (`#BPM`, `#BASEBPM`, `#RANK`, `#DEFEXRANK`, `#TOTAL`), they are listed in `"header": {"bpm": v, "baseBpm": v, "rank": v, "defExRank": v, "total": v}` (only the ones it sets).
- Definitions made inside a branch (`#BPMxx`, `#STOPxx`, `#SCROLLxx`, `#SPEEDxx`, `#EXRANKxx`, `#LNOBJ`, `#LNTYPE`, `#LNMODE`) apply to that branch's own objects and its nested branches, on top of the definitions outside it. Long notes are paired within one branch.
- Content of a `#RANDOM` block that is outside every `#IF` plays whatever the outcome, so it goes to the enclosing lists. (A missing `#ENDRANDOM` therefore makes no difference.)
- Sibling `#IF` blocks with the same value under one `#RANDOM` merge into one branch. Branches are sorted by value, with the default branch last. Empty branches are dropped, and a block left with no branch is dropped.
- `#SETRANDOM n`, `#SETSWITCH n`, `#RANDOM 1`, and `#SWITCH 1` have only one possible outcome and are resolved in place.
- Nodes in a `random` list are sorted by their canonical JSON text (section 4).
- `measures.count` at the top level counts the included events of every branch too, and `laneMode` is resolved from the objects of every branch together.
- Content that appears in every branch is not hoisted out. Two charts that differ only in such hoisting get different chart fingerprints but the same play fingerprints.

## 4. Canonical document

```json
{
  "v": "bmfp1",
  "laneMode": "7",
  "bpm": "150",
  "baseBpm": null,
  "judge": { "rank": "2" },
  "total": { "bms": "300" },
  "measures": { "count": "64", "lengths": [["12", "3/4"]] },
  "notes": [
    { "m": "1", "p": "0", "lane": "11" },
    { "m": "1", "p": "1/2", "lane": "16", "end": { "m": "2", "p": "0" }, "ln": "2" }
  ],
  "mines": [{ "m": "3", "p": "1/4", "lane": "13", "damage": "10" }],
  "timeline": [
    { "m": "8", "p": "0", "type": "bpm", "v": "400/3" },
    { "m": "9", "p": "0", "type": "stop", "v": "1" },
    { "m": "16", "p": "1/2", "type": "scroll", "v": "1/2" }
  ],
  "random": []
}
```

- Every number, including counts and indexes, is a string: an integer as `"n"`, any other rational as `"p/q"` in lowest terms with a positive denominator and the sign on the numerator (`"-3/4"`). No floats, exponents, or `+` signs.
- `notes` are sorted by `(m, p, lane)`, then by `end` (a normal note first) and `ln`; `mines` by `(m, p, lane, damage)`; `timeline` by `(m, p, type, v)`; `measures.lengths` by measure. `lane` and `type` compare as strings; numeric fields sort by value, not as text.
- A field with no value is omitted (`end` / `ln` on a normal note), except `baseBpm` and `total`, which are always present and may be `null`.
- The document is serialized with the JSON Canonicalization Scheme ([RFC 8785](https://www.rfc-editor.org/rfc/rfc8785)): object keys sorted, no whitespace, UTF-8.

## 5. Output

```
bmfp1:<lowercase hex SHA-256 of the canonical JSON bytes>
```

The `bmfp1` prefix names the algorithm version. Any change to what is included or how it is normalized bumps it (`bmfp2`), so fingerprints from different versions never compare equal by accident.

## 6. Implementation notes

- `@be-music/chart` implements this specification (`packages/chart/src/fingerprint.ts`):
  - `computeChartFingerprint(json, options?)` / `computePlayFingerprint(json, options?)` return `string` (`bmfp1:…`) synchronously. They hash with a small built-in SHA-256 (`packages/chart/src/sha256.ts`) instead of Web Crypto, whose `crypto.subtle.digest` is async only, so they run in Node and browsers alike and synchronous callers such as the play-log recorder can use them.
  - `createChartFingerprintDocument(json, options?)` / `createPlayFingerprintDocument(json, options?)` build the canonical document synchronously, and `canonicalizeFingerprintDocument(document)` returns its RFC 8785 text.
  - `computePlayFingerprint` takes the chart after `resolveBmsControlFlow` and ignores `json.bms.controlFlow`. `computeChartFingerprint` takes the parser's unresolved output, whose `events` hold only the content outside control flow, and rebuilds the branches from `json.bms.controlFlow`.
  - `options.chartPath` passes the chart's file name to the lane-mode detection, which reads its extension (`.pms` is always 9 KEY).
- The play log is planned to record the play fingerprint.
- The parser stores BMS values as numbers, so the shortest round-trip text of the stored double stands in for the decimal text (section 3.1). Raw strings the parser keeps (`#EXRANKxx`, `#STP`) are read from their digits.
- Tests must cover, at least: the same chart with lines reordered, `#WAV` renumbered, a different measure resolution, and different decimal precision; a BMS chart against its bmson conversion; BGA / BGM / keysound changes keeping the fingerprint; and each included item changing it.
