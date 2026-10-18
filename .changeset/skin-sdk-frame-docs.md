---
'@be-music/skin-sdk': patch
---

Document how the player fills the play frame, where it now follows LR2 and beatoraja:

- A note, mine, long note or measure line can sit below the judgement line (down to the bottom of the stage) in a chart with a negative `#SCROLL`, because the player draws such charts the way beatoraja does. Skins that want nothing below the line clip to the lane's `bottom`.
- A long note's head (`bottom`) is held on the judgement line once its time has passed, and LR2 and the built-in skins draw a `'dropped'` long note at half alpha until it goes.
- `visibleMs` and `greenNumber` follow the chart's `#SCROLL` × `#SPEED` at the playhead and read 0 while the chart scrolls backwards or stands still.
- `mainBpm` is the BPM the most notes sit at (beatoraja's main BPM), not the BPM held longest; HS-FIX `'AVERAGE'` pegs the hi-speed to it, and the play log's `visibleMs` is taken at it.
