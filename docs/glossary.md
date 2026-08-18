[Japanese version](./glossary.ja.md)

# Glossary

This document defines terms used by the `be-music` specifications and implementation.
The definitions follow general BMS/BMSON terminology where possible, but prioritize how this repository uses each term.

## Usage Rules

- **chart** is the default word for a score file and for the unit of playback, selection, and storage.
- **music** is a human-facing work unit such as a title and artist. One piece of music can have multiple charts.
- **song** is not the default repository term. Use it only when referring to an external specification name or file name such as `song.mid`, `bemuse-song.json`, or `songs[]`.
- **Music Select** is a screen name. The unit selected and restored on that screen is still a chart.

## Score And Resources

- **BMS**: Be-Music Source text score format. It consists of header and object lines such as `#TITLE`, `#WAVxx`, and `#mmmcc:...`.
- **bmson**: JSON-based score format with structures such as `info`, `sound_channels`, `bga`, and `lines`.
- **chart**: One score file or playback unit. In Music Select, one list entry corresponds to one chart.
- **metadata**: Descriptive data outside the note body, such as title, artist, genre, comments, `#STAGEFILE`, `#BACKBMP`, and `#BANNER`.
- **resource**: External audio, image, video, or text file referenced by a chart or skin.
- **keysound**: Audio resource used for notes and BGM. BMS usually uses `#WAVxx`; bmson uses `sound_channels`.
- **preview**: Short audio played on Music Select. The runtime prefers `#PREVIEW` or bmson `info.preview_music`.
- **BGA**: Background image or video displayed during gameplay. BGA timelines can have base, layer, layer2, and POOR cues.
- **POOR BGA**: Dedicated visual shown during `POOR` judgment when the chart defines one.
- **STAGEFILE**: Loading-screen image shown after chart selection. It is separate from gameplay BGA.
- **BACKBMP**: Skin special graphic slot backed by BMS `#BACKBMP` or bmson back-image metadata. Browser LR2 and beatoraja scenes can resolve it as chart imagery.
- **BANNER**: Horizontal image shown in Music Select. BMS uses `#BANNER`; bmson uses `info.banner_image`.

## Playback And Judgment

- **channel**: Source-level score lane or event identifier. BMS uses values such as `11`, `16`, and `54`; bmson derives channel identity from fields such as `notes.x`.
- **lane**: Runtime input, drawing, and judgment unit. The player maps source channels to lanes according to the chart mode.
- **scratch**: Scratch lane. SP uses `16`; DP uses `16` and `26`.
- **FREE ZONE**: Special `17` / `27` note. Outside 9KEY it is drawn over the scratch lane and excluded from normal score and gauge targets.
- **measure**: Score division. BMS uses the `mmm` part of `#mmmcc`; IR uses `measure`.
- **beat**: Normalized score-time unit. `@be-music/chart` and player runtimes resolve time and drawing positions from beats.
- **BPM**: Beats per minute. It controls score-time progression.
- **STOP**: Event that stops score time for a duration. It affects visual position and judgment time.
- **SCROLL**: Visual scroll coefficient. It changes note distance, not judgment time.
- **SPEED**: Interpolated visual spacing factor used with `SCROLL`.
- **long note (LN)**: Note with a start and end point. Hold, release, and end judgment depend on `LNMODE`.
- **LNOBJ**: BMS long-note terminator object declared by `#LNOBJ`.
- **LNMODE**: BMS long-note judgment rule. `1`, `2`, and `3` change end judgment and hold-break behavior.
- **mine**: Damage note. This repository treats a manual mine hit as `BAD` with chart-defined gauge damage.
- **judge**: `PERFECT` / `GREAT` / `GOOD` / `BAD` / `POOR` result. It affects score, combo, and gauge.
- **FAST/SLOW**: Timing-direction display for early or late hits. The current implementation aggregates only `GREAT` and `GOOD`.
- **EX-SCORE**: IIDX-compatible score where `PERFECT=2`, `GREAT=1`, and other judgments add `0`.
- **SCORE**: Standard score normalized to 200,000 points.
- **groove gauge**: Clear gauge. The shared core defaults to LR2-compatible `GROOVE` (`NORMAL`); the exported helper also supports `HARD`, `DEATH`, and `EASY` for browser play options.
- **HIGH-SPEED**: User setting that changes visible note density. It does not change score time.
- **MANUAL / AUTO SCRATCH / AUTO**: Playback modes. `MANUAL` uses player input, `AUTO SCRATCH` automates scratch lanes only, and `AUTO` automates all playable notes.
- **control flow**: BMS branch directives such as `#RANDOM`, `#IF`, and `#SWITCH`. The parser retains them, and player/audio-renderer runtimes evaluate them before playback or rendering.

## Runtime Packages

