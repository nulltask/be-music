---
'@be-music/player-engine': minor
---

PRACTICE can loop its range in place, measured in bars:

- With `practice.loop: true` (`PlayPractice.loop`) a practice play goes back to its start where it would end — once every note in the range is judged, or its gauge empties — instead of finishing, as a seek there does: the judge, score, combo and gauge return to the practice settings, the audio stops what still rings, and the host gets a `seek` UI command and a frame of the next generation. The play then ends only at an interrupt.
- The lead-in and the end are measured in bars instead of seconds, so they line up with the music: a practice play starts at the head of the bar before the one the range starts in (the chart's start in the first bar) and ends, or loops, at the head of the bar after the one its END TIME lies in, read from the resolved chart's bar lines through BPM changes, `#xxx02` measure lengths and stops (`resolvePracticePlayWindow`). The prepared chart reports the start as `practicePlayStartSeconds`. Without an END TIME the play still runs 1000 ms past the chart's end; beatoraja uses 1000 ms on both sides.
