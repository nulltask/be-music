---
'@be-music/player-engine': minor
---

PRACTICE can loop its range in place: with `practice.loop: true` (`PlayPractice.loop`) a practice play goes back to its start (1000 ms before the range) where it would end — 1000 ms past the range with every note judged, or its gauge emptied — instead of finishing, as a seek there does: the judge, score, combo and gauge return to the practice settings, the audio stops what still rings, and the host gets a `seek` UI command and a frame of the next generation. The play then ends only at an interrupt.
