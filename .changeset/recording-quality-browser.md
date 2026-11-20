---
'@be-music/player-browser': minor
---

Add recording quality: `RecordingQuality` (`low`, `standard`, `high`, `very-high`), `RECORDING_QUALITIES`, `DEFAULT_RECORDING_QUALITY`, `describeRecordingQuality` and `resolveRecordingBitrates`, which scales the video bitrate by the canvas size and frame rate (within 1–80 Mbps) and picks the audio bitrate. `PlayScene.startRecording` takes a `quality`; `standard` keeps the bitrates recordings had (about 5.5 Mbps of video at 1280×720 and 192 kbps of audio).
