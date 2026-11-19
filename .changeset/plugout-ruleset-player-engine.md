---
'@be-music/player-engine': minor
---

Adds the `plugout` judge ruleset (revision `plugout/0`), plugout4 -ARCADE EDITION-'s rules read from its executable: fixed windows by rank, charge long notes whose end is a release (a key held 200 ms past the end and an early release are BADs, a scratch held to the end is a PGREAT), the NORMAL / EASY / HARD / HAZARD gauges and their EX variants, course gauges with grade lives, a score out of 100,000 and lamps up to PERFECT. It is in `RULESET_IDS`, replays and re-judging accept it, and the new gauge picks `EX-GROOVE`, `EX-EASY` and `EX-DEATH` reach the EX gauges.

It also follows these plugout rules:

- A single play keeps going when a survival gauge empties, as plugout plays the chart to its end.
- After a BAD the same press judges the lane's next note when that note lies less than 3 ms after the press.
- AUTO SCRATCH only sounds its notes, which are neither judged nor counted.
- An LRX chain note that starts its lane is judged but left out of the note count; replays mark such notes `uncounted`.
- A press with nothing to judge plays plugout's lane sound cursor: the last note a press judged, the lane's next note after a long note is let go, or a hidden note that played since, starting from the lane's first note.
