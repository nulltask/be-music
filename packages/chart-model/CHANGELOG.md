# @be-music/chart-model

## 0.11.0

### Minor Changes

- a15f307: Expose chart load warnings, play a non-positive STOP as LR2 does, and add chart BASE-SPEED and charatbeatHDX BGA placement.
  
  - Expose nonfatal warnings on resolved charts, including dropped stacked bmson notes, undefined references and rejected chart options.
  - Add `keysOutBGALayerBlack(json, bmpKey?)`, and let `usesMonophonicWAVPlayback(json, sampleKey?)` take a slot: both follow a slot's own format from `resources.bmpSourceFormat` / `resources.wavSourceFormat`, so a BMS stage in a NONSTOP chart stitched as bmson keeps restarting keysounds on retrigger and keying out layer black. `ResolvedChart.volumeChanges` now also lists the 97 / 98 changes of a bmson chart stitched from BMS stages.
  - Compile initial nanasigroove CRA-RHS declarations as chart BASE-SPEED and include the rate in gameplay fingerprints.
  - Compile charatbeatHDX BGAMODE declarations into the display program.
  - Play a BMS STOP without a positive `#STOPxx` (zero, negative or undefined) as LR2 does instead of ignoring it. LR2 never stores a STOP value at or below 0, so the slot keeps its initial `-1` and the STOP takes `1/192` of a measure (at the BPM in force) off everything after it. `createTimingResolver` now gives such a STOP a negative `StopPoint.seconds`, it takes part in the last-one-wins rule at its position, and `createBeatAtSecondsResolver` jumps the chart position ahead when the STOP is reached. The chart fingerprint (`bmfp0`) carries the STOP as `-1/48` beat, so charts with such a STOP get a new fingerprint. Non-positive bmson stops and `#STP` lines are still ignored.

### Patch Changes

- Updated dependencies: `@be-music/chart-source@0.8.0`

## 0.10.0

### Minor Changes

- c967103: Add `isHeldLongNote`, which tells a long note a player holds from a FREE ZONE note (`17` / `27`), whose fixed one-beat tail is not a long note, and `isFreeZoneChannel`, which says whether a channel is a FREE ZONE column under a play variant.

## 0.9.0

### Minor Changes

- ebc8500: Charts can now use nanasigroove's chart-authored gameplay options; before, they were diagnosed as unsupported:
  
  - Initial `774:RANDOM_*`, the judgment-related `774:CRAZY_*` options (`GOOD2BAD`, `GREAT2BAD`, `HELLJUDGE`, `ADDMINE`) and `774:NOTES_DOUBLE` / `NOTES_COPY` / `NOTES_DBLCOPY` compile with the new `compileChartPlayOptions` into a versioned `ChartPlayOptionProgram` (`NOTES_OFF` clears `notes`, `CRAZY_OFF` does not), with `parseChartPlayOption`, `isChartPlayOptionDeclaration`, `hasChartPlayOptions`, `CHART_NOTES_OPTIONS` and the other ID lists. The legacy aliases `CRA-HYPER` and `CRA-CPDOUBLE` read as `NOTES_DOUBLE` and `NOTES_COPY`.
  - Initial `774:GAMELEVEL_*` and `774:EXTRA_*` compile with the new `compileChartGaugeOptions`, with `parseChartGaugeOption`, `isChartGaugeOptionDeclaration` and their ID lists.
  - `compileChartOptions` diagnoses their A6 use as `initial-only-option`.
  - The fingerprint documents carry a chart's compiled gameplay options as `playOptions` (also inside `#RANDOM` branches), so charts that differ only in these options get different fingerprints; a chart without them keeps its fingerprint.
