---
'@be-music/player-web': patch
---

Fix beatoraja play skins ignoring `#SCROLL` / `#SPEED` (and bmson `scroll_events`): notes and bar lines were placed by beat, so SCROLL gimmicks did not show. They now use the same scroll distances as the core gameplay view, and on a chart that scrolls, notes and bar lines (with the BPM / STOP markers) draw by beatoraja's `LaneRenderer` rules (the walk stops past the lane top, a note whose time has come is gone, a note a negative rate puts below the line still draws).
