---
'@be-music/player': minor
---

Add `ScrollDistanceMapper.firstBeatBeyondDistance(fromBeat, distance)`: the first beat whose signed `#SCROLL` / `#SPEED` distance from `fromBeat` exceeds `distance` (where the chart first runs past a lane that tall), or `+Infinity`. Renderers use it to stop walking the chart there, as beatoraja's `LaneRenderer` does.
