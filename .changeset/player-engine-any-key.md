---
'@be-music/player-engine': minor
---

Add ANY KEY (That-Which-Must-Not-Be-Named PC's assist, #751) as `PlayerOptions.anyKey`: each press takes the nearest unjudged note in reach on any lane, the scratch included, a chord takes as many presses as it has notes, and a long note stays held until the key that took its head comes up. The replay records `play.anyKey` and keeps each key's own lane in `inputs`, and replay playback and `simulateReplay` route the presses again by the same rule, so they agree. `classifyReplayAssists` classifies it `any-key` from the `____` source as `no-save`, so a play with it keeps no record and is stored unranked.
