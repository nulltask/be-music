[Japanese version](./format-compat-bms.ja.md)

# BMS compatibility

[Comparison method and evidence labels](./format-compat.md)

<details>
<summary>Table of contents</summary>

- [2. BMS](#2-bms)
  - [2.1 Lines, headers and object data](#21-lines-headers-and-object-data)
  - [2.2 Character encoding](#22-character-encoding)
  - [2.3 Object IDs and `#BASE 62`](#23-object-ids-and-base-62)
  - [2.4 Lane modes and channel layouts](#24-lane-modes-and-channel-layouts)
  - [2.5 Long notes](#25-long-notes)
  - [2.6 Mines](#26-mines)
  - [2.7 Invisible notes (`3x` / `4x`)](#27-invisible-notes-3x--4x)
  - [2.8 BPM](#28-bpm)
  - [2.9 STOP and `#STP`](#29-stop-and-stp)
  - [2.10 SCROLL and SPEED](#210-scroll-and-speed)
  - [2.11 Measure length and `#BASEBPM`](#211-measure-length-and-basebpm)
  - [2.12 Judgment rank](#212-judgment-rank)
  - [2.13 `#TOTAL`](#213-total)
  - [2.14 Control flow](#214-control-flow)
  - [2.15 Audio commands and keysounds](#215-audio-commands-and-keysounds)
  - [2.16 `#OPTION`, `#CHANGEOPTION`, `#PREVIEW`](#216-option-changeoption-preview)
  - [2.17 BGA](#217-bga)
  - [2.18 Note drawing](#218-note-drawing)
  - [2.19 Asset file lookup](#219-asset-file-lookup)
  - [2.20 Nanasi Groove 2 `.n2s` containers](#220-nanasi-groove-2-n2s-containers)

</details>

## 2. BMS

Compare how LR2, beatoraja, and Be-Music read and play BMS charts.

### 2.1 Lines, headers and object data

**Command case**

- **De jure** Case-insensitive (BM98). cmds notes that some players are case-sensitive in places (for example `#LNOBJ` values).
- **LR2** The whole line is upper-cased before parsing, IDs included [R] ([OpenLR2 L25950][olr2-upper])
- **beatoraja** Commands and channels are case-insensitive [V] ([BMSDecoder L487-500][j-reserve])
- **Be-Music** Commands and channels are case-insensitive; IDs follow [§2.3](#23-object-ids-and-base-62) ([`parser.ts`][bm-parser])

**Leading whitespace**

- **De jure** Undefined. cmds ([`#INDENT-STYLE`][cmds-indent]) tabulates per player.
- **LR2** Tab and space are accepted, U+3000 is not [C]; the line is trimmed before parsing [R]
- **beatoraja** Not stripped: an indented line is ignored [V] ([BMSDecoder L189-194][j-lines])
- **Be-Music** Trimmed, so indented commands are accepted ([`parser.ts`][bm-parser] `parseBMS`)

**Header separator**

- **De jure** One space by convention (cmds).
- **LR2** Most headers are matched with a trailing space (`"#TOTAL "`) [R]
- **beatoraja** The argument starts one character after the command name, whatever that character is [V] ([BMSDecoder L366-375][j-arg])
- **Be-Music** At least one whitespace character is required: `#TITLE:abc` is not a header ([`parser.ts`][bm-parser] `parseHeaderDirectiveLine`)

**Lines not starting with `#`**

- **De jure** Ignored; this is the comment mechanism (BM98). `;` / `//` comments are IIDXv / HDX extensions ([`#COMMENT-SYNTAX`][cmds-comment]).
- **LR2** Ignored [R]
- **beatoraja** Ignored, except `%key value` / `@key value`, which are stored as extra values [V] ([BMSDecoder L378-388][j-values])
- **Be-Music** Ignored

**Duplicate header definitions**

- **De jure** Undefined in BM98. cmds ([`#BEHAVIOR-IN-GENERAL-IMPLEMENTATION`][cmds-general]): the line nearest EOF wins, except repeatable commands (`#STP`, `#WAVCMD`, control flow).
- **LR2** Last wins [C]
- **beatoraja** Last wins [V] ([BMSDecoder L282-315][j-dup])
- **Be-Music** Last wins, in file order, also across control flow: a definition inside a taken `#RANDOM` / `#SWITCH` branch beats an earlier top-level one and loses to a later one ([§2.14](#214-control-flow))

**Duplicate object lines (same measure, channel)**

- **De jure** cmds: lines merge, a later non-`00` object overrides an earlier one at the same position, `00` never overwrites; BGM (`01`) lines stack. About half of the players tested did not meet this.
- **LR2** Every object is collected; how LR2 resolves two notes at one position was not determined. cmds reports trouble with duplicated mine lines [C]
- **beatoraja** Playable channels: the later object replaces the earlier one with a warning. `01` stacks. `03` / `08` / `09`: one per position [V] ([Section L353-403][j-section-notes])
- **Be-Music** On normal note channels the later nonzero object replaces the earlier one, including across active control-flow branches. Replaced keysounds are discarded. When a dedicated long note starts at the same position, the surviving tap plays as BGM if its keysound differs. Legacy JSON without line order keeps the previous resolution rule. Mines and invisible objects are not collapsed; BGM stacks ([`resolved-notes.ts`][bm-resolved-notes] `resolveJudgedNotes`). Timing objects (`03` / `08` / `09` / `SC` / `SP`) keep file order on one channel, so the later line wins as in beatoraja (LR2 leaves same-channel duplicates undefined); `08` still beats `03` at one position as in LR2, and a duplicated STOP applies once ([`beats.ts`][bm-beats] `compareEvents`, #133). Branch timing objects are appended after top-level ones.

**Malformed object data**

- **De jure** Undefined (cmds).
- **LR2** Not determined
- **beatoraja** Not determined
- **Be-Music** The data ends at the first whitespace; characters outside the ID alphabet are skipped without taking a slot; a trailing odd character is dropped ([`event-utils.ts`][bm-event-utils] `collectNonZeroObjectTokens`)

**Measure numbers**

- **De jure** `000`–`999` (BM98).
- **LR2** Notes at the very start of `#000` make LR2 insert an empty measure first [C]
- **beatoraja** No special handling found
- **Be-Music** `000`–`999`, no special handling

### 2.2 Character encoding

- **De jure** Undefined. cmds ([`#CHARSET`][cmds-charset]): most files are Shift_JIS and only ASCII is safe; `#CHARSET` was a ruv-it! command, obsolete since 2.0b5p2.
- **LR2** Shift_JIS only; ISO-2022-JP and EUC-KR files break [C].
- **beatoraja** BOM first, then a round-trip probe of the first 64 KiB in the order EUC-KR, MS932, UTF-8, UTF-16, UTF-32; fallback MS932. `#CHARSET` is not read [V] ([BMSDecoder L535-654][j-charset]).
- **Bemuse** `bemuse-chardet` (UTF-8, UTF-16, Shift_JIS, EUC-KR), overridable by file name (`.sjis.`, `.euc_kr.`, `.utf8.`) [V].
- **Be-Music** BOM, then a `#CHARSET` declaration, then ASCII → UTF-8, then strict UTF-8, then Korean EUC-KR (every non-ASCII byte pairs up as KS X 1001, as in beatoraja's probe, and the text is at least 90 % Hangul syllables), then a score over Shift_JIS / UTF-8 / EUC-JP / Latin-1 ([`bms-text-decode.ts`][bm-decode], [`bms-charset.ts`][bm-charset]; see [BMS spec — Character Encoding](./bms-spec.md#character-encoding)). `#CHARSET EUC-KR` / `CP949` is honoured. The Hangul share keeps Shift_JIS half-width katakana, whose bytes also fit KS X 1001, from reading as Korean, which beatoraja does not guard against.

### 2.3 Object IDs and `#BASE 62`

| Topic       | De jure                                                                   | LR2                                                           | beatoraja                                                                                                                                                               | Be-Music                                                                                                                                                                                                                                                                                                       |
| ----------- | ------------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ID alphabet | BM98: hexadecimal `01`–`FF`. cmds: later base 36. No rule on letter case. | Base 36, case folded by the upper-cased line [R]              | Base 36, case-insensitive [V] ([ChartDecoder L93-149][j-chart])                                                                                                         | Base 36; lower case folds to upper case ([`event-utils.ts`][bm-event-utils])                                                                                                                                                                                                                                   |
| `#BASE 62`  | Undefined (not in cmds or the wiki).                                      | Not in LR2 beta3 100201 [R] (OpenLR2's `main` branch adds it) | Read in a separate pass over the whole file, ignoring `#IF`, so its position does not matter; anything but 36 / 62 falls back to 36 [V] ([BMSDecoder L126-162][j-base]) | Pre-scanned over the whole file, ignoring control flow, so its position does not matter; the last `#BASE 36` / `#BASE 62` line wins and other values are ignored, as in beatoraja ([`parser.ts`][bm-parser] `detectBMSBase`). Under base 62, IDs are case-sensitive ([BMS spec — `#BASE`](./bms-spec.md#base)) |

### 2.4 Lane modes and channel layouts

| Topic                                   | De jure                                                                                                                                                                                  | LR2                                                                                                          | beatoraja                                                                                                                                                                                    | Be-Music                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `#PLAYER`                               | BM98: 1 single, 2 two players, 3 double. cmds ([`#PLAYER`][cmds-player]): 4 battle (BM98 only); default 1.                                                                               | Ignored; the mode is inferred from the channels [C]                                                          | Only 1 or 2 accepted, used for consistency warnings, never for the mode [V] ([BMSDecoder L664-677][j-player])                                                                                | Kept as metadata. `#PLAYER 3` with channel `17` and no That-Which-Must-Not-Be-Named 2P side selects 9 KEY; otherwise unused for the mode                                                                                                                                                                                                       |
| File extension                          | BM98 names `.bms`. cmds ([`#OUTLINE`][cmds-outline]): `.bme` / `.bml` are for backward compatibility; `.pms` is needed to tell 9-key from double play; strict BML means `#LNOBJ` charts. | `.pms` selects 9-key [R] ([OpenLR2 L25923-25925][olr2-pms])                                                  | `.pms` forces POPN 9K [V] ([BMSDecoder L169][j-mode])                                                                                                                                        | `.pms` forces 9 KEY. `.bme` / `.bml` have no special meaning: a `.bme` chart without 6th / 7th key columns is 5 / 10 KEY, as in beatoraja                                                                                                                                                                                                      |
| Mode detection                          | Undefined.                                                                                                                                                                               | From the channels used [C]                                                                                   | Starts at 5K; data on lane offset 8 / 9 of any note family (visible, invisible, LN, mine) upgrades to 7K / 14K; any 2P family upgrades to 10K / 14K [V] ([Section L175-202][j-section-mode]) | One shared rule, `resolveChartPlayVariant` ([`chart/src/play-variant.ts`][bm-play-variant]), run on the chart after `#RANDOM`. Only visible lanes (`1x` / `2x`) and `#LNTYPE` lanes (`5x` / `6x`) count; mines and invisible notes never decide the mode. Order: [BMS spec — Player-Specific Behavior](./bms-spec.md#player-specific-behavior) |
| PMS layouts                             | cmds ([`#PMS`][cmds-pms]): standard 9-key is `11`–`15` + `22`–`25`; the BME-type layout is `11`–`15`, `18`, `19`, `16`, `17`.                                                            | Both, the BME type since beta3 090916 [C]                                                                    | `11`–`15` + `22`–`25` in `.pms` files [V] ([Section L323-351][j-section-lanes])                                                                                                              | Both, detected from the channels even without `.pms` (PMS-STD / PMS-COMPAT)                                                                                                                                                                                                                                                                    |
| FREE ZONE (`17` / `27`)                 | BM98 lists channel 17 without describing it. cmds ([`#FREE-ZONE`][cmds-freezone]): one quarter-note zone counted as one note; only BM98-era players support it.                          | `17` is a 9-key button, not a FREE ZONE [C]                                                                  | Dropped [V] ([Section L255-257][j-section-lanes])                                                                                                                                            | FREE ZONE in the That-Which-Must-Not-Be-Named families: drawn on the scratch lane with a 1-beat tail, not judged, not counted ([`resolved-notes.ts`][bm-resolved-notes]). An ordinary lane under 9 KEY and 24 / 48 KEY                                                                                                                         |
| Extended channels `1A`–`1Z` / `2A`–`2Z` | cmds ([`#CHANNEL-MAPPING-TABLE`][cmds-channels]): visible extended channels, `1A`–`1F` from MGQ, `1G`–`1Z` from pomu. No wheel channel anywhere.                                         | Not supported: the loader needs a digit as the second channel character [R] ([OpenLR2 L25970][olr2-channel]) | Ignored in BMS; a BMS chart can never become 24K [V] ([Section L323-351][j-section-lanes])                                                                                                   | `1A`–`1O` / `2A`–`2O` are keys 10–24 of the 24 KEY / 48 KEY modes; one such channel selects those modes ([player spec — lane mode](./player-spec.md#lane-mode-and-input))                                                                                                                                                                      |
| 24 / 48 KEY wheel                       | Undefined.                                                                                                                                                                               | —                                                                                                            | Only through bmson `keyboard-24k` (`x` 25 / 26); the wheel lanes are judged like keys and are fixed under RANDOM / MIRROR [V] (see [§3.2](./format-compat-bmson.md#32-mode_hint-and-x))      | `1P` / `1Q` (`2P` / `2Q`) are the wheel up / down. This is a be-music-only BMS spelling of the bmson wheel lanes; no other BMS player reads it                                                                                                                                                                                                 |

### 2.5 Long notes

| Topic                           | De jure                                                                                                                                                                    | LR2                                                                                                                                   | beatoraja                                                                                                                                                                           | Be-Music                                                                                                                                                                                                                                     |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `#LNTYPE 1` (`5x` / `6x`)       | cmds ([`#LNTYPE-1`][cmds-lntype1]): RDM style, objects alternate start / end; the default since RDM 1.7, so the header may be omitted.                                     | Supported; `#LNTYPE` itself is not parsed, `5x` / `6x` always alternate [R] ([OpenLR2 L26562-26572][olr2-ln])                         | `#LNTYPE` is not parsed; `5x` / `6x` always behave as type 1 [V] ([Section L410-493][j-section-ln])                                                                                 | Type 1 by default ([`chart/src/long-notes.ts`][bm-long-notes] `resolveBMSLongNotes`)                                                                                                                                                         |
| `#LNTYPE 2` (MGQ)               | cmds ([`#LNTYPE-2`][cmds-lntype2]): the LN lasts while consecutive cells are non-`00` and can cross bar lines; obsolete.                                                   | Not supported [C]                                                                                                                     | Not supported [V]                                                                                                                                                                   | Supported. Omission uses Type 1 by default. Hosts can opt in to Type 2 inference for legacy charts.                                                                                                                                          |
| `#LNOBJ`                        | cmds ([`#LNOBJ`][cmds-lnobj]): the marked object ends an LN started by the previous note on the lane; write it in upper case. Priority against `5x` / `6x` is unspecified. | One value; the last definition wins [R] ([OpenLR2 L26295-26297][olr2-headers])                                                        | One value; the last definition wins [V] ([BMSDecoder LNOBJ handler][j-lnobj])                                                                                                       | Only the last declaration in file order, including selected branches, supplies the end ID. Earlier IDs are ordinary objects. At a lane position that also has a `5x` / `6x` LN, the `5x` / `6x` LN wins. The end object never sounds         |
| `#LNOBJ` with no note before it | Undefined.                                                                                                                                                                 | Becomes an ordinary note [R] ([OpenLR2 L26573-26583][olr2-ln])                                                                        | Dropped [V] ([Section L353-403][j-section-notes])                                                                                                                                   | Becomes an ordinary tap note (matches LR2)                                                                                                                                                                                                   |
| `5x` / `6x` LN with no end      | Undefined.                                                                                                                                                                 | Plays as an ordinary note: the start becomes a lane note with no end [R] ([OpenLR2 L26562-26572][olr2-ln], [L2349-2362][olr2-ln-tap]) | The start is deleted with a warning [V] ([BMSDecoder L429-439][j-ln-end])                                                                                                           | Stays as an ordinary tap note (matches LR2)                                                                                                                                                                                                  |
| LN end on a bar line            | Undefined (only MGQ type 2 defines crossing a bar line).                                                                                                                   | No special handling found [R]                                                                                                         | No special handling found                                                                                                                                                           | No special handling: the end is wherever the end object is                                                                                                                                                                                   |
| `#LNMODE`                       | Undefined (not in cmds).                                                                                                                                                   | Not parsed [R]; LR2 plays every LN as an LN (no CN / HCN) [C]                                                                         | 1 LN / 2 CN / 3 HCN for the chart; the player's own LN-mode option applies only when the chart sets none [V] ([BMSDecoder L776-787][j-lnmode], [JudgeManager L233-275][b-judge-ln]) | The ruleset decides ([player spec — Long-note style](./player-judgment.md#long-note-style)): `lr2` plays every LN as LN, `beatoraja` follows `#LNMODE` (LN when absent), `____` plays CN / HCN. Qwilight treats 2 and 3 alike as CN-like [V] |

### 2.6 Mines

| Topic                                | De jure                                                                                                          | LR2                                                                                                                                                                                                                                          | beatoraja                                                                                                               | Be-Music                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Channels and sound                   | cmds ([`#LANDMINE`][cmds-landmine]): nanasi extension on `D1`–`D9` / `E1`–`E9`; `#WAV00` is the explosion sound. | `#WAV00` when defined, otherwise a built-in sound [C] [R] ([OpenLR2 L7437-7456][olr2-mine-hit])                                                                                                                                              | `#WAV00`, or a default sound when it is missing [V] ([PlayerResource L217-229][b-resource])                             | `D`/`E` + lane, the extended `DA`–`DO` / `EA`–`EO` included. `#WAV00` plays on detonation                                                                                                                                                                                                                                                      |
| Damage                               | cmds: the base-36 value **divided by 2**, as gauge percent; `ZZ` fails the stage (nanasi).                       | The base-36 value itself is subtracted from the gauge, no halving [R] ([OpenLR2 L2041-2055][olr2-mine]); Be-Music's [BMS spec](./bms-spec.md#landmine-damage-basis) also cites LR2's changelog and losak's measurements for this reading [C] | The raw base-36 value, no halving [V] ([Section L494-520][j-mine])                                                      | The raw base-36 value as gauge percent. A value that is not two upper-case base-36 characters, or `00`, deals a default `4` % (a Be-Music choice) ([`note-rules.ts`][bm-note-rules])                                                                                                                                                           |
| When it explodes                     | Undefined.                                                                                                       | A press on the judge line or strictly inside the early GREAT window, or a held key at crossing [D] ([Landmines](./player-spec.md#landmines))                                                                                                 | When the key is held as the mine passes [V] ([JudgeManager L244-249][b-judge-mine])                                     | `lr2` uses an early GREAT press or a held key at crossing. `beatoraja` uses a held key at crossing. The AC reference has no mines. Under `____`, Be-Music imports LR2's policy as an extension: an early GREAT press on the ruleset's own window or a held key at crossing, with LR2's POOR/BP count ([Landmines](./player-spec.md#landmines)) |
| Judgement and combo                  | Undefined.                                                                                                       | Gauge damage and one POOR/BP. Combo and EX-SCORE stay the same [D]                                                                                                                                                                           | Gauge only, on every gauge; no judgement, no combo change [V] ([GrooveGauge L63-67][b-gauge])                           | LR2 counts one POOR/BP and keeps combo and EX-SCORE. beatoraja and the Be-Music AC extension apply gauge damage only.                                                                                                                                                                                                                          |
| Mine on a note or inside a long note | Undefined.                                                                                                       | Kept: a mine is one more object on its lane, with no collision check [R] ([OpenLR2 L26585-26589][olr2-mine-load])                                                                                                                            | Dropped with a warning, for BMS and bmson alike [V] ([Section L494-520][j-mine], [BMSONDecoder L317-366][j-bmson-mine]) | Kept, BMS and bmson alike, as in LR2: an author who placed one meant it ([`resolved-notes.ts`][bm-resolved-notes])                                                                                                                                                                                                                             |
| Other players                        | —                                                                                                                | —                                                                                                                                                                                                                                            | —                                                                                                                       | Qwilight ignores the value and judges a hit mine as a miss [V]; Bemuse uses mines only in its previewer [V]; raindrop parses but does not play them [V]                                                                                                                                                                                        |

### 2.7 Invisible notes (`3x` / `4x`)

cmds ([`#BMS`][cmds-bms]) says invisible objects are not displayed, judged or scored.
beatoraja stores them as hidden notes and uses their sound when a key press hits no note [V] ([JudgeManager L460-486][b-judge-hidden]).
Be-Music does the same: an invisible object becomes the lane's fallback keysound once its early window opens, and is never judged or counted ([player spec — Invisible Note](./player-spec.md#invisible-note)). bmson `key_channels` are read as invisible notes too ([§3.5](./format-compat-bmson.md#35-mines-and-hidden-notes)).
Bemuse ignores them [V].

### 2.8 BPM

| Topic                         | De jure                                                                               | LR2                                                                                                                                                                                                                                                                            | beatoraja                                                            | Be-Music                                                                                                                                                                                                                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `#BPM` missing                | BM98: default 130. Other players use 120, 150, 0 … ([`#BPM`][cmds-bpm]).              | Nothing scrolls [C]                                                                                                                                                                                                                                                            | A start BPM of 0 fails the decode [V] ([BMSDecoder L252-281][j-bpm]) | 130 ([`parser.ts`][bm-parser])                                                                                                                                                                                                                                                                     |
| Channel `03`                  | cmds ([`#CHANGING-BPM-BASIC-FORMAT`][cmds-bpm03]): hexadecimal `01`–`FF` = BPM 1–255. | Hexadecimal; only values above 0 apply [R] ([OpenLR2 L26623][olr2-bpm03])                                                                                                                                                                                                      | Hexadecimal [V] ([Section L103-110][j-section-bpm])                  | Hexadecimal; a token that is not two hex digits falls back to a leading-hex parse, so `1G` is BPM 1 and `G1` is ignored ([`chart/src/channels.ts`][bm-channels] `parseBPMFrom03Token`)                                                                                                             |
| Channel `08` + `#BPMxx`       | cmds ([`#BPMXX`][cmds-bpmxx]): real-valued (bemaniaDX). `#EXBPMxx` is a nanasi alias. | Supported; `#EXBPM` is not [C]                                                                                                                                                                                                                                                 | Supported; `#EXBPM` is not [V]                                       | Supported; `#EXBPMxx` is an alias of `#BPMxx` (same slot, file order, written back as `#BPMxx`)                                                                                                                                                                                                    |
| `03` and `08` at one position | Implementation-dependent (cmds).                                                      | `08` wins [C] (exbpm)                                                                                                                                                                                                                                                          | Not determined                                                       | `08` wins ([`timing.ts`][bm-timing] `createTempoPoints`)                                                                                                                                                                                                                                           |
| Zero or negative BPM          | Undefined; cmds lists player differences ([`#BPMXX`][cmds-bpmxx]).                    | Negative `#BPMxx`: timing runs at the absolute value; the first value with `trunc(BPM) < 0` freezes the event pump and mirrors the scroll and the judge clock for good [R] ([scroll][olr2-reverse-draw], [judge][olr2-reverse-judge]). Zero degenerates (the scroll stops) [C] | `#BPM` / `#BPMxx` ≤ 0 is ignored with a warning [V]                  | Negative `#BPMxx` follows LR2's reverse scroll ([§5](./format-compat.md#5-be-music-decisions-in-short), [BMS spec](./bms-spec.md#negative-bpm-bpmxx-via-channel-08-basis)). An undefined `#BPMxx` slot reverses at 1 BPM. Zero and a negative `#BPM` header are ignored ([`timing.ts`][bm-timing]) |

### 2.9 STOP and `#STP`

**`#STOPxx` unit**

- **De jure** cmds ([`#STOPXX`][cmds-stop]): 1/192 of a whole note (a 4/4 measure), not scaled by channel `02`.
- **LR2** Same; the value is read as an integer, so decimals are truncated [R] ([OpenLR2 L26324-26331][olr2-headers])
- **beatoraja** 1/192 of a measure at the BPM in force at that position [V] ([Section L299-318][j-section-stop])
- **Be-Music** Same unit; decimals are kept; the BPM in force at the position, a BPM change at that same position included ([`timing.ts`][bm-timing] `createStopPoints`)

**Negative or zero STOP**

- **De jure** Undefined; cmds lists player differences.
- **LR2** Only values above 0 are stored, so the slot keeps its initial `-1.0` [R] ([OpenLR2 L25773][olr2-stop-slot], [L26324-26331][olr2-headers]): the STOP adds `-1/192` of a measure, whatever its value, and everything after it comes that much earlier [R] ([OpenLR2 L26666-26669][olr2-stop-case]). A zero or negative redefinition leaves an earlier positive value in place, and an undefined reference also reads `-1.0` [R]; cmds reports a short skip [C]
- **beatoraja** The absolute value is used, with a warning [V] ([BMSDecoder L316-334][j-stop])
- **Be-Music** A STOP without a positive `#STOPxx` (zero, negative or undefined) is `-1/192` of a measure at the BPM in force, as in LR2, and takes part in the last-one-wins rule; a later zero or negative `#STOPxx` does not replace a positive one ([`timing.ts`][bm-timing] `collectStopChanges`, [`bms-headers.ts`][bm-bms-headers]). (Qwilight rejects the chart, Bemuse subtracts time [V].)

**Several STOPs at one position**

- **De jure** Undefined for BMS; bmson adds them (L498-503).
- **LR2** The last one wins [R] ([OpenLR2 L26666-26670][olr2-stop-case])
- **beatoraja** One per position; the last wins [V]
- **Be-Music** BMS: the last one wins, as in LR2 and beatoraja ([`timing.ts`][bm-timing] `createStopPoints`); bmson `stop_events` and `#STP` lines add up

**A note at the STOP's position**

- **De jure** cmds: sounds first, then the BPM change, then the stop. bmson (L505-542): the note is hit when the stop begins.
- **LR2** Hit before the stop: the stop is added after the objects at its position [R] ([OpenLR2 L26494-26527][olr2-stop])
- **beatoraja** Hit when the stop begins [V] ([Section L542-562][j-section-time])
- **Be-Music** Hit when the stop begins: a stop delays only what comes strictly after it ([`timing.ts`][bm-timing])

**`#STP xxx.yyy ms`**

- **De jure** cmds ([`#STP`][cmds-stp]): bemaniaDX; repeats add up.
- **LR2** Not supported [C]
- **beatoraja** Not supported [V]
- **Be-Music** Supported; stops at one position add up ([player spec — Execution flow](./player-spec.md#execution-flow))

**Precision of a STOP's length**

- **De jure** Undefined.
- **LR2** Not checked.
- **beatoraja** Each stop is truncated to whole microseconds (a `(long)` cast) [V] ([Section L315][j-section-stop-cast]), so note times drift early on charts with many stops: 0.151 ms on Labyrinth, 0.863 ms on safe_state, 3.36 ms over the 5,704 stops of "the life"
- **Be-Music** Exact (double precision), deliberately: that is the timing the chart's numbers describe, and the drift stays far below any judge window ([`timing.ts`][bm-timing])

### 2.10 SCROLL and SPEED

Neither `#SCROLLxx` (channel `SC`) nor `#SPEEDxx` (channel `SP`) appears in any de jure source; they come from beatoraja and Bemuse.

**LR2**

- **SCROLL** Unsupported [I]
- **SPEED** Unsupported [I]

**beatoraja**

- **SCROLL** A step multiplier per segment; 0 and negative values are accepted [V] ([LaneRenderer L314-321][b-lane])
- **SPEED** Linear in time between objects; before the first object it ramps from 1.0 at time 0 [V] ([LaneRenderer L259-286][b-lane-speed])

**Others**

- **SCROLL** Qwilight and raindrop support SCROLL [V]
- **SPEED** Bemuse supports it as a spacing factor (the model Be-Music follows) and holds the first value before the first object; Qwilight and raindrop do not [V]

**Be-Music**

- **SCROLL** A step multiplier. Notes, mines and bar lines draw as beatoraja's `LaneRenderer` walks them: from the playhead up to the first point past the lane top, so nothing beyond it is drawn, not even notes a later negative value brings back into the lane ([`note-draw-window.ts`][bm-note-draw]). A negative value scrolls notes backwards; in the web player one still ahead can sit below the judgement line and is drawn there, as beatoraja draws it unclipped, while the terminal player moves notes by the absolute distance (no reverse scroll); with `SCROLL 0`, notes stacked in one cell keep their order ([BMS spec — SCROLL/BPM/STOP](./bms-spec.md#scrollbpmstop-compatibility-policy))
- **SPEED** Linear in beat between keyframes; before the first keyframe the speed ramps from 1.0 at beat 0 to that keyframe's value, as beatoraja ramps from 1.0 at time 0 (a keyframe at 0 applies at once); the last value holds. beatoraja interpolates in time and applies the current value to the whole lane, Be-Music interpolates in beats along the lane ([`scroll-distance.ts`][bm-scroll])

### 2.11 Measure length and `#BASEBPM`

Channel `02` (cmds [`#BMS`][cmds-bms]): 1 = 4/4, decimals allowed, the measure only.
LR2 accepts values above 0 for measures up to 4999 [R] ([OpenLR2 L26189-26193][olr2-measure]); beatoraja accepts any finite value above 0 with no upper bound [V] ([Section L87-101][j-section-len]).
Be-Music does the same as beatoraja: any finite value above 0, however small, and the last definition wins ([`event-utils.ts`][bm-event-utils]).

`#BASEBPM` is an LR command whose support may have been removed in LR2 ([`#BASEBPM`][cmds-basebpm]) [C]; beatoraja does not read it [V].
Be-Music uses it only as the reference BPM of the web player's hi-speed fix ([`chart/src/reference-bpm.ts`][bm-reference-bpm] `resolveChartReferenceBPM`), never for timing.

### 2.12 Judgment rank

| Topic                              | De jure                                                                                                                         | LR2                                                                                                                                      | beatoraja                                                                                                    | Be-Music                                                                                                                                                                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `#RANK 0`–`3`                      | BM98: very hard, hard, normal, easy. No default in BM98; cmds says 3 but its own table shows most players (LR2 included) use 2. | PG 8 / 15 / 18 / 21 ms, BAD fixed at 200 ms; default 2 [C] ([hitkey diary 2015-01-19](https://hitkey.nekokan.dyndns.info/diary1501.php)) | Judgerank 25 / 50 / 75 / 100 % of its base windows (PG ±20 ms at 100 %) [V] ([BMSPlayerRule L57-66][b-rule]) | The `lr2` ruleset uses LR2's measured table; `beatoraja` and `____` use their own ([player spec — Judgment width](./player-judgment.md#judgment-width))                                                                                      |
| `#RANK 4` (VERY EASY)              | nanasi extension ([`#RANK-4`][cmds-rank4]).                                                                                     | Not supported; plays as NORMAL [C] (LR2oraja README)                                                                                     | Judgerank 125 [V]                                                                                            | `lr2`: NORMAL. `beatoraja`: 125                                                                                                                                                                                                              |
| Out-of-range or fractional `#RANK` | Undefined.                                                                                                                      | Read as an integer [R]                                                                                                                   | Out of range: NORMAL with a warning [V] ([BMSDecoder L702-715][j-rank])                                      | Truncated to an integer; out of range is NORMAL ([`judge-window.ts`][bm-judge-window])                                                                                                                                                       |
| `#DEFEXRANK n`                     | nanasi; a percentage where 100 = `#RANK 2` ([`#DEFEXRANK`][cmds-defexrank]).                                                    | Not supported [C] [R] (no such command in the reconstruction)                                                                            | `n` × 75 / 100 judgerank (since 0.7.3); values below 1 are refused [V] ([BMSDecoder L716-729][j-defexrank])  | Values above 0 apply in every ruleset. `lr2` scales the `#RANK 2` windows by `n` / 100, the base value the command's own definition names. A deliberate extension over real LR2 ([player spec](./player-judgment.md#bms-conversion-formula)) |
| `#EXRANKxx` + channel `A0`         | nanasi; same unit as `#DEFEXRANK` ([`#EXRANKXX`][cmds-exrank]).                                                                 | Not supported [C]                                                                                                                        | Not supported [V]                                                                                            | Applied mid-play by the `lr2` ruleset only, with `#DEFEXRANK`'s scaling of the `#RANK 2` windows; `beatoraja` and `____` keep static windows ([`definitions.ts`][bm-ruleset])                                                                |
| Other players                      | —                                                                                                                               | —                                                                                                                                        | —                                                                                                            | Bemuse ignores `#RANK` for play; Qwilight maps `#RANK 0`–`4` to its own judge stages and ignores `#DEFEXRANK`; raindrop defaults to EASY when both are missing [V]                                                                           |

### 2.13 `#TOTAL`

The de jure position ([`#TOTAL`][cmds-total]): the gauge rises by `TOTAL / notes` per best judgement; the default when `#TOTAL` is missing is "not prescribed by specification". BM98 used `200 + notes`.

| Player    | `#TOTAL` missing                                                                                                                                                                                                                      | `#TOTAL` ≤ 0        |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| LR2       | cmds says "160?" [C]. LR2oraja uses `160 + (N + clamp(N - 400, 0, 200)) × 0.16` [C] ([LR2oraja BMSPlayerRule L88-89][l-rule]), the same curve as OpenLR2's `LR2_bmsload.cpp` that Be-Music cites; the value is read as an integer [R] | Not determined      |
| beatoraja | `max(260, 7.605 N / (0.01 N + 6.5))`; 24K: `max(300, 7.605 (N + 100) / (0.01 N + 6.5))` [V] ([BMSPlayerRule L68-88][b-rule])                                                                                                          | Same as missing [V] |
| Be-Music  | Each ruleset applies its own default: `lr2` the LR2 curve above, `beatoraja` beatoraja's formula ([`definitions.ts`][bm-ruleset] `resolveEffectiveTotal`)                                                                             | Same as missing     |

The table describes the default. Optional `bmsonTotalMode: 'spec'` implements zero-total no-recovery, including fixed-recovery and course gauges. Damage and starting/carry HP remain unchanged; affected runs are stored unranked. Replay absence always preserves compatibility. See [ADR 0030](./adr/0030-bmson-zero-total.md).

### 2.14 Control flow

| Topic                                        | De jure                                                                                                                                                                           | LR2                                                                       | beatoraja                                                                                                                                                        | Be-Music                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Commands                                     | BM98: `#RANDOM`, `#IF`, `#ENDIF`. Later additions ([`#CONTROL-FLOW`][cmds-control]): `#ELSEIF` (IIDXv), `#ELSE` / `#ENDRANDOM` / `#SWITCH` family (nanasi), `#SETRANDOM` (pomu2). | `#RANDOM`, `#IF`, `#ENDIF` only [R] ([OpenLR2 L25952-25966][olr2-random]) | `#RANDOM`, `#IF`, `#ENDIF`, `#ENDRANDOM`; the rest are silently ignored, so an `#ELSE` body belongs to the preceding `#IF` [V] ([BMSDecoder L197-233][j-random]) | All of them, `#SETSWITCH` included, plus the misspellings `#END IF`, bare `#END` and `#ELSE IF n` ([`control-flow.ts`][bm-control-flow])                                                                                                                                                                          |
| Nesting                                      | Not stated in BM98. cmds: players split into one-level and nestable; nanasi requires `#ENDRANDOM` when nesting.                                                                   | One level: a single random value [R] [C]                                  | Nested `#RANDOM` is a stack; nested `#IF` checks only the innermost one [V]                                                                                      | One shared stack of `#RANDOM` / `#IF` / `#SWITCH` frames; `#IF` reads the innermost random value                                                                                                                                                                                                                  |
| Lines inside `#RANDOM` but outside any `#IF` | Not guaranteed to be read (cmds).                                                                                                                                                 | Dropped [R] [C]                                                           | Read [V]                                                                                                                                                         | Read                                                                                                                                                                                                                                                                                                              |
| `#IF` with no `#RANDOM`                      | Undefined.                                                                                                                                                                        | Discarded [C]                                                             | Warning; the block is read [V]                                                                                                                                   | Never matches, so the block is skipped                                                                                                                                                                                                                                                                            |
| Missing `#ENDIF` / `#ENDRANDOM`              | Undefined; nanasi requires `#ENDRANDOM`.                                                                                                                                          | The skip state lasts to EOF [R]                                           | The skip state lasts to EOF [V]                                                                                                                                  | An unclosed `#IF` outlives `#ENDRANDOM` and keeps gating the following lines to EOF; `#ENDIF` / `#ELSE` act on the innermost open `#IF`                                                                                                                                                                           |
| `#RANDOM 0`, negative or missing             | cmds: IIDXv, HDX and others use 1 when `n` is missing or invalid.                                                                                                                 | Not determined                                                            | `(int)(random × n) + 1`: 0 gives 1, a negative `n` gives values from `n + 2` to 1 [V]                                                                            | 1                                                                                                                                                                                                                                                                                                                 |
| `#IF` value above `n`                        | Undefined.                                                                                                                                                                        | Never matches [R]                                                         | Never matches [V]                                                                                                                                                | Never matches                                                                                                                                                                                                                                                                                                     |
| Definitions inside a branch                  | Undefined.                                                                                                                                                                        | Applied in file order [R]                                                 | Applied in file order [V]                                                                                                                                        | Applied in file order: a header inside a taken branch (`#BPMxx`, `#WAVxx` …) is skipped when a top-level line later in the file defines the same key (the parser marks it `overriddenByLaterHeader`); repeatable headers (`#STP`, `#WAVCMD`, `#OPTION`) add up ([`parser.ts`][bm-parser] `resolveBMSControlFlow`) |
| When the draw happens                        | —                                                                                                                                                                                 | Each load [I]                                                             | Each load [V]                                                                                                                                                    | Each play: the parser keeps every branch and the player draws at play time ([BMS spec — Evaluation rules](./bms-spec.md#evaluation-rules-for-control-constructs))                                                                                                                                                 |

Bemuse handles only `#RANDOM` / `#IF` / `#ENDIF` (it never pops on `#ENDRANDOM`, although its documentation says nesting works); Qwilight is single-level; raindrop nests up to 16 levels and supports `#SETRANDOM` [V].

### 2.15 Audio commands and keysounds

| Topic                     | De jure                                                                                                                                    | LR2                     | beatoraja                                                                                                 | Be-Music                                                                                                                                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `#VOLWAV n`               | BM98: relative volume in percent; cmds: default 100, not recommended.                                                                      | Not supported [C]       | `0 < n < 200` sets `n / 100`; anything else plays at 100 % [V] ([AbstractAudioDriver L355-359][b-volwav]) | Same as beatoraja: `0 < n < 200` is a linear gain `n / 100`; anything else plays at 100 % ([`chart/src/wav-directives.ts`][bm-wav-directives] `volWAVToLinearGain`, [BMS spec — `#VOLWAV`](./bms-spec.md#volwav)) |
| `#WAVCMD`                 | MacBeat, `.mbm` files only ([`#WAVCMD`][cmds-wavcmd]).                                                                                     | Not supported [I]       | Not supported [V]                                                                                         | Kept; pitch, percentage volume and sounding-time limits are applied in browser, Node and offline playback                                                                                                         |
| `#EXWAVxx`                | nanasi ([`#EXWAVXX`][cmds-exwav]). nanasigroove 1.552 shares the slot with `#WAV`, the later line winning, and also reads an `r` rate [D]. | Not supported [C]       | Not supported [V]                                                                                         | Kept; the effective filename and `p`/`v`/`f`/`r` effects are applied in browser, Node and offline playback, and the later of a slot's `#WAV` and `#EXWAV` wins ([ADR 0024](./adr/0024-extended-bms-audio.md))     |
| `#PATH_WAV`               | GDAC2 / BMEV, for test play ([`#PATH-WAV`][cmds-pathwav]).                                                                                 | Not supported [I]       | Not supported [V]                                                                                         | Tried as a directory prefix by the web player, the offline renderer and the song-select preview, and the terminal player                                                                                          |
| `#MIDIFILE`               | BM98: MIDI BGM; not recommended.                                                                                                           | Not supported [C]       | Not supported [V]                                                                                         | Kept, not played                                                                                                                                                                                                  |
| Retriggering one `#WAVxx` | Undefined.                                                                                                                                 | Monophonic per slot [C] | Not determined                                                                                            | BMS: one voice per slot, a retrigger restarts it (LR2-compatible). bmson: slices are polyphonic ([`chart/src/wav-directives.ts`][bm-wav-directives] `usesMonophonicWAVPlayback`)                                  |

### 2.16 `#OPTION`, `#CHANGEOPTION`, `#PREVIEW`

`#OPTION` and `#CHANGEOPTIONxx` (channel `A6`) are nanasi commands with vendor-prefixed values ([`#OPTION`][cmds-option]).
beatoraja does not read them [V]; Be-Music keeps them in the IR and does not apply them, since a chart that forces lane options changes what is played.
`#PREVIEW` has no de jure source; beatoraja [V] and Be-Music both use it for the song-select preview.

### 2.17 BGA

| Topic                                 | De jure                                                                                                                                                                                                   | LR2                                                                                       | beatoraja                                                                                                                                                                                                                                                         | Be-Music                                                                                                                                                                                                                                                                            |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `04` / `07` / `0A`                    | BM98: `04` BGA (256 × 256). `07` layer with black as transparent (BM98k). `0A` layer 2 (nanasi).                                                                                                          | `04` and `07` [C]                                                                         | `04` and `07`; `0A` is ignored [V] ([Section L74-85][j-section-bga])                                                                                                                                                                                              | `04` < `07` < `0A`; black is transparent on both layers ([BMS spec](./bms-spec.md#supported-semantics))                                                                                                                                                                             |
| `06` POOR                             | BM98: the poor bitmap; `#BMP00` is shown on a poor play.                                                                                                                                                  | Supported [C]                                                                             | A MISS layer shown for 500 ms by default [V] ([BGAProcessor L135-209][b-bga])                                                                                                                                                                                     | `06` cues; before the first cue, `#BMP00` is the POOR image unless `#POORBGA` is `2` ([`play-bga.ts`][bm-play-bga])                                                                                                                                                                 |
| Image size and placement              | Undefined; the canvas is 256 × 256 in most players. cmds ([`#BMPXX-ADJUSTMENT`][cmds-bmp-adjust]): an image is usually centered on X and top-aligned on Y; oversize handling is implementation-dependent. | Smaller images are centered on X and top-aligned; larger ones are scaled to 256 × 256 [C] | An image whose long edge is at most 256 is pasted on a 256 × 256 canvas at `x = (256 - w) / 2`, `y = 0`; a larger one is drawn as is over the BGA rect [V] ([BGImageProcessor L46-57][b-bgimage]). The base canvas is black ([BGAProcessor L333-371][b-bga-draw]) | Same as beatoraja: still images up to 256 px keep their pixel size on the 256 × 256 canvas over black (the layer's canvas is transparent); larger images and videos fill the BGA rect; a `#BGAxx` crop lands at its `dx dy` ([`bga-timeline.ts`][bm-web-bga] `resolveBGAImageRect`) |
| `0B`–`0E` opacity                     | nanasi ([`#BMPXX-LAYER`][cmds-bmp-layer]).                                                                                                                                                                | Not supported [I]                                                                         | Ignored [V]                                                                                                                                                                                                                                                       | Browser (Native/Canvas/LR2/beatoraja) and terminal apply independent hex-byte opacity to base/layer/layer2/POOR; NONSTOP stages retain their own histories                                                                                                                          |
| `#BGA`, `#SWBGA`, `#ARGB`, `#POORBGA` | `#BGA`: BM98de, with known incompatibilities ([`#ABOUT-THE-COMPATIBILITY-OF-BGAXX`][cmds-bga-compat]); `#SWBGA` / `#ARGB` / `#POORBGA`: nanasi.                                                           | Not supported [C]                                                                         | Not supported [V]                                                                                                                                                                                                                                                 | Browser and terminal render BGA sub-regions, EXBMP still-image/opaque-video color keys, A1–A4 plane controls and input-bound A5 SWBGA. NONSTOP remaps SWBGA frames and bounds their lifetime to the stage; exact nanasigroove parity remains unverified                             |
| Video                                 | A video file in `#BMPxx` is an LR extension, channel `04` only ([`#BMPXX-VIDEO-FILE-DEFINING-TO-BMP`][cmds-video]). `#VIDEOFILE` is bemaniaDX.                                                            | Video in `#BMPxx` through DirectShow [C]                                                  | Video in `#BMPxx`, chosen by extension (`mp4`, `wmv`, `webm`, `mpg`, …) [V] ([VideoFormat L7-13][b-video])                                                                                                                                                        | Video in `#BMPxx` (`mpeg1video`, `h264`, `mjpeg`; audio ignored). `#VIDEOFILE` is kept but not played                                                                                                                                                                               |

### 2.18 Note drawing

No de jure source says how notes are drawn. LR2's `DrawNotes` (0x406710) is read from the binary [D]: OpenLR2's newer rewrite of it drops the bar-line clamp, the LN dimming and part of the walk's exit, while its older reconstruction matches the binary.

| Topic                            | LR2                                                                                                                                                                                                                    | beatoraja                                                                                                                                      | Be-Music                                                                                                                                                |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Position past the judgement line | Capped at the line (`if (note_y > 0) note_y = 0`) for notes, mines, LN heads and tails [D] (0x40746c-0x40748e) and for bar lines [D] (0x406f18-0x406f34)                                                               | Not clipped; past objects are gone by time (below), and an LN head whose time has passed sits on the line [V] ([LaneRenderer L552][b-lane-ln]) | Charts without SCROLL / SPEED: capped at the line, as in LR2. With SCROLL / SPEED: not clipped, as in beatoraja ([`note-draw-window.ts`][bm-note-draw]) |
| When a note or mine goes         | When it is processed (judged) **and** the playhead has reached its beat and its LN end; nothing else advances the lane's `draw_count` [D] (0x407af0-0x407b4c). An unhit late note sits on the line until judged a miss | When its time has passed, judged or not [V] ([LaneRenderer L546-550][b-lane-note], [L587][b-lane-mine])                                        | As LR2 without SCROLL / SPEED (the miss comes from the selected ruleset's late window); as beatoraja with them                                          |
| A note hit early                 | Keeps scrolling to the line and goes at its beat (the hit only marks it processed) [D] (0x407a9e-0x407ae8)                                                                                                             | Keeps scrolling until its time; the processed image only with `markprocessednote` (off by default) [V] ([LaneRenderer L546-550][b-lane-note])  | Keeps scrolling until its time under either rule set; the web player's `judgedNoteDisplay: 'HIDE'` hides it at once instead                             |
| Auto lanes                       | Gone once the playhead reaches the beat and LN end, judged or not [D] (0x407cd1-0x407d45)                                                                                                                              | By time, as any note                                                                                                                           | As LR2 without SCROLL / SPEED                                                                                                                           |
| Missed or dropped LN             | Drawn at alpha `0x80` until its end has passed [D] (0x407a25, 0x407a8d)                                                                                                                                                | Not dimmed; the body image changes while held [V] ([LaneRenderer L717-724][b-lane-ln-body])                                                    | Drawn at half alpha until it goes, whatever the chart; beatoraja play skins keep their body images instead                                              |
| Bar lines                        | Gone once the playhead has passed (strict `>`), so a STOP that starts on one holds it on the line [D] (0x40703d-0x40705b)                                                                                              | Gone once its time has come, a STOP on it included [V] ([LaneRenderer L357-364][b-lane-bar])                                                   | As LR2 without SCROLL / SPEED; as beatoraja with them                                                                                                   |

### 2.19 Asset file lookup

A chart names its keysounds and images by file, but packs often ship them under another extension (an `.ogg` for a `#WAV` that says `.wav`, a `.png` or `.mp4` for a `#BMP` that says `.bmp` or `.mpg`), and 差分 (alternate difficulty) charts are often shipped in a sub-folder beside the files they use.
No specification fixes how a player searches. cmds ([`#WAVXX-ALTERNATIVE-SEARCH`][cmds-wav-alt]) says only that the name as written comes first, then same-named files of other types in an order each player picks; the point is that a pack can swap WAV for OGG without changing the chart's MD5.

**Folders searched**

- **De jure** Undefined. cmds notes that LR2 looks in other directories when a relative path is not found.
- **LR2** The chart's folder, then its parent (`..\`) with the same rules [R] ([LR2f.cpp L14607-L14726][olr2-find-alt])
- **beatoraja** The chart's folder only; a `..\` in the name itself works [V] ([SongResources L107-L108][b-song-resources])
- **Be-Music** As LR2: the chart's folder (and the top of what was dropped), then its parent with the same rules, every extension in the chart's folder first. A 差分 chart in a sub-folder finds the files beside its parent ([`collection.ts`][bm-collection] `resolveChartAsset`, [`sample-path.ts`][bm-sample-path] `resolveSamplePath`)

**Keysounds (`#WAV`, bmson sound names)**

- **De jure** cmds: the name as written first, then same-named files of other types ([`#WAVXX-ALTERNATIVE-SEARCH`][cmds-wav-alt]). bmson: an extension may be omitted, and a named file that is missing or unplayable is treated as if it had none (L576-L581).
- **LR2** As written, `.ogg`, `.wav`; in the parent as written, `.wav`, `.ogg`. The last three characters are replaced, so the name is assumed to carry a three-letter extension [R] ([LR2f.cpp L14676-L14726][olr2-find-wav])
- **beatoraja** As written, then `.wav`, `.flac`, `.ogg`, `.mp3` (the written extension skipped); a file that fails to decode moves on to the next [V] ([AudioDriver L207-L229][b-audio-ext], [AbstractAudioDriver L691-L750][b-audio-load])
- **Be-Music** Web player: the authored filename first, then `.opus`, `.ogg`, `.mp3`, `.wav`, `.m4a` without repeating the authored extension. Missing or undecodable candidates fall through. All candidates in the chart folder precede those in its parent ([`collection.ts`][bm-collection] `resolveChartAudioAsset`). Terminal player and offline renderer, reading local files: as written first, then by the written extension, e.g. `.wav` → `.mp3` → `.ogg` → `.opus` → `.m4a` ([`sample-path.ts`][bm-sample-path])

**Images in `#BMP`**

- **De jure** cmds: LR2 also searches PNG and JPG with the same base name ([`#BMPXX-IMAGE-FILE-FORMATS`][cmds-bmp-image]).
- **LR2** As written, `.png`, `.jpg`, `.bmp`, then the same in the parent [R] ([LR2f.cpp L14607-L14673][olr2-find-image])
- **beatoraja** The written name is not tried first: `.jpg`, `.jpeg`, `.gif`, `.bmp`, `.png`, `.tga`, first found wins. A missing image is searched as a video first, then as an image [V] ([BGAProcessor L135-L192][b-bga-lookup])
- **Be-Music** As written first, as in LR2; then `.webp`, `.png`, `.jpg`, `.jpeg`, `.gif`, `.bmp` without repeating the written extension, an order that is a Be-Music policy (`.webp` first for packs re-encoded to save space). The same lookup serves `#STAGEFILE`, `#BANNER` and `#BACKBMP`. Never a video ([`collection.ts`][bm-collection] `resolveChartBGAAsset`)

**Videos in `#BMP`**

- **De jure** cmds lists the containers each player plays ([`#BMPXX-VIDEO-FILE-DEFINING-TO-BMP`][cmds-video]); nothing on substitution.
- **LR2** No other video extension is tried; a missing video is searched as `.png` / `.jpg` / `.bmp` [R] ([LR2f.cpp L14607-L14673][olr2-find-image])
- **beatoraja** The written name is not tried first: `.mp4`, `.m4v`, `.wmv`, `.webm`, `.mpg`, `.mpeg`, `.m1v`, `.m2v`, `.avi`, first found wins; a missing video falls back to the images [V] ([BGAProcessor L135-L192][b-bga-lookup], [VideoFormat L7-L13][b-video])
- **Be-Music** As written, then `.mp4`, `.webm`, `.m4v`, `.mov`, `.mpg`, `.mpeg`, `.wmv`, `.avi`, `.mkv` (browser-native containers first); then, when no video is found in the chart's folder or its parent, the same name as a still image (`.webp`, `.png`, `.jpg`, `.jpeg`, `.gif`, `.bmp`) ([`collection.ts`][bm-collection] `resolveChartBGAAsset`)

**`#STAGEFILE`, `#BANNER`, `#BACKBMP`**

- **De jure** Undefined.
- **LR2** The same search as `#BMP` images [R] ([Main.cpp L752-L773][olr2-header-images])
- **beatoraja** The name as written only [V] ([BMSResource L72-L87][b-bms-resource], [BarManager L712-L725][b-bar-banner])
- **Be-Music** The same search as `#BMP` images

**A name without an extension**

- **De jure** bmson: search for a compatible file (L576-L578).
- **LR2** The last three characters are still replaced, so the name is mangled [R]
- **beatoraja** Keysounds: `name.wav`, `name.flac`, …; images and videos go to the missing-file search [V]
- **Be-Music** Keysounds: the extensions above are added; images and videos: only the name as written

**Letter case**

- **De jure** Undefined.
- **LR2** Case-insensitive (Windows `FindFirstFileA`) [R] ([LR2f.cpp L14345-L14372][olr2-exists])
- **beatoraja** Up to the file system [V]
- **Be-Music** Always case-insensitive, whatever the system ([`file-lookup.ts`][bm-file-lookup])

**`#PATH_WAV`**

- **De jure** See [§2.15](#215-audio-commands-and-keysounds).
- **LR2** Not supported [I]
- **beatoraja** Not supported [V]
- **Be-Music** The prefixed path is tried before the bare one

### 2.20 Nanasi Groove 2 `.n2s` containers

Toy Musical 3 ships its charts only as `.n2s` files for its bundled player, Nanasi Groove 2. No specification exists; everything below was read in `nanasi2.exe` [D] and checked against all 1,206 charts and 89 lists of Toy Musical 3 ver 2.96. Be-Music reads them as PMS ([ADR 0042](./adr/0042-nanasi-groove-2-charts.md), [`n2s.ts`][bm-n2s]).

| Topic      | Nanasi Groove 2                                                                                                                                                                                                                                                                                                                                                                | Be-Music                                                                                                                                                                                                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Container  | "ZEXA" (`zexa::ZipExtendArchiver`): a header, a `DATA` area of one zlib stream per file, then an `INDEX` of flags, offset, size and name per entry. Header flag bit 30 marks the container encrypted (0x51d380, 0x51d6d0)                                                                                                                                                      | The same layout; directories are skipped; an unencrypted container is read too                                                                                                                                                                                                |
| Encryption | AES-128-CBC (OpenSSL 0.9.8k). Key: the first 16 bytes of `x_button_wo_naze_oshi_kurui_masu`; IV: the first 16 bytes of SHA-1(`nanasigroove2`) (0x51c910). Each field (archive id, format string, entry name, payload) is encrypted on its own from the same IV, zero-padded to the block size; an encrypted payload inflates to its cipher length, plain length and ciphertext | The same; the plain length trims the padding                                                                                                                                                                                                                                  |
| Contents   | A chart container holds one Shift_JIS PMS file (`#PLAYER 3`) named `<stem>.pms`; `.n2x` files hold UTF-8 XML lists and settings (`bmslist`, `bms_information`, courses, skins). One skin `.n2s` wraps a nested `.n2x`                                                                                                                                                          | The first `.pms` / `.bms` / `.bme` / `.bml` entry is parsed as BMS bytes, looking into nested containers. A `bmslist` `.n2x` is read as a course, without its unlock conditions ([course.md](course.md#nanasi-groove-2-n2x-chart-lists)); the other `.n2x` files are not read |
| Lane mode  | Nine-button charts use `11`–`15` and `22`–`25`. Five-button charts use only `13`–`15` and `22`–`23` and are played on the nine-button layout; nothing in the chart names the mode (the file name and list do)                                                                                                                                                                  | `.n2s` counts as `.pms` (`isPMSChartPath`), so both are 9 KEY and the fingerprint matches the `.pms` file inside                                                                                                                                                              |
| Extensions | Nonstandard headers: `#BMSFMT_774HASH`, `#BMSFMT_774PERMITEXRANKZERO`, `#HEXMODE`; play levels up to the 40s; `#EXRANKxx` on channel `A0`                                                                                                                                                                                                                                      | Read as any other BMS: unknown headers are kept, `#EXRANKxx` follows [§2.12](#212-judgment-rank)                                                                                                                                                                              |

[bm-parser]: ../packages/chart-parser/src/core/parser.ts
[bm-n2s]: ../packages/chart-parser/src/core/n2s.ts
[bm-bms-headers]: ../packages/chart-parser/src/core/bms-headers.ts
[bm-event-utils]: ../packages/chart-parser/src/core/event-utils.ts
[bm-control-flow]: ../packages/chart-parser/src/core/control-flow.ts
[bm-decode]: ../packages/chart-parser/src/core/bms-text-decode.ts
[bm-charset]: ../packages/chart-parser/src/core/bms-charset.ts
[bm-play-variant]: ../packages/chart-model/src/play-variant.ts
[bm-channels]: ../packages/chart-model/src/channels.ts
[bm-reference-bpm]: ../packages/chart-model/src/reference-bpm.ts
[bm-wav-directives]: ../packages/chart-model/src/wav-directives.ts
[bm-long-notes]: ../packages/chart-model/src/long-notes.ts
[bm-timing]: ../packages/chart-model/src/timing.ts
[bm-resolved-notes]: ../packages/chart-model/src/resolved-notes.ts
[bm-beats]: ../packages/chart-model/src/beats.ts
[bm-note-rules]: ../packages/chart-model/src/note-rules.ts
[bm-judge-window]: ../packages/player-engine/src/core/judge-window.ts
[bm-ruleset]: ../packages/player-engine/src/ruleset/definitions.ts
[bm-scroll]: ../packages/player-engine/src/core/scroll-distance.ts
[bm-note-draw]: ../packages/player-browser/src/chart/note-draw-window.ts
[bm-web-bga]: ../packages/player-browser/src/chart/bga-timeline.ts
[bm-play-bga]: ../packages/player-browser/src/chart/play-bga.ts
[cmds-indent]: https://hitkey.nekokan.dyndns.info/cmds.htm#INDENT-STYLE
[cmds-comment]: https://hitkey.nekokan.dyndns.info/cmds.htm#COMMENT-SYNTAX
[cmds-general]: https://hitkey.nekokan.dyndns.info/cmds.htm#BEHAVIOR-IN-GENERAL-IMPLEMENTATION
[cmds-charset]: https://hitkey.nekokan.dyndns.info/cmds.htm#CHARSET
[cmds-player]: https://hitkey.nekokan.dyndns.info/cmds.htm#PLAYER
[cmds-outline]: https://hitkey.nekokan.dyndns.info/cmds.htm#OUTLINE
[cmds-pms]: https://hitkey.nekokan.dyndns.info/cmds.htm#PMS
[cmds-freezone]: https://hitkey.nekokan.dyndns.info/cmds.htm#FREE-ZONE
[cmds-channels]: https://hitkey.nekokan.dyndns.info/cmds.htm#CHANNEL-MAPPING-TABLE
[cmds-lntype1]: https://hitkey.nekokan.dyndns.info/cmds.htm#LNTYPE-1
[cmds-lntype2]: https://hitkey.nekokan.dyndns.info/cmds.htm#LNTYPE-2
[cmds-lnobj]: https://hitkey.nekokan.dyndns.info/cmds.htm#LNOBJ
[cmds-landmine]: https://hitkey.nekokan.dyndns.info/cmds.htm#LANDMINE
[cmds-bms]: https://hitkey.nekokan.dyndns.info/cmds.htm#BMS
[cmds-bpm]: https://hitkey.nekokan.dyndns.info/cmds.htm#BPM
[cmds-bpm03]: https://hitkey.nekokan.dyndns.info/cmds.htm#CHANGING-BPM-BASIC-FORMAT
[cmds-bpmxx]: https://hitkey.nekokan.dyndns.info/cmds.htm#BPMXX
[cmds-stop]: https://hitkey.nekokan.dyndns.info/cmds.htm#STOPXX
[cmds-stp]: https://hitkey.nekokan.dyndns.info/cmds.htm#STP
[cmds-basebpm]: https://hitkey.nekokan.dyndns.info/cmds.htm#BASEBPM
[cmds-rank4]: https://hitkey.nekokan.dyndns.info/cmds.htm#RANK-4
[cmds-defexrank]: https://hitkey.nekokan.dyndns.info/cmds.htm#DEFEXRANK
[cmds-exrank]: https://hitkey.nekokan.dyndns.info/cmds.htm#EXRANKXX
[cmds-total]: https://hitkey.nekokan.dyndns.info/cmds.htm#TOTAL
[cmds-control]: https://hitkey.nekokan.dyndns.info/cmds.htm#CONTROL-FLOW
[cmds-wavcmd]: https://hitkey.nekokan.dyndns.info/cmds.htm#WAVCMD
[cmds-exwav]: https://hitkey.nekokan.dyndns.info/cmds.htm#EXWAVXX
[cmds-pathwav]: https://hitkey.nekokan.dyndns.info/cmds.htm#PATH-WAV
[cmds-option]: https://hitkey.nekokan.dyndns.info/cmds.htm#OPTION
[cmds-bmp-layer]: https://hitkey.nekokan.dyndns.info/cmds.htm#BMPXX-LAYER
[cmds-bmp-adjust]: https://hitkey.nekokan.dyndns.info/cmds.htm#BMPXX-ADJUSTMENT
[cmds-bga-compat]: https://hitkey.nekokan.dyndns.info/cmds.htm#ABOUT-THE-COMPATIBILITY-OF-BGAXX
[cmds-video]: https://hitkey.nekokan.dyndns.info/cmds.htm#BMPXX-VIDEO-FILE-DEFINING-TO-BMP
[olr2-upper]: https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L25943-L25950
[olr2-pms]: https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L25923-L25925
[olr2-random]: https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L25952-L25966
[olr2-channel]: https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L25970
[olr2-headers]: https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L26295-L26331
[olr2-measure]: https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L26189-L26193
[olr2-bpm03]: https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L26623-L26626
[olr2-reverse-draw]: https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L2185-L2188
[olr2-reverse-judge]: https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L12619-L12636
[olr2-stop]: https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L26494-L26527
[olr2-stop-case]: https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L26666-L26670
[olr2-stop-slot]: https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L25773
[olr2-ln]: https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L26562-L26583
[olr2-mine]: https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L2041-L2055
[olr2-mine-load]: https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L26585-L26589
[olr2-ln-tap]: https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L2349-L2362
[olr2-mine-hit]: https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L7437-L7456
[j-reserve]: https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/BMSDecoder.java#L487-L500
[j-lines]: https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/BMSDecoder.java#L189-L194
[j-arg]: https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/BMSDecoder.java#L366-L375
[j-values]: https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/BMSDecoder.java#L378-L388
[j-dup]: https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/BMSDecoder.java#L282-L315
[j-charset]: https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/BMSDecoder.java#L535-L654
[j-base]: https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/BMSDecoder.java#L126-L162
[j-chart]: https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/ChartDecoder.java#L93-L149
[j-player]: https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/BMSDecoder.java#L664-L677
[j-mode]: https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/BMSDecoder.java#L169
[j-random]: https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/BMSDecoder.java#L197-L233
[j-bpm]: https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/BMSDecoder.java#L252-L281
[j-stop]: https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/BMSDecoder.java#L316-L334
[j-ln-end]: https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/BMSDecoder.java#L429-L439
[j-rank]: https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/BMSDecoder.java#L702-L715
[j-defexrank]: https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/BMSDecoder.java#L716-L729
[j-lnobj]: https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/BMSDecoder.java#L734-L744
[j-lnmode]: https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/BMSDecoder.java#L776-L787
[j-section-len]: https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/Section.java#L87-L101
[j-section-bpm]: https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/Section.java#L103-L110
[j-section-bga]: https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/Section.java#L74-L85
[j-section-mode]: https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/Section.java#L175-L202
[j-section-lanes]: https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/Section.java#L255-L351
[j-section-stop]: https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/Section.java#L299-L318
[j-section-stop-cast]: https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/Section.java#L315
[j-section-notes]: https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/Section.java#L353-L403
[j-section-ln]: https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/Section.java#L410-L493
[j-mine]: https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/Section.java#L494-L520
[j-section-time]: https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/Section.java#L542-L562
[j-bmson-mine]: https://github.com/exch-bms2/jbms-parser/blob/8108cd54a19275810e1f5d2c9586f008eb6db95e/src/bms/model/BMSONDecoder.java#L317-L366
[b-rule]: https://github.com/exch-bms2/beatoraja/blob/8320241d8481e0826c703878c3eba01cd81ca3e4/src/bms/player/beatoraja/play/BMSPlayerRule.java#L57-L88
[b-judge-ln]: https://github.com/exch-bms2/beatoraja/blob/8320241d8481e0826c703878c3eba01cd81ca3e4/src/bms/player/beatoraja/play/JudgeManager.java#L233-L275
[b-judge-mine]: https://github.com/exch-bms2/beatoraja/blob/8320241d8481e0826c703878c3eba01cd81ca3e4/src/bms/player/beatoraja/play/JudgeManager.java#L244-L249
[b-judge-hidden]: https://github.com/exch-bms2/beatoraja/blob/8320241d8481e0826c703878c3eba01cd81ca3e4/src/bms/player/beatoraja/play/JudgeManager.java#L460-L486
[b-gauge]: https://github.com/exch-bms2/beatoraja/blob/8320241d8481e0826c703878c3eba01cd81ca3e4/src/bms/player/beatoraja/play/GrooveGauge.java#L63-L67
[b-resource]: https://github.com/exch-bms2/beatoraja/blob/8320241d8481e0826c703878c3eba01cd81ca3e4/src/bms/player/beatoraja/PlayerResource.java#L217-L229
[b-lane]: https://github.com/exch-bms2/beatoraja/blob/8320241d8481e0826c703878c3eba01cd81ca3e4/src/bms/player/beatoraja/play/LaneRenderer.java#L314-L321
[b-lane-speed]: https://github.com/exch-bms2/beatoraja/blob/8320241d8481e0826c703878c3eba01cd81ca3e4/src/bms/player/beatoraja/play/LaneRenderer.java#L259-L286
[b-lane-bar]: https://github.com/exch-bms2/beatoraja/blob/8320241d8481e0826c703878c3eba01cd81ca3e4/src/bms/player/beatoraja/play/LaneRenderer.java#L357-L364
[b-lane-note]: https://github.com/exch-bms2/beatoraja/blob/8320241d8481e0826c703878c3eba01cd81ca3e4/src/bms/player/beatoraja/play/LaneRenderer.java#L546-L550
[b-lane-ln]: https://github.com/exch-bms2/beatoraja/blob/8320241d8481e0826c703878c3eba01cd81ca3e4/src/bms/player/beatoraja/play/LaneRenderer.java#L552
[b-lane-mine]: https://github.com/exch-bms2/beatoraja/blob/8320241d8481e0826c703878c3eba01cd81ca3e4/src/bms/player/beatoraja/play/LaneRenderer.java#L587
[b-lane-ln-body]: https://github.com/exch-bms2/beatoraja/blob/8320241d8481e0826c703878c3eba01cd81ca3e4/src/bms/player/beatoraja/play/LaneRenderer.java#L717-L724
[b-bga]: https://github.com/exch-bms2/beatoraja/blob/8320241d8481e0826c703878c3eba01cd81ca3e4/src/bms/player/beatoraja/play/bga/BGAProcessor.java#L135-L209
[b-bga-draw]: https://github.com/exch-bms2/beatoraja/blob/8320241d8481e0826c703878c3eba01cd81ca3e4/src/bms/player/beatoraja/play/bga/BGAProcessor.java#L333-L371
[b-bgimage]: https://github.com/exch-bms2/beatoraja/blob/8320241d8481e0826c703878c3eba01cd81ca3e4/src/bms/player/beatoraja/play/bga/BGImageProcessor.java#L46-L57
[b-video]: https://github.com/exch-bms2/beatoraja/blob/8320241d8481e0826c703878c3eba01cd81ca3e4/src/bms/player/beatoraja/video/VideoFormat.java#L7-L13
[b-volwav]: https://github.com/exch-bms2/beatoraja/blob/8320241d8481e0826c703878c3eba01cd81ca3e4/src/bms/player/beatoraja/audio/AbstractAudioDriver.java#L355-L359
[l-rule]: https://github.com/wcko87/lr2oraja/blob/3db78adff969b854fb3bcc68966449bd36cf7a5b/src/bms/player/beatoraja/play/BMSPlayerRule.java#L73-L89
[cmds-wav-alt]: https://hitkey.nekokan.dyndns.info/cmds.htm#WAVXX-ALTERNATIVE-SEARCH
[cmds-bmp-image]: https://hitkey.nekokan.dyndns.info/cmds.htm#BMPXX-IMAGE-FILE-FORMATS
[olr2-find-alt]: https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L14607-L14726
[olr2-find-image]: https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L14607-L14673
[olr2-find-wav]: https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L14676-L14726
[olr2-exists]: https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/LR2f.cpp#L14345-L14372
[olr2-header-images]: https://github.com/GOMazk/OpenLR2/blob/583a38503555e59c4bafa49d60b9d0714c9007c2/Main.cpp#L752-L773
[b-audio-ext]: https://github.com/exch-bms2/beatoraja/blob/8320241d8481e0826c703878c3eba01cd81ca3e4/src/bms/player/beatoraja/audio/AudioDriver.java#L207-L229
[b-audio-load]: https://github.com/exch-bms2/beatoraja/blob/8320241d8481e0826c703878c3eba01cd81ca3e4/src/bms/player/beatoraja/audio/AbstractAudioDriver.java#L691-L750
[b-bga-lookup]: https://github.com/exch-bms2/beatoraja/blob/8320241d8481e0826c703878c3eba01cd81ca3e4/src/bms/player/beatoraja/play/bga/BGAProcessor.java#L135-L192
[b-bms-resource]: https://github.com/exch-bms2/beatoraja/blob/8320241d8481e0826c703878c3eba01cd81ca3e4/src/bms/player/beatoraja/BMSResource.java#L72-L87
[b-bar-banner]: https://github.com/exch-bms2/beatoraja/blob/8320241d8481e0826c703878c3eba01cd81ca3e4/src/bms/player/beatoraja/select/BarManager.java#L712-L725
[b-song-resources]: https://github.com/exch-bms2/beatoraja/blob/8320241d8481e0826c703878c3eba01cd81ca3e4/src/bms/player/beatoraja/song/SongResources.java#L107-L108
[bm-collection]: ../packages/player-browser/src/collection/collection.ts
[bm-file-lookup]: ../packages/player-browser/src/collection/file-lookup.ts
[bm-sample-path]: ../packages/chart-audio-renderer/src/core/sample-path.ts
