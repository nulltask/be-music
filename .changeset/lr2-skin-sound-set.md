---
'@be-music/lr2-skin': patch
---

Fix the course result playing `clear` / `fail` with LR2's own sound files: `loadLr2ThemeSkinsFromFiles` looked the course jingles up as `courseclear` / `coursefail`, while the stock set names them `course_clear.wav` / `course_fail.wav`. The theme loader now reads the dropped sound set (`LR2files/Sound/*.lr2ss`, `lr2.lr2ss` first), as LR2 does, for the select / decide BGM, the clear / fail / course jingles and the cursor, folder and option sounds, and falls back to the stems under `Sound/lr2/` (`course_clear` or `courseclear` for the course jingles) when there is no sound set or it does not name the file.
