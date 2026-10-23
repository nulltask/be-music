---
'@be-music/player-browser': patch
---

Fix missing POOR BGA after empty presses by stamping the pause-aware millisecond play clock instead of chart seconds. Use an explicit inactive sentinel so a real miss at clock zero displays, and reject future or expired stamps.
