---
'@be-music/player-browser': minor
---

Add `PlaySessionOptions.bgaTranscodeQuality` (`low`, `standard`, `high`, `very-high`): how much bitrate a BGA video transcode spends, on every path (libx264's `-crf`, the WebCodecs encoders' bitrate). `standard` keeps the bitrates transcodes had.
