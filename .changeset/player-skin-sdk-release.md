---
'@be-music/player-skin-sdk': minor
---

Add shared note sizing and independent two-player layout support.

- Export `NOTE_HEIGHT_LANE_RATIO` (0.21), `noteHeightForLane`, `resolveNoteHeight`, and `findWhiteLaneWidth` so skins can size every note from the playfield's white-key lane width.
- Add `twoPlayer` layout input and output, stage `twoPlayerSideInset`, and an optional `twoPlayer` argument to `resolveBGARect` and lane geometry resolution. Keep independent players or replay ghosts on opposite sides of the monitor while double-play charts retain their shared field.
- Extend cabinet layouts with second-player gauge, score, and hi-speed panels for skins that present independent players.
