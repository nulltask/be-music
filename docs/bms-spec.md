[Japanese version](./bms-spec.ja.md)

# BMS implementation specification

This document defines how `packages/parser` / `packages/stringifier` / `packages/player` handles BMS.

## Primary References

- Command specifications (Japanese): https://hitkey.nekokan.dyndns.info/cmdsJP.htm
- Command specifications (English): https://hitkey.nekokan.dyndns.info/cmds.htm
- BMS Format Specification (1998-11-26): http://bm98.yaneu.com/bm98/bmsformat.html
- Bms:Spec (wiki.bms.ms, Wayback 2009-02-13): https://web.archive.org/web/20090213050609/http://wiki.bms.ms/Bms:Spec
- Basic specification of BML (RDM): https://nvyu.net/rdm/rby_ex.php
- STOP Sequence (`#STOPxx` / `#STP`): https://hitkey.nekokan.dyndns.info/exstop.htm
- Extended BPM (`#BPMxx` / `#EXBPM`): https://hitkey.nekokan.dyndns.info/exbpm-object.htm
- `#OPTION` / `#CHANGEOPTION` Specification: https://hitkey.nekokan.dyndns.info/option.htm
- Sonorous Proposal Extension (Supplementary Primary Reference): https://hitkey.nekokan.dyndns.info/bmsexts-ja.htm
- Obj Tech Lovers | Guidance chapter3-2 (Supplementary Primary Reference for `#WAV00` / rest semantics / landmine behavior): https://nekokan.dyndns.info/~otlovers/guidance/guidance_3a_txt.html
- Obj Tech Lovers | Guidance chapter4-7 (Supplementary Primary Reference for landmine damage semantics): https://nekokan.dyndns.info/~otlovers/guidance/guidance_4b.html
- Bemuse BMS Extensions (auxiliary primary reference): https://bemuse.ninja/project/docs/bms-extensions
- beatoraja Materials for music producers: https://github.com/exch-bms2/beatoraja/wiki/%E6%A5%BD%E6%9B%B2%E8%A3%BD%E4%BD%9C%E8%80%85%E5%90%91%E3%81%91%E8%B3%87%E6%96%99

## Reference materials

- `bms benchmark` (implementation comparison): https://hitkey.nekokan.dyndns.info/bmsbench.shtml
- `bmsplayer data` (compatibility check): https://hitkey.nekokan.dyndns.info/bmsplayer_data2010.shtml
- Numuther: BMS Scroll gimmick explanation (SCROLL/BPM/STOP example): https://note.com/numuther/n/n57bf895e7969

## Compliance Status Summary

- Compatibility level: Partial compliance
- Policy: Rather than fully reproducing the entire specification, prioritize implementation of major score playback elements

## Supported (syntax accepted)

- [x] Accept object data line `#mmmcc:data`
- [x] Accept header line `#COMMAND value`
- [x] Ignore lines that do not start with `#`
- [x] Accept `LF` as line terminator
- [x] Accept `CRLF` by removing `CR` at the end of the line
- [x] Accept EOF as end of line even in files without trailing newline
- [x] `CR` Accept single newline as line end
- [x] Keep unknown header in `metadata.extras`
- [x] Keep `#mmmcc` as an event, whether known or unknown

### line end

The actual `parser` separates the BMS text as either `LF` / `CRLF` / `CR`.
`CRLF` is treated as a single line terminator, and `CR` single line breaks are accepted as well as `LF`.

Treats EOF as the end of the last line even if there is no newline at the end of the input.
However, the exact specification of control syntax compatibility for files containing a mixture of `CRLF` and `LF` remains an unsupported item, which will be discussed later.

## Supported Semantics

