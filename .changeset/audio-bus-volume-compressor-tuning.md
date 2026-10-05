---
'@be-music/player-web': minor
---

Let hosts balance keysounds against BGM and tune each compressor.

- The audio bus gains per-bus user volume (`setBusVolume` / `getBusVolume`, `initialVolumes`) applied at each source mixer ahead of the compressor stack, and live compressor tuning (`setCompressorParams` / `getCompressorParams`, `initialCompressorParams`) for the key, BGM, master, and legacy compressors, clamped to the Web Audio ranges.
- New `@be-music/player-web/runtime` exports: `AudioBusChannel`, `TunableCompressor`, `MAX_BUS_VOLUME`, `sanitizeBusVolume`, `DEFAULT_COMPRESSOR_PARAMS`, `COMPRESSOR_PARAM_RANGES`, and `mergeCompressorParams`.
- Gameplay views take `audioVolumes` and `audioCompressorParams` options and expose `setAudioVolume` / `setAudioCompressorParams` to change them live; the beatoraja gameplay prep accepts `audioBusOptions` for the same initial state.
