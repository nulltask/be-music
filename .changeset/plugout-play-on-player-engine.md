---
'@be-music/player-engine': patch
---

Under the `plugout` ruleset a single play keeps going when a survival gauge empties, as plugout plays the chart to its end, and an LRX chain note that starts its lane is judged but left out of the note count, as plugout's judge cursor and note count treat it. Replays mark such notes `uncounted`.
