---
'@be-music/player-web': minor
---

Show courses on LR2 skins: the select, gameplay and result scenes take a `courseInfo` (`SceneCourseInfo`, built with `resolveSceneCourseInfo`) and light LR2's course ops (290-293, 280-289 for the stage), fill numbers 250-259 and texts 150-170, count numbers 104 / 105 over the whole course in an expert or grade course, and report the red gauge ops for a course stage. `resolveLr2CourseOps` gives the ops for parsing a course stage's skin again.
