[Japanese version](./player-spec.ja.md)

# Player implementation specifications

This document defines the runtime specification for the shared `@be-music/player` core engine.
Regarding the acceptance rules of musical score formats and the meaning of IR, priority is given to [`bms-spec.md`](./bms-spec.md), [`bmson-spec.md`](./bmson-spec.md), and [`json-spec.md`](./json-spec.md), and this document only deals with how the player plays, judges, and displays them.

## Purpose

- Consolidate the behavior of `@be-music/player` by mode in one place.
- Clarify criteria for judgment, scores, gauges, audio, and display.
- Leave a compatibility policy that should be checked when changing the implementation.

## Scope

This document covers the results returned by `autoPlay()` and `manualPlay()`, as well as the judgment, display, and audio processing they use internally.
Invocation methods such as `@be-music/player-tui` CLI arguments, configuration file persistence, and Node worker communication are not covered.
The terminal player and browser player reuse the same chart semantics for timing, notes, BGA cues, score, and results. Terminal UI behavior is documented separately in [Terminal player implementation notes](./player-tui.md), while PixiJS scenes, LR2/beatoraja skin rendering, browser file loading, and WebAudio lifecycle are documented in [Browser player implementation notes](./player-web.md).

The core engine defaults to the LR2-compatible `GROOVE` gauge, which corresponds to LR2's `NORMAL` gauge.
The exported gauge helper also supports `HARD`, `DEATH`, and `EASY`, but `autoPlay()` and `manualPlay()` do not currently expose a gauge-type option. Engine-owned `PlayerSummary.gauge.type` is therefore `GROOVE` in the current result path, and the bundled terminal player has no gauge-type switch.

## BMS compatible range

This section classifies the BMS commands and channels that appear in the primary reference in [`bms-spec.md`](./bms-spec.md) relative to the current `player` implementation.
"Compatible" here means that the player refers to the value at runtime and reflects it in playback, judgment, display, song selection screen, preview, and loading screen.
Items that are only stored in the IR by the parser and not referenced by the player during execution are treated as unsupported.

### Supported channels

| channel                      | Handling in player                                                                                                                                                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `#xxx01`                     | Play as BGM / sample trigger.                                                                                                                                                                                          |
| `#xxx02`                     | Reflected in time resolution and beat resolution as bar length.                                                                                                                                                        |
| `#xxx03`, `#xxx08`           | Reflected in time resolution as BPM change.                                                                                                                                                                            |
| `#xxx04`, `#xxx07`, `#xxx0A` | Render as BGA base / layer / layer2.                                                                                                                                                                                   |
| `#xxx06`                     | Treated as POOR BGA cue. If `#POORBGA` is not specified, `#BMP00` is used as fallback.                                                                                                                                 |
| `#xxx09`                     | Reflects in time resolution as STOP.                                                                                                                                                                                   |
| `#xxx11-19`, `#xxx21-29`     | Treated as visible performance notes. `16` / `26` is scratch, `17` / `27` is FREE ZONE except for 9KEY, and normal note for 9KEY.                                                                                      |
| `#xxx31-39`, `#xxx41-49`     | Treated as invisible notes. They update the corresponding lane's manual keysound state like visible notes, and may be used for display aids, but are not included in `summary.total`. `AUTO` does not produce a sound. |
| `#xxx51-59`, `#xxx61-69`     | Treated as BMS legacy long note.                                                                                                                                                                                       |
| `#xxx97`, `#xxx98`           | Treated as a dynamic volume change that changes the initial gain of the BGM/playable sound that plays after that.                                                                                                      |
| `#xxxA0`                     | Treated as a dynamic judgment width change that refers to `#EXRANKxx`.                                                                                                                                                 |
| `#xxxSC`                     | Reflects in the drawing distance as a scroll segment of the `#SCROLLxx` reference.                                                                                                                                     |
| `#xxxSP`                     | Reflects in the drawing distance as a speed keyframe of `#SPEEDxx` reference.                                                                                                                                          |
| `#xxxD1-D9`, `#xxxE1-E9`     | Treated as a landmine.                                                                                                                                                                                                 |

### Supported commands

