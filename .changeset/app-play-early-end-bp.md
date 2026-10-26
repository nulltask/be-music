---
'@be-music/app-play': patch
---

A single play quit with ESC is now saved as a FAILED play, as LR2 and beatoraja save one, and sent to the Leaderboard: before, it returned to select with no record. Every play's BP now also counts the notes it never judged, so a play that dies early no longer lowers the best BP; existing records are left as they are.
