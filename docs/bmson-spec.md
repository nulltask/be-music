[Japanese version](./bmson-spec.ja.md)

# BMSON implementation specification

This document defines how `packages/parser` / `packages/stringifier` handles BMSON.

## Primary reference

- Official website: https://bmson.nekokan.dyndns.info/
- Official documents: https://bmson.nekokan.dyndns.info/documents/
- bmson format and specs v1.0 (Read the Docs): http://bmson-spec.readthedocs.org/en/master/doc/index.html
- Google Docs spec: https://docs.google.com/document/d/1ZDjfjWud8UG3RPjyhN-dd1rVjPaactcMT3PIODTap9s/mobilebasic?pli=1

## Compliance status summary

- Compatibility level: Partial compliance
- Policy: Prioritize the minimum set required for BMS interconversion and playback, rather than the full BMSON specification.

## Compatibility checklist

### parser (bmson -> `@be-music/json`)

- [x] Root: `version`
- [x] Root: `info`
- [x] Root: `lines`
- [x] Route compatibility: `resolution` (fallback when `info.resolution` is not specified)
- [x] Root: `sound_channels`
- [x] Root: `bpm_events`
- [x] Root: `stop_events`
- [x] Root: `bga`
- [x] `info` extended item: `subartists`
- [x] `info` extended item: `chart_name`
- [x] `info` extended item: `mode_hint`
- [x] `info` extended item: `judge_rank`
- [x] `info` extended item: `total`
- [x] `info` extended item: `back_image`
- [x] `info` extended item: `eyecatch_image`
- [x] `info` extended item: `banner_image`
- [x] `info` extended item: `preview_music`
- [x] `x` in `sound_channels[].notes[]`
- [x] `y` in `sound_channels[].notes[]`
- [x] `l` in `sound_channels[].notes[]`
- [x] `c` in `sound_channels[].notes[]`
- [x] `measure` / `position` resolution using `lines`
- [x] `x <= 0` (or unspecified) Interpret notes as background music (`01`)- [ ] Validation of `version` (turning `null` into an error, treating legacy as unspecified)
- [ ] Clarification of policy for determining compatibility of `version` with SemVer
- [ ] `info.init_bpm` Treat unspecified as a fatal error
- [ ] Error policy when required information such as `info.title` / `artist` / `genre` is missing
- [ ] Fixed completion rule assuming 4/4 (`resolution * 4` interval) when `lines` is not specified.
- [ ] `sound_channels[].name` extension fallback search (`.wav`/`.ogg`/`.m4a`)
- [ ] `sound_channels[].name` path normalization (`\` and `/`) and directory traversal prevention
- [ ] `sound_channels[].notes[]` Priority rules when `c=true/false` are mixed in the same pulse
- [ ] `bpm_events` Same `y` Normalization of “last priority” when overloading
- [ ] `stop_events` Same `y` "Addition" normalization when overloaded
- [ ] When the same `id` of `bga.bga_header` is defined multiple times, it is interpreted as the winner.
- [ ] Acceptance of `info.title_image` and retention in IR
- [ ] Retention rules for `key:value` format (`music:`/`chart:` etc.) of `subartists`
- [ ] Transparent preservation of unknown root keys

### stringifier (`@be-music/json` -> bmson)

- [x] `version` output (`bmson.version`, `1.0.0` if not specified)
- [x] `info.resolution` output (`240` if not specified)
- [x] `info` Extended item `subartists` output
- [x] `info` Extended item `chart_name` output
- [x] `info` Extended item `mode_hint` output
- [x] `info` Extended item `judge_rank` output
- [x] `info` Extended item `total` output
- [x] `info` Extended item `back_image` output
- [x] `info` Extended item `eyecatch_image` output
- [x] `info` Extended item `banner_image` output
- [x] `info` Extended item `preview_music` output
- [x] `lines` output (prioritizes `preservation.bmson.lines`)
- [x] `lines` automatic generation (IR bar length based)
- [x] `sound_channels` output
- [x] `bpm_events` output (from `03` / `08`)
- [x] `stop_events` output (from `09`)
- [x] `notes.l` output (`l=0` if not specified)
- [x] `notes.c` output (`c=false` if not specified)
- [x] `bga.bga_header` output
- [x] `bga.bga_events` output
- [x] `bga.layer_events` output
- [x] `bga.poor_events` output
- [ ] `bpm_events` Normalize and output events with the same `y` to "last priority"
- [ ] `stop_events` Add and normalize events of the same `y` and output
- [ ] Output of `info.title_image`
- [ ] Path-separated normalization and dangerous path removal for `sound_channels[].name`
- [ ] Transparent reoutput of unknown root key
- [~] Strictly maintain the original value of `notes.x` (exact identity is not guaranteed as lanes are reallocated in IR)

### player / audio-renderer (bmson playback behavior)

- [x] bmson input playback (via `parseChartFile`)
- [x] Use `info.banner_image` for player's song selection screen banner
- [x] Use `info.preview_music` to preview the player's music selection screen
- [x] Time resolution using `lines`
- [x] Time resolution using `resolution`
- [x] Time resolution using `bpm_events`
- [x] Time resolution using `stop_events`
- [x] Sample continuation offset interpretation with `notes.c`
- [x] Long note end interpretation using `notes.l`
- [ ] `bga.bga_events` playback reflection
- [ ] `bga.layer_events` playback reflection
- [ ] `bga.poor_events` playback reflection
- [ ] Video BGA playback
- [ ] Fixed the processing order of the same pulse (Note/BGA → BPM → STOP) as specified.
- [ ] Apply `bpm_events` of the same `y` with priority to the end
- [ ] Add and apply `stop_events` of the same `y`
- [ ] Playback based on sound channel slicing rules (`c` and restart)
- [ ] BGM discard rules when playable/BGM are mixed in the same slice
- [ ] Composite playback of the same `(x,y)` notes from different sound channels as Layered Notes

## Fields read by implementation (parser)

- Root: `version`, `lines`, `resolution`(compatible), `info`, `sound_channels`, `bpm_events`, `stop_events`, `bga`
- `info`: `title`, `subtitle`, `artist`, `genre`, `subartists`, `chart_name`, `level`, `init_bpm`, `resolution`, `mode_hint`, `judge_rank`, `total`, `back_image`, `eyecatch_image`, `banner_image`, `preview_music`
- `sound_channels[].notes[]`: `x`, `y`, `l`, `c`
- `bga`: `bga_header`, `bga_events`, `layer_events`, `poor_events`

## bmson -> BMS/BMSON intermediate representation (`@be-music/json`) conversion

- Keep `version` in `bmson.version`
- Keep `lines[].y` in `preservation.bmson.lines`
- Keep `info.resolution` in `bmson.info.resolution`
- Also read the root `resolution` for compatibility, and adopt it if `info.resolution` is not present.
- Register `sound_channels[i].name` in `resources.wav[key]`
- Convert `key = base36(i + 1)` to 2 digits
- Convert `notes[].y` to fractional position and turn it into an event
- `notes[].l/c` is kept as `events[].bmson.l/c`
- If `lines` exists, calculate `measure` and `position` using the `lines` interval as a measure.
- Number the unique values ​​of `notes[].x` in ascending order and map them to BMS compatible channels.
- `11` if `x` is not specified
- `bpm_events` is converted to `resources.bpm` + channel `08`
- `stop_events` is converted to `resources.stop` + channel `09`
- Original array of `bpm_events` is kept in `preservation.bmson.bpmEvents`
- Original array of `stop_events` is kept in `preservation.bmson.stopEvents`
- Original array of `sound_channels` is kept in `preservation.bmson.soundChannels`
- `bga` is kept in `bmson.bga`

## BMS/BMSON intermediate representation -> BMSON conversion (stringifier)

- Generate `y = round(beat * resolution)` from beat resolution equivalent to `eventToBeat` of `@be-music/chart`
- Output `bmson.version` to `version` (`1.0.0` if not specified)
- Output `bmson.info.resolution` to `info.resolution` (`240` if not specified)
- Output extended items of `bmson.info` (`subartists`, `chart_name`, `judge_rank`, `total`, image/preview etc.)
- If `preservation.bmson.lines` exists, output as `lines[].y`
- If `preservation.bmson.lines` is not present, `lines` will be automatically generated from the bar length of IR.
- `sound_channels` outputs in `wav` keys
- Generate `bpm_events` from `03` / `08` channels
- Generate `stop_events` from `09` channel
- Reflect `events[].bmson.l/c` to `sound_channels.notes[].l/c` (if not specified, `l=0`, `c=false`)
- If `preservation.bmson.bpmEvents` / `stopEvents` / `soundChannels` are consistent with the current IR, re-output them in favor of their array structure.
- Output `bga` if `bmson.bga` exists

## Unsupported/incompatible for primary references

- Not supported: transparent retention of unused unknown root keys in bmson

## y -> position conversion rule

- If you have `lines`:
  - index of the `lines` interval to which `measure = y` belongs
  - `position = [y - lineStart, lineEnd - lineStart]`
- If `lines` is missing:
  - `beat = y/resolution`
  - `measure = floor(beat / 4)`
  - `position = [round(y) % (resolution * 4), resolution * 4]`