| command                                                                                                                                 | Handling in player                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `#TITLE`, `#SUBTITLE`, `#ARTIST`, `#SUBARTIST`, `#GENRE`, `#COMMENT`                                                                    | Used to display metadata on the song selection screen. `#TITLE` / `#ARTIST` / `#GENRE` are also used for TUI and results screens.                                    |
| `#BANNER`                                                                                                                               | Used to display the banner on the song selection screen. bmson uses `info.banner_image` for the same purpose.                                                        |
| `#STAGEFILE`                                                                                                                            | Used as a dedicated image for the loading screen after song selection. It is not referenced by the BGA renderer during gameplay.                                     |
| `#PLAYLEVEL`, `#DIFFICULTY`                                                                                                             | Used to display, sort, filter, and display the results of the song selection screen.                                                                                 |
| `#BPM`, `#BPMxx`, `#STOPxx`, `#STP`                                                                                                     | Used for time resolution.                                                                                                                                            |
| `#RANK`, `#DEFEXRANK`, `#EXRANKxx`, `#TOTAL`                                                                                            | Used for judgment range, display rank, groove gauge calculation.                                                                                                     |
| `#WAVxx`, `#BMPxx`                                                                                                                      | Used for audio/BGA resource resolution.                                                                                                                              |
| `#BASE`                                                                                                                                 | Selects the BMS object ID base. `#BASE 62` keeps lowercase IDs case-sensitive when resolving samples, BGA, BPM/STOP references, long-note ends, and landmine values. |
| `#PREVIEW`                                                                                                                              | Used preferentially for preview playback on the song selection screen.                                                                                               |
| `#PATH_WAV`                                                                                                                             | Used only to search for files on the song selection screen preview. It is not used to solve samples during normal play.                                              |
| `#LNTYPE`, `#LNMODE`, `#LNOBJ`                                                                                                          | Used to interpret BMS long notes.                                                                                                                                    |
| `#PLAYER`                                                                                                                               | Used for mode estimation and display player lane metadata.                                                                                                           |
| `#VOLWAV`                                                                                                                               | Used as a volume multiplier for the entire score.                                                                                                                    |
| `#POORBGA`                                                                                                                              | Used to override the default value of POOR images.                                                                                                                   |
| `#SCROLLxx`, `#SPEEDxx`                                                                                                                 | Used to calculate note drawing distance.                                                                                                                             |
| `#RANDOM`, `#SETRANDOM`, `#IF`, `#ELSEIF`, `#ELSE`, `#ENDIF`, `#ENDRANDOM`, `#SWITCH`, `#SETSWITCH`, `#CASE`, `#SKIP`, `#DEF`, `#ENDSW` | Resolved as control syntax before playback starts.                                                                                                                   |

### Unsupported channels

| channel                                                                                                                      | Current player implementation                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `#xxxA6`                                                                                                                     | It is not supported as a runtime reflection channel for `#CHANGEOPTIONxx`. Even if it is kept as an event, the player runtime does not refer to it.                                                                                       |
| Performance-related expansion channels such as `#xxx1A-1Z` and `#xxx2A-2Z` that are not included in the above supported list | are not treated as playable note channels in the current runtime. Although there is display mode estimation and input assignment for `24 KEY SP` / `48 KEY DP`, these channels themselves do not become the target notes for score/judge. |
| Other object channels that are not included in the above list of correspondence                                              | Even if the parser holds them, the player runtime does not interpret them.                                                                                                                                                                |

### Unsupported commands

| command                                                                                                                                     | Current player implementation                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `#TEXTxx`, `#TEXT00`                                                                                                                        | The parser is retained, but it is not used for player display or runtime performance.                                                                                                                                                                             |
| `#OPTION`, `#CHANGEOPTIONxx`                                                                                                                | Parser is retained, but forced play-option changes are not supported by the core runtime.                                                                                                                                                                         |
| `#WAVCMD`, `#EXWAVxx`                                                                                                                       | Parser is retained. The bundled Node realtime audio session does not apply them, while audio-renderer and browser WebAudio apply the implemented volume subset (`#WAVCMD 01` and `#EXWAVxx v`). Pitch, loop, pan, and frequency parameters are still unsupported. |
| `#BACKBMP`                                                                                                                                  | The core/terminal runtime has no dedicated behavior for this command. Browser LR2 special graphics can use it.                                                                                                                                                    |
| `#MAKER`                                                                                                                                    | Metadata-only/unsupported.                                                                                                                                                                                                                                        |
| `#EXBMPxx`, `#BGAxx`, `#SWBGAxx`, `#ARGBxx`                                                                                                 | The parser retains them. The terminal/core runtime does not apply them, while the browser player renders the implemented BGA sub-region, switching, tint, and alpha subset.                                                                                       |
| `#BASEBPM`                                                                                                                                  | The parser is retained, but the player is not used for time resolution.                                                                                                                                                                                           |
| `#VIDEOFILE`                                                                                                                                | The parser is retained, but it is not used for BGA video resolution in the player. Real-world video playback only handles video files referenced with `#BMPxx`.                                                                                                   |
| `#MIDIFILE`, `#MATERIALS`, `#DIVIDEPROP`, `#CHARSET`                                                                                        | Retains the parser but does not refer to the player runtime.                                                                                                                                                                                                      |
| `#SONGxx`, `#EXBPMxx`, `#CHARFILE`, `#ExtChr`, `#CDDA`, `#VIDEOFPS`, `#VIDEODLY`, `#VIDEOCOLORS`, `#SEEK`, `#MATERIALSBMP`, `#MATERIALSWAV` | Not supported by the current player implementation.                                                                                                                                                                                                               |

