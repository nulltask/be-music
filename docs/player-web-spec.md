[Japanese version](./player-web-spec.ja.md)

# Player Web implementation specification

This document defines the current implementation status and forward roadmap of the browser player centered on `@be-music/player-web-core`.

The browser player currently provides a local-first flow that loads charts by dropping a folder or ZIP file, shows a song list, and starts PixiJS-based gameplay in the browser.

## Purpose

- Clarify the current scope of the browser player implementation.
- Record which chart-related behaviors are already aligned with the CLI player and which are not yet implemented.
- Provide a staged roadmap so follow-up work can be prioritized without re-auditing the entire codebase.

## Scope

This document covers the browser-side player packages and their direct runtime responsibilities.

- `@be-music/player-web-core`
- `@be-music/player-react`
- `@be-music/player-vue`
- `@be-music/player-web-demo`

The canonical runtime specification of the CLI/Node player remains [`player-spec.md`](./player-spec.md).
If this document conflicts with the CLI runtime behavior, treat that mismatch as a browser implementation gap unless this document explicitly defines a browser-only divergence.

## Revision tracking information

- Audit origin: `0106ea4` (`feat(player-web): add browser song library and gameplay`)
- Audit point: `4526a08` (`feat(player-web): add manual browser gameplay`)
- Audit target: `packages/player-web-core` / `packages/player-react` / `packages/player-vue` / `packages/player-web-demo` / related `packages/player` chart-runtime references / `docs`
- This document reflects the browser player implementation range audited at the above point.

## Current architecture

The browser player is intentionally split into a framework-agnostic rendering core and thin framework adapters.

- `@be-music/player-web-core`
  - Loads dropped folders / ZIP archives / loose chart files
  - Parses charts in the browser
  - Resolves timing
  - Renders song list and gameplay with PixiJS
  - Plays audio with Web Audio in real time
- `@be-music/player-react`
  - Thin React adapter around the browser core
- `@be-music/player-vue`
  - Thin Vue adapter around the browser core
- `@be-music/player-web-demo`
  - Vite demo application used for local verification

## Current implementation status

### Implemented

- Dropping local folders, ZIP files, and loose chart files
- Parsing BMS / BME / BML / BMSON / be-music JSON in the browser
- Song list display with chart metadata such as title, subtitle, artist, genre, difficulty, level, and base BPM
- Real-time timing resolution for BPM change and STOP
- PixiJS-based gameplay scene
- Manual gameplay with keyboard input
- Groove gauge, score summary, combo, and fast/slow tracking
- Landmine hit handling including `#WAV00`
- LNOBJ and legacy BMS long note extraction
- Browser audio playback in real time without prerendering the whole chart
- Browser High Speed adjustment
- Runtime BMS control flow resolution before gameplay starts
- Gameplay rendering support for `#SCROLLxx` and `#SPEEDxx`
- Extended song summary fields for `subartist`, `bannerPath`, `totalNotes`, `player`, `rank`, `rankLabel`, `bpmInitial`, `bpmMin`, and `bpmMax`
- Deterministic `previewContinueKey` derivation for browser song summaries
- Song-list preview playback with `#PREVIEW` priority and fallback preview scheduling

### Implemented but simplified relative to the CLI player

- Long note judging exists, but is not yet a complete behavioral match for the CLI player's long-note mode handling
- Song list metadata is present, but still thinner than the CLI music-select summary
- Gameplay lane presentation is browser-specific and only partially aligned with the terminal player's display semantics

## Chart-related gaps relative to the CLI player

The following chart-related behaviors exist in the CLI player but are not yet fully implemented in the browser player.

### 1. BGA / layer / POOR / video / loading assets

The CLI player supports:

- base BGA
- layer BGA
- layer2 BGA
- POOR BGA
- `#POORBGA`
- `#BMP00` fallback for POOR BGA
- video BGA
- `#STAGEFILE`
- `#BANNER`

The browser player does not yet provide an equivalent BGA pipeline in gameplay or song selection.

### 2. Invisible notes and lane-fallback keysounds

The CLI player extracts invisible notes separately and uses them for manual-input assistance and lane-fallback keysound behavior.
The browser player now extracts invisible play-lane notes and uses them for manual-input lane-fallback sample triggering.
Invisible notes are also expired alongside visible notes so fallback playback does not keep selecting stale objects forever.

### 3. Dynamic judgment rank changes

The CLI player supports runtime judge-window changes through `#xxxA0` and `#EXRANKxx`.
The browser player currently resolves judge windows once at gameplay start and does not yet update them during playback.

### 4. Playback-end extension from UI/BGA assets

The CLI player can extend playback end based on UI/BGA runtime playback requirements.
The browser player currently derives duration primarily from chart event timing and note tails.

## Roadmap

The browser player should be expanded in the following order.

### Phase 1: Correct chart interpretation

Status:

- Complete

Completed work:

- Resolve BMS control flow before song summary generation and gameplay
- Expand browser song metadata to match the CLI selection summary more closely
- Add deterministic preview identity and song-list preview playback

### Phase 2: Gameplay semantic parity

Status:

- In progress

Completed work:

- Added `#SCROLLxx` and `#SPEEDxx` timeline support to browser gameplay rendering
- Added invisible-note extraction and lane-fallback keysound triggering

Goals:

- Match the CLI player's note rendering semantics more closely
- Match manual input semantics more closely

Tasks:

1. Add runtime `#EXRANKxx` / `A0` judge-window updates.
2. Tighten long-note behavior toward full CLI parity.

Why second:

- These items affect real gameplay correctness but do not block the browser player from loading and running basic charts.
- They depend on Phase 1 control-flow correctness to avoid interpreting the wrong event stream.

### Phase 3: Media parity and polish

Goals:

- Reach practical parity with the CLI player's media and presentation behavior

Tasks:

1. Add `#BANNER` rendering in the browser song list.
2. Add `#STAGEFILE` rendering for pre-game loading state.
3. Add gameplay BGA support in staged order:
   - static base BGA
   - layer / layer2 / POOR BGA
   - video BGA
4. Extend playback end when media playback requires it.

Why third:

- Media features are valuable but larger in scope than the chart-interpretation gaps above.
- Staging static images before video keeps risk and debugging cost manageable.

## Browser-only policy

The browser player is currently local-first.
Near-term loading is based on user-dropped folders and ZIP archives.

The intended future direction is:

1. Registry server for chart discovery
2. ZIP-based chart package distribution
3. Browser-side load and play from downloaded chart bundles

When that remote-loading path is introduced, this document should be extended with:

- package integrity requirements
- archive layout expectations
- asset resolution policy
- caching policy
- browser security constraints
