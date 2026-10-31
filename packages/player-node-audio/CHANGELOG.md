# @be-music/player-node-audio

## 0.2.1

### Patch Changes

- 3259b06: Fix clicks at bmson sound-slice boundaries in Node playback: a slice that starts inside its file fades in over 1 ms, and one cut before the file's end rings on past its end while it fades out over 1 ms, so a continuation crossfades with the slice before it. Note timing and slice deduplication are unchanged.
- 87e176d: Keep bmson slices independent and restart a slice on a later manual trigger without adding overlapping voices for the same slice.
- 6e14d72: Apply PATH_WAV to gameplay sample decoding and diagnostic duration loading so samples stored under the declared directory are found.
- c13f3fa: Apply authored WAVCMD pitch/sounding-time and EXWAV pan/frequency when preparing realtime samples and active-audio duration diagnostics, using the shared renderer transform.
- 10951d6: Apply per-slot WAVCMD percentage volume and EXWAV attenuation alongside VOLWAV in Node playback. Load EXWAV-only filenames through the same resolver used by duration diagnostics.
- 3e1855e: Apply intrinsic slot gain in realtime Node sample preparation so composed NONSTOP stages retain exact VOLWAV levels.
- Updated dependencies: `@be-music/chart-model@0.8.0`, `@be-music/player-engine@0.12.0`, `@be-music/chart-audio-renderer@0.5.0`, `@be-music/chart-source@0.6.0`, `@be-music/shared-utils@0.7.0`

## 0.2.0

### Minor Changes

- 7f0386b: Provide a Node audio adapter for the playback engine: `createNodeAudioSession` loads samples, mixes keysounds and BGM, and plays through `node-web-audio-api`. Export `loadNodeAudioSampleDurations` for optional diagnostics and the PCM sinks through `./audio-sink`.

### Patch Changes

- Updated dependencies: `@be-music/player-engine@0.11.0`, `@be-music/chart-audio-renderer@0.4.1`, `@be-music/chart-model@0.7.0`, `@be-music/chart-source@0.5.0`, `@be-music/shared-utils@0.6.0`