## Execution flow

player executes the score in the following order:

1. Resolve the BMS control syntax at runtime and create a branched score to be used for the current playback.
2. Extract performance notes, mines, invisible notes, and real-time audio triggers from the branched score.
3. Confirm the mode, key assignment, and lane FREE ZONE alias from the actual channels.
4. Initialize gauges, scores, UI state, input runtime, and audio runtime.
5. Execute either `AUTO` / `MANUAL` / `AUTO SCRATCH` main loop and return `PlayerSummary` at the end.

In addition to the regular `#STOPxx`, time resolution also treats the BMS extension `#STP` as a stop event.
`#STP` interprets `xxx[.yyy] zzzz` as a stop of `zzzz ms` at `yyy / 1000` position of `measure xxx`, and multiple definitions at the same position are added together. If `.yyy` is omitted, it is treated as `000`. Malformed `bms.stp` elements are retained in the IR but ignored by the player's time resolution.

## Handling control syntax

BMS's `#RANDOM` / `#SETRANDOM` / `#SWITCH` control syntax is resolved before playback starts.
`#RANDOM` draws a random number once at runtime and reinjects that value into `resolveBmsControlFlow()` to reproduce the branch.

The player also maintains the RANDOM pattern selected for this playback for UI display.
`#SETRANDOM` is recorded as a fixed value, and if there are multiple RANDOM types, they are formatted as `RANDOM #1 2/3 #2 1/2` in the order of declaration.

## Note model

### Notes to be played

The player first normalizes the IR `events` into a sequence of performance notes with beats/seconds.
Only the playable channel is included, and each note has at least the following information:

- `channel`
- `beat`
- `seconds`
- `judged`
- `endBeat` / `endSeconds` / `longNoteMode` as required

### Long Note

The player handles long notes by normalizing them to "1 note from the starting point + information about the ending point."
bmson's `l`, FREE ZONE (`17` / `27`), BMS's `#LNOBJ`, and BMS legacy LN (`#mmm51-69`) all fold into this shape.

The terminal object of `#LNOBJ` itself is not left in the performance note string.
Therefore, both LNs derived from `#LNOBJ` and LNs derived from `#mmm51-69` are worth 1 note per book on the player.

### Landmine

The mine channel is mapped to the corresponding playable lane and stored as a separate array.
Landmines are not included in `summary.total`, but when manually input, they may generate `BAD` with priority over normal notes.
If `#WAV00` is defined, the player uses it as the explosion sound when a landmine is hit manually.

### Invisible Note

Invisible notes are kept separate from the normal playing target.
They update the same-lane keysound fallback state using the same timing rule as visible notes: once the invisible object's early `BAD` window opens, that WAV becomes the lane's current fallback sound until a later visible or invisible object takes over.
They are included in the UI drawing target only when `showInvisibleNotes` is enabled, but are not included in the number of judgments or `summary.total`.

### FREE ZONE

FREE ZONE (`17` / `27`) is treated as a note with a 1 beat ending.
It is excluded from the normal score/gauge target and treated as a keysound fallback and a drawing aid target.

## Lane mode and input

The lane mode is estimated from the actual channels in the music score, `bms.player`, and `chartExtension`.
The main modes that can be automatically determined with real equipment are as follows.

- `5 KEY SP`
- `5 KEY DP`
- `7 KEY SP`
- `14 KEY DP`
- `9 KEY (PMS-STD / PMS-COMPAT)`
- `24 KEY SP`
- `48 KEY DP`

Channels that do not exist in a known fixed layout will fallback to unused keys in order.
FREE ZONE also shares the input tokens of the corresponding scratch lanes (`17 -> 16`, `27 -> 26`).

The default keyboard layout for the IIDX series is 1P as `Z S X D C F V` and 2P as `B H N J M K,`.
For scratch, 1P is left `Shift`, 2P is right `Shift`.
For reverse scratch, 1P uses left `Ctrl` and 2P uses right `Ctrl`. On macOS, use left/right `Option` instead of `Ctrl`.

Distinguishing between left/right `Ctrl` and left/right `Option` is done using the kitty keyboard protocol.
If you fall back to a terminal that does not support kitty, side-specific input of reverse scratch is not guaranteed.

## Judgment width

### Standard width

