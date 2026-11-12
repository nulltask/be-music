---
'@be-music/player-engine': minor
---

Add LR2's mania chart generators ADD NOTES, LOUDNESS, ADD LONGNOTES and ADD MINES: `PlayerOptions.lr2Mania` holds a rate per generator, and one seed feeds every draw. Replays record `play.lr2Mania` (rates, seed, counts) with the generated chart. ADD NOTES and LOUDNESS are classified `no-save`, ADD LONGNOTES and ADD MINES `light`.
