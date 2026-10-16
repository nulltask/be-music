---
'@be-music/player': minor
---

`autoPlay` followed `replayTempoChanges` in any play, so a live AUTO play handed them changed tempo as if it were a replay: like `manualPlay`, it now follows them only in a replay. Migration: a host replaying an AUTO-played log passes its inputs as `replayInputs` (they are empty) next to `replayTempoChanges`, as it does for a manual log.
