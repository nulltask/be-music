---
'@be-music/player': minor
---

Let NONSTOP course runs be ranked: `checkCoursePlaylogEligibility` no longer refuses a course log with `nonstop` (the `nonstop` reason is gone). It checks the stitched play like a single play (an ESC abort is a failed run), requires it to cover every course stage and every stage to name its chart, and returns the stitched play's fingerprints as `nonstop` (with `stages` empty). A NONSTOP stage now records the `#RANDOM` / `#SWITCH` draws its chart was resolved with (`PlaylogNonstopStage.randomDraws`, parsed by `parseCoursePlaylog`; `resolveNonstopPlaylogStages` takes them as a second argument), so a verifier can rebuild the stitched chart from the stage charts.
