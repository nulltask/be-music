---
'@be-music/player-web': minor
---

Play logs recorded in the browser carry more of the play:

- The software that recorded them (`recorder`), from `createPlayScene`'s `playlogRecorder` setting.
- The chart file's MD5 (`chart.md5`), from the `chartMD5` setting. `computeChartFileHashes` (`./collection`) reads a chart file's SHA-256 and MD5 in one pass, and `md5HexOfBytes` hashes bytes.
- What the player saw (`play.view`, `play.viewChanges`), on every family: the hi-speed on the family's scale, HS-FIX, the visible time at the main BPM (beatoraja's white number) and the lane covers, at the start and on each change from the keys, the wheel or a skin's buttons, coalesced to at most one per 100 ms and rounded so float noise records no change. A view change still held back when the play ends is written too.

A replay shows the recorded view along the playhead over the viewer's own settings, as far as the `replayView` setting (`PlaylogViewReplay`, all on by default) asks: the tempo, the hi-speed (as recorded on the same scale, or matching the recorded visible time when the play was on another family's scale), SUDDEN+ / HIDDEN+, and the LIFT on the beatoraja view, the one view that draws it.
