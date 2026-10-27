# @be-music/player-node-audio

## 0.2.0

### Minor Changes

- 7f0386b: Provide a Node audio adapter for the playback engine: `createNodeAudioSession` loads samples, mixes keysounds and BGM, and plays through `node-web-audio-api`. Export `loadNodeAudioSampleDurations` for optional diagnostics and the PCM sinks through `./audio-sink`.

### Patch Changes

- Updated dependencies: `@be-music/player-engine@0.11.0`, `@be-music/chart-audio-renderer@0.4.1`, `@be-music/chart-model@0.7.0`, `@be-music/chart-source@0.5.0`, `@be-music/shared-utils@0.6.0`
