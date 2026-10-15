---
'@be-music/player': patch
---

Read an LR2 GRADE course from `.lr2crs` (`parseLr2CourseFile`) or the course maker (`defaultCourseMakerConstraints('grade')`) as `grade` with `gauge_lr2`, which allows no lane option: LR2 turns both sides' lane options off when a GRADE course starts. A difficulty table's legacy grade keeps jbmstable-parser's `grade_mirror`.
