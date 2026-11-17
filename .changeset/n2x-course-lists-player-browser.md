---
'@be-music/player-browser': minor
---

Read dropped `.n2x` chart lists as courses: `isCourseFilePath` takes every `.n2x`, `readCourseFile` reads a list as one course named after the file with its stages' paths resolved from the drop's root, and the new `bindCourseStagePaths` gives each path stage the hashes and title of the chart at that path, so the course finds, records and replays its charts like any other.
