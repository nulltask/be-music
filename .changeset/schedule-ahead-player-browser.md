---
'@be-music/player-browser': patch
---

Background sounds, volume changes and AUTO keysounds now start at their due time instead of when the engine's ~60 Hz tick reached them, which made each one start 0–17 ms late (about 8 ms on average, a different amount for every sound) and smeared layered BGM samples against each other. The web audio session reports its write head 50 ms ahead and starts each sound at its due time with `start(when)` (`AudioSession.scheduleEventAt`); a queued `#xxx97` / `#xxx98` change applies to the voices that start from its time, and a press of a slot whose sound is queued ahead keeps the queued voice. A press's keysound still starts at once, and judging is unchanged.