- **player core**: The shared `@be-music/player` engine and helper surface. It owns timing, note extraction, judgment, scoring, gauge helpers, BGA timelines, and UI/audio adapter contracts.
- **terminal player**: The `@be-music/player-tui` CLI and TUI frontend. It provides Music Select, terminal gameplay, terminal BGA, loading screens, and SEA builds on top of the core engine.
- **browser player**: The `@be-music/player-web` PixiJS/WebAudio runtime and the `@be-music/player-web-demo` Vite host. It handles browser drops, LR2/beatoraja skin rendering, browser gameplay, result scenes, and recording.
- **skin family**: Browser-player scene family selected from the loaded theme state. The current families are LR2, beatoraja, and the built-in default family.
- **default skin family**: Built-in browser-player skin family used when no external theme is active or when the host explicitly selects it. It supplies skinless select, decide, gameplay, and result chrome (cut-in plates in navy / ice / cyan / gold, wobbling diamond lock-ons, additive flashes, per-element slam, diagonal wipes between scenes). Gameplay injects its chrome into the shared gameplay runtime without making LR2 import the default renderer.
- **LR2 skin**: Lunatic Rave 2 CSV skin format handled by `@be-music/lr2-skin`. The package parses skin files and resolves theme assets independently from PixiJS.
- **beatoraja skin**: beatoraja JSON or Lua skin format handled by `@be-music/beatoraja-skin`. The package parses headers and full skins, resolves options and assets, and normalizes elements independently from PixiJS.

## Internal Model

- **IR (`@be-music/json`)**: Internal intermediate representation for BMS/BMSON/JSON charts. It is not an external exchange format.
- **pure IR**: Design policy that `@be-music/json` stores normalized structure and preservation data without owning score semantics.
- **sourceFormat**: IR attribute that records whether the chart came from `bms`, `bmson`, or `json`.
- **round-trip**: Recreate source structure as much as possible through `parse -> IR -> stringify`.
- **preservation**: Auxiliary source-level data retained for round-trip output, separate from normalized `events` and `measures`.
- **sourceLines**: BMS preservation data that keeps header, object, and control-flow lines in declaration order.
- **objectLines**: BMS preservation data that keeps object lines outside control-flow blocks.
- **event**: Normalized score event with `measure`, `channel`, `position`, and `value`.
- **position**: IR event position. `[numerator, denominator]` represents a relative position inside the measure.
- **chart semantics (`@be-music/chart`)**: Score semantics above IR, including beat resolution, event order, long-note resolution, sample triggers, BGA timelines, and reference BPM.
- **bms.controlFlow**: BMS control-flow array retained by the parser. Branches are not finalized during parsing.

## Runtime And Display

- **candidate note**: Unjudged note searched as the judgment target when an input event arrives for a lane set.
- **keysound fallback**: LR2-compatible blank-press sound routing. If no note is judged, manual play may retrigger the latest same-lane visible or invisible WAV whose early BAD window has already opened; it never looks ahead to a future pending WAV before that note's window opens.
- **empty POOR**: LR2-compatible blank-keystroke side effect. It flashes `POOR`, triggers POOR BGA, and applies the `EMPTY_POOR` gauge delta without changing judge counters, combo, EX-SCORE, or score.
- **stateSignals / uiSignals**: Signal groups that send engine state to UI adapters, including judge, combo, frame, lane flash, and hold state.
- **UI runtime**: Runtime display adapter between the player core and a concrete frontend such as TUI or PixiJS.
- **gameplay worker / UI worker**: Node worker split used by the terminal frontend for heavier gameplay, rendering, and video BGA work.
- **ANSI rendering**: Terminal image/BGA rendering through character cells and colored strings.
- **Kitty graphics protocol**: Terminal image overlay protocol. The terminal player enables it by default and can disable it with `--no-kitty-graphics`.
- **render throttle**: TUI frame-rate limiter.
- **settle delay**: Short delay before Music Select preview playback starts after focus movement.
- **focus key**: Identifier used to restore the selected Music Select entry per directory. It can refer to a chart or to the `random` entry.
- **content hash**: Hash used to detect whether a cached chart body is unchanged. The current implementation uses SHA-256 over raw bytes.
- **cache hash**: Hash used to detect corruption of a persisted cache entry.
- **Sound / Visual status**: Separate loading-screen progress states for audio and visual resources.
- **structured log**: NDJSON execution log written separately from TUI output, usually under `~/.be-music/logs/player.ndjson`.
- **video BGA streaming**: Policy that prepares only the first video frame before gameplay starts, then decodes remaining frames progressively.
- **PlayerSummary**: Final playback summary containing judge counts, FAST/SLOW, EX-SCORE, SCORE, gauge, and clear state.

## Related Documents

- [Specification top](./README.md)
- [BMS implementation specification](./bms-spec.md)
- [BMSON implementation specification](./bmson-spec.md)
- [Player implementation specification](./player-spec.md)
- [Browser player implementation notes](./player-web.md)
- [LR2 skin implementation notes](./lr2-skin.md)
- [beatoraja skin implementation notes](./beatoraja-skin.md)
- [BMS/BMSON intermediate representation (`@be-music/json`) implementation specification](./json-spec.md)
