---
'@be-music/player-web': patch
---

Take `#SCROLL` and `#SPEED` into account in the green number and `visibleMs`: the visible duration is divided by the scroll rate at the playhead and reads 0 while the chart scrolls backwards or stands still, as beatoraja shows it. It used to follow the BPM alone, so gimmick charts showed a duration unrelated to what was on screen.
