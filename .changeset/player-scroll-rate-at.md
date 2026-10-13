---
'@be-music/player': minor
---

Add `ScrollDistanceMapper.rateAt(beat)`: the scroll distance per beat at a beat (`#SCROLL` × the interpolated `#SPEED`), negative while the chart scrolls backwards and 0 while it stands still. `ScrollDistanceMapperLike` lists it as an optional member, so existing implementations of the interface still type-check.
