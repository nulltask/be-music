---
'@be-music/player-web': patch
---

Draw every chart without `#SCROLL` / `#SPEED` by LR2's note-drawing rules, whatever the judge ruleset and the skin (LR2, be-music or beatoraja play skin); drawing is not part of a ruleset, and only charts with `#SCROLL` / `#SPEED`, which LR2 cannot play, keep beatoraja's `LaneRenderer` rules. Under the `beatoraja` ruleset plain charts used to switch to beatoraja's rules, and everywhere notes were cut at the judgement line. The rules now follow LR2's `DrawNotes`:

- A passed note, mine, long-note head or tail and bar line is held on the judgement line instead of vanishing below it.
- A note or mine goes once it is judged and its beat has passed, so a note the player has not hit waits on the line until the ruleset's late window judges it a miss, and an auto lane's note goes at its beat.
- A long note keeps its head sprite on the line until it goes, and one missed at the head or let go early is drawn at half alpha (LR2's `0x80`) until its end, in LR2 skins, the scene's fallback drawing and the built-in skins.
- A bar line goes once the playhead has passed it, so one under a STOP that began on it stays on the line.
- beatoraja play skins no longer let bar lines slide up to 24 px under the line, and no longer drop a judged note before its time.
