---
'@be-music/player-tui': patch
---

Scroll the TUI lane grid from the engine's mirrored display beat past an LR2 negative-BPM reversal (#134), so charts like Sofa $15 → $1 or U9 visibly run backwards instead of continuing forward. The BGA stops changing cues at the reversal while a movie that is already playing keeps running, and the BPM readout holds the reversal value.
