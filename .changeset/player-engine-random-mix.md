---
'@be-music/player-engine': minor
---

Add LR2's RANDOM MIX draw to `@be-music/player-engine/course`: `drawLR2RandomMix` draws a course by stage count, level limits, BPM limits, a BPM range around stage 1's max BPM and a favorite level, one stage per song folder, as LR2's `WriteRandomCourse` does, with the randomness passed in so a draw is reproducible. `LR2RandomMixSettings` with `DEFAULT_LR2_RANDOM_MIX_SETTINGS`, `LR2_RANDOM_MIX_SETTING_RANGES`, `stepLR2RandomMixSetting`, `normalizeLR2RandomMixSettings` and `resolveLR2RandomMixSettings` hold the settings LR2's buttons 260-266 edit.
