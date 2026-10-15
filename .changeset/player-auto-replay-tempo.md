---
'@be-music/player': patch
---

An auto play ignored `replayTempoChanges`, so the replay of an auto-played log ran at its starting tempo; it now follows the recorded changes as a manual replay does. An auto play given up with ESC now records where it stopped (`play.abortedAtUs`), as a manual play does, so a course counts the stage's play time up to there.