- [x] Interpret meta header `#TITLE`
- [x] Interpret meta header `#SUBTITLE`
- [x] Interpret meta header `#ARTIST`
- [x] Interpret meta header `#GENRE`
- [x] Interpret meta header `#COMMENT`
- [x] Keep `#SUBARTIST` as `metadata.extras.SUBARTIST` and use it for player's music selection screen metadata
- [x] Keep `#BACKBMP` as `metadata.backBmp` for browser LR2 special graphics
- [x] Keep `#BANNER` as `metadata.banner` and use it for the player's song selection screen banner
- [x] Interpret meta header `#STAGEFILE`
- [x] Display `#STAGEFILE` as a loading screen exclusive image after song selection
- [x] Interpret meta header `#PLAYLEVEL`
- [x] player: When `#PLAYLEVEL` is not specified in BMS, the display default value `3` is reflected on the song selection screen, TUI, and result display.
- [x] Keep `#PLAYLEVEL 0`
- [x] Hold string `#PLAYLEVEL`
- [x] Interpret meta header `#RANK`
- [x] Keep `#RANK 0-4` as judgment difficulty level specification
- [x] Interpret meta header `#TOTAL`
- [x] Interpret meta header `#DIFFICULTY`
- [x] player: Use `#DIFFICULTY 1-5` to display, sort, and filter the song selection list
- [x] Interpret meta header `#BPM`
- [x] When `#BPM` is not specified in BMS, the compatible default value `130` is applied (IR default value is also unified to `130`)
- [x] Interpret resource header `#WAVxx`
- [x] Interpret resource header `#BMPxx`
- [x] Interpret resource header `#BPMxx`
- [x] Interpret resource header `#STOPxx`
- [x] Interpret resource header `#TEXTxx`
- [x] Interpret channel `02` (bar length: `#mmm02:length`)
- [x] Interpret channel `03` (hexadecimal direct value BPM)
- [x] Interpret channel `08` (`#BPMxx` reference BPM)
- [x] Interpret channel `09` (`#STOPxx` reference STOP)
- [x] Interpret channel `01` (background sound)
- [x] Interpret channel `1x` (play)
- [x] Interpret channel `2x` (play)
- [x] Interpret channels `17` / `27` as FREE ZONE (other than 9KEY)
- [x] When judging 9KEY, channel `17` is interpreted as a normal lane note.
- [x] `#PLAYER=1` is retained as SINGLE meta information, and lane determination prioritizes channel configuration.
- [x] `#PLAYER=2` (COUPLE) is retained as meta information, and dedicated 1P/2P separation play is not currently implemented.
- [x] `#PLAYER=3` is used as a 9KEY determination hint only when `17` channel exists
- [x] `#PLAYER=4` (BATTLE) will be retained as meta information, and dedicated two-player competitive play will not be implemented at this time.
- [x] Interpret channel `D1-D9` (mine)
- [x] Interpret channel `E1-E9` (mine)
- [x] Reflect mine timing input in `BAD` judgment in MANUAL mode
- [x] Apply mine object value as MANUAL mode groove gauge damage (`object value / 2` under the chart's ID base) while keeping the judgment display as `BAD`
- [x] When `#WAV00` is defined, use it as the landmine explosion sound on manual mine hit
- [x] Exclude landmines from the number of target notes for `TOTAL` / `EX-SCORE`

#### Landmine damage basis

The original BM98-era core BMS specifications do not define landmine damage as part of the base format, so this implementation follows later public extension references.

- `value / 2` for landmine damage is based on Hitkey's command memo (`[01-ZZ]` damage amount, gauge decreases by `value / 2`).
- `#WAV00` as the dedicated landmine reaction sound and the `ZZ` instant-death convention are corroborated by Obj Tech Lovers chapter3-2 and chapter4-7.
- In `be-music`, the practical effect of `ZZ` is a clamp to the implemented groove gauge minimum `2%`, because the player keeps the LR2-compatible `2-100%` gauge range.
- [x] Keep channel `SC` as `#SCROLLxx` reference event
- [x] Exclude channel `SC` from audio triggering
- [x] Reflect scroll speed of channel `SC` to player drawing
- [x] Keep channel `SP` as `#SPEEDxx` reference event
- [x] Exclude channel `SP` from audio triggering
- [x] Reflect visual interval interpolation of channel `SP` to player drawing
- [x] Use channel `04` as BGA base for display
- [x] Channel `07` is used for display as BGA layer
- [x] Use channel `0A` for display as BGA layer2
- [x] Combine display of `04` / `07` / `0A` (priority: `04` < `07` < `0A`)
- [x] Treat black (`#000000`) as a transparent color in layer (`07`)
- [x] Apply the same transparency rules to layer2 (`0A`) as layer (`07`)
- [x] Handle BGA images assuming a 256x256 canvas
- [x] Do not normally scale BGA images
- [x] Images smaller than 256x256 aligned on the center of the X axis / top aligned on the Y axis
- [x] Undefined in `04` / `07` / `0A` Treated as 256x256 black when referencing `#BMPxx`
- [x] Play BGA video by drawing (`mpeg1video` / `h264` / `mjpeg`, ignore audio)
- [x] Preserve control construct `#RANDOM` and evaluate at runtime
- [x] Preserve control construct `#SETRANDOM` and evaluate at runtime
- [x] Preserve control construct `#ENDRANDOM` and evaluate at runtime
- [x] Preserve control construct `#IF` and evaluate at runtime
- [x] Preserve control construct `#ELSEIF` and evaluate at runtime
- [x] Preserve control construct `#ELSE` and evaluate at runtime
- [x] Preserve control construct `#ENDIF` and evaluate at runtime
- [x] Preserve control construct `#SWITCH` and evaluate at runtime
- [x] Preserve control construct `#SETSWITCH` and evaluate at runtime
- [x] Preserve control construct `#CASE` and evaluate at runtime
- [x] Preserve control construct `#DEF` and evaluate at runtime
- [x] Preserve control construct `#SKIP` and evaluate at runtime
- [x] Preserve control construct `#ENDSW` and evaluate at runtime
- [x] Keep extension header `#PREVIEW` in `bms` extension area
- [x] Keep extension header `#LNTYPE` in `bms` extension area
- [x] Keep extension header `#LNMODE` in `bms` extension area
- [x] Keep extension header `#LNOBJ` in `bms` extension area
- [x] Keep extension header `#VOLWAV` in `bms` extension area
- [x] Keep extension header `#DEFEXRANK` in `bms` extension area
- [x] Keep extension header `#EXRANKxx` in `bms` extension area
- [x] Keep extension header `#ARGBxx` in `bms` extension area
- [x] Keep extension header `#PLAYER` in `bms` extension area
- [x] Keep extension header `#PATH_WAV` in `bms` extension area
- [x] Keep extension header `#BASEBPM` in `bms` extension area
- [x] Keep extension header `#STP` in `bms` extension area
- [x] Keep extension header `#OPTION` in `bms` extension area
- [x] Keep extension header `#CHANGEOPTIONxx` in `bms` extension area
- [x] Keep extension header `#WAVCMD` in `bms` extension area
- [x] Keep extension header `#EXWAVxx` in `bms` extension area
- [x] Keep extension header `#EXBMPxx` in `bms` extension area
- [x] Keep extension header `#BGAxx` in `bms` extension area
- [x] Keep extension header `#SCROLLxx` in `bms` extension area
- [x] Keep extension header `#SPEEDxx` in `bms` extension area
- [x] Keep extension header `#POORBGA` in `bms` extension area
- [x] Keep extension header `#SWBGAxx` in `bms` extension area
- [x] Keep extension header `#VIDEOFILE` in `bms` extension area
- [x] Keep extension header `#MIDIFILE` in `bms` extension area
- [x] Keep extension header `#MATERIALS` in `bms` extension area
- [x] Keep extension header `#DIVIDEPROP` in `bms` extension area
- [x] Keep extension header `#CHARSET` in `bms` extension area
- [x] Keep extension header `#BASE 62` (beatoraja-compatible base-62 ID extension) in `bms.base`; with `#BASE 62`, indexed-header keys (`#WAVxx`, `#BMPxx`, …) and channel-stream tokens are treated as case-sensitive (lowercase `a-z` is a separate ID space)
- [x] Adopt EOF side for single value header, indexed header, and duplicate definition of `#mmm02`
- [x] `#STP` / `#LNOBJ` / Control constructs keep duplicate lines in declaration order
- [x] `#PREVIEW` is used preferentially in song selection screen preview playback
- [x] Reflect `#VOLWAV` to player / audio-renderer playback gain
- [x] Interpret `#xxx97` as dynamic volume change on BGM side
- [x] Interpret `#xxx98` as dynamic volume change on playable/key side
- [x] Interpret `#EXRANKxx` and `#xxxA0` as dynamic decision width changes of player
- [x] Supports LR2 100001x BPM gimmick by `#BPMxx` with time resolution
- [x] Keep every `#WAVCMD` line in `bms.wavCmds`; audio-renderer and browser WebAudio apply the `01` volume parameter
- [x] Parse `#EXWAVxx` and apply its `v` volume parameter in audio-renderer and browser WebAudio
- [x] Use `#BASEBPM` as the chart reference BPM for browser HS-FIX calibration through `@be-music/chart`
- [x] Browser player reflects `#BGAxx` sub-region BGA, `#SWBGAxx` switching BGA, and `#ARGBxx` / `#EXBMPxx` tint and alpha

### `#BASE`

`#BASE` is a beatoraja-compatible extension that selects the radix for BMS object IDs.
The default is `36`, which uses `0-9A-Z` and folds lowercase ASCII letters to uppercase.
`#BASE 62` switches indexed headers and object-stream tokens to case-sensitive `0-9A-Za-z`, so `0a` and `0A` are different IDs.

The parser pre-scans the BMS source for `#BASE 36` / `#BASE 62` before normal parsing starts.
The scan stops at the first object line (`#mmmcc:data`), so a late `#BASE 62` after object data is ignored for compatibility with players that require `#BASE` to be declared before objects.
Unsupported values are ignored and fall back to the current/default base.

Runtime and round-trip behavior:

- `parser` stores the active base in `bms.base`; `#BASE 36` is equivalent to the default and does not need to be emitted.
- `stringifier` emits `#BASE 62` when `bms.base` is `62`.
- `#WAVxx`, `#BMPxx`, `#BPMxx`, `#STOPxx`, `#TEXTxx`, `#LNOBJ`, BGA-related indexed maps, and object-stream values are normalized with the active base.
- Control-flow contents (`#RANDOM` / `#IF` / `#SWITCH` blocks) use the same base as normal lines, so lowercase IDs inside branches survive parsing and branch resolution.
- `player`, `audio-renderer`, `chart`, and `player-web` resolve sample, BGA, BPM/STOP, LN, mine, and timing references through `resolveBmsBase()` so base-62 lowercase IDs remain distinct at runtime.

Example:

```bms
#BASE 62
#WAV0a lower.wav
#WAV0A upper.wav
#00111:0a0A
```

This plays `lower.wav` and `upper.wav` as two different sample references.
Without `#BASE 62`, both keys fold into the same base-36 ID and the later definition wins.

### `#VOLWAV`

`parser` holds `#VOLWAV` as a non-negative number in `bms.volWav`.
`stringifier` outputs the value of `bms.volWav` as is if it exists, as `#VOLWAV n`.

During playback and rendering, `#VOLWAV` is treated as a linear gain applied to the entire score.
If omitted, the default value is `100` and the effective magnification is `n / 100`.

- `#VOLWAV 100`: Original volume
- `#VOLWAV 200`: `2` times the original volume
- `#VOLWAV 0`: Silence

This magnification applies to real-time playback of `player`, song selection screen preview, and `renderJson()` / `renderChartFile()` of `audio-renderer`.
It does not reproduce player- or hardware-specific volume differences, and is treated as a simple gain multiplication factor in actual equipment.

### `#xxx97` / `#xxx98`

`parser` / `stringifier` keep `97` / `98` as regular object channels.
`00` is treated as an empty token as usual, and only non-zero values ​​of `01-FF` are events.

During playback and rendering, `97` is treated as a dynamic bus volume on the BGM side and `98` on the playable/key side.
The value converts the hex integer `1-255` to the gain of `value / 255` and applies it from that point forward.

- `#xxx97`: Switch from `01` / BGM minimum volume to `FF` / original volume
- `#xxx98`: Switch from the minimum volume of `01` / KEY SOUND to the original volume of `FF` /
- `00`: Since it is a rest, it is not turned into an event, and the volume does not change.

In actual implementation, these channels themselves are not treated as sample triggers.
Also, volume changes will only be reflected in the initial gain of new sounds that are played after that point, and will not be reflected in the voices of the same type that are already playing.

## Not supported (difference to primary reference)

- [x] Dedicated behavior of extended channel `#mmm51-59` (LN: `LNTYPE=1`)
- [x] Dedicated behavior of extended channel `#mmm61-69` (LN: `LNTYPE=2`)
- [x] Dedicated interpretation of header `#MIDIFILE` (currently treated as unknown header)
- [x] Playback behavior of channel `06` (POOR-BMP/BGA switching)
- [x] Default behavior of treating `#BMP00` as a POOR image when `#POORBGA` is not specified
- [x] `#BPM` Default value when not specified `130` is treated as compatible behavior (unified to IR default value `130`)
- [x] Clarification of compatibility policy for `#PLAYER` specification value `1-4` (especially `2` / `4`)
- [x] Definition of LN interpretation rules based on the default value `1` when `#LNTYPE` is not specified (when `51-69` is implemented)
- [x] `#LNOBJ` Handling when multiple declarations are made (declaration order maintained in `bms.lnObjs`)
- [x] `#LNOBJ` Compatibility policy for Keyup pronunciation extension at the end (HDX Keyup is not adopted, end trigger is suppressed)
- [x] Priority definition in a score where `#xxx51-69` and `#LNOBJ` conflict (`#xxx51-69` takes precedence in the same lane and position)
- [ ] Dedicated interpretation of header `#MAKER`
- [ ] Interpretation of multiple line definition (Multiplex) of `#SUBTITLE` / `#SUBARTIST` / `#COMMENT`
- [ ] Rules for treating the old-style compatible header `#SONGxx` as equivalent to `#TEXTxx`
- [ ] Compatible header `#EXBPMxx` reading policy (difference with `#BPMxx`)
- [ ] Handling of BM98 extension `#CHARFILE` / `#ExtChr` (policy of ignoring, retaining, and replaying)
- [ ] Handling of header `#CDDA` (policy of ignoring, retaining, and replaying)
- [ ] Handling of old video headers `#VIDEOFPS` / `#VIDEODLY` / `#VIDEOCOLORS` / `#SEEK`
- [ ] Handling of material separation header `#MATERIALSBMP` / `#MATERIALSWAV`
- [x] Real-time reflection of `#STP`
- [ ] `#WAVCMD` pitch and loop execution. Current runtime support only applies the `01` volume parameter in audio-renderer and browser WebAudio.
- [ ] `#OPTION` Simultaneous application rule for multiple lines (currently holds a single value)
- [ ] Runtime reflection of object channel `#xxxA6` (`#CHANGEOPTIONxx`)
- [ ] `#TEXTxx` / `#TEXT00` display behavior during play (currently only retained)
- [ ] Clarification of compatibility policy for inputs containing negative numbers and decimal numbers for `#STOPxx`
- [ ] `#EXBPM` Compatible header reading policy (including priority with `#BPMxx`)
- [ ] Clarification of index range of `#BPMxx` / `#STOPxx` (`01-FF` / `01-ZZ`) and handling of `00`
- [ ] Index range of `#WAVxx` / `#BMPxx` (operational difference including `01-FF` / `01-ZZ` / `00`) and case handling
- [ ] Conflict priority between `#xxx03` and `#xxx08` on the same timeline
- [ ] Conflict priority between `#xxx08` and `#xxx09` on the same timeline
- [ ] Compatibility behavior when inputting invalid values ​​(negative numbers/zero/character strings/exponential notation, etc.) for `#BPMxx`
- [x] Timing interpretation of `#STP` format `xxx[.yyy] zzzz` and abbreviation `xxx zzzz`
- [x] Browser player: `#BGAxx` interpretation of sub-region cutting and placement parameters
- [ ] Runtime reflection of `#@BGAxx` (branch/conditional BGA definition)
- [x] Browser player: `#SWBGAxx` runtime reflection for switching BGA animations
- [x] Browser player: `#ARGBxx` / `#EXBMPxx` runtime reflection for transparency and tint parameters
- [ ] CLI/TUI reflection of `#BGAxx`, `#SWBGAxx`, `#ARGBxx`, and `#EXBMPxx`
- [ ] Decision width interpretation of boundary values ​​including `#DEFEXRANK 0`
- [ ] Apply `#PATH_WAV` to real file resolution during playback/rendering.
- [x] Support for drawing channel `0A` (BGA LAYER2)
- [ ] Acceptance policy for compatible directives `#RONDAM` / `#SETRONDAM` / `#IFEND`
- [ ] Acceptance policy for mixed input of full-width commands and full-width spaces
- [ ] End token processing policy when object data string has odd length
- [ ] Compatible with control syntax evaluation for CRLF+LF mixed files (line end shaking)
- [ ] Strict compatibility for files without trailing newlines (parser/control syntax)
- [ ] Evaluation stability of scores containing large numbers/nested `#RANDOM` and `#SWITCH`
- [ ] Fixed random number generation specifications for musical scores that use a large upper limit of `#RANDOM`
- [ ] `#000` Time/judgment compatibility for musical scores containing measure performance objects
- [ ] Accuracy verification and upper limit policy for high-resolution musical scores (e.g. measure resolution 4032 or higher)
- [ ] Upper limit of measure number (near `#999`) and handling when inputting after `#1000`
- [x] When `#STOPxx` / `#BPMxx` are multi-defined, the line on the EOF side is adopted.
- [x] When `#WAVxx` / `#BMPxx` are multi-defined, the line on the EOF side is adopted.
- [x] Duplicate definitions of general headers, indexed extension headers, and `#mmm02` are generally prioritized on the EOF side.
- [ ] Policy for audio format compatibility (μ-law WAV, etc.)
- [ ] Compatibility policy for treating `00` object tokens as ordinary `#WAV00` references outside landmine playback
- [ ] Search for alternative files when extension omitted/mismatches for `#WAVxx` (extension fallback)
- [ ] Search for alternative files when extension omitted/mismatches for `#BMPxx` (extension fallback)
- [ ] Compatible behavior when referencing undefined `#BPMxx` / `#STOPxx` (ignored, default value, error)
- [ ] `#STOPxx` Compatibility behavior when empty definition reference (e.g. undefined token of `#05209:`)
- [ ] Acceptance policy for commands with leading indentation (leading blank + `#COMMAND`)
- [ ] Acceptance policy for alternative notation of control syntax `#ELSE IF` / `#END IF` / `#END`
- [ ] EOF completion rules when `#IF` / `#SWITCH` block is unterminated (`#ENDIF` / `#ENDSW` is missing)
- [x] Acceptance of Bemuse extension header `#SPEEDxx` and reflection in note drawing distance
- [x] Bemuse expansion channel `#xxxSP` (spacing factor) acceptance and drawing reflection
- [ ] Acceptance rules for Bemuse extension line `#EXT #xxxyy:...` (differences from normal objects)
- [ ] 256x256 Oversize BGA drawing policy (cropping, reduction, placement)
- [x] Maximum number of layers and priority for BGA composition (normally 3 layers: `04` < `07` < `0A`, while POOR is displayed, POOR has the highest priority)
- [ ] Whether to apply `#ARGBxx` / `#BGAxx` parameters to video BGA
- [ ] `#BASEBPM` core time-resolution reflection policy. Browser HS-FIX uses it as a visual reference BPM, but internal chart timing still follows BPM events.
- [ ] player: `#PLAYER` When not specified, the default value `1` is reflected on the song selection screen, TUI, and result display.
- [ ] player: Match the display of `#PLAYER=2` / `#PLAYER=4` with the actual implementation (meta only explicit or dedicated mode implementation)
- [ ] editor: `setMetadata` / `set-meta` write `#PLAYER` to `bms.player` instead of `metadata.extras`
- [ ] editor: Allow dedicated BMS extension headers to be exported without save/load roundtrips after API/CLI editing
- [ ] Acceptance limit and error handling when inputting extremely long lines (e.g. 100KB class)
- [ ] Upper limit and performance guarantee policy for musical scores with hundreds of thousands of performance/internal objects

### TODO (SCROLL/BPM/STOP) from reference materials

| TODO                                                                              | current situation | remarks                                                                                                     |
| --------------------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------- |
| [x] `#SCROLL 0` Specify the display priority of notes that overlap in the same lane in the section before and after.        | correspondence | If they overlap in the same cell, place the note that comes first on the reference line, and stack subsequent notes in the direction away from the judgment line. |
| [x] `#SCROLL < 0`'s reverse running display (direction, near the judgment line, off-screen) is fixed as a compatible specification.  | correspondence | The current implementation policy is "proximity display priority", and the drawing distance is treated as an absolute value (reverse scrolling will not be reproduced)     |
| [x] `#SCROLL 0` Specify the upper limit of lookahead and visible range in long intervals                            | correspondence | Read-ahead is discontinued at `MAX_SCROLL_LOOKAHEAD_BEATS` (= 64 measures), and notes outside the visible range are excluded from drawing.         |
| [x] BPM×`100001` + `#STOPxx` Clarified "display BPM" compatibility policy when correcting                 | correspondence | The same BPM value as the time resolution is displayed as is, and LR2 compatible display replacement and rounding are not performed.                              |
| [x] SCROLL/BPM/STOP Added regression test for complex gimmicks (partial warp, blank keystroke, reverse run)     | correspondence | Add complex cases to `timeline` and continue to verify POOR system with existing `bga` test group                              |
| [x] Determined the handling of beatoraja-specific appearance/disappearance bug-dependent scores (unsupported clearly or reproduction mode) | correspondence | Specify that it is not compatible and consider reproducing mode with another option if necessary in the future.                                   |

## Player-Specific Behavior

- Automatically determine lane mode from used channel (`5 KEY SP`, `5 KEY DP`, `7 KEY SP`, `14 KEY DP`, `9 KEY`, `24 KEY SP`, `48 KEY DP`)
- If lane mode cannot be automatically determined, complete with extension (`.bms -> 5 KEY`, `.bme -> 7 KEY`, `.pms -> 9 KEY`)
- `.pms` The 9KEY of the musical score is estimated from the standard array (`PMS-STD`) / compatible array (`PMS-COMPAT`) from the channel distribution and reflected in the `LANE` display.
- FREE ZONE (`17` / `27`) does not create an independent lane and draws on the scratch lane (`16` / `26`)
- FREE ZONE Note length is fixed at quarter note
- FREE ZONE is not subject to judgment (not included in `TOTAL` / `EX-SCORE` / `SCORE`)
- BGA viewport background uses black (black even when transparent area/BGA is not displayed)
- For scores containing control syntax, the selected `#RANDOM` pattern is displayed in `RANDOM current/total` format.
- During play, `Shift+R` will restart the performance from the beginning, and `#RANDOM` will be redrawn.
- The default keyboard layout for IIDX series is `Z S X D C F V` for 1P and `B H N J M K ,` for 2P.
- Automatically opt-in to kitty keyboard protocol for key input, use left/right `Shift` for 1P/2P scratch, left/right `Ctrl` for reverse scratch
- On macOS, use left/right `Option` instead of left/right `Ctrl` for reverse scratch
- On terminals that do not support kitty, fall back to existing input, and side-specific input of reverse scratch is not guaranteed.
- HIGH-SPEED operation is performed with `Alt/Option` + lane input (decelerate on odd lanes, accelerate on even lanes)
- The song selection screen preview gives priority to `#PREVIEW`, and if it is not specified, it will generate a fallback from the first pronunciation of the score.
- Rendering of the song selection screen preview is interrupted when the focus moves, but if it is the same `#PREVIEW` (same real file) or the same fallback signature, it will continue playing (fallback ignores performance channel arrangement differences)
- In single song mode (and one score directory), you can wait for the result in `Enter` / `Esc` and replay it in `r`.
- Result transition is executed after waiting for the draining of the audio being played, instead of a fixed waiting time.

### player judgment/audio rules

- FAST/SLOW adds only `GREAT` / `GOOD`, not `PERFECT`
- Long notes are determined by the end time, and the end object is not sounded.
- Playback audio uses real-time trigger method for any of `AUTO` / `AUTO SCRATCH` / `MANUAL`
- `--play-volume` applies to performance lanes, `--bgm-volume` applies to non-performance lanes.
- `SC` / Landmine / `LNOBJ` Exclude terminal suppression target events from audio trigger targets

### SCROLL/BPM/STOP compatibility policy

- In `SCROLL 0`, when multiple notes overlap in the same lane and same drawing cell, the preceding note is placed at the reference position, and the subsequent notes are stacked in order toward the side (upward) away from the judgment line.
- `SCROLL < 0` prioritizes "maintaining note approach display" rather than "faithful reproduction of backward running display", and drawing distance is handled by `abs(distance)`
- Visible search for `SCROLL` is capped at `MAX_SCROLL_LOOKAHEAD_BEATS` (`4 * 64` beat)
- Even with gimmicks that include BPM×`100001` + `STOP` correction, the BPM display uses the value used in internal time calculation as is.
- Beatoraja-specific drawing bug-dependent scores are not compatible, and a reproduction mode is not implemented at this time.
- Verify regression of the above policy with `packages/player/src/tui/lane-stacking.test.ts`, `packages/player/src/core/timeline.test.ts`, `packages/player/src/bga.test.ts`

## Handling of event location

- `data` splits by two characters, `00` is empty event
- Position is kept as `position: [numerator, denominator]`
- `denominator = number of tokens`
- `numerator = zero-based token index`

## Character Encoding

- Prefer UTF-8 / UTF-16LE / UTF-16BE with BOM
- If BOM is missing, infer by scoring `shift_jis`, `utf8`, `euc-jp`, `latin1`

## stringifier rules

- Determine intra-measure resolution from denominator information of `position`
- For the same measure and same channel, the least common multiple of the denominator is used.
- If `--maxResolution` is specified, it will be aborted at the upper limit.

## Evaluation rules for control constructs

- `parser` retains control syntax as `bms.controlFlow` and does not commit branches when parsing
- `player` / `audio-renderer` evaluate `bms.controlFlow` and expand valid blocks at runtime
- `#RANDOM n` / `#SWITCH n` generate integers of `1..n` and use them as selection values
- `#SETRANDOM n` / `#SETSWITCH n` fix the selection value
- `#IF` chain branches at the current RANDOM selection value, `#ELSEIF` / `#ELSE` are invalid if there is a previously established branch
- `#SWITCH` chain evaluates `#CASE` / `#DEF` and aborts at `#SKIP` until `#ENDSW`
- `#SWITCH` falls through to subsequent `#CASE` / `#DEF` if `#SKIP` is missing
