---
'@be-music/player': patch
'@be-music/player-web': patch
---

Fix LN regressions in the Web build:

- **Auto play**: pair every `hold-lane-until-beat` with a matching
  `release-lane` so the LR2 LN-hold timer (70..89) and the lane
  laser (100..117) actually fade out at the LN tail. Previously
  the sustain glow / scratch streak stayed lit after the LN had
  visually cleared. Applied to both `drainPendingAutoLongNotes`
  (autoplay) and `drainPendingAutoScratchLongNotes`
  (manual play with auto-scratch).
- **Manual play**: have the Web input runtime emit a `kitty-state`
  press alongside the existing `lane-input` on `keydown`. The
  engine's tick loop only refreshes `longHoldUntilMsByChannel`
  for channels in `activeKittyPressedChannels`, which previously
  was populated only from `kitty-state` press tokens that the
  Web runtime never sent. Without this signal every manual LN
  BAD-failed ~380 ms (`LONG_NOTE_INITIAL_HOLD_GRACE_MS`) into
  the sustain even when the user kept the key held, and the
  lane laser collapsed to a `flash-lane` flicker instead of a
  sustained `press-lane` glow.
