---
'@be-music/player-web': minor
---

Fix gameplay recordings showing the picture ~40-50 ms ahead of the sound. `MediaRecorder` stamps video and audio on arrival and the Web Audio path reaches it later than the canvas, by an amount that varies per machine; the recorder now encodes with WebCodecs and muxes with Mediabunny (new runtime dependency `mediabunny`), stamping frames with the `AudioContext` time they were drawn at and audio from an `AudioWorklet` by sample position, so both tracks share the gameplay clock (measured offset within 4 ms, against 41-47 ms before). Browsers without WebCodecs / `AudioWorklet` or a WebM encoder keep the `MediaRecorder` path.

- New `GameplayRecorderOptions.subscribeFrame` captures each frame right after the scene renders (the built-in gameplay views pass `PixiSceneHost.onAfterRender`), and `backend` forces a backend.
- `GameplayRecorderResult.seekable` tells whether the file already carries its seek index; `makeWebmSeekable` is only needed when it is `false`.
- New exports `alignAudioChunk`, `resolveFrameTimestamp` and `supportsWebCodecsRecording`.
