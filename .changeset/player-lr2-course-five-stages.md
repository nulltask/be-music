---
'@be-music/player': patch
---

Read every `.lr2crs` course as its first five stages, not only NONSTOP ones: LR2 plays at most five stages of any course, EXPERT and GRADE included. An EXPERT or GRADE course with more stages is now shorter, and its course fingerprint changes. `LR2_MAX_NONSTOP_STAGES` is renamed `LR2_MAX_PLAYED_STAGES`.
