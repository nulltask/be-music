---
'@be-music/lr2-skin': minor
---

Load what an LR2 theme's course screens and sounds need:

- `loadLR2ThemeSkinsFromFiles` returns the theme's course-result skin (`courseResultSkin`, `#INFORMATION` type 15 under `CourseResult/`) and its course clear / fail jingles, plus `loadSkin` to parse one of its skins again with extra parse-time ops (`LoadLR2SkinOptions.parseOps`), so a course stage can take the `#IF` blocks gated on the course ops 280-293 as LR2 does.
- The theme's sounds come from the dropped sound set (`LR2files/Sound/*.lr2ss`, `lr2.lr2ss` first), as LR2 reads them, for the select / decide BGM, the clear / fail / course jingles and the cursor, folder and option sounds, falling back to the stems under `Sound/lr2/` (`course_clear` or `courseclear` for the course jingles) when there is no sound set or it does not name the file.
- `pickLR2PlaySkinVariant` names the play-skin variant a chart plays on.
