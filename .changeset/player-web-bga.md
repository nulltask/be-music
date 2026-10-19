---
'@be-music/player-web': minor
---

Fix BGAs that never showed, stopped early or were stretched:

- A chart that names `_bga.mpg` or `_bga.wmv` while its pack ships the video re-encoded as `_bga.mp4` now finds it: a missing video is looked up under the other video extensions, browser-native containers first, but never as an image. 14 charts in the BMS Starter Pack 2022 and the GdbG packages 2022–2025 were affected. `resolveChartBGAAsset` (`./collection`) resolves a BGA file this way and names the file it found.
- A bare MPEG-1 / MPEG-2 video stream (a `.mpg` with no container) takes the single-pass transcode, which decodes it in order. The chunked WebCodecs transcode trusted the stream's header duration and frame rate, so a 113-second BGA could come out 1.2 seconds long or at the wrong speed; it also keeps reading past a container's reported duration until the video ends.
- As LR2 does, a keysound, image or video not found beside the chart is looked up once more in the chart's parent folder, so 差分 (alternate difficulty) charts shipped in a sub-folder play with their sounds and BGA.
- An image smaller than 256x256 keeps its pixel size on the 256x256 BMS canvas, centered horizontally and top-aligned, as LR2 and beatoraja place it, instead of being stretched over the BGA rect; a base or POOR image leaves the rest of the canvas black, and a `#BGAxx` sub-region is drawn at its authored `dx dy`.
- A beatoraja play loads its BGA with the loader the other families use: TGA and other non-browser image formats, bmson `bga.header` images, `#BGAxx` sub-regions and layer images with their black keyed out now show, and video BGAs use the host's transcode options.
