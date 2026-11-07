---
'@be-music/player-engine': minor
---

Add `hasRandomMixFirstStage` to `@be-music/player-engine/course`, which tells whether any chart of a RANDOM MIX pool can be stage 1 under the draw settings (the BPM range and limits), reading BPMs only until it finds one.

Add `RandomMixConditions.allowBPMChanges` (default `true`) and `RandomMixStageOptions.allowBPMChanges`: a chart whose BPM changes can be stage 1, and the BPM limits and range read its max BPM.
