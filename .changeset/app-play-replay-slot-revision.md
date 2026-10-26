---
'@be-music/app-play': patch
---

Version the replay slots' storage with a revision kept in the `be-music-replays` database. It starts at 0, where a stored slot that no longer reads as a slot record is cleared with its replay; from revision 1 on, a bump migrates the stored slots step by step.
