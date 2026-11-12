# @be-music/chart-audio-renderer

## 0.5.3

### Patch Changes

- f57d9b0: Fix a BMS stage of a NONSTOP course stitched as bmson rendering its keysounds polyphonically: the monophonic retrigger rule now follows each slot's own format.
- Updated dependencies: `@be-music/chart-model@0.11.0`, `@be-music/chart-parser@0.7.2`, `@be-music/chart-source@0.8.0`

## 0.5.2

### Patch Changes

- Updated dependencies: `@be-music/chart-model@0.10.0`, `@be-music/chart-parser@0.7.1`

## 0.5.1

### Patch Changes

- Updated dependencies: `@be-music/chart-model@0.9.0`, `@be-music/chart-parser@0.7.0`, `@be-music/chart-source@0.7.0`

## 0.5.0

### Minor Changes

- dd9ba17: Apply WAVCMD pitch/sounding-time and EXWAV pan/frequency before output-rate conversion. Expose playbackModifiers on renderSingleSample so realtime Node preparation and offline rendering share PCM behavior.
- 5edccbc: Add a path prefix option to single-sample rendering so Node gameplay can apply the chart's PATH_WAV directory with the shared bare-path fallback rules.

### Patch Changes

- 31ad44a: Render paired bmson LN end slices at their authored tails while leaving unmatched or replaced up entries silent.
- 2d520be: Fix clicks at bmson sound-slice boundaries in offline rendering: a slice that starts inside its file fades in over 1 ms, and one cut before the file's end rings on past its end while it fades out over 1 ms, so a continuation crossfades with the slice before it. Note timing and slice deduplication are unchanged.
- aee87a3: Render every bmson continuation slice, including a first c=true note, while deduplicating simultaneous uses of the same slice.
- 3a1e5da: Render EXWAV-only samples and apply WAVCMD volume as a percentage with 100 as unity. Respect EXWAV attenuation bounds, including its silent minimum.
- 7ea3be3: Render intrinsic slot gain with the same volume composition as browser and Node playback, preserving exact NONSTOP stage levels through Be-Music JSON.
- Updated dependencies: `@be-music/chart-model@0.8.0`, `@be-music/chart-parser@0.6.0`, `@be-music/chart-source@0.6.0`, `@be-music/shared-utils@0.7.0`

## 0.4.1

### Patch Changes

- a82ec63: Render stitched bmson audio using retained source-slice coordinates and resource identifiers longer than two characters.
- Updated dependencies: `@be-music/chart-model@0.7.0`, `@be-music/chart-parser@0.5.0`, `@be-music/chart-source@0.5.0`, `@be-music/shared-utils@0.6.0`

## 0.4.0

### Minor Changes

- 559897f: Rename the package from `@be-music/audio-renderer` to `@be-music/chart-audio-renderer` to identify its role consistently. Update imports and package filters to the new name.

### Patch Changes

- Updated dependencies: `@be-music/chart-model@0.6.0`, `@be-music/chart-parser@0.4.0`, `@be-music/chart-source@0.4.0`, `@be-music/shared-utils@0.5.0`

## 0.3.0

### Minor Changes

- 8a051a5: Render chart audio using the shared chart timing and sample-trigger rules, including parent-folder keysound lookup, valid #VOLWAV ranges and LR2 negative-BPM reversal behavior. Update ogg-opus-decoder to 1.7.5.
  
  Migration: use `renderJSON` and the uppercase-abbreviation API names. Import timing resolvers, sample-trigger helpers and their types from `@be-music/chart-model`; the renderer root exports rendering APIs only, and `@be-music/chart-audio-renderer/triggers` is removed.

### Patch Changes

- Updated dependencies: `@be-music/chart-model@0.5.0`, `@be-music/chart-source@0.3.0`, `@be-music/chart-parser@0.3.0`, `@be-music/shared-utils@0.4.0`
## 0.2.4

### Patch Changes

- Updated dependencies: `@be-music/chart-model@0.4.0`, `@be-music/chart-parser@0.2.4`

## 0.2.3

### Patch Changes

- 6ce9173: Missing, undefined, or undecodable `#WAVxx` references are now silent by default, matching LR2 / beatoraja. The synthesized sine fallback tone is opt-in via `fallbackToneSeconds`.
- Updated dependencies: `@be-music/chart-parser@0.2.3`, `@be-music/chart-source@0.2.2`, `@be-music/shared-utils@0.3.0`, `@be-music/chart-model@0.3.2`

## 0.2.2

### Patch Changes

- Updated dependencies: `@be-music/shared-utils@0.2.1`, `@be-music/chart-source@0.2.1`, `@be-music/chart-parser@0.2.2`, `@be-music/chart-model@0.3.1`

## 0.2.1

### Patch Changes

- Updated dependencies: `@be-music/chart-model@0.3.0`, `@be-music/chart-parser@0.2.1`

## 0.2.0

### Minor Changes

- 632f274: Honour the chart's `#BASE 62` object-ID base when resolving WAV / BMP slot IDs at playback time, so `#WAVaA` and `#WAVAA` map to distinct samples. Charts that don't declare `#BASE 62` keep the historical 36-base behaviour.

### Patch Changes

- Updated dependencies: `@be-music/chart-parser@0.2.0`, `@be-music/chart-model@0.2.0`, `@be-music/chart-source@0.2.0`, `@be-music/shared-utils@0.2.0`

## 0.1.0

### Minor Changes

- Initial release.

### Patch Changes

- Updated dependencies: `@be-music/chart-model@0.1.0`, `@be-music/chart-source@0.1.0`, `@be-music/chart-parser@0.1.0`, `@be-music/shared-utils@0.1.0`
