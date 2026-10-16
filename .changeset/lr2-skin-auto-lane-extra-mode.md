---
'@be-music/lr2-skin': minor
---

Add `isLr2AutoLane(laneIndex, ops)` to `@be-music/lr2-skin/state`: whether a lane draws the skin's AUTO note graphics, the 1P scratch while 1P auto scratch is on (op 55). The LR2 play scene took op 53 for "every lane is auto", but op 53 is EXTRA MODE ON, which plays no lane by itself (OpenLR2's `GetOptionFlag_dst` reads it off `m_isExtra`); it no longer counts.
