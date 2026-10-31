# @be-music/chart-model

## 0.8.0

### Minor Changes

- 4480fe0: Add an optional `allowLongKeys` argument to `parseBmsBGA` so internal mixed-NONSTOP bmson resource references can exceed two characters without truncation. Ordinary BMS parsing keeps its existing two-character normalization.
- dcb4256: Expose BGA opacity timelines and time-based selection for channels `0B`–`0E`. Interpret nonzero hexadecimal bytes independently of the resource-id base, use chart timing including STOPs, and restore prior opacity when seeking backwards.
- 206afe9: Expose constituent bmson slices on resolved layered notes so one judged note retains its complete input sound. As in beatoraja, the first sound channel's note is kept and a stacked note of another length is dropped with its sound; the chart still loads.
- ceb5fcc: Attach bmson up slices to matching long-note tails as endSoundEvent. Keep unmatched definitions as silent slicing boundaries and resolve duplicate end sounds deterministically.
- c6f70f4: Expose deterministic bmson BGA event-layer resolution: sequences with authored millisecond frame times, header-index references, missing images and end markers, conditional image sets and frame lookup. Event-layer consumers can keep ordinary layer changes as selection clears, conditional and sequence events stay out of the normal image timeline, and resolved event cues retain NONSTOP stage ownership, trim anchors, FIT playback rates and exclusive animation windows. A selected conditional MISS definition clears an earlier POOR image so it cannot reappear after a short sequence ends. An `id_set`-only `bga_events` or `poor_events` entry reads beatoraja's default id 0: it shows header id 0 when one exists and otherwise changes nothing.
- d611e66: Add deterministic chart-text timeline construction and lookup for BMS channel 99, including quote decoding, replacement/clearing, missing references and separate TEXT00 miss metadata. Stop treating channel 99 as a sample trigger, preventing an unrelated WAV from sounding.
- 5992a52: Add versioned effective chart-option compilation and stateless lookup. Execute native HI-SPEED values without user-control clamping, retain initial numeric HSP aliases and report unsupported, malformed or disallowed declarations.
- c13f3fa: Resolve WAVCMD pitch and sounding-time limits together with EXWAV native-rate frequency and stereo balance. Export shared modifier collection and playback resolution with documented dialect bounds and composition rules.
- 10951d6: Resolve EXWAV-only sample filenames consistently and use MacBeat percentage volume (100 is unity). Add resolveBmsWAVResources and wavCmdVolumePercentToLinearGain. Parse WAVCMD 02 as duration rather than loop, reject malformed EXWAV parameters and constrain playback attenuation to its dialect bounds.
- 86f4978: Resolve initial charatbeatHDX LONGMODE declarations into CN/HCN notes and conditional fingerprints, with explicit LNMODE taking precedence and timed changes diagnosed.
- 3e1855e: Add collectBmsWAVVolumeMultipliers to combine WAVCMD, EXWAV and intrinsic slot gain consistently without rounding composed stage volume.
- 07a8c75: Add `buildChartOptionTimeline` to collect resolved initial OPTION declarations and timed A6 references without splitting vendor arguments or inventing vendor semantics. Preserve missing references for diagnostics and require branch resolution first.
- 9a5554f: Remove helpers that implemented superseded interpretations: `parseBMSSwBGA`, `pickSwitchingBGAFrame` and `BMSSwitchingBGA` (cue-driven SWBGA; use `parseBMSKeyBoundBGA` and the A5 timeline), `resolveBmsBmpARGB` (slot tint; use `resolveBMSExBMPColorKey` and the A1–A4 tint timeline), and `wavCmdVolumeByteToLinearGain` (use `wavCmdVolumePercentToLinearGain`).
  Rename `BMSExWAV.volumeCentibels` to `volumeMillibels` and `exWAVVolumeCentibelsToLinearGain` to `exWAVVolumeMillibelsToLinearGain`: the value is in hundredths of a decibel (millibels), not centibels.
- afc65fb: Preserve generic bmson keyboards as distinct generic-N play variants with 1–70 ordinary keys, declared empty columns and layout-aware fingerprints. Expose bounded generic-hint resolution and shared lane tables.
- 5c820d9: Add `pickBGATint` and resolve channel-scoped A1–A4 ARGB controls in BGA timelines. Share alpha with 0B–0E opacity changes while retaining each plane's RGB multipliers, with deterministic equal-time selection and seek restoration.
- 4b09c06: Add `resolveBMSExBMPColorKey` and `applyBMSColorKey` for strict EXBMP color-key selection and alpha-aware RGBA8 matching. Preserve unrelated colors and source alpha instead of treating the tuple as a multiplicative tint.
- 87461c3: Add standard SWBGA parsing, A5 selection timelines and millisecond frame selection, preserving packed BMP00 frames and raw ARGB fields. Exclude A0–A6 controls from WAV sample triggers so matching resource ids cannot play unrelated audio.
- 458b6f3: Add optional selection-window and source-video-rate metadata to input-bound BGA cues so NONSTOP hosts preserve stage ownership and FIT timing without changing the external BMS grammar.

### Patch Changes

- 87e176d: Cut bmson stems at every distinct note pulse so missed continuation notes stay silent, and resolve mixed BGM/playable slice lists in timeline order.
- e66f84f: Resolve bmson scroll values beyond the BMS resource capacity and fingerprint STOP durations by their actual values, including deduplicated and edited resources.
- fbe15fd: Parse whitespace-separated EXWAV parameters in authored flag order so multi-parameter declarations retain the correct filename and volume. Keep earlier comma-separated input compatible.
- aec2c56: Resolve duplicate BPM, STOP, SCROLL and SPEED objects on one channel at one position by file order, so the later line wins as in beatoraja, instead of by the larger object id. `#xxx08` still beats `#xxx03` at one position, as in LR2, and a duplicated STOP still applies once.
- b1cb060: Parse standard `#EXBMPxx a,r,g,b filename` declarations as well as the previously accepted comma-before-filename form. Preserve spaces and commas in filenames so players can locate these resources.
- Updated dependencies: `@be-music/chart-source@0.6.0`, `@be-music/shared-utils@0.7.0`

## 0.7.0

### Minor Changes

- 69df53c: Resolve extended bmson resource keys, source-audio slice coordinates and explicit TOTAL units so stitched mixed-format NONSTOP charts retain their playback data.
- f994ec4: Export the shared `resolvePoorBGAMode` parser so browser and terminal BGA rendering use the same chart policy.

### Patch Changes

- a83e326: Use `____` in internal names for the That-Which-Must-Not-Be-Named lane layouts and mode detection.
- c52d77d: `computeChartFingerprint` is faster on `#RANDOM` / `#SWITCH` charts (about 40% on the heaviest, `_random_s4.bms` 118 → 72 ms), with byte-identical fingerprints: outcomes that change only events reuse the notes already resolved for a lane with the same events, the lane buckets merge in order instead of being re-sorted, and the diff against the top-level content finds the shared runs by comparing fields instead of keying every note. Checked against every chart of a 5,537-chart collection and 400 generated control-flow charts.
- Updated dependencies: `@be-music/chart-source@0.5.0`, `@be-music/shared-utils@0.6.0`

## 0.6.0

### Minor Changes

- dca9a2f: Rename the package from `@be-music/chart` to `@be-music/chart-model` to identify its role consistently. Update imports and package filters to the new name.

### Patch Changes

- Updated dependencies: `@be-music/chart-source@0.4.0`, `@be-music/shared-utils@0.5.0`

## 0.5.0

### Minor Changes

- b2818d0: Provide a shared chart-resolution API for timing, judging, playback, rendering and fingerprinting.
  
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