The player first has an IIDX-based reference judgment width.
Subsequent rank resolution and expansion instructions will apply this reference value by scaling it.

- `PGREAT`: `16.67ms`
- `GREAT`: `33.33ms`
- `GOOD`: `116.67ms`
- `BAD`: `250ms`

The boundaries of `PERFECT` / `GREAT` / `GOOD` / `BAD` / `POOR` are determined by the width of these four lines.
`POOR` occurs when an input exceeds the `BAD` width or a note is missed.

### BMS initial judgment width

BMS determines the judgment range at the start of playback using the following priority order.

1. `#DEFEXRANK`
2. `metadata.rank` (`#RANK`)
3. Default value `#RANK 2`

`#DEFEXRANK` is treated as a percentage value.
`100` is the standard value and has the same width as `NORMAL`.
The player interprets `#DEFEXRANK` with `Number.parseFloat()` and only accepts values ​​​​that are finite and greater than `0`.

`#RANK` is treated as a beatoraja-compatible scaling table `[25, 50, 75, 100, 125]`.
`metadata.rank` is interpreted by rounding down to an integer, and values ​​​​outside the range are invalidated and fallback to the default value.

- `#RANK 0`: `25%` (`VERY HARD`)
- `#RANK 1`: `50%` (`HARD`)
- `#RANK 2`: `75%` (`NORMAL`)
- `#RANK 3`: `100%` (`EASY`)
- `#RANK 4`: `125%` (`VERY EASY`)

### BMS conversion formula

The actual decision width of BMS is calculated based on `NORMAL = 75%`.
For example, `#DEFEXRANK 120` is ``1.2` times the standard judgment width'' and is treated as `PGREAT=20.004ms`, `GREAT=39.996ms`, `GOOD=140.004ms`, `BAD=300ms`.

The same expression handles the value resolved from `#RANK`.
For example, `#RANK 4` is `125 / 75` times, so `VERY EASY` is about `1.666...` times wider than `NORMAL`.

### BMS dynamic judgment width change

In BMS, you can use the `#xxxA0` channel and `#EXRANKxx` to change the judgment range during the performance.
The player resolves the event value of the `A0` channel as a key in `#EXRANKxx`, reads the value with `Number.parseFloat()`, and uses it only if it is finite and greater than `0`.
The adopted value shares `#DEFEXRANK`'s unit — a percentage with `RANK 2 = 100` as the baseline — so `#EXRANKxx 100` restores exactly the `NORMAL` judgment width.

If `#EXRANKxx` is undefined, an empty string, a non-number, or less than or equal to `0`, the event does not change the judgment width.
If there are multiple `A0` events, they are applied in chronological order, and the value reached later becomes the subsequent judgment width.

In the current implementation, this dynamic change is applied on the manual judgment side of `manualPlay()` and `AUTO SCRATCH`.
Normal `AUTO` treats all notes as `PERFECT`, so the judgment width derived from chart rank does not affect the score result.

After changing the dynamic judgment width, use the new `BAD` width for the next process.

- Input candidate note search
- Classification of `PERFECT` / `GREAT` / `GOOD` / `BAD` / `POOR`
- Missed note detection
- Determination of expiration of mines/invisible notes
- Determining the end point of a long note

### bmson initial judgment width

bmson determines the judgment width using the following priority order.

1. `bmson.info.judgeRank`
2. `metadata.rank`
3. Default value `100`

The standard value for bmson is `100%`.
Therefore, `judgeRank=100` is treated as the IIDX standard judgment width, `50` is treated as half, and `150` is treated as `1.5` times.

In the current implementation, bmson does not have dynamic judgment width change equivalent to BMS's `#EXRANKxx`.

### Override for debugging

The `judgeWindowMs` option directly overrides only the `BAD` width.
`PGREAT` / `GREAT` / `GOOD` use the scaling result derived from rank as is.

This override applies not only to the initial judgment width but also after dynamic changes by `#EXRANKxx` in BMS.
This means that even if `#EXRANKxx` changes, the `BAD` width with debug overrides will always be that fixed value.

### Display treatment

The rank display resolved from the current chart is displayed on the song selection list, TUI, and result screen.
BMS with `#DEFEXRANK` will display that number, and normal `#RANK 0-4` will display the corresponding label.
Similarly, `PLAYLEVEL` uses the display value resolved from the chart, and if `#PLAYLEVEL` is omitted in BMS, it will give a BM98-compatible default value of `3`.
When `PLAYLEVEL` is `0`, player uses `?` for display. The string `PLAYLEVEL` is displayed as is, and decimal values ​​​​are also displayed without rounding.
`DIFFICULTY` only displays integers between `1-5`. In the song selection list, arrange them in the order of `PLAYER -> DIFFICULTY -> PLAYLEVEL -> filename`, use the keys `1-5` to switch the `DIFFICULTY` filter, and press `0` to cancel it. `DIFFICULTY` Unspecified values ​​​​or values ​​​​outside the range are not filtered and will be displayed as `-`.

