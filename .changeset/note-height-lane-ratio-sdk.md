---
'@be-music/player-skin-sdk': minor
---

Adds `noteHeightForLane(laneWidth)` and `NOTE_HEIGHT_LANE_RATIO` (0.21): a note's height as a share of its lane's width, from the arcade cabinet, so a skin can draw wider lanes with thicker notes. `resolveNoteHeight(laneWidth, whiteLaneWidth)` gives every note of a playfield a white key's height, so a scratch or black key's note is as tall as a white one, and `findWhiteLaneWidth(lanes)` finds that width.
