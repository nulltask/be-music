---
'@be-music/player-web': patch
---

`BeatorajaMarkerLayer.update` previously picked only the first prototype per marker kind (`group` / `bpm` / `stop` / `time`) via `kind.find(...)` and painted it at every beat. DP skins that author one destination per side (1P-side + 2P-side) only saw markers rendered on the 1P side as a result. Iterate every registered prototype per kind, matching beatoraja's upstream `LaneRenderer.java` loop, so both sides paint measure lines / BPM-change lines / STOP markers / time-tick markers.