A BMS that has dynamic changes using `#EXRANKxx` will have a displayed rank of `RANDOM`.
This is because the judgment range changes midway through the score, and it cannot be expressed with a single fixed label.

However, there is still no ability to dynamically update the TUI's `BAD` width display after play has started.
The `Judge window: ...` line that appears on the current TUI/standard output only displays the width at the start of playback.

## Judgment words and side effects

### `PERFECT` / `GREAT` / `GOOD`

These are success tests.
When the judgment is confirmed, do the following:

- Increment the corresponding `summary` counter.
- Add EX-SCORE.
- Increase combo by 1.
- Update score.
- Add groove gauge.

`FAST` / `SLOW` records only `GREAT` and `GOOD`.
`PERFECT` does not increase FAST/SLOW.

### `BAD`

`BAD` is a failure judgment.
When the judgment is confirmed, do the following:

- Add `summary.bad`.
- Set combo back to 0.
- Update score.
- For ordinary note `BAD`, set groove gauge to `-4`.
- For manual landmine hit, keep the displayed judgment as `BAD` and apply mine damage separately.

### `POOR`

`POOR` is a failure for the note being played.
Occurs when a note passes the `BAD` window, or when a manual input deviation exceeds the `BAD` window.

When `POOR` occurs, do the following:

- Add `summary.poor`.
- Set combo back to 0.
- Set groove gauge to `-6`.
- Fire POOR BGA.
- Update judge/combo display to `POOR`.

### Blank keystroke (no candidate) — LR2-compatible empty POOR

If there is an input but no undecided notes inside the `BAD` window for that lane set, fire an LR2-compatible "empty POOR" (空POOR).

Empty POOR mirrors LR2's phantom-press behaviour:

- Do NOT update `summary` judge counters (`perfect` / `great` / `good` / `bad` / `poor`). LR2 only counts the "missed POOR" branch (NOWJUDGE index 1) into the POOR tally; the "empty POOR" branch (index 0) is excluded.
- Do NOT change EX-SCORE / IIDX score.
- Do NOT cut the combo.
- Apply `EMPTY_POOR` to the groove gauge — the delta lives in [`groove-gauge.ts`](../packages/player/src/core/groove-gauge.ts) (`applyGrooveGaugeJudge('EMPTY_POOR')`): GROOVE / HARD `-2`, EASY `-1`, DEATH `-100` (instant 0%). Nearly harmless on NORMAL / EASY; meaningful drain on HARD / DEATH.
- Trigger POOR BGA (`trigger-poor-bga`).
- Flash the judge display as `POOR` for 0.6 s (`publishJudgeCombo('POOR', combo)`). The LR2 spec separates op 246 (1P empty POOR) / 266 (2P empty POOR) from op 245 / 265 (missed POOR), but both NOWJUDGE indices currently resolve to the same `'poor'` skin slot in this implementation, so the rendered sprite is identical.

If a keysound fallback exists, play it first.
The fallback is the latest same-lane WAV whose early `BAD` window has already opened, so a blank press between two notes keeps playing the previous WAV until the next note's judgment window begins.
The next note's WAV is never used before that window opens.
After the fallback, if the channel sits in a FREE ZONE, suppress empty POOR and return — FREE ZONE is the author's explicit "press here for ambience" region, not a phantom press.
The LN repeat-suppress window after a long-note release is treated the same way (the input is the intended tail re-tap, not phantom).

### Landmine

During manual input, if a mine candidate is closer or the same distance as a normal note candidate, the landmine will be prioritized.
Treat mines as `BAD` and turn off the combo.
Groove gauge damage is calculated from the mine object value as uppercase base36, using `damage = value / 2`.
The applied gauge result is still clamped to `2-100%`, so a large value such as `ZZ` practically drops the gauge to `2%`.
If `#WAV00` is defined, trigger that sample on the mine hit path.

The basis for this rule is documented in [`bms-spec.md`](./bms-spec.md): the `value / 2` interpretation follows Hitkey's command memo, and the `#WAV00` / `ZZ` convention is supplemented by Obj Tech Lovers chapter3-2 and chapter4-7.

## NOTES・combo・score

### `summary.total`

`summary.total` is the number of notes played.
It does not contain the following elements:

- FREE ZONE
- Landmine
- invisible note
- Terminal object of `#LNOBJ`

### combo

