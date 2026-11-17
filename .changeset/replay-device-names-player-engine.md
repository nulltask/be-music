---
'@be-music/player-engine': minor
---

Replays can record each input source's device name, off by default. `InputSource.deviceName` carries the name a host reported (a browser's `Gamepad.id`), and the recorder keeps it in `play.inputSources` only under the new `ReplayRecordingOptions.includeDeviceNames`, with control characters removed and cut to 128 characters. `createInputSourceTable` takes `{ deviceNames: true }` to keep names, and `parseReplay` validates `deviceName` when present. The name is not part of a source's identity and judging never reads it.
