---
'@be-music/player': patch
---

`ScrollDistanceMapper.distanceBetween` remembers the distance of the last start beat it measured from. A frame of a `#SCROLL` / `#SPEED` chart measures every note and bar line from the same playhead, so that distance is now worked out once per frame instead of once per object. Results are unchanged.