combo is increased only by `PERFECT` / `GREAT` / `GOOD`.
`BAD` and `POOR` return combo to 0.

### EX-SCORE

EX-SCORE is IIDX compatible.

- `PERFECT`: `+2`
- `GREAT`: `+1`
- Otherwise: `+0`

### SCORE

The display `score` is an integer between `0-200000`.
Internally, the following two systems are added together and then normalized to `200000`.

- Judgment basic points: maximum `150000`
- combo bonus: up to `50000`

The magnification of the judgment basic points is as follows.

- `PERFECT`: `1.5`
- `GREAT`: `1.0`
- `GOOD`: `0.2`
- `BAD` / `POOR`: `0`

Combo bonuses are added up to 10 steps per note.
Calculate the bonus unit price for each number of notes so that it is always `200000` for all notes `PERFECT`.

## Groove Gauge

### Basic policy

- The default `GROOVE` gauge matches the Lunatic Rave 2 `NORMAL` gauge.
- `GROOVE` / `EASY` use a soft floor, while `HARD` / `DEATH` can fall to `0%`.
- Clear judgment is resolved from each gauge type's threshold at the end of the performance.

The variant rules live in `@be-music/player/core/groove-gauge`.
The core engine's summary path constructs the default `GROOVE` state today.
Browser scenes may use the helper for skin-side gauge UI state, but the shared engine remains the authority for final score and summary values.

### Initial and default values

- Default `GROOVE` initial gauge is `20%`
- Default `GROOVE` lower limit during play is `2%`
- Upper limit is `100%`
- Default `GROOVE` clear line is `80%`
- If `#TOTAL` is not specified, the default value is `160`
- When `#TOTAL` is specified, use that value as is

`HARD` and `DEATH` start at `100%` and bottom out at `0%`; `EASY` starts at `20%`, has a `2%` floor, and clears at `60%`.

### Increase/Decrease

`noteCount` is the number of notes played for TOTAL / EX-SCORE / SCORE.
FREE ZONE, mines, and invisible objects are not included in `noteCount`.

The following deltas describe the default `GROOVE` gauge. `HARD`, `DEATH`, and `EASY` use the variant-specific deltas in [`groove-gauge.ts`](../packages/player/src/core/groove-gauge.ts).

`baseGain = effectiveTotal / noteCount`

- `PGREAT`: `+baseGain`
- `GREAT`: `+baseGain`
- `GOOD`: `+baseGain / 2`
- `BAD`: `-4`
- `POOR`: `-6`
- Manual landmine hit: `-(mineValue(base36) / 2)`

The value after gauge update is clamped to the current gauge type's min/max range.

## Long Note

### How to count NOTES

The player treats each long note as one note.
The terminal object of `#LNOBJ` itself is not included in the number of notes played.
Long notes derived from `#mmm51-69` are also counted as one starting note.

### `#LNMODE`

If `#LNMODE` of BMS is not specified, it is treated as `1`.
bmson resolves the mode via the beatoraja extensions `info.ln_type` and the per-note `t` (1: LN / 2: CN / 3: HCN, `t` takes precedence over `ln_type`); when neither is specified the LR2-aligned default `1` (LN) is used.
FREE ZONE is not subject to `#LNMODE` and is treated as a note with a terminal.

### Manual Play

In manual performance, the start point side judgment is calculated when inputting the long note start point.
However, the final decision timing depends on `#LNMODE`.

- `LNMODE=1`: Only if you keep pressing until the end point, the judgment on the start point side will be confirmed only once when the end point is reached. If you release it midway, it will become `BAD` at that point and the lane sound will also stop.
- `LNMODE=2`: Calculate the judgment on the end point side when reaching the end point or leaving halfway, and confirm the worse one of the starting point side and the ending point side as the final judgment only once. The lane sound will also stop when you leave midway.
- `LNMODE=3`: The basic final judgment is the same as `LNMODE=2`. In addition, the groove gauge will continue to decrease while the hold expires. If the end point is reached while the hold is broken, the end point side is treated as `POOR`. The lane sound will also stop when you leave midway.

### Auto Play

Autoplay does not currently branch to `#LNMODE`.
A long note starts keysound playback and lane holding display at the start point, and `PGREAT` / combo / score / gauge is confirmed only once at the end point.

### AUTO SCRATCH

`AUTO SCRATCH` is a mode that automatically processes only the scratch lane (`16` / `26`) on the manual loop.
The confirmation timing of long note is the end point, same as `AUTO`.

## Behavior by mode

### `AUTO`

`AUTO` automatically processes all notes to be played.
A normal note confirms `PERFECT` once when the time is reached, and a long note confirms `PERFECT` at the end point.

