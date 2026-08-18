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

The core engine defaults to the `lr2` compat ruleset and its `GROOVE` gauge, which corresponds to LR2's `NORMAL`
gauge. Both are options: `PlayerOptions.judgeRuleset` picks the ruleset and `PlayerOptions.gauge` the gauge, and
`bms-player` exposes them as `--ruleset` and `--gauge`.

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

### Landmines

Mines follow the LR2 detonation model (losak's LR2 mine writeup, confirmed against beatoraja's `JudgeManager`).

- A mine explodes while "the lane's key is ON and the mine is within the `GOOD` window of the judge line": pressing with a mine in range detonates it, and **holding through a passing mine detonates it too**. A mine passing with the key up is harmless.
- An explosion only drains the gauge and plays the `#WAV00` explosion sample — **no verdict, no combo break, no score change**. Regular note judgment runs independently of detonation (a mine never swallows the input aimed at a nearby note).
- Damage interprets the mine object value (upper-case base36) **directly as a percentage** (LR2 / beatoraja behavior; this differs from the nanasi-lineage `value / 2` rule). A bmson mine with `key_channels[].notes[].damage` uses that value instead.
- Mine damage bypasses the HARD sub-30% softening and the `#TOTAL` damage multiplier (same as beatoraja's direct `gauge.addValue()`).
- `ZZ` (= 1295 %) instantly FAILs survival gauges (HARD / DEATH); GROOVE / EASY stop at the `2%` floor.
- kitty keyboard protocol input uses the real press/release state; release-less fallback input approximates "held" with the same short grace window the LN hold logic uses.
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

## Compat rulesets

**The player has no judge logic of its own.** Every play runs under one of three compat rulesets — `lr2` (the
default), `beatoraja`, or `iidx` — chosen with `PlayerOptions.judgeRuleset`. The ruleset owns the judge windows,
which note a press resolves against, the long-note style, the empty-POOR rule, the gauge line-up and its curve,
and the score formula. The tables and their primary sources live in
[`packages/player/src/ruleset/definitions.ts`](../packages/player/src/ruleset/definitions.ts) and are compared
side by side in [`docs/playlog.md`](./playlog.md).

The same tables drive the live engine and the play-log simulator, and an equivalence suite requires the two to
agree judge for judge on the same recorded input stream.

The rest of this chapter describes the **`lr2` ruleset**, which is the default.

## Judgment width

### Window shape

A window is a signed `[late bound, early bound]` pair in microseconds, resolved per lane kind (key vs scratch) and
per context (note vs long-note end). LR2 uses one table for all four contexts; beatoraja widens scratch by 10 ms
per judge and gives long-note ends their own table.

The boundaries of `PERFECT` / `GREAT` / `GOOD` / `BAD` are determined by these four windows, walked inner to outer.
An input outside every window reaches no note: the lane keysound plays and the press falls through to the
empty-POOR path. `POOR` is a note that was missed outright.

### BMS initial judgment width

BMS determines the judgment range at the start of playback using the following priority order.

1. `#DEFEXRANK`
2. `metadata.rank` (`#RANK`)
3. Default value `#RANK 2`

`#DEFEXRANK` is treated as a percentage value.
`100` is the standard value and has the same width as `NORMAL`.
The player interprets `#DEFEXRANK` with `Number.parseFloat()` and only accepts values ​​​​that are finite and greater than `0`.

`#RANK` maps onto the internal judgerank percent axis `[25, 50, 75, 100, 75]` (`VERY HARD` = 25 / `HARD` = 50 / `NORMAL` = 75 / `EASY` = 100 / `VERY EASY` treated as `NORMAL`).
`metadata.rank` is interpreted by rounding down to an integer, and values ​​​​outside the range are invalidated and fallback to the default value.

### BMS conversion formula

Judgment widths are derived by piecewise-linear interpolation of the measured table above over the judgerank percent anchors (25 / 50 / 75 / 100) — the same model as lr2oraja's `JudgeWindowRule.LR2`.
`#DEFEXRANK n` converts to the percent axis as `n × 75 / 100`. For example `#DEFEXRANK 120` is percent `90` and yields `PGREAT=19.8ms`, `GREAT=52ms`, `GOOD=112ms`, `BAD=200ms` (fixed).
Values beyond `EASY` (percent `100`) extrapolate along the final segment; only `PGREAT` / `GREAT` / `GOOD` scale, and no width ever exceeds the fixed `BAD` gate of `±200ms`.

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

bmson's `judgeRank` shares the `100 = NORMAL` percentage unit with `#DEFEXRANK` and converts through the same LR2 anchor interpolation.
Therefore `judgeRank=100` is exactly `NORMAL` (`±18/±40/±100/±200ms`).

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

- The trigger condition is that a note on the same lane falls inside the **ruleset's miss window**. LR2's is `{0, 1 s}` (lr2oraja's `JudgeProperty` LR2 miss window — fixed, independent of rank / EXRANK), so under `lr2` an empty POOR never fires after a note passes and a press with no note within the next second is harmless: only the keysound plays. beatoraja's window reaches 500 ms early and 150 ms late.
- It fires **repeatedly** for the same note while mashing in front of it (LR2's `MissCondition.ALWAYS`, including in front of already-judged notes).

Empty POOR mirrors LR2's phantom-press behaviour:

- Increment `summary.emptyPoor`, and do NOT touch the note-judge counters (`perfect` / `great` / `good` / `bad` / `poor`) — no note was consumed. Whether a player's POOR counter displays the two summed is a presentation choice; LR2's does (OpenLR2 `ApplyJudgeNote` increments `playerstat.poor` for the empty-POOR branch).
- Do NOT change EX-SCORE or the score.
- Cut the combo only where the ruleset says to (`comboBreaksOnEmptyPoor`): beatoraja's five-key and PMS rules do, LR2 and IIDX do not.
- Apply `EMPTY_POOR` to the gauge — the delta lives in the ruleset's gauge table ([`definitions.ts`](../packages/player/src/ruleset/definitions.ts)). Under `lr2`: GROOVE `-2`, HARD `-2` (subject to the TOTAL multiplier), EASY `-1.6`, DEATH `-10`. Nearly harmless on GROOVE / EASY; meaningful drain on HARD / DEATH.
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

`summary.total` is the active ruleset's **judgment count** — its EX-SCORE denominator, not the number of notes on
screen. Charge-note styles count a long note's head and tail separately, so one long note contributes two.

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

`score` is whatever the active ruleset defines.

- `lr2` reports LR2's money score, `floor((4 × PGREAT + 2 × GREAT + GOOD) × 50000 / notes)`, capped at `200000`.
  It is purely a function of the judge tally — there is no combo term.
- `beatoraja` and `iidx` report EX-SCORE, which is what they display. IIDX retired its own money score in
  BISTROVER.

### Empty POOR

An empty POOR (空POOR) is a press with no note in reach but one inside the ruleset's miss window. It costs gauge
and fires the POOR cue without consuming a note, so it never reaches EX-SCORE and is counted in
`summary.emptyPoor` rather than `summary.poor`. LR2's miss window is early-only (`{0, 1 s}`) — a press up to a
second before a note charges one, a press after never does; beatoraja's reaches 500 ms early and 150 ms late.
Whether it breaks the combo is the ruleset's call: beatoraja's five-key and PMS rules say yes, LR2 and IIDX say no.

Whether a player's POOR counter displays `poor` and `emptyPoor` summed is a presentation choice. LR2's does
(OpenLR2 `ApplyJudgeNote` increments `playerstat.poor` for it), which is why the split is exposed rather than
folded.

## Groove Gauge

### Basic policy

- The gauge is picked with `PlayerOptions.gauge`, spelled in LR2's names (`GROOVE` / `EASY` / `HARD` / `DEATH`),
  and each ruleset maps that pick onto its own line-up: `GROOVE` is beatoraja's `NORMAL`, `DEATH` its `HAZARD`,
  and IIDX — which has no HAZARD equivalent — folds `DEATH` onto `EX-HARD`.
- The ruleset owns the curve: per-judge deltas, TOTAL scaling, guts softening, the death border, and the clear
  rule (a threshold for the recovery gauges, "never bottomed out" for the survival gauges).
- The selected gauge governs the run. It is not a colour: HARD really drains, and a HARD run that bottoms out
  reports `failedMidPlay` and can no longer clear.
- The tables live in [`packages/player/src/ruleset/definitions.ts`](../packages/player/src/ruleset/definitions.ts)
  and are applied through `RulesetGauge`. The shared engine is the authority for final score and summary values;
  browser scenes mirror `summary.gauge`.

### Initial and default values (`lr2`)

- `GROOVE` starts at `20%`, floors at `2%`, and clears at `80%`
- `EASY` starts at `20%`, floors at `2%`, and clears at `80%` with gentler numbers
- `HARD` / `EX-HARD` / `DEATH` start at `100%` and fail the moment they drop below `2%`
- Upper limit is `100%`
- When `#TOTAL` is specified, use that value as is
- When `#TOTAL` is absent, LR2's note-count formula supplies it (`LR2_bmsload.cpp`): `(n / 5 + 200) × 0.8` below
  400 notes, `((n - 400) / 2.5 + 280) × 0.8` below 600, `((n - 600) / 5 + 360) × 0.8` above. beatoraja and IIDX
  use their own defaults.

### Increase/Decrease

`noteCount` is the number of notes played for TOTAL / EX-SCORE / SCORE.
FREE ZONE, mines, and invisible objects are not included in `noteCount`.

The following deltas describe the `lr2` ruleset's `GROOVE` gauge. `HARD`, `DEATH`, `EASY`, and the other rulesets' values live in [`definitions.ts`](../packages/player/src/ruleset/definitions.ts).

`baseGain = effectiveTotal / noteCount`

- `PGREAT`: `+baseGain`
- `GREAT`: `+baseGain`
- `GOOD`: `+baseGain / 2`
- `BAD`: `-4`
- `POOR`: `-6`
- Manual landmine hit: `-(mineValue(base36) / 2)`

The value after gauge update is clamped to the current gauge type's min/max range.

The `HARD` / `EASY` / `DEATH` variants follow the LR2 values (beatoraja `GaugeProperty`'s `HARD_LR2` / `EASY_LR2` / `HAZARD_LR2`).

- `HARD`: recovery `PGREAT/GREAT +0.1` / `GOOD +0.05` (TOTAL-independent); damage `BAD -6` / `missed POOR -10` / `empty POOR -2`. Damage is multiplied by the `#TOTAL` table (`×1.0` at `TOTAL ≥ 240` up to `×10` below `120`) and softened by `×0.6` while the gauge is under `32%` (lr2oraja rounds the gauge down to an even percent before
  the comparison, so "display 30 %" is internal 32 %).
- `EASY`: gains are `1.2×` GROOVE, damage is `0.8×` GROOVE (`BAD -3.2` / `POOR -4.8` / `empty POOR -1.6`). The clear threshold stays at `80%`, same as GROOVE.
- `DEATH` (LR2 HAZARD equivalent): `PGREAT +0.15` / `GREAT +0.06` / `GOOD 0`; `BAD` / missed `POOR` are `-100` (instant death); `empty POOR -10`.
- `HARD` / `DEATH` collapse to `0%` (FAILED, no recovery) the moment they drop below `2%`. Raw deltas such as mine damage bypass the guts softening and the TOTAL multiplier.

## Long Note

### How to count NOTES

How many judgments a long note is worth is the ruleset's call. LR2 plays every long note as an LN and counts one;
charge-note styles judge the head and the tail separately and count two.

The terminal object of `#LNOBJ` itself is never counted.
Long notes derived from `#mmm51-69` are counted the same way as `#LNOBJ` ones.

### Long-note style

The chart's `#LNMODE` is a request, not a decision — the ruleset maps it to what it actually plays:

- `lr2` (`ln`): every long note is an LN, whatever `#LNMODE` says. One deferred judgment, early release is a `BAD`.
- `beatoraja` (`per-note`): honours the chart — `1` is an LN, `2` a CN, `3` an HCN.
- `iidx` (`charge`): every long note is a charge note, an HCN where the chart says `3`. A `BAD` or `POOR` on the
  head cancels the tail judgment entirely.

If `#LNMODE` of BMS is not specified, it is treated as `1`.
bmson resolves the mode via the beatoraja extensions `info.ln_type` and the per-note `t` (1: LN / 2: CN / 3: HCN, `t` takes precedence over `ln_type`); when neither is specified the LR2-aligned default `1` (LN) is used.
FREE ZONE is not subject to `#LNMODE` and is treated as a note with a terminal.

### Manual Play

In manual performance, the start point side judgment is calculated when inputting the long note start point.
However, the final decision timing depends on `#LNMODE`.

The modes below are the EFFECTIVE modes the ruleset resolved to, not the chart's raw `#LNMODE`.

- Mode `1` (LN): the head judgment is held and confirmed once, at the end point. Releasing midway makes it a `BAD`
  at that point and stops the lane sound.
- Mode `2` (CN): the head scores immediately on the press. The tail is judged on the RELEASE — against the exact
  release instant, not the frame that noticed it — and contributes a second judgment. Holding past the end point
  is not yet a judgment: the player has until the tail's late window closes to let go. The lane sound stops on
  release.
- Mode `3` (HCN): as mode `2`, plus the gauge keeps draining while the hold is broken. Reaching the end point with
  the hold broken makes the tail a `POOR`.

A long note the player never touched owes one `POOR` for the head, plus a second for the tail under charge modes —
except under IIDX, where the cancelled tail owes nothing.

### Auto Play

A long note starts keysound playback and lane holding display at the start point, and is cleared at the end point:
one `PGREAT` under LN styles, two (head and tail) under charge styles.

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
- `emptyPoor`
- `exScore`
- `score`
- `gauge`

`gauge` includes `current` / `max` / `clearThreshold` / `initial` / `effectiveTotal` / `cleared`, plus `type` (the
ruleset-scoped gauge id), `survival`, and `failedMidPlay`.

## Known unsupported

- Independent 2P gauge variant in browser gameplay
- Gauge timeline display
- beatoraja's non-default note-selection algorithms (`duration` / `lowest` / `score`) are implemented but not
  exposed as an option
