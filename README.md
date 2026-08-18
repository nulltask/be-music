[Japanese version](./README.ja.md)

# be-music

BMS/BMSON toolchain composed of TypeScript + pnpm workspaces.

## Packages

- `@be-music/json`: pure IR of BMS/BMSON intermediate representation (JSON compatible) dedicated to Be-Music internal processing
- `@be-music/chart`: chart semantics helper such as beat resolution, event order, long note resolution, etc.
- `@be-music/utils`: Generic utilities reused across all packages, with narrow subpath exports for browser-safe core helpers and Node-facing helpers
- `@be-music/parser`: `.bms` / `.bme` / `.bml` / `.pms` / `.bmson` / JSON parser
- `@be-music/stringifier`: Stringization from JSON to `.bms` / `.bmson`
- `@be-music/audio-renderer`: Render the music score and output `.wav` / `.aiff`
- `@be-music/player`: Shared playback engine, timing, judgment, scoring, gauge, BGA timeline, and UI/audio adapter contracts
- `@be-music/player-tui`: Terminal UI and `bms-player` CLI frontend for autoplay, keyboard play, Music Select, BGA, and SEA builds
- `@be-music/lr2-skin`: Renderer-independent Lunatic Rave 2 skin parser, asset resolver, and theme loader
- `@be-music/beatoraja-skin`: Renderer-independent beatoraja JSON/Lua skin parser, normalizer, and theme loader
- `@be-music/player-web`: Browser PixiJS player core for song selection, built-in default / LR2 / beatoraja skin rendering, gameplay, result scenes, and recording
- `@be-music/player-web-demo`: Private Vite demo that wires folder/ZIP drops, LR2/beatoraja themes, debug controls, and browser playback together
- `@be-music/editor`: CLI editor (import/edit/export)

## Required environment

- Node.js `>= 26`
- pnpm workspaces

## Setup

```bash
pnpm install
```

## Build and Verification

```bash
pnpm run clean
pnpm run build
pnpm run typecheck
pnpm run lint
pnpm run test
```

`pnpm run build` executes `tsdown` build in each workspace in parallel while satisfying the dependencies, and outputs the bundle and type definition (`.d.ts`) together. `pnpm run typecheck` / `pnpm run lint` / `pnpm run format` are also executed in parallel in each workspace.

## Package Releases

In this repository, `Changesets` manages the version and changelog for each package.

```bash
pnpm run changeset
pnpm run release:status
pnpm run release:version
```

- Normal feature PR adds `.changeset/*.md` for the changed package
- When you want to release, run `pnpm run release:version` on `devel` and commit the generated `packages/*/package.json` and `packages/*/CHANGELOG.md` updates together.
- In that state, if you merge the release PR of `devel -> main`, a separate GitHub Release will be created only for the package whose version has increased.
- The player SEA executable is built from `@be-music/player-tui` and attached to the `@be-music/player` release; `@be-music/audio-renderer` also ships a SEA zip
- The private repository root `package.json` stays at `0.0.0`; releasable versions are tracked in `packages/*/package.json`.

The tag is created in the format `@be-music/package-name@x.y.z`.

## Specifications

- [Specification top](./docs/README.md)
- [BMS implementation specification](./docs/bms-spec.md)
- [BMSON implementation specification](./docs/bmson-spec.md)
- [Bemuse implementation specification](./docs/bemuse-spec.md)
- [Player implementation specification](./docs/player-spec.md)
- [Terminal player implementation notes](./docs/player-tui.md)
- [Browser player implementation notes](./docs/player-web.md)
- [Play log (play history) specification](./docs/playlog.md)
- [LR2 skin implementation notes](./docs/lr2-skin.md)
- [beatoraja skin implementation notes](./docs/beatoraja-skin.md)
- [BMS/BMSON intermediate representation (`@be-music/json`) implementation specification](./docs/json-spec.md)
- [Glossary](./docs/glossary.md)

`@be-music/json` is Be-Music's internal data model. It is not designed as a distribution format or a reusable exchange format with other tools.
The semantics helper of the score is separated into `@be-music/chart`, and `@be-music/json` itself is responsible for pure IR and round-trip preservation.

## Compatibility status summary