`AUTO` accepts pause/resume, restart, and high-speed changes.
No judgment window or manual input candidate search is used.

### `MANUAL`

`MANUAL` selects the most appropriate candidate note within the `BAD` window from the set of lanes corresponding to the input token.
If there are no candidates, the runtime may play the latest same-lane keysound whose early `BAD` window has already opened, then applies LR2-compatible empty POOR unless the channel is FREE ZONE or the input falls inside the long-note repeat-suppress window.
It does not play the next pending lane keysound before that note's judgment window opens.

In manual input, objects that pass the `BAD` window without any note input are automatically set to `POOR`.
Invisible notes are not included in this miss judgment.

### `AUTO SCRATCH`

`AUTO SCRATCH` is a derivative of `MANUAL`.
Only the notes on the scratch playable channel are automatically processed, and the rest are subjected to normal manual judgment.

## Time control and interrupts

### `speed`

`speed` is the speed at which in-game time progresses.
Both `AUTO` and `MANUAL` are used to convert seconds on the musical score to real time.

### `highSpeed`

`highSpeed` is a display parameter that primarily changes the visible range and scrolling density of the TUI.
The judgment window itself cannot be changed.
The runtime normalizes high-speed values through `@be-music/player/core/high-speed-control`.
Valid values range from `0.5` to `10.0` and snap to `0.5` increments.

### pause / restart / interrupt

The player can handle input events for pause/resume, restart, and high-speed changes.
During pause, the playback clock and audio session are stopped at the same time, and resume restarts them both.

`escape` returns the current `summary` and exits.
`ctrl-c` and `restart` raise `PlayerInterruptedError` and have exit codes of `130` and `0`, respectively.

## Audio processing

### Play timing

Real-time playback uses the trigger sequence generated by `collectSampleTriggers()` from the score after branch resolution.
Clamp the playback time so that it does not become negative.

### Volume separation

`playVolume` applies to the sound on the playable lane side.
`bgmVolume` applies to the other BGM side.

### `#VOLWAV`

BMS's `#VOLWAV` is treated as the volume multiplier for the entire score.
If omitted, the default value is `100`, and the effective gain is `bms.volWav / 100`.

- `#VOLWAV 100`: Keep the original volume
- `#VOLWAV 200`: `2` times the original volume
- `#VOLWAV 0`: Silence

This scaling factor applies to keysound for real-time playback, song selection screen preview, and offline audio rendering using `renderJson()`.
The actual device applies only linear gain and does not reproduce player- or hardware-dependent volume differences.

### `#xxx97` / `#xxx98`

BMS's `97` / `98` channels are treated as bus volume automation during play.
`97` corresponds to the BGM side, `98` corresponds to the playable/key side, and converts the value `01-FF` to a gain of `value / 255`.

- `#xxx97`: Update the volume on the BGM side
- `#xxx98`: Update the volume on the playable/key side
- `FF`: Original volume
- `00`: No event is generated because it is an empty token.

The player applies `97` / `98` before the sample trigger at the same time.
Therefore, if the same beat is pronounced as volume change, the new volume will be used when pronouncing it.

This change only affects the initial gain of newly triggered notes from that point on.
Voices that are already playing will not be changed. If CLI's `playVolume` / `bgmVolume` or `#VOLWAV` exists, apply them by multiplying them.

The reason for this interpretation is that if the PCM gain is changed instantly during playback, discontinuous steps are likely to occur, which can easily be heard as clicks or unstable volume changes.
Also, since `#xxx98` can be read as a command close to the pronunciation conditions of a playable/key sound, it is easier to understand the correspondence between the implementation and the result if you interpret it as ``change the initial gain of the sound that will be played afterward.''

### BGM headroom control

When `limiter === false`, enable BGM headroom control for auto mix.
In this mode, while maintaining the amplitude of the playable/key-sound side, only the BGM side is reduced to the extent that the peak after addition does not clip.

### Long stop

If the retention expires with manual long note, the playback sound of the corresponding channel will be stopped.
With `LNMODE=3`, the gauge continues to decrease even during hold break.

## UI and display

### UI runtime

The player body is independent of the UI implementation and notifies the state through `stateSignals` and `uiSignals`.
Judge/combo, frame information, POOR BGA, lane flash, and lane hold indication are communicated via this signal.

### Loading screen

During loading after song selection, the CLI draws a progress bar and current steps to standard output.
At this time, if `metadata.stageFile` exists and the image can be resolved, the image will be converted to ANSI and drawn across the terminal, and the loading text will be overlaid on top of it.

The loading statement displays the high-level `Step` as well as the separate states of `Sound` and `Visual`.
The audio and graphics loads proceed in parallel, so you can tell on the screen which one you're waiting on.
The detail of each line also displays the name of the file currently being processed and the number of items, such as `3/24`, if necessary.

