---
'@be-music/player-browser': minor
---

The folder reload key (LR2's F8, beatoraja's F2) on the select screen asks the host to read the library again (`SelectSessionEvents.reload`). `dropEntries` and `readDropEntries` keep a drop's entries and walk them again, so a host can read what the dropped folders hold now.