- b4610c1: Charts can now use nanasigroove's chart-authored display options from `#OPTION` and channel `A6`; before, they were diagnosed as `unsupported-option` without effect:
  
  - `774:HIDDEN_*` (including `M-SUDDEN`), `774:CHANGE-HS_*` and every visual CRAZY option (`SMALL`, `BIG`, `FADEIN`, `FADEOUT`, `RD-SIZE`, the X / Y / XY / 3D waves, `STAR`, `SPIN`, `CLONE`, `CLONE2`, `S-CLONE`, `LINEMOVE`, `LINEMOVE2`, `HIDJUDGE`, `DARK`, `DARK2`, `REVERSE`).
  - The legacy `774:HID-*` / `774:CRA-*` IDs, in initial declarations only (`initial-only-alias` on A6), with `resolveChartLegacyOptionAlias`.
  - `compileChartOptions` emits effective-program version 3 (`CHART_OPTION_PROGRAM_VERSION`) with the new `hidden`, `changeHS`, `crazySize`, `crazyWave`, `crazyColor`, `crazySpin`, `crazyClone`, `crazyLine`, `crazyJudge`, `crazyDark` and `crazyReverse` fields.
  - The sources give no thresholds, curves or periods, so `resolveChartNoteVisual` (with `tint`, `rotation` and `clones`) and its parts implement documented Be-Music formulas deterministically: `resolveChartHiddenAlpha`, `resolveChartChangeHSProgress`, `resolveChartCrazyScale`, `resolveChartCrazyXOffset`, `resolveChartCrazyYProgress`, `resolveChartCrazyWaveScale`, `resolveChartCrazyTint`, `resolveChartCrazyRotation`, `resolveChartCrazyClones`, `resolveChartLineLift`, `resolveChartPlayfieldVisual`, plus `parseChartVisualOption`, `isChartVisualOptionValue`, `hasChartVisualOptions`, `hasChartPlayfieldVisual`, `chartVisualOptionFieldsOf` and `chartVisualHash01`.
- 6a60505: Add `resolveReferencedBmsWAVResources`: the effective WAV resources that some sample event of the chart names, leaving out slots only declared, named only by landmines, or only tweaked by `#WAVCMD` / `#EXWAV`.

### Patch Changes

- cd2a0bd: Chart text (channel `99`) shows pomu `#SONGxx` text for an index `#TEXTxx` leaves undefined, whichever line comes first; the miss text stays nanasigroove's `#TEXT00`.
- Updated dependencies: `@be-music/chart-source@0.7.0`

## 0.8.0

### Minor Changes

- d61020f: Add an optional `allowLongKeys` argument to `parseBmsBGA` so internal mixed-NONSTOP bmson resource references can exceed two characters without truncation. Ordinary BMS parsing keeps its existing two-character normalization.
- ae5ec48: Expose BGA opacity timelines and time-based selection for channels `0B`–`0E`. Interpret nonzero hexadecimal bytes independently of the resource-id base, use chart timing including STOPs, and restore prior opacity when seeking backwards.
- ec732e0: Expose constituent bmson slices on resolved layered notes so one judged note retains its complete input sound. As in beatoraja, the first sound channel's note is kept and a stacked note of another length is dropped with its sound; the chart still loads.
- 31ad44a: Attach bmson up slices to matching long-note tails as endSoundEvent. Keep unmatched definitions as silent slicing boundaries and resolve duplicate end sounds deterministically.
- bcf7edc: Expose deterministic bmson BGA event-layer resolution: sequences with authored millisecond frame times, header-index references, missing images and end markers, conditional image sets and frame lookup. Event-layer consumers can keep ordinary layer changes as selection clears, conditional and sequence events stay out of the normal image timeline, and resolved event cues retain NONSTOP stage ownership, trim anchors, FIT playback rates and exclusive animation windows. A selected conditional MISS definition clears an earlier POOR image so it cannot reappear after a short sequence ends. An `id_set`-only `bga_events` or `poor_events` entry reads beatoraja's default id 0: it shows header id 0 when one exists and otherwise changes nothing.
- 73d56ff: Add deterministic chart-text timeline construction and lookup for BMS channel 99, including quote decoding, replacement/clearing, missing references and separate TEXT00 miss metadata. Stop treating channel 99 as a sample trigger, preventing an unrelated WAV from sounding.
- 9a70860: Add versioned effective chart-option compilation and stateless lookup. Execute native HI-SPEED values without user-control clamping, retain initial numeric HSP aliases and report unsupported, malformed or disallowed declarations.
- dd9ba17: Resolve WAVCMD pitch and sounding-time limits together with EXWAV native-rate frequency and stereo balance. Export shared modifier collection and playback resolution with documented dialect bounds and composition rules.
- 3a1e5da: Resolve EXWAV-only sample filenames consistently and use MacBeat percentage volume (100 is unity). Add resolveBmsWAVResources and wavCmdVolumePercentToLinearGain. Parse WAVCMD 02 as duration rather than loop, reject malformed EXWAV parameters and constrain playback attenuation to its dialect bounds.
- 1a8aa70: Resolve initial charatbeatHDX LONGMODE declarations into CN/HCN notes and conditional fingerprints, with explicit LNMODE taking precedence and timed changes diagnosed.
- 7ea3be3: Add collectBmsWAVVolumeMultipliers to combine WAVCMD, EXWAV and intrinsic slot gain consistently without rounding composed stage volume.
- adfaf40: Add `buildChartOptionTimeline` to collect resolved initial OPTION declarations and timed A6 references without splitting vendor arguments or inventing vendor semantics. Preserve missing references for diagnostics and require branch resolution first.
- 4ecee8b: Remove helpers that implemented superseded interpretations: `parseBMSSwBGA`, `pickSwitchingBGAFrame` and `BMSSwitchingBGA` (cue-driven SWBGA; use `parseBMSKeyBoundBGA` and the A5 timeline), `resolveBmsBmpARGB` (slot tint; use `resolveBMSExBMPColorKey` and the A1–A4 tint timeline), and `wavCmdVolumeByteToLinearGain` (use `wavCmdVolumePercentToLinearGain`).
  Rename `BMSExWAV.volumeCentibels` to `volumeMillibels` and `exWAVVolumeCentibelsToLinearGain` to `exWAVVolumeMillibelsToLinearGain`: the value is in hundredths of a decibel (millibels), not centibels.
