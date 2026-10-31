---
'@be-music/player-browser': minor
---

A BGA video the browser can't play (`.wmv`, `.avi`, `.mpg`, …) now starts playing while ffmpeg.wasm is still transcoding it, instead of after the whole file is done: the transcode streams fragmented MP4 into the `<video>` through Media Source Extensions (`ManagedMediaSource` on iPhone). Hosts opt in by installing two workers with the new `configureBGAVideoWorkers` from `./compute`, whose entries call the new `runBGAVideoDecodeWorker()` / `runBGAVideoEncodeWorker()`. On a cross-origin isolated page the frames are encoded with WebCodecs under `SharedArrayBuffer` flow control; elsewhere ffmpeg's own libx264 encodes them. Without the workers or MSE the whole-file transcode runs as before.
