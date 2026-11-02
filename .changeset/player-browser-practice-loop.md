---
'@be-music/player-browser': patch
---

A PRACTICE play loops its range inside the same play scene instead of finishing: it hands the engine the range with `loop: true`, and takes each restart as a seek, so the score, combo and gauge reset to the practice settings while the decoded samples, BGA and skin stay. ESC still leaves.
