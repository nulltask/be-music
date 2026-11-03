---
'@be-music/player-engine': minor
---

Replay inputs can now record the physical input behind each press and release as `code`: a keyboard's `KeyboardEvent.code` (`'KeyZ'`, `'ShiftLeft'`) or `'touch'` for a touch lane. A `lane-input` or `kitty-state` command passes it in its new `code` field, and the recorder writes it on the input event. It is diagnostic only, like `tokens`: simulators and rejudging don't read it, and older replays without it still parse.
