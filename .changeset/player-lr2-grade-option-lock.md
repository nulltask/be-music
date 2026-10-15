---
'@be-music/player': patch
---

An LR2 GRADE course read from `.lr2crs` (`parseLr2CourseFile`) or made with the course maker (`defaultCourseMakerConstraints('grade')`) allowed MIRROR (`grade_mirror`); LR2 turns both sides' lane options off when a GRADE course starts (OpenLR2 `Main.cpp` M1124-M1125), so it now reads as `grade` with `gauge_lr2`. A difficulty table's legacy grade keeps jbmstable-parser's `grade_mirror`. The constraints are part of a course's fingerprint, so these courses get new fingerprints; course rankings are not released yet, so nothing is migrated.
