---
'@be-music/player': patch
---

Count a course given up with ESC as a failed run, as LR2 records it. `simulateCoursePlaylog` and `createCoursePlaylog` fail a course whose last played stage is aborted whatever its gauge, and `checkCoursePlaylogEligibility` accepts an abort on that stage while still refusing one on an earlier stage.
