---
'@be-music/player-engine': minor
---

A PRACTICE play's first notes no longer start on the judgement line, and a loop with no rest after the bars no longer jumps. The first round starts a bar before the range even with `restBarsBefore` 0 (`PreparedPlaybackChartData.practiceLoopStartSeconds` is where each loop goes back to). With `restBarsAfter` 0 a looping play goes back the moment it reaches the range's end, carrying the time past it, and `renderNotes` draws the next round's notes past the end, so the loop runs on without a seam.
