---
'@be-music/lr2-skin': minor
---

Load LR2 course skins: `loadLr2ThemeSkinsFromFiles` now returns the theme's course-result skin (`courseResultSkin`, `#INFORMATION` type 15 under `CourseResult/`) and its `courseclear` / `coursefail` jingles, plus `loadSkin` to parse one of its skins again with extra parse-time ops (`LoadLr2SkinOptions.parseOps`), so a course stage can take the `#IF` blocks gated on the course ops 280-293 as LR2 does. `pickLr2PlaySkinVariant` names the play-skin variant a chart plays on.
