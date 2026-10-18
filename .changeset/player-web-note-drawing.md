---
'@be-music/player-web': patch
---

Draw notes by LR2's and beatoraja's own rules, on every skin family. Notes used to be cut at the judgement line, a judged note was hidden at once by default, and beatoraja play skins ignored `#SCROLL` / `#SPEED`.

- A chart without `#SCROLL` / `#SPEED` is drawn by LR2's `DrawNotes` rules whatever the judge ruleset and the skin, since drawing is not part of a ruleset. A passed note, mine, long-note end or bar line waits on the judgement line instead of vanishing below it. A note goes once it is judged and its beat has passed, so an unhit note waits until the late window misses it and an auto lane's note goes at its beat. A long note missed at its head or let go early is drawn at half alpha until its end, and a bar line under a STOP that began on it stays on the line.
- A judged note keeps scrolling down to the judgement line by default (`judgedNoteDisplay: 'KEEP_SCROLLING'`), as LR2 and beatoraja both do; `'HIDE'`, which was the default, stays a choice.
- A chart with `#SCROLL` / `#SPEED` (or bmson `scroll_events`), which LR2 cannot play, is drawn by beatoraja's `LaneRenderer` rules, beatoraja play skins included. The walk stops at the first point past the lane top, so objects a later negative SCROLL brings back no longer appear before their turn. A note whose time has passed is gone, judged or not, and a long note's head stays on the line until its tail's time. A note a negative SCROLL puts below the line while it is still ahead draws down to the bottom of the stage (built-in and SDK skins receive it with a `y` below the lane's `bottom`). A chart whose SCROLL / SPEED points are all 1 scrolls as a plain chart.
- The green number and `visibleMs` follow SCROLL / SPEED: the visible duration is divided by the scroll rate at the playhead and reads 0 while the chart scrolls backwards or stands still, as beatoraja shows it.
