---
'@be-music/scene-model': minor
---

Add `resolveHiSpeedForWhiteNumber`, the inverse of `resolveWhiteNumber`: the hi-speed that shows a note for a given white number on a lane of a given length in beats. A replay on another hi-speed scale works out the speed that shows the visible time its play log recorded with it. Like the white number, it leaves LIFT out, as beatoraja's `LaneRenderer` does.
