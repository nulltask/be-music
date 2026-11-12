# @be-music/player-node-audio

## 0.2.8

### Patch Changes

- f57d9b0: Fix a BMS stage of a NONSTOP course stitched as bmson playing its keysounds polyphonically: the monophonic retrigger rule now follows each slot's own format.
- Updated dependencies: `@be-music/chart-model@0.11.0`, `@be-music/chart-source@0.8.0`, `@be-music/chart-audio-renderer@0.5.3`, `@be-music/player-engine@0.18.0`

## 0.2.7

### Patch Changes

- Updated dependencies: `@be-music/chart-model@0.10.0`, `@be-music/player-engine@0.17.0`, `@be-music/chart-audio-renderer@0.5.2`

## 0.2.6

### Patch Changes

- Updated dependencies: `@be-music/player-engine@0.16.0`

## 0.2.5

### Patch Changes

- Updated dependencies: `@be-music/player-engine@0.15.1`

## 0.2.4

### Patch Changes

- Updated dependencies: `@be-music/player-engine@0.15.0`

## 0.2.3

### Patch Changes

- Updated dependencies: `@be-music/player-engine@0.14.0`

## 0.2.2

### Patch Changes

- Updated dependencies: `@be-music/chart-model@0.9.0`, `@be-music/chart-source@0.7.0`, `@be-music/player-engine@0.13.0`, `@be-music/chart-audio-renderer@0.5.1`

## 0.2.1

### Patch Changes

- 2d520be: Fix clicks at bmson sound-slice boundaries in Node playback: a slice that starts inside its file fades in over 1 ms, and one cut before the file's end rings on past its end while it fades out over 1 ms, so a continuation crossfades with the slice before it. Note timing and slice deduplication are unchanged.
- aee87a3: Keep bmson slices independent and restart a slice on a later manual trigger without adding overlapping voices for the same slice.
- 5edccbc: Apply PATH_WAV to gameplay sample decoding and diagnostic duration loading so samples stored under the declared directory are found.
- dd9ba17: Apply authored WAVCMD pitch/sounding-time and EXWAV pan/frequency when preparing realtime samples and active-audio duration diagnostics, using the shared renderer transform.
- 3a1e5da: Apply per-slot WAVCMD percentage volume and EXWAV attenuation alongside VOLWAV in Node playback. Load EXWAV-only filenames through the same resolver used by duration diagnostics.
- 7ea3be3: Apply intrinsic slot gain in realtime Node sample preparation so composed NONSTOP stages retain exact VOLWAV levels.
- Updated dependencies: `@be-music/chart-model@0.8.0`, `@be-music/player-engine@0.12.0`, `@be-music/chart-audio-renderer@0.5.0`, `@be-music/chart-source@0.6.0`, `@be-music/shared-utils@0.7.0`

## 0.2.0

### Minor Changes

- e6ea4d2: Provide a Node audio adapter for the playback engine: `createNodeAudioSession` loads samples, mixes keysounds and BGM, and plays through `node-web-audio-api`. Export `loadNodeAudioSampleDurations` for optional diagnostics and the PCM sinks through `./audio-sink`.

### Patch Changes

- Updated dependencies: `@be-music/player-engine@0.11.0`, `@be-music/chart-audio-renderer@0.4.1`, `@be-music/chart-model@0.7.0`, `@be-music/chart-source@0.5.0`, `@be-music/shared-utils@0.6.0`
