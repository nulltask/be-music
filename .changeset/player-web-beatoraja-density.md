---
'@be-music/player-web': patch
---

beatoraja skins' note-density numbers 360-365 showed other values than beatoraja: one decimal digit instead of two, the average as notes / length, the end density as the last note's second, and long notes not counted while held. They now follow beatoraja's `SongInformation`: per-second counts with every held second of a long note, peak as the busiest second, average over the seconds holding at least a quarter of the mean, end as the busiest 5-second average from the TOTAL border on, and two truncated decimal digits.