### parser (`@be-music/parser`)

- Preserves BMS header/object lines/control syntax
- Interpret `#WAVxx` / `#BMPxx` / `#BPMxx` / `#STOPxx` / `#TEXTxx`
- Contains BMS extension headers (`#PREVIEW`, `#LNTYPE`, `#LNMODE`, `#LNOBJ`, `#VOLWAV`, `#SCROLLxx`, `#VIDEOFILE`, etc.)
- Interpret BMSON's `info` / `lines` / `sound_channels` / `bpm_events` / `stop_events` / `bga`
- BMS text character code guessing (`Shift_JIS`, `UTF-8`, `EUC-JP`, `latin1`, etc.)
- BMSON `info.init_bpm` is required by the parser; missing or invalid values fail early instead of falling back to `130`
- BMSON `key_channels` mine notes are mapped through the `mode_hint` lane resolver and preserve per-mine `damage`

### stringifier (`@be-music/stringifier`)

- Output BMS/BMSON from intermediate representation (JSON)
- Stable reproduction of bar resolution using `position: [numerator, denominator]`
- Output BMSON extension information (`info` extension, `bga`, `notes.l/c`)
- Preserve BMS source structure when the stored `preservation` layer still matches the normalized events

### audio-renderer (`@be-music/audio-renderer`)

- Supports BMS / BMSON / JSON input
- Output format `.wav` / `.aiff`
- Sample loading: `WAV` / `MP3` / `OGG` (Vorbis/Opus) / `OPUS`
- Reflects bar length / BPM / STOP
- 100001 times the BPM gimmick value of LR2 series is processed by time resolution
- Applies `#VOLWAV`, `#xxx97` / `#xxx98`, BMSON `notes.c`, `#WAVCMD 01 xx vv`, and `#EXWAVxx v` volume scaling

### player core (`@be-music/player`)

- Shared `autoPlay()` / `manualPlay()` engine for terminal and browser runtimes
- UI and input signal buses for lane flashes, POOR BGA commands, frame snapshots, pause, restart, and high-speed changes
- Shared note extraction for playable notes, legacy long notes, `#LNOBJ`, FREE ZONE, mines, and invisible notes
- Shared judgment windows, dynamic `#EXRANKxx` changes, score, groove gauge, scroll-distance, BGA timelines, and result summaries
- Browser-safe subpath exports for reusable helpers such as `core/engine`, `core/bga-timeline`, `core/scroll-distance`, `core/groove-gauge`, and `playable-notes`

### terminal player (`@be-music/player-tui`)

- 3 modes: MANUAL / AUTO SCRATCH / AUTO
- TUI play screen and song selection screen
- Metadata / preview / banner display on song selection screen
- Local cache of song list metadata (`~/.be-music/chart-selection-cache.json`)
- HIGH-SPEED (`0.5` ~ `10.0`, `0.5` increments)
- TUI refresh rate setting (`--tui-fps`, default `60`)
- Judgment: `PERFECT` / `GREAT` / `GOOD` / `BAD` / `POOR` (with `FAST` / `SLOW` tally)
- 200,000 points SCORE and IIDX compliant EX-SCORE
- Show invisible notes (`--show-invisible-notes`)
- Exclusive handling of FREE ZONE (`17` / `27`)
- BGA image drawing (`BMP` / `PNG` / `JPEG`) and video drawing (`mpeg1video` / `h264` / `mjpeg`)
- Video BGA progressive decoding (switch to old method with `--no-video-bga-streaming`)
- Kitty graphics protocol drawing switching using `--kitty-graphics` / `--no-kitty-graphics` (default: on)
- Play with `node-web-audio-api` fixed backend
- Optional BMS `#LNTYPE` auto-detection when omitted (`--ln-type-auto` / `--no-ln-type-auto`)
- Optional pre-playback audio rendering (`--render-audio`) and per-bus volume tuning (`--volume`, `--bgm-volume`, `--key-volume`)
- Output dynamics tuning with compressor/limiter switches and threshold/release controls
- Structured log output (`~/.be-music/logs/player.ndjson`, overwritten with `--log-file`)
- Node worker split for gameplay, TUI rendering, and video BGA decoding

