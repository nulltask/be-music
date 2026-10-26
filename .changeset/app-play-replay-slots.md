---
'@be-music/app-play': minor
---

Keep up to four replays per chart and per course in the browser, as beatoraja does: save a play into a slot on its result screen (keys 1-4, a beatoraja skin's replay buttons, or the replay-slot card on the built-in, Native and LR2 skins), give each slot an auto-save rule in Debug Menu → Library & records → Replay slots (by default slot 1 keeps the best EX score, slot 2 the best clear lamp, slot 3 the fewest BP and slot 4 the latest play), and replay a slot from the select screen. Replays are stored gzip-compressed in their own IndexedDB database (`be-music-replays`) under a 500 MB budget; past it the lowest-scoring replays are removed first.
