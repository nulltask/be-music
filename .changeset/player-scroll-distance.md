---
'@be-music/player': minor
---

`ScrollDistanceMapper` (`@be-music/player/display`) gains what a renderer needs for `#SCROLL` / `#SPEED` charts that scroll both ways:

- `rateAt(beat)`: the scroll distance per beat at a beat (`#SCROLL` × the interpolated `#SPEED`), negative while the chart scrolls backwards and 0 while it stands still.
- `firstBeatBeyondDistance(fromBeat, distance)`: the first beat whose signed distance from `fromBeat` exceeds `distance` (where the chart first runs past a lane that tall), or `+Infinity`, so a renderer stops walking the chart there, as beatoraja's `LaneRenderer` does.

`ScrollDistanceMapperLike` lists both as optional members, so existing implementations of the interface still type-check. `distanceBetween` also remembers the distance of the last start beat it measured from, so a frame that measures every note and bar line from the same playhead works it out once instead of once per object; results are unchanged.
