[Japanese version](./player-tui.ja.md)

# Terminal player implementation notes

This document summarizes the terminal frontend implemented by `@be-music/player-tui` and the `bms-player` CLI.
Shared playback semantics such as timing, notes, judgment, score, gauge, and BGA cues are defined in [Player implementation specifications](./player-spec.md).
Browser-specific PixiJS and WebAudio behavior is documented in [Browser player implementation notes](./player-web.md).

## Runtime boundary

`@be-music/player-tui` is a Node frontend around the shared `@be-music/player` engine.
The CLI runner parses chart files, manages directory selection, renders loading/result screens, and starts one gameplay session.
Gameplay itself runs in a worker thread that calls `autoPlay()` or `manualPlay()` from `@be-music/player/core/engine`.

The main thread owns terminal input and coordinates two worker-side surfaces:

- `node-gameplay-worker.ts` runs the shared engine and forwards load progress, logs, frame patches, input requests, and final `PlayerSummary` values.
- `node-ui-worker.ts` owns the terminal renderer and receives compact frame patches, UI commands, pause state, high-speed changes, and judge/combo state.
- `node-input-runtime.ts` captures raw keyboard input on the main thread and forwards normalized input commands to the gameplay worker.

When TTY support or TUI initialization is unavailable, the player falls back to text output.
Passing `--no-tui` also disables the TUI path; in that mode the effective play mode is `AUTO`.

## Entry flow

When the input path is a single chart, the CLI parses that chart, prepares the loading screen, runs gameplay, and then shows a result screen.
The result screen accepts replay for single-chart mode.

When the input path is a directory, the CLI recursively discovers `.bms`, `.bme`, `.bml`, `.pms`, and `.bmson` files.
It builds a Music Select list, then moves through a small state machine:

- `select`: browse charts, filter difficulty, change play mode, change high-speed, or choose the random entry.
- `play`: run one chart with the selected play mode and high-speed.
- `result`: show the last play result and accept replay, return-to-select, or exit.
- `exit`: finish with the appropriate process exit code.

`Esc` from gameplay returns to Music Select in directory mode.
`Ctrl+C` exits with code `130`.
Restart creates a fresh playback run and redraws control-flow random branches.

## Music Select

Music Select shows chart metadata, chart rows, play mode, high-speed, difficulty filter, audio backend state, and an optional banner.
Chart rows are grouped by directory and sorted by `PLAYER`, `DIFFICULTY`, `PLAYLEVEL`, file label, and relative path.
The first row is a random-entry pseudo chart.

The chart summary builder reads each chart through the parser, resolves BMS control flow with a deterministic random value for metadata extraction, and computes note count, displayed player/rank/play level, BPM range, banner path, and preview identity.
Metadata extraction failures do not remove the chart from the list; missing fields display as blanks.

The summary cache lives at `~/.be-music/chart-selection-cache.json`.
Each entry is keyed by a SHA-256 content hash of the chart body and verified with a cache hash that includes the derived metadata.
The player skips reparsing while those hashes match.

## Preview playback

The selection screen starts preview playback after a short settle delay so fast cursor movement does not spawn unnecessary render work.
`#PREVIEW` takes priority, and `#PATH_WAV` is considered when resolving a relative preview path.
If no preview file is available, the controller renders a fallback preview from the chart's first sample trigger.

Preview audio uses the Node audio sink and loops rendered PCM.
The controller keeps a small in-memory preview cache and continues playback when the next focused chart resolves to the same preview file or fallback signature.

## Input model

The input runtime normalizes keyboard input into token strings before the shared engine sees it.
On non-Windows terminals, it opts into the Kitty keyboard protocol by default so left/right modifier keys can be distinguished.
On Windows, it opts into the Win32 terminal input mode.
Set `BE_MUSIC_KEYBOARD_PROTOCOLS=kitty`, `win32`, or a comma-separated combination to override protocol opt-in.

Important command mappings:

- `Space`: pause or resume.
- `Esc`: interrupt the current play and return a summary.
- `Ctrl+C`: interrupt with exit code `130`.
- Restart key input: raise a `restart` interruption and rerun the chart.
- `Alt`/`Option` plus an odd lane input: decrease high-speed by `0.5`.
- `Alt`/`Option` plus an even lane input: increase high-speed by `0.5`.

Manual lane input is timestamped with wall-clock milliseconds before crossing the worker boundary.
The engine converts that timestamp back to the playback clock so a key press that lands between UI frames still judges at its physical timing.

## TUI rendering

The TUI displays song metadata, mode, BPM/SCROLL/STOP status, progress, current measure, judgment window, high-speed, score counters, FAST/SLOW, lane body, judge/combo state, input labels, groove gauge, BGA, and optional audio debug lines.
The default target refresh rate is `60fps`; `--tui-fps <value>` accepts any positive value.

The UI worker receives compact frame patches instead of full frame payloads whenever possible.
It also tracks terminal resize events, pause state, high-speed changes, judge/combo updates, and deferred UI command flushing.

## BGA and terminal images

The terminal BGA renderer uses the shared BGA timeline helper and supports base, layer, layer2, and POOR tracks.
It loads BMP, PNG, JPEG, and supported video frames, then composites the active frame into ANSI color blocks or a Kitty graphics image.
BMS layer channels treat black pixels as transparent; bmson layer images preserve black pixels as image data.

`#STAGEFILE` is used only for the loading screen.
It is drawn with a cover fit over the terminal and falls back to text loading when the image is missing or unsupported.
`#BANNER` and bmson `info.banner_image` are shown in Music Select when the terminal has enough space.

Kitty graphics is enabled by default on capable terminals.
Use `--no-kitty-graphics` to force ANSI rendering.
Video BGA decodes progressively by default; `--no-video-bga-streaming` restores the older full-predecode behavior.

## Configuration and logs

The CLI persists player settings in `~/.be-music/player.json`.
The file stores:

- play mode: `manual`, `auto-scratch`, or `auto`;
- high-speed, normalized through the shared `0.5` to `10.0` range;
- last selected chart file by directory;
- last Music Select focus key by directory.

Command-line play-mode and high-speed flags override persisted values for the current run.

Structured logs default to `~/.be-music/logs/player.ndjson`.
Use `--log-file <path>` to write them elsewhere.

## Compatibility boundary

The terminal player does not load LR2 or beatoraja skin files.
It renders its own TUI and uses shared engine semantics for notes, scoring, gauge, input, timing, BGA cues, and result summaries.

The terminal result path currently uses the shared engine's default `GROOVE` gauge.
Gauge-type selection, independent 2P gauge variants, and LR2/beatoraja skin option panels are browser-side concerns.
