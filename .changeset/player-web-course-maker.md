---
'@be-music/player-web': minor
---

Let the player make their own courses on the select screen, as on LR2.

- `CourseMaker` (`@be-music/player-web/collection`) holds the player's courses and the course being made, and `resolveCourseMakerFolders` lists them as EXPERT / NONSTOP / GRADE course folders, each ending with a NEW COURSE bar.
- The select views take `courseMaker`, `onCourseNameActivate` and `onCourseDeleteRequest`. An LR2 skin lights ops 571 / 572, 580-599, runs timers 17 / 18, shows the course being made on texts 150-154 / 170 and the default connection on 198, and handles buttons 230, 231, 233, 240-248 and 268.
