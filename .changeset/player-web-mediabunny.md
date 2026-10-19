---
'@be-music/player-web': patch
---

Replace the deprecated `mp4-muxer` with `mediabunny` (bumped to 1.61.6) for re-muxing BGA video that the WebCodecs path transcodes to H.264, and drop `ts-ebml`: `makeWebmSeekable` now re-muxes the `MediaRecorder` WebM with Mediabunny, copying every packet with its timestamp and writing `Duration` and `Cues`, so bundlers no longer need Node `Buffer` / `events` polyfills or an `ebml` resolve workaround. Mediabunny is loaded on demand by the BGA transcode and the recorder, keeping it out of the main bundle.
