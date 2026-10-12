---
'@be-music/player-web': patch
---

Draw notes, mines, long notes and bar lines that a negative `#SCROLL` puts below the judgement line while they are still ahead, down to the bottom of the stage, as beatoraja does (its `LaneRenderer` does not clip). They used to vanish at the line and pop back up later. Built-in and SDK skins receive such objects with a `y` below the lane's `bottom`; charts that only scroll forward are unchanged.