- a69f267: Preserve generic bmson keyboards as distinct generic-N play variants with 1–70 ordinary keys, declared empty columns and layout-aware fingerprints. Expose bounded generic-hint resolution and shared lane tables.
- 1618b3e: Add `pickBGATint` and resolve channel-scoped A1–A4 ARGB controls in BGA timelines. Share alpha with 0B–0E opacity changes while retaining each plane's RGB multipliers, with deterministic equal-time selection and seek restoration.
- 12a52f6: Add `resolveBMSExBMPColorKey` and `applyBMSColorKey` for strict EXBMP color-key selection and alpha-aware RGBA8 matching. Preserve unrelated colors and source alpha instead of treating the tuple as a multiplicative tint.
- c688817: Add standard SWBGA parsing, A5 selection timelines and millisecond frame selection, preserving packed BMP00 frames and raw ARGB fields. Exclude A0–A6 controls from WAV sample triggers so matching resource ids cannot play unrelated audio.
- af3fa9a: Add optional selection-window and source-video-rate metadata to input-bound BGA cues so NONSTOP hosts preserve stage ownership and FIT timing without changing the external BMS grammar.

### Patch Changes

- aee87a3: Cut bmson stems at every distinct note pulse so missed continuation notes stay silent, and resolve mixed BGM/playable slice lists in timeline order.
- 32c7fb5: Resolve bmson scroll values beyond the BMS resource capacity and fingerprint STOP durations by their actual values, including deduplicated and edited resources.
- 4ba21e4: Parse whitespace-separated EXWAV parameters in authored flag order so multi-parameter declarations retain the correct filename and volume. Keep earlier comma-separated input compatible.
- 49199ab: Resolve duplicate BPM, STOP, SCROLL and SPEED objects on one channel at one position by file order, so the later line wins as in beatoraja, instead of by the larger object id. `#xxx08` still beats `#xxx03` at one position, as in LR2, and a duplicated STOP still applies once.
- 409105f: Parse standard `#EXBMPxx a,r,g,b filename` declarations as well as the previously accepted comma-before-filename form. Preserve spaces and commas in filenames so players can locate these resources.
- Updated dependencies: `@be-music/chart-source@0.6.0`, `@be-music/shared-utils@0.7.0`

## 0.7.0

### Minor Changes

- a82ec63: Resolve extended bmson resource keys, source-audio slice coordinates and explicit TOTAL units so stitched mixed-format NONSTOP charts retain their playback data.
- 603b23a: Export the shared `resolvePoorBGAMode` parser so browser and terminal BGA rendering use the same chart policy.

### Patch Changes

- 745a0db: Use `____` in internal names for the That-Which-Must-Not-Be-Named lane layouts and mode detection.
- 6b0ac13: `computeChartFingerprint` is faster on `#RANDOM` / `#SWITCH` charts (about 40% on the heaviest, `_random_s4.bms` 118 → 72 ms), with byte-identical fingerprints: outcomes that change only events reuse the notes already resolved for a lane with the same events, the lane buckets merge in order instead of being re-sorted, and the diff against the top-level content finds the shared runs by comparing fields instead of keying every note. Checked against every chart of a 5,537-chart collection and 400 generated control-flow charts.
- Updated dependencies: `@be-music/chart-source@0.5.0`, `@be-music/shared-utils@0.6.0`

