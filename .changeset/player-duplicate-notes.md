---
'@be-music/player': minor
---

Fix two notes on the same lane and position being played and judged as two notes (for example layered bmson notes on one `x` / `y`, or two BMS object lines writing the same cell): the player now keeps one note per lane and position, as beatoraja does. A long note wins over a tap; otherwise the lowest object ID (for bmson, the first sound channel) wins. The other notes are not judged, drawn or counted, but their keysounds still play as background audio in manual play.

`extractTimedNotes` returns those notes as `shadowedNotes`, and `PreparedPlaybackChartData` carries them as `shadowedNotes`.
