---
'@be-music/player-engine': minor
---

Preserve BGA opacity channels `0B`–`0E` when stitching NONSTOP stages, carry effective values from trimmed leading intervals, and restore opaque defaults for stages without commands. Expose independent stage histories as `NonstopStitchStage.bgaOpacity` on the stitched clock for BGA crossfades, retaining FIT/STOP timing without changing judged notes or rank inputs.
