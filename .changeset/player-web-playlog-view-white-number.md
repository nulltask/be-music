---
'@be-music/player-web': patch
---

The built-in and LR2 play screens record the play log's view with the scene model's `resolvePlaylogView`: `visibleMs` is beatoraja's white number over the lanes laid out (`resolveWhiteNumber`), with LIFT left out, as beatoraja's `LaneRenderer` leaves it out. A replay recorded on another hi-speed scale works out its hi-speed with `resolveHiSpeedForWhiteNumber`, and the HUD's green and white numbers come from the same formula. These scenes draw no LIFT, so the recorded values are unchanged; a replay of an older log may land on a hi-speed that differs by rounding, as the formula is now worked in beats rather than design pixels.
