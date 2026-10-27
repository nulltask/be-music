---
'@be-music/player-engine': patch
---

The play loop no longer busy-waits: each 60 Hz tick sleeps its whole remainder in one timer (re-armed if the host fires it early) instead of sleeping 4 ms short and polling the rest with zero-delay timers. The polling kept the thread busy for the last milliseconds of every tick, about 5% of the browser's main thread on a dense chart; a JUDGE is timed by its `pressedAt` and audio is queued ahead of the write head, so nothing depended on the tick landing exactly. Inputs still wake the loop at once.
