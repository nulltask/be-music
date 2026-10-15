---
'@be-music/player-web': patch
---

Replays restore the recorded `play.endOnFailure` and `play.course` settings. A log recorded before plays ended on failure still replays to the end of the chart, and a course stage replays on its course gauge from the state it was recorded with.
