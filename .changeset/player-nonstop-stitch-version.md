---
'@be-music/player': minor
---

Record the version of the NONSTOP stitching rules in a course play log (`nonstop.stitch`, `NONSTOP_STITCH_VERSION`), so a stitched chart can be rebuilt by the rules it was played on after the rules change. `stitchNonstopCourse` takes the version as `options.stitch` and refuses one it does not know (`stitch-version`); logs without it read as version 1.
