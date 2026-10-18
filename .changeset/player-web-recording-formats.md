---
'@be-music/player-web': minor
---

Record a play as MP4 as well as WebM, in a chosen video codec, MP4 with H.264 by default. `GameplayRecorder` and `PlayScene.recording.startRecording()` take a `format` (`{ container: 'mp4' | 'webm', videoCodec: 'avc' | 'hevc' | 'vp9' | 'vp8' | 'av1' }`). The WebCodecs backend writes MP4 (AAC audio, else Opus; index at the front) or WebM, trying the chosen codec first and then the others its container carries, and the `MediaRecorder` fallback tries the same order and then WebM. New in `./recording`: `RecordingFormat`, `DEFAULT_RECORDING_FORMAT`, `RECORDING_FORMATS`, `describeRecordingFormat`, `recordingVideoCodecs`, `recordingAudioCodecs`, `recorderMimeCandidates` and `recordingFileExtension`. `pickRecorderMimeType` takes an optional candidate list, and `GameplayRecorderResult.seekable` is true for MP4 from either backend.
