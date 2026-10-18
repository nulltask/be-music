---
'@be-music/player-web': minor
---

Play LR2 and beatoraja courses. `./collection` reads dropped course files with `readCourseFile` (`.lr2crs`, a beatoraja course `.json` and beatoraja's command-folder file, returning every course group a file holds), matches their stages to the collection by hash (`createSongHashLookup`) and lists them as course folders (`resolveCourseFolders`). A beatoraja random course is listed as a course bar (`createRandomCourseEntry`) whose stages `drawBrowserRandomCourse` draws from the collection, matching each chart against the stage filters through `createCourseSongRecord`.

Every family's select screen lists the course folders and bars and starts a course from its bar, PLAY or AUTO, a skin's PLAY / AUTO buttons included, through `on.start` with a `{ kind: 'course', course }` entry. A course with a stage missing from the collection is handed over too, so the host can say why it does not start. The key-mode filter lists a course that names its key mode (`definition.keyMode`) only under that mode, as LR2 lists courses by their `line`, and keeps one that names none; a search lists the courses whose name matches. Course bars show the player's course records (`records.course`):

- LR2 skins draw the course bar bodies (`#SRC_BAR_BODY` 8, with 7 for NEW COURSE and 9 for a random course), light the focused bar's lamp ops (100-105) and `#SRC_BAR_LAMP`, light ops 700-745 by each stage's `#DIFFICULTY` as OpenLR2 does, and show the course on texts 150-170 and numbers 250-259.
- beatoraja skins light `OPTION_GRADEBAR` (3) on a fixed course bar and `OPTION_RANDOMCOURSEBAR` (1031) on a random one, `OPTION_PLAYABLEBAR` (5) on a course that can start, the course's constraint ops and its `CLEAR_LAMP_*` op, and name its stages on strings 150-159.
- The built-in skins show the course's name, kind, stage count and stages, and its best lamp with the trophy its bests earn.
