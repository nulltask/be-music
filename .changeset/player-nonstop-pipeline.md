---
'@be-music/player': minor
---

Add the NONSTOP course pipeline to `@be-music/player/course`, so a host stitching a course to play it and the Leaderboard rebuilding a run's stitched chart take the same steps:

- `prepareNonstopCourse` resolves each stage chart's `#RANDOM` / `#SWITCH` (with recorded draws, or drawn), applies the course's long-note constraint and stitches the stages; the host's asset plumbing comes in through `assetPath`.
- `resolveNonstopRun` gives a play's `nonstop` record: the stage placements with their draws and the stage of every note.
- `buildNonstopCoursePlaylog` builds the course play log of a NONSTOP run, naming each stage by its chart fingerprint.