### LR2 skin (`@be-music/lr2-skin`)

- Parses LR2 select / decide / play / result skin CSV files independently from PixiJS
- Resolves `#INCLUDE`, `#CUSTOMOPTION`, `#CUSTOMFILE`, `#LR2FONT`, system font declarations, skin timers, op conditions, and play-skin variants
- Parses image, number, text, slider, bargraph, button, BGA, judge-line, measure-line, gauge, score-chart, and result graph elements
- Loads theme assets with case-insensitive and wildcard lookup, TGA decoding, and DXA archive extraction

### beatoraja skin (`@be-music/beatoraja-skin`)

- Parses beatoraja JSON skins and Lua `.luaskin` entries independently from PixiJS
- Evaluates the beatoraja two-phase Lua contract on a restricted Fengari sandbox
- Discovers play / select / decide / result / course-result entries, with play skins grouped by `5` / `7` / `9` / `10` / `14` / `24` / `24d`
- Resolves `property[]`, `filepath[]`, category groups, custom offsets, wildcard source paths, and case-insensitive assets
- Normalizes image, imageset, value, float-value, text, slider, note, judge, gauge, graph, BPM graph, timing graph, song-list, custom event, destination, and PM character elements

### browser player (`@be-music/player-web` / `@be-music/player-web-demo`)

- Browser song library for dropped folders, ZIPs, and mixed song/LR2/beatoraja theme drops
- Lazy browser asset loading for large audio/video files, with case-insensitive path lookup
- Built-in default skin family for skinless select, gameplay, and result scenes
- LR2 select / decide / gameplay / result skin parsing and rendering on PixiJS
- beatoraja select / decide / gameplay / result skin parsing and rendering on PixiJS
- Separated default gameplay chrome injection so default-skin rendering does not depend on LR2 renderer modules
- Shared LR2 Pixi helpers for destination interpolation, sprite transforms, numbers, text, sliders, and bargraphs
- Shared beatoraja Pixi helpers for destination sampling, source-cell selection, text, values, sliders, gauges, graphs, timing visualizers, notes, markers, BGA, and runtime op/timer wiring
- Shared playback semantics with the terminal player for notes, timing, scroll distance, BGA cues, score, and results
- WebAudio preview and gameplay buses with split key/BGM/master compressor controls
- BGA still/video rendering, browser-side video transcode fallback, and WebM gameplay recording
- Single PixiJS scene host that owns one renderer context and disposes scene resources on transitions
- In-scene LR2 and beatoraja PLAY OPTION controls for hi-speed, BGA mode/size, filters, sort, HS-FIX, lane cover, lift, auto-scratch, DP flip, random/mirror modes, gauge variants, and skin options

### editor (`@be-music/editor`)

- `init`, `import`, `export`, `set-meta`, `add-note`, `delete-note`, `list-notes`

## Main commands

### 1. Convert BMS/BMSON to JSON

```bash
pnpm run parse chart.bms chart.json
```

### 2. Convert JSON to BMS/BMSON

```bash
pnpm run stringify chart.json chart.bms --format bms
pnpm run stringify chart.json chart.bmson --format bmson
```

### 3. Audio rendering

```bash
pnpm run audio-render chart.bms out.wav
pnpm run audio-render chart.bms out.aiff --sample-rate 48000
```

### 4. Player

```bash
# Autoplay
pnpm run player chart.bms --auto

# Autoplay scratch only (16ch/26ch)
pnpm run player chart.bms --auto-scratch

# Manual play
pnpm run player chart.bms

# Disable TUI
pnpm run player chart.bms --no-tui

# Initial HIGH-SPEED value
pnpm run player chart.bms --high-speed 3.5

# TUI refresh rate
pnpm run player chart.bms --tui-fps 120

# Disable progressive decode for video BGA
pnpm run player chart.bms --no-video-bga-streaming

# Show invisible channels (31-39/41-49) as green notes
pnpm run player chart.bms --show-invisible-notes

# Render BGA / STAGEFILE / BANNER images with the Kitty graphics protocol
pnpm run player chart.bms --kitty-graphics

# Override the structured log output path
pnpm run player chart.bms --log-file /tmp/be-music.ndjson

# Disable audio
pnpm run player chart.bms --no-audio

# Disable the output limiter
pnpm run player chart.bms --no-limiter

# Enable the compressor
pnpm run player chart.bms --compressor --compressor-threshold-db -10 --compressor-ratio 3

# Render audio before playback without in-game audio
pnpm run player chart.bms --render-audio preview.wav --no-audio

# Tune visible-note cap for dense charts
pnpm run player chart.bms --tui-visible-notes-limit 4096

# Disable automatic #LNTYPE inference when missing
pnpm run player chart.bms --no-ln-type-auto
```

