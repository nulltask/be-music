---
'@be-music/player-engine': minor
---

Add the RANDOM MIX conditions and a draw one stage at a time to `@be-music/player-engine/course`: `RandomMixConditions` (including `estimateDifficulty`, which narrows a chart without `#DIFFICULTY` by `RandomMixCandidate.estimatedDifficulty`) with `normalizeRandomMixConditions`, `matchesRandomMixConditions`, `filterRandomMixCandidates`, `listRandomMixKeyModes`, `resolveRandomMixCount`, `isRandomMixKept`, `drawRandomMixStage` (which reads a chart's BPMs only for the charts it walks, with randomness passed in) and `createRandomMixCourse`. `CourseRun` takes `{ endless: true }` for a run without a last stage, to which a host adds stages with `appendStage`.