The display size of `#STAGEFILE` is used up to the current terminal size.
When drawing, the image is enlarged using the equivalent of `cover` to cover the entire terminal while maintaining the image's aspect ratio. If it does not match the terminal ratio, crop a part based on the center.
The loading text is overlaid on top of it, and the background color of each character cell uses the corresponding `STAGEFILE` pixel color. The font color is chosen to have a higher contrast ratio with the background, so it can be either white or black.

If `#STAGEFILE` is not specified, the file is not found, the format is not supported, or decoding fails, it will fall back to a text loading screen without an image.
`#STAGEFILE` is only for loading and does not refer to the BGA renderer during gameplay. The viewport remains a black background while the first base BGA cue is not yet enabled.
If `--kitty-graphics` is enabled and the device supports it, `#STAGEFILE` will be displayed as an image overlay using the Kitty graphics protocol. If not specified, ANSI display will be displayed.
The default implementation of video BGA is progressive decode. The UI runtime is set to ready when the first frame is ready, and the remaining frames are decoded step by step with another worker after the gameplay starts.

### Music Select (song selection screen)

The song selection screen displays the following information:

- `TITLE` / `SUBTITLE` / `ARTIST` / `SUBARTIST` / `GENRE` / `COMMENT` of the selected chart
- List of music scores (`PLAYER`, `DIFF`, `RANK`, `PLEVEL`, `BPM`, `NOTES`)
- Operation help, current directory, play mode, HIGH-SPEED, audio backend
- `#BANNER` or bmson `info.banner_image`

The banner will be displayed on the right side of the metadata block and will fit within the block while maintaining the aspect ratio.
If `--kitty-graphics` is enabled and the terminal supports it, the banner will also be displayed using the Kitty graphics protocol. If not specified, ANSI display will be displayed.

On the song selection screen, `#PREVIEW` is given priority for preview playback.
Place a short settle delay before starting the preview to prevent the preview process from continuing to run while the cursor is being hit.
The focus of Music Select is saved for each directory and restores not only the chart but also the `random` entry.
The chart summary of the song list is reused using the local cache for each user, and re-parsing is omitted as long as the content hash of the chart body matches.

### TUI

The standard TUI displays the following information:

- Song title, genre, play mode, BPM, SCROLL, STOP
- progress, current measure, judgment window, HIGH-SPEED
- NOTES / EX-SCORE / SCORE / judge counts / FAST / SLOW
- Lane body, judge/combo, input key, groove gauge
- RANDOM summary, BGA, audio debug lines as needed

The default drawing limit for TUI is `60fps`.
By specifying `--tui-fps <value>`, you can change the target refresh rate during playback to any positive value.

When drawing a note, the head and tail are drawn with priority over the long note body.
Mines are drawn with even higher priority.
A playback progress indicator is displayed outside the lane, and the line closest to the current position is displayed as a brighter vertical bar.

### Visualization rules

Even on judged notes, drawing will remain until the judge line is crossed or the `visibleUntilBeat` expires.
A long note is drawn as a single note with a body and tail lane, and the highlight continues while being held.
The visual distance of a note is determined by the integral of the piecewise-constant coefficient of `#SCROLLxx` / `#xxxSC` multiplied by the piecewise-linear interpolation coefficient of `#SPEEDxx` / `#xxxSP`. If there is no `#SPEEDxx`, it is always `1`, and multiple keyframes with the same beat are the last to win. Before the first keyframe, the first keyframe's value holds flat (matching the Bemuse reference implementation). If the value of `#SPEEDxx` is a negative number, a non-number, or an undefined reference, that keyframe will be ignored from drawing calculations.

### Non-TUI output

If TUI is disabled, the mode start message, lane assignment, judgment log, and final result are output as text.
`renderSummary()` formats the result in the following order: `TOTAL / GAUGE / PGREAT / GREAT / GOOD / BAD / POOR / FAST / SLOW / EX-SCORE / SCORE`.

## `PlayerSummary`

`PlayerSummary` is the final playback result.
The main items are:

- `total`
- `perfect`
- `fast`
- `slow`
- `great`
- `good`
- `bad`
- `poor`
- `exScore`
- `score`
- `gauge`

`gauge` includes `current` / `max` / `clearThreshold` / `initial` / `effectiveTotal` / `cleared`.

## Known unsupported

- Gauge type switching in `PlayerOptions` and the core `autoPlay()` / `manualPlay()` result path
- Gauge type switching in the bundled terminal player
- Independent 2P gauge variant in browser gameplay
- Gauge timeline display
- `#LNMODE` branch on `AUTO`
