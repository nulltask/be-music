[Japanese version](./README.ja.md)

# @be-music/player-terminal

The terminal UI and the `bms-player` CLI frontend for autoplay, keyboard play, Music Select, BGA and SEA builds, plus the `bms-replay` replay re-simulator. It plays through [`@be-music/player-engine`](../player-engine/README.md) and [`@be-music/player-node-audio`](../player-node-audio/README.md).

See the [Terminal player implementation notes](../../docs/player-tui.md) and the [Player implementation specification](../../docs/player-spec.md).

## Features

- 3 modes: MANUAL / AUTO SCRATCH / AUTO
- TUI play screen and song selection screen
- Metadata / preview / banner display on song selection screen
- Local cache of song list metadata (`~/.be-music/chart-selection-cache.json`)
- HIGH-SPEED (`0.5` ~ `10.0`, `0.5` increments)
- TUI refresh rate setting (`--tui-fps`, default `60`)
- Judgment: `PERFECT` / `GREAT` / `GOOD` / `BAD` / `POOR` (with `FAST` / `SLOW` tally)
- 200,000 points SCORE and That-Which-Must-Not-Be-Named compliant EX-SCORE (see [Score and judgment](../player-engine/README.md#score-and-judgment))
- Show invisible notes (`--show-invisible-notes`)
- Exclusive handling of FREE ZONE (`17` / `27`) (see [FREE ZONE](../player-engine/README.md#free-zone-17--27))
- BGA image drawing (`BMP` / `PNG` / `JPEG`) and video drawing (`mpeg1video` / `h264` / `mjpeg`)
- Video BGA progressive decoding (switch to old method with `--no-video-bga-streaming`)
- Kitty graphics protocol drawing switching using `--kitty-graphics` / `--no-kitty-graphics` (default: on)
- Play with `node-web-audio-api` fixed backend
- Optional BMS `#LNTYPE` auto-detection when omitted (`--ln-type-auto` / `--no-ln-type-auto`)
- Optional pre-playback audio rendering (`--render-audio`) and per-bus volume tuning (`--volume`, `--bgm-volume`, `--key-volume`)
- Output dynamics tuning with compressor/limiter switches and threshold/release controls
- Structured log output (`~/.be-music/logs/player.ndjson`, overwritten with `--log-file`)
- Node worker split for gameplay, TUI rendering, and video BGA decoding
- `bms-replay` CLI that re-derives LR2 / beatoraja / That-Which-Must-Not-Be-Named results from a recorded replay (see [Replay specification](../../docs/replay.md))

## Usage

Run the player from the repository root:

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

### Replay re-simulation

```bash
pnpm run replay -- /path/to/Song.bmplay.json
pnpm run replay -- /path/to/Song.bmplay.json --ruleset=lr2,beatoraja --json
```

See [Replay specification](../../docs/replay.md) for the options.

## Operations

These controls apply to the terminal player. Browser controls follow the selected skin family and key configuration; see [Browser player controls](../../docs/player-web.md#options-dialog).

### Song selection screen

- `↑/↓` or `k/j`: Move
- `←/→` or `h/l`: Move page
- `Ctrl+b / Ctrl+f`: Move page
- `g` or `Home` / `G` or `End`: Jump to the first / last entry
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
- `r`: Play the same chart again (single-chart mode)

## Lane input assignment

The lane mode comes from the channels in use (see [Automatic lane mode determination](../chart-model/README.md#automatic-lane-mode-determination)). Representative mode channels and inputs:

| Mode                     | Channel -> Input                                                                                                                              |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `5 KEY SP`               | `16 -> LShift`, `11 -> z`, `12 -> s`, `13 -> x`, `14 -> d`, `15 -> c`                                                                         |
| `5 KEY DP`               | `16 -> LShift`, `11 -> z`, `12 -> s`, `13 -> x`, `14 -> d`, `15 -> c`, `21 -> b`, `22 -> h`, `23 -> n`, `24 -> j`, `25 -> m`, `26 -> RShift`  |
| `7 KEY SP`               | `5 KEY SP` + `18 -> f`, `19 -> v`                                                                                                             |
| `14 KEY DP`              | `7 KEY SP` + `21 -> b`, `22 -> h`, `23 -> n`, `24 -> j`, `25 -> m`, `28 -> k`, `29 -> ,`, `26 -> RShift`                                      |
| `9 KEY (BME-compatible)` | `11 -> z`, `12 -> s`, `13 -> x`, `14 -> d`, `15 -> c`, `16 -> f`, `17 -> v`, `18 -> g`, `19 -> b`                                             |
| `9 KEY (PMS-STD)`        | `11 -> z`, `12 -> s`, `13 -> x`, `14 -> d`, `15 -> c`, `22 -> f`, `23 -> v`, `24 -> g`, `25 -> b`                                             |
| `24 KEY SP`              | `11..19` + `1A..1O` (24 keys, no scratch) -> `a s d f g h j k l ; q w e r u i o p z x c v b n`; wheel `1P -> Tab` (up), `1Q -> LShift` (down) |
| `48 KEY DP`              | `24 KEY SP` + `21..29` + `2A..2O`, the 2P keys running past the printable-key pool onto function keys; 2P wheel `2P -> Enter`, `2Q -> RShift` |

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

## Settings/Cache/Log

`@be-music/player-terminal` saves the following locally.

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

# Build output
./packages/player-terminal/dist-sea/be-music-player chart.bms

# When specifying the Node executable explicitly
pnpm run player:sea --node-binary /path/to/node
```

- Requires Node.js 26+.
- SEA generation uses built-in `--build-sea`.
- The player SEA executable is attached to the `@be-music/player-terminal` release.