### 5. Browser player demo

```bash
pnpm run player:web
```

The demo starts a Vite dev server. Drop a BMS/BMSON song folder, an LR2 theme folder, a beatoraja theme folder, a ZIP, or a song folder and LR2/beatoraja theme folder together into the browser.

### 6. Editor

```bash
pnpm run editor import chart.bms chart.json
pnpm run editor add-note chart.json 0 11 1 2 01
pnpm run editor export chart.json chart.bms
```

## Player Operations

### Song selection screen

- `↑/↓` or `k/j`: Move
- `←/→` or `h/l`: Move page
- `Ctrl+b / Ctrl+f`: Move page
- `1-5`: DIFFICULTY filter
- `0`: DIFFICULTY filter cancellation
- `a`: `MANUAL -> AUTO SCRATCH -> AUTO` switching
- `s`: HIGH-SPEED increase (`+0.5`)
- `S`: HIGH-SPEED decrease (`-0.5`)
- `Enter`: Start
- `Esc` or `Ctrl+C`: Exit

### Playing

- `Space`: Pause/Resume
- `Alt`/`Option` + Odd lane input: HIGH-SPEED decrease (`-0.5`)
- `Alt`/`Option` + Even lane input: HIGH-SPEED increase (`+0.5`)
- `Esc`: Finish playing and go to results
- `Ctrl+C`: Exit

### Results screen

- `Enter` or `Esc`: Return to song selection screen

## Automatic lane mode determination and input assignment

### Automatic judgment

Automatically determines the next mode based on the channel used.

- `5 KEY SP`
- `5 KEY DP`
- `7 KEY SP`
- `14 KEY DP`
- `9 KEY`
- `24 KEY SP`
- `48 KEY DP`

If the automatic judgment is ambiguous, it will be supplemented with an extension.

- `.bms` -> `5 KEY SP/DP`
- `.bme` -> `7 KEY SP/14 KEY DP`
- `.pms` -> `9 KEY`
- A full `11..19` one-player keyboard or PMS-STD `22..25` without traditional IIDX 2P channels also resolves to `9 KEY`.

### Representative mode channels and inputs

| Mode                     | Channel -> Input                                                                                                                             |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `5 KEY SP`               | `16 -> LShift`, `11 -> z`, `12 -> s`, `13 -> x`, `14 -> d`, `15 -> c`                                                                        |
| `5 KEY DP`               | `16 -> LShift`, `11 -> z`, `12 -> s`, `13 -> x`, `14 -> d`, `15 -> c`, `21 -> b`, `22 -> h`, `23 -> n`, `24 -> j`, `25 -> m`, `26 -> RShift` |
| `7 KEY SP`               | `5 KEY SP` + `18 -> f`, `19 -> v`                                                                                                            |
| `14 KEY DP`              | `7 KEY SP` + `21 -> b`, `22 -> h`, `23 -> n`, `24 -> j`, `25 -> m`, `28 -> k`, `29 -> ,`, `26 -> RShift`                                     |
| `9 KEY (BME-compatible)` | `11 -> z`, `12 -> s`, `13 -> x`, `14 -> d`, `15 -> c`, `16 -> f`, `17 -> v`, `18 -> g`, `19 -> b`                                            |
| `9 KEY (PMS-STD)`        | `11 -> z`, `12 -> s`, `13 -> x`, `14 -> d`, `15 -> c`, `22 -> f`, `23 -> v`, `24 -> g`, `25 -> b`                                            |

## FREE ZONE (`17` / `27`)

