---
'@be-music/player': minor
'@be-music/player-tui': minor
---

Split the CLI / TUI frontend out of `@be-music/player` into a
new `@be-music/player-tui` package.

`@be-music/player` is now a pure playback-engine library:
gameplay loop, scoring, lane layout, BGA timeline, signals,
and the audio sink. Its package surface adds new subpath
exports under `core/` (`bga-timeline`, `lane-layout`,
`ui-options`) plus top-level `audio-sink`,
`image-resize-algorithm`, `state-signals`, and `utils`. The
`bms-player` bin and the Node-only dependencies (`libav.js`,
`fast-bmp`, `fast-png`, `jpeg-js`) move to player-tui.

`@be-music/player-tui` carries the `bms-player` bin, the
terminal UI (kitty-graphics renderer, lane-stacking layout,
high-speed control), Node worker runtimes, manual input,
BGA video decoding, and the `keyboard-diagnostic` /
`gameplay-input-diagnostic` entry points. Hosts that want
just the engine (web players, custom UIs) depend on
`@be-music/player`; the historical TUI experience lives in
`@be-music/player-tui`.
