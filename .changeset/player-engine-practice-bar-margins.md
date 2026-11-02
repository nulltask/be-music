---
'@be-music/player-engine': minor
---

PRACTICE now measures its lead-in and loop point in bars instead of seconds, so they line up with the music: a practice play starts at the head of the bar before the one the range starts in (the chart's start in the first bar) and ends, or loops, at the head of the bar after the one its END TIME lies in, read from the resolved chart's bar lines through BPM changes, `#xxx02` measure lengths and stops (`resolvePracticePlayWindow`). The prepared chart reports the start as `practicePlayStartSeconds`. Without an END TIME the play still runs 1000 ms past the chart's end; beatoraja uses 1000 ms on both sides.
