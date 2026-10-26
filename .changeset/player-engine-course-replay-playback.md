---
'@be-music/player-engine': minor
---

Add course replay playback helpers to `@be-music/player-engine/replay`: `listCourseReplayStageCharts` and `matchesCourseReplayStageChart` name and match each stage's chart (SHA-256, then MD5, then chart fingerprint), and `planCourseReplayPlayback` lists the stage replays a course replay plays back, up to the first stage given up or failed, so a host can replay a whole course stage by stage.
