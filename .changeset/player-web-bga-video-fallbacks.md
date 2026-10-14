---
'@be-music/player-web': minor
---

Fix video BGAs that never showed or stopped after a second or two:

- A chart that names `_bga.mpg` or `_bga.wmv` while its pack ships the video re-encoded as `_bga.mp4` now finds it: a missing video is looked up under the other video extensions, browser-native containers first, but never as an image. 14 charts in the BMS Starter Pack 2022 and GdbG packages 2022–2025 were affected.
- A bare MPEG-1 / MPEG-2 video stream (a `.mpg` with no container) no longer goes through the chunked WebCodecs transcode. That transcode trusted the stream's header duration and frame rate, which can be far off, so a 113-second BGA came out 1.2 seconds long, or at the wrong speed. Such streams now take the single-pass transcode, which decodes them in order. The chunked transcode also keeps reading past a container's reported duration until the video ends.
- As LR2 does, a keysound, image or video not found beside the chart is looked up once more in the chart's parent folder, after every extension in the chart's own folder, so 差分 (alternate difficulty) charts shipped in a sub-folder play with their sounds and BGA.
- The beatoraja path now resolves BGA files with the image / video resolver instead of the audio one, and uses the host's transcode options (WebCodecs encode, size cap) like the LR2 path.

New export: `resolveChartBgaAsset`, which also names the file it found.
