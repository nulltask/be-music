---
'@be-music/player-web': minor
'@be-music/player-web-demo': minor
---

Initial browser player implementation. Adds two packages:

- **`@be-music/player-web`** — vanilla PixiJS scene host
  for the LR2 chart-player flow (select / decide / play /
  result), with scene-graph rendering driven by the parsed
  LR2 skin (`#IMAGE` / `#SRC_*` / `#DST_*` keyframes, bitmap
  fonts via `#LR2FONT`, op-gated visibility, scene-stage
  timers). Loads charts and themes from drag-drop or file
  picker via a chunked enumerate / read / parse pipeline that
  publishes progress events to host UIs.
- **`@be-music/player-web-demo`** — Vite-based demo shell
  that wires the core into a single-page app, with a lil-gui
  settings panel, a glassmorphism drop overlay, browser-
  compatibility check panel, and a Help dialog that hosts
  the usage guide plus the Open-Source attribution list
  (resolved at build time by a custom Vite plugin that walks
  the runtime dep tree).

Headline capabilities of the core:

- **LR2 skin rendering**: frame chrome, BGA, lane lasers,
  scratch turntable with physics-driven streak alternation,
  bomb / FC / hold timers, animated bitmap fonts, gauge /
  combo / score numbers, scroll slider.
- **PMS / 9 KEY (Pop'n) skin support** alongside default
  IIDX 7 / 14-key layouts; per-variant skin pickers and
  channel→lane mappings. Single-side judge / combo plate
  rendering — PMS-STD charts that source lanes from the
  `2X` channel block still collapse onto the LR2 9-key
  skin's 1P-side `#SRC_NOWJUDGE` / `#SRC_NOWCOMBO` slots.
- **BGA pipeline** — native `<video>` decode for modern codecs
  with an ffmpeg.wasm transcode fallback (single-threaded
  H.264, optional WebCodecs hardware-accelerated encode,
  optional long-edge pixel cap). Hold playback until the
  chart-start gate so the video doesn't sneak ahead during
  the LOADING / DONE intro.
- **Web Audio bus** — split key / BGM / master compressor
  topology with per-stage toggles plus a global bypass; per-
  sample latency tuning; `MediaRecorder` + canvas
  `captureStream` for downloadable WebM gameplay capture.
- **LR2 button wiring** — RANDOM / MIRROR, AUTO-SCRATCH, gauge
  type, HIDDEN / SUDDEN + shutter, HS-FIX, DP FLIP, BGA on /
  off / autoplay-only, BGA size NORMAL / EXTEND, score graph
  toggle, difficulty / keymode filters, song-list sort.
- **Performance** — single shared `Application` (avoids the
  Pixi v8 batchPool race), per-section frame-timing tracker,
  cached cropped textures, sprite / text node pooling,
  static-rect graphics caching, parallel drop pipeline,
  deferred song-bundle bytes.
- **Polish** — keyframe-inheriting LR2 parser fixes (op4 /
  loop / acc / ops), clip-mask to design rect, auto-shrink
  text, theme + library persistence across additional drops,
  scene-stage exit FADEOUT / CLOSE, intro LOADING → DONE
  flow, freeze on pause / blur, scoped colored logger.
