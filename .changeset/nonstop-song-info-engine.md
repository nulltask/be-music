---
'@be-music/player-engine': minor
---

Add `resolveNonstopSongInfoState` and `NONSTOP_SONG_INFO_FADE_SECONDS` to `@be-music/player-engine/course`, which tell which stage's song a stitched NONSTOP play shows at a moment and how far its crossfade from the previous stage's has gone. `stitchNonstopCourse` now records each stage's song (`NonstopStitchStage.songInfo`: title, subtitle, artist, genre) for the play screen.