## 0.6.0

### Minor Changes

- 559897f: Rename the package from `@be-music/chart` to `@be-music/chart-model` to identify its role consistently. Update imports and package filters to the new name.

### Patch Changes

- Updated dependencies: `@be-music/chart-source@0.4.0`, `@be-music/shared-utils@0.5.0`

## 0.5.0

### Minor Changes

- 8a051a5: Provide a shared chart-resolution API for timing, judging, playback, rendering and fingerprinting.
  
  - Add `resolveChart` with lazily computed playable notes, long notes, mines, invisible notes, sample triggers, tempo changes, bar lines, BGA cues, scroll and speed changes, judge-rank inputs and TOTAL.
  - Expose timing resolvers, sample-trigger helpers and timeline builders through `@be-music/chart-model`.
  - Define shared play-mode layouts for 5, 7, both 9-key layouts, 10, 14, 24 and 48 keys, including scratch, FREE ZONE and keyboard-wheel mappings.
  - Evaluate RANDOM and SWITCH control flow from explicit `RandomDraws` so playback, replay and verification use the same branches.
  - Add chart and play fingerprints with canonical fingerprint documents. Chart fingerprints preserve control-flow alternatives; play fingerprints identify the selected branches.
  - Match LR2 negative-BPM reversal timing and display values, keep the last duplicated BMS STOP at a position, and preserve authored bmson bar lines.
  - Reduce sorting work when resolving long notes.
  
  Migration: use the canonical uppercase-abbreviation exports and fields. Timing and timeline APIs previously imported from the audio renderer or player now come from this package. Fingerprint version `bmfp0` remains a development format.

### Patch Changes

- Updated dependencies: `@be-music/chart-source@0.3.0`, `@be-music/shared-utils@0.4.0`
## 0.4.0

### Minor Changes

- 202a28b: Recognize the 24-key (Keyboardmania) lane channels, so charts authored past the classic nine columns classify and extract like any other playable chart.
  
  `ChartPlayVariant` gains `'24'` and `'48'`. `resolveChartPlayVariant` now checks the extended lane channels (`1A..1Z` / `2A..2Z`) before every other rule and returns `'48'` when the chart also uses the 2P side, `'24'` otherwise — ahead of the `.pms` extension, the `#PLAYER 3` + `17` POPN-9 signature, and the "full `11..19` 1P keyboard" rule, each of which a 24-key chart would otherwise trip.
  
  The `<side><lane>` channel predicates accept the extended `A`-`Z` lane codes alongside the classic `1`-`9`: `isPlayableChannel` (`1X` / `2X`), `isLandmineChannel` (`DX` / `EX`), `isBmsLongNoteChannel` (`5X` / `6X`), and `isPlayLaneSoundChannel`. `mapBmsLongNoteChannelToPlayable` maps the extended long-note columns onto their playable counterparts (`5A` → `1A`, `6O` → `2O`).

## 0.3.2

### Patch Changes

- Updated dependencies: `@be-music/chart-source@0.2.2`

## 0.3.1

### Patch Changes

- @be-music/chart-source@0.2.1

## 0.3.0

### Minor Changes

- 06a2db9: `resolveChartPlayVariant` now detects PMS-STD / POPN-9 charts authored as `.bme` / `.bms` instead of falling through to That-Which-Must-Not-Be-Named heuristics.

  - BME POPN-9 — `#PLAYER 1` + every channel `11..19` populated maps to `'9'` (That-Which-Must-Not-Be-Named 7K never lights all nine columns).
  - PMS-STD on any extension — any of channels `22..25` AND no traditional That-Which-Must-Not-Be-Named 2P channels (`21` / `26..29`) maps to `'9'`.

## 0.2.0

### Minor Changes

- 632f274: Thread the chart's `#BASE 62` object-ID base through every `parseInt` / `toString` site so serialised charts round-trip without dropping casing. Charts that don't declare `#BASE 62` keep the historical 36-base behaviour.

### Patch Changes

- Updated dependencies: `@be-music/chart-source@0.2.0`

## 0.1.0

### Minor Changes

- Initial release.

### Patch Changes

- Updated dependencies: `@be-music/chart-source@0.1.0`
