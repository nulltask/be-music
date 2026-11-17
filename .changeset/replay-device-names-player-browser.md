---
'@be-music/player-browser': minor
---

Add `replayDeviceNames` to the play session options: when true, a recorded replay keeps each controller's `Gamepad.id` in `play.inputSources`. Off by default. Controller input sources now carry the pad's `Gamepad.id` as `deviceName`, which judging never reads.
