---
'@be-music/player-web': patch
---

After a course or a song the beatoraja select screen came back on the first bar of the folder (or the first root bar) instead of the bar that was played: `captureSnapshot` saved the cursor kept for the folder as it was entered, not the live one. It now saves the live cursor at every depth.