- Other than 9KEY, it is treated as FREE ZONE.
- Do not create an independent lane, but draw on top of the scratch lane (`16` / `26`).
- The note length is fixed at a quarter note.
- Since it is not subject to judgment, it is not included in `TOTAL` / `EX-SCORE` / `SCORE`.
- When determining 9KEY, `17` is treated as the normal lane note.

## Keyboard input (kitty keyboard protocol)

- Automatic opt-in to kitty keyboard protocol when starting play.
- On compatible terminals, pressing and lifting of Left Shift and Right Shift will be handled individually.
- Incompatible terminals will fall back to conventional input.
- Even during fallback, scratch input can be replaced with `a` (1P) / `]` (2P).

## BGA implementation

- Combine and draw `04` (base) and `07` (layer).
- Black (`#000000`) in layer is treated as a transparent color.
- `#BANNER` / bmson `banner_image` is displayed in the song introduction block on the song selection screen.
- On compatible terminals, the kitty graphics protocol is used to display gameplay BGA, `#STAGEFILE` loading screen, and song selection screen banner as images by default.
- Add `--no-kitty-graphics` to return to ANSI drawing.
- BGA recalculates and updates the display size when resizing the window.
- Video BGA is decoded with `@uwx/libav.js-fat`.
  - Supported codecs: `mpeg1video`, `h264`, `mjpeg`
  - Does not decode audio tracks.
  - By default, playback starts after the first frame is acquired, and the remaining frames are decoded gradually in the background.
  - Add `--no-video-bga-streaming` to revert to the old method of decoding all frames before playback.

## Score and judgment

- Judgment type: `PERFECT`, `GREAT`, `GOOD`, `BAD`, `POOR`
- `FAST` / `SLOW` is added only when pressing `GREAT` / `GOOD` quickly or slowly.
- A blank keystroke without a corresponding unjudged note fires LR2-style empty POOR: it does not change judge counters, score, EX-SCORE, or combo, but it applies the empty-POOR gauge delta and triggers POOR BGA.
- EX-SCORE:
  - `PERFECT = +2`
  - `GREAT = +1`
- SCORE (200000 points):
  - Judgment base points 150000 + Combo additional points 50000
  - `BAD` / `POOR` does not add points, disconnects the combo

## Settings/Cache/Log

`player` saves the following locally.

- Play Mode (`manual` / `auto-scratch` / `auto`)
- HIGH-SPEED
- Per-directory last selected chart file and music-select focus key

Storage location and usage:

- `~/.be-music/player.json`
  - Play Mode, HIGH-SPEED, last selected chart file by directory, and music-select focus key by directory
- `~/.be-music/chart-selection-cache.json`
  - Song list metadata cache
  - Reuse is determined by `contentHash` in the chart body, and saved entries are verified by `cacheHash`
- `~/.be-music/logs/player.ndjson`
  - Structured log when running `player`
  - If `--log-file <path>` is specified, use that path

## SEA (Single Executable Applications)

```bash
# Build the player SEA binary
pnpm run player:sea

# Build the audio-renderer SEA binary
pnpm run audio-renderer:sea

# Build outputs
./packages/player-tui/dist-sea/be-music-player chart.bms
./packages/audio-renderer/dist-sea/be-music-audio-render chart.bms output.wav

# When specifying the Node executable explicitly
pnpm run player:sea --node-binary /path/to/node
pnpm run audio-renderer:sea --node-binary /path/to/node
```

supplement:

- Requires Node.js 26+.
- SEA generation uses built-in `--build-sea`.

## Exports Benchmark

```bash
# All packages
pnpm run bench

# Single package (example: parser)
pnpm --filter @be-music/parser run bench

# Aggregate multiple runs
pnpm run bench:aggregate -- --output tmp/bench/head.json tmp/bench/head-runs/*.json

# Compare two revisions and generate Markdown
pnpm run bench:compare -- --head tmp/bench/head.json --base tmp/bench/base.json --output tmp/bench/benchmark.md
```

- snapshot output: `tmp/bench/exports*.json`
- compare output: arbitrary Markdown and summary JSON
- In GitHub Actions, post base/head comparison as PR comment in PR for `devel` / `main`
- GitHub Actions also performs the previous revision comparison when pushing to `devel` / `main` and posts a commit comment to the target commit.
