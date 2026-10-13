---
'@be-music/player-web': minor
---

Record gameplay as MP4 as well as WebM, in a chosen video codec. `GameplayRecorder` and the gameplay views' `startRecording` take a `format` (`{ container: 'mp4' | 'webm', videoCodec: 'avc' | 'hevc' | 'vp9' | 'vp8' | 'av1' }`), MP4 with H.264 by default. The WebCodecs backend writes MP4 (AAC, else Opus, audio; index at the front) or WebM, trying the chosen codec first and then the others its container carries; the `MediaRecorder` fallback tries the same order and then WebM. New exports: `RecordingFormat`, `DEFAULT_RECORDING_FORMAT`, `RECORDING_FORMATS`, `describeRecordingFormat`, `recordingVideoCodecs`, `recordingAudioCodecs`, `recorderMimeCandidates` and `recordingFileExtension`; `pickRecorderMimeType` takes an optional candidate list, and `GameplayRecorderResult.seekable` is true for MP4 from either backend.
