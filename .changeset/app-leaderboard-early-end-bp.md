---
'@be-music/app-leaderboard': patch
---

A play's BP now counts the notes it never judged because it failed or was given up mid-way, under every ruleset, so a play that dies early no longer lowers a player's fewest BP. A single play given up with ESC is accepted and ranked as a failed play instead of being refused as `aborted`. BP stored before this change is left as it was.
