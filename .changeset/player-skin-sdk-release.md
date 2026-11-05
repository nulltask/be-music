---
'@be-music/player-skin-sdk': minor
---

Add shared note sizing and independent two-player layout support.

- Export `NOTE_HEIGHT_LANE_RATIO` (0.21), `noteHeightForLane`, `resolveNoteHeight`, and `findWhiteLaneWidth` so skins can size every note from the playfield's white-key lane width.
- Add `twoPlayer` layout input and output, stage `twoPlayerSideInset`, and an optional `twoPlayer` argument to `resolveBGARect` and lane geometry resolution. Keep independent players or replay ghosts on opposite sides of the monitor while double-play charts retain their shared field.
- Extend cabinet layouts with second-player gauge, score, and hi-speed panels for skins that present independent players.
- Expose optional folder ancestry in select frames, authored search text sizes, and video-monitor aspect fitting. Label charts without difficulty as `UNSPECIFIED`.
- Expose chart beats, per-lane input brightness, directional scratch presentation, and replay ghost sides. Add shared helpers for four-beat scratch rotation and per-side AUTO PLAY / GHOST PLAY captions.
- Align cabinet panels, extend lanes toward their keys, and vertically center gauge captions while reserving space for independent players and their gauges.
