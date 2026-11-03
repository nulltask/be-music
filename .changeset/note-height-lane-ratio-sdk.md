---
'@be-music/player-skin-sdk': minor
---

Adds `noteHeightForLane(laneWidth)` and `NOTE_HEIGHT_LANE_RATIO` (0.21): a note's height as a share of its lane's width, from the arcade cabinet, so a skin can draw wider lanes with thicker notes. `resolveNoteHeight(kind, laneWidth, whiteLaneWidth)` gives a scratch (or wheel) note a white key's height, and `findWhiteLaneWidth(lanes)` finds that width.
