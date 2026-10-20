[Japanese version](./glossary.ja.md)

# Glossary

This document defines terms used by the `be-music` specifications and implementation.
The definitions follow general BMS/BMSON terminology where possible, but prioritize how this repository uses each term.

## Usage Rules

- **chart** is the default word for a score file and for the unit of playback, selection, and storage.
- **music** is a human-facing work unit such as a title and artist. One piece of music can have multiple charts.
- **song** is not the default repository term. Use it only when referring to an external specification name or file name such as `song.mid`, `bemuse-song.json`, or `songs[]`.
- **Music Select** is a screen name. The unit selected and restored on that screen is still a chart.
- In the library a select screen browses, a chart is a **library chart** (`LibraryChart`): a chart bar is `{ kind: 'chart', chart }`, a folder lists its `charts` and a course stage names its `chart`. Some public names still say song (`PlayResult.song`, `BrowserSongCollection`, `BeMusicSongRecord`, `resolveSongStats`, `CourseSongRecord`); new names say chart.
- When two entries below could be swapped, [Words that are not synonyms](#words-that-are-not-synonyms) says which word names which thing.

## Words that are not synonyms

- **chart** / **music** / **chartset**. A chart is one chart file, and the unit of play, selection and storage. Music is the work a person names by title and artist; one work can have several charts. A chartset is that work as the Leaderboard stores it, the charts BMS Search files together. English prose may say work for the same grouping; the Japanese UI says 作品. A chart that is not linked yet is shown on its own.
- **song**. An external name only (`song.mid`, `bemuse-song.json`, `songs[]`, an LR2 or beatoraja song bar). Public names that still say song mean a chart.
- **play variant** / **key mode** / **lane mode** / **play mode**. The play variant (`ChartPlayVariant`, `'5'` through `'48'`) picks the lane layout and the play skin. The key mode (`KeyMode`, a number) is the key-count a select filter lists; a bmson `mode_hint` wins over the variant. Lane mode is the Leaderboard's stored label (`7keys`). A play mode is one row of `PLAY_MODE_LAYOUTS`, which can split one key count into two layouts (9 KEY BME and 9 KEY PMS).
- **gauge type** / **gauge id**. The gauge type is what the player picks, in LR2's names (`GROOVE`, `HARD`, `DEATH`, `EASY`). The gauge id is the gauge that judge ruleset actually runs (`NORMAL`, `HAZARD`, `CLASS`). `DEATH` runs as beatoraja's `HAZARD`.
- **skin** / **theme** / **family** / **kit**. A skin is one skin definition. A theme is a dropped folder of skins plus its BGM and system sounds. A family is which drawer runs (`built-in`, `lr2`, `beatoraja`). A kit is what the host hands one scene of that family.
- **library** / **collection**. The library is the select screen's model (`Library`, `LibraryChart`). A collection is the browser loader that fills one (`BrowserSongCollection`, the `./collection` entry). New loader names say library.
- **play log** / **replay** / **score** / **best record** / **PlayerSummary** / **play result**. A play log is the recorded-input file. A replay is playing that log, and the replay judge strategy. A Leaderboard score is one submitted play. `SCORE` and `EX-SCORE` are point totals, not that row. A best record is the best lamp, EX-SCORE, combo and BP under one judge ruleset. `PlayerSummary` is the engine's tally at the end of a play. A play result is the payload every result screen reads.
- **IR**. The chart IR is `BeMusicJSON`. An Internet Ranking is what LR2 and beatoraja call an online ranking; this repository's is the Leaderboard. _Avoid_ calling the Leaderboard an IR.
- **hi-speed** / **HS-FIX** / **white number** / **play tempo**. Hi-speed changes how dense notes look, not judgment time. HS-FIX picks the BPM that density is measured against. The white number is the hi-speed value a screen shows. Play tempo (`speed`) changes how fast the chart itself runs, including judgment time. A changed tempo is practice.
- **judge rank** / **DJ rank** / **play level** / **difficulty**. Judge rank is `#RANK`, `#EXRANK` or bmson `judge_rank`: the judge windows. DJ rank is the grade of an EX-SCORE. Play level is the chart's level (☆). Difficulty is BMS `#DIFFICULTY` (1–5).
- **stage**. A course stage is one chart of a course run. A skin stage is the rectangle a skin draws on (`BeMusicStage`, a portrait stage). `STAGEFILE` is the loading image.
- **option** / **op**. Play options are what the player sets (gauge, lane random, hi-speed). An op is an LR2 or beatoraja skin's numeric visibility gate. A custom option is a choice the skin author declares.
- **preview**. A chart preview is the short select-screen audio (`#PREVIEW`, bmson `preview_music`). A preview environment is the deploy from `devel`. URL auto-load (`?music=`) is neither.
- **BP** / **misses**. BP is the name (`resolveMissCount`). Leaderboard English that says misses means BP.
- **clear** / **clear lamp** / **trophy**. A clear is the gauge surviving the chart. A clear lamp is the grade of the result (FAILED to MAX). A trophy is the course-run award, separate from the lamp.
- **random**. `#RANDOM` is control flow. A random lane option (RANDOM, MIRROR, and the rest) reorders lanes. The random entry on a select screen picks a chart. The three do not share a result.

## Charts And Resources

- **BMS**: Be-Music Source text score format. It consists of header and object lines such as `#TITLE`, `#WAVxx`, and `#mmmcc:...`.
- **bmson**: JSON-based score format with structures such as `info`, `sound_channels`, `bga`, and `lines`.
- **chart**: One chart file, and the unit of playback. In Music Select, one list entry corresponds to one chart. A chartset is the Leaderboard's grouping of the charts of one work, not another name for a chart.
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
- **mine**: Damage note. Following LR2, a mine explodes when its lane is held as it crosses the judge line or pressed within the `PGREAT` window; the explosion only drains the gauge by the chart-defined damage and is not a judgment.
- **judge**: `PERFECT` / `GREAT` / `GOOD` / `BAD` / `POOR` result. It affects score, combo, and gauge.
- **FAST/SLOW**: Timing-direction display for early or late hits. The current implementation aggregates only `GREAT` and `GOOD`.
- **EX-SCORE**: IIDX-compatible score where `PERFECT=2`, `GREAT=1`, and other judgments add `0`.
- **SCORE**: Standard score normalized to 200,000 points.
- **groove gauge**: Clear gauge. The shared core defaults to LR2-compatible `GROOVE` (`NORMAL`); the exported helper also supports `HARD`, `DEATH`, and `EASY` for browser play options.
- **HIGH-SPEED**: User setting that changes visible note density. It does not change score time.
- **MANUAL / AUTO SCRATCH / AUTO**: Playback modes. `MANUAL` uses player input, `AUTO SCRATCH` automates scratch lanes only, and `AUTO` automates all playable notes.
- **control flow**: BMS branch directives such as `#RANDOM`, `#IF`, and `#SWITCH`. The parser retains them; hosts resolve them once per play, before playback or rendering, with explicit `RandomDraws`.
- **RandomDraws**: The outcome of a chart's control flow for one play: one entry (command, range, value) per `#RANDOM` / `#SETRANDOM` / `#SWITCH` / `#SETSWITCH` line in file order. Drawn once with `drawRandomOutcomes` and shared by the resolver, the engine and the play log.
- **Source layer / Resolved layer**: The two layers a chart is read in. The Source layer (`BeMusicJSON`) is what the file says; the Resolved layer (`ResolvedChart`, built by `resolveChart` in `@be-music/chart`) is what the player plays, with every format default and de facto rule applied. See [Architecture](./architecture.md).

## Runtime Packages

- **player core**: The shared `@be-music/player` rules and engine. The package root is the engine (`manualPlay`, `autoPlay`): it prepares a play from the resolved chart, judges it and owns the UI / audio / input runtime contracts. The other entries hold the rules (`./ruleset`, `./course`, `./records`, `./playlog`) and what a host shares with a play (`./signals`, `./lanes`, `./display`). Timing, note resolution and timelines live in `@be-music/chart`.
- **terminal player**: The `@be-music/player-tui` CLI and TUI frontend. It provides Music Select, terminal gameplay, terminal BGA, loading screens, and SEA builds on top of the core engine.
- **browser player**: The `@be-music/player-web` PixiJS/WebAudio runtime and the `@be-music/player-web-demo` Vite host. The runtime makes every screen as a scene session drawn by a family view, behind its host API, and loads the library and the skins and records plays; the demo handles browser drops, themes, the Debug Menu and the scene router.
- **skin family**: The kind of skin that draws a browser-player scene: `built-in` (be-music skins), `lr2` or `beatoraja` (`SceneFamily`). The host picks it from the loaded themes and the player's choice.
- **built-in family (default skin family)**: The skin family used when no external theme is active or when the host explicitly selects it. It draws select, play and result (and decide, when the skin declares one) through a be-music skin; its play view draws the shared playfield, as the LR2 one does, and the skin draws the chrome around it.
- **be-music skin**: Code-based skin written against `@be-music/skin-sdk`. The player hands it a canvas and plain per-frame data, and the skin draws each screen with whatever renderer it brings.
- **built-in skins**: The be-music skins bundled with the browser player: Synesthesia (the default), Phantom, and Plain, plus the opt-in Lattice.
- **touch layout / portrait stage**: Gameplay layouts for touch-first devices. The touch layout spreads equal-width lanes across the stage; a skin with a `portraitStage` can also be shown on a portrait (9:16) stage.
- **LR2 skin**: Lunatic Rave 2 CSV skin format handled by `@be-music/lr2-skin`. The package parses skin files and resolves theme assets independently from PixiJS.
- **beatoraja skin**: beatoraja JSON or Lua skin format handled by `@be-music/beatoraja-skin`. The package parses headers and full skins, resolves options and assets, and normalizes elements independently from PixiJS.

## Internal Model

- **IR (`@be-music/json`)**: Internal intermediate representation for BMS/BMSON/JSON charts (`BeMusicJSON`). It is not an external exchange format. LR2 and beatoraja also say IR for an Internet Ranking; here that product is the Leaderboard.
- **pure IR**: Design policy that `@be-music/json` stores normalized structure and preservation data without owning score semantics.
- **sourceFormat**: IR attribute that records whether the chart came from `bms`, `bmson`, or `json`.
- **round-trip**: Recreate source structure as much as possible through `parse -> IR -> stringify`.
- **preservation**: Auxiliary source-level data retained for round-trip output, separate from normalized `events` and `measures`.
- **sourceLines**: BMS preservation data that keeps header, object, and control-flow lines in declaration order.
- **objectLines**: BMS preservation data that keeps object lines outside control-flow blocks.
- **event**: Normalized score event with `measure`, `channel`, `position`, and `value`.
- **position**: IR event position. `[numerator, denominator]` represents a relative position inside the measure.
- **chart semantics (`@be-music/chart`)**: Score semantics above IR, including beat resolution, event order, long-note resolution, sample triggers, BGA timelines, and reference BPM.
- **bms.controlFlow**: BMS control-flow array retained by the parser. Branches are not finalized during parsing; a resolved chart has an empty array.

## Runtime And Display

- **candidate note**: Unjudged note searched as the judgment target when an input event arrives for a lane set.
- **keysound fallback**: LR2-compatible blank-press sound routing. If no note is judged, manual play may retrigger the latest same-lane visible or invisible WAV whose early BAD window has already opened; it never looks ahead to a future pending WAV before that note's window opens.
- **empty POOR**: LR2-compatible blank-keystroke side effect. It flashes `POOR`, triggers POOR BGA, and applies the `EMPTY_POOR` gauge delta without changing judge counters, combo, EX-SCORE, or score.
- **stateSignals / uiSignals**: Signal groups that send engine state to UI adapters, including judge, combo, frame, lane flash, and hold state (`createPlayerStateSignals`, `createPlayerUISignalBus` on `@be-music/player/signals`).
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
- **play log (playlog)**: The recorded input of one play (`*.bmplay.json`): the resolved chart, every key press and release, and the play settings. `bms-playlog` re-simulates it under the LR2, beatoraja, and IIDX rulesets. Playing that file back is a replay, not a second name for the file.
- **PlayerSummary**: Final playback summary containing judge counts, FAST/SLOW, EX-SCORE, SCORE, gauge, and clear state.

## Courses, Records And View

- **course run**: One play of a course: its stages in order, or, for NONSTOP, one stitched play. It is ranked and recorded as one run. _Avoid_: course session, course play.
- **stage**: One chart of a course run. A skin stage (`BeMusicStage`) and `#STAGEFILE` are different things.
- **carry-in**: The gauge value, course combo and course max combo a stage starts from, left by the stage before it.
- **give up**: Leaving a course run with ESC. A run given up is a failed run.
- **stitched play**: The single chart a NONSTOP course is played as, built by stitching its stages with their connections and placement.
- **judge ruleset**: The game whose judge windows, gauges and lamps a play is judged and ranked by: `lr2`, `beatoraja` or `iidx`.
- **gauge type**: The gauge the player picks, in LR2's names: `GROOVE`, `HARD`, `DEATH` or `EASY` (`GaugeType`). Each judge ruleset plays it on a gauge of its own line-up, named by its gauge id (`NORMAL`, `HAZARD`, `CLASS`, ...).
- **clear lamp**: The class of clear a play earned (FAILED to MAX, `ClearLamp`). Each judge ruleset awards its own subset; one rule lamps every play (`resolveClearLamp`, `resolveCourseClearLamp` in `@be-music/player/ruleset`).
- **BP**: BADs, POORs and empty POORs, plus, for a course, the notes the run never judged (`resolveMissCount`). Leaderboard English that says misses means this count.
- **best record**: The best clear lamp, EX-SCORE, max combo and BP a player has on a chart or course under one judge ruleset (`BestRecord`, kept by the rules of `@be-music/player/records`).
- **view settings**: What the player saw, apart from what was judged: hi-speed, hi-speed fix, visible time and each side's SUDDEN+, HIDDEN+ and LIFT. _Avoid_: display options.
- **play tempo**: How fast a play runs relative to the chart (`speed`). A play at another tempo is practice.

## Architecture

- **scene model**: The state and rules of one screen, independent of the skin family: what it shows and how it responds. See [ADR 0002](./adr/0002-scene-model-package.md) and [Scene models](./scene-model.md).
- **designed entry point**: A package subpath made for its consumers rather than a file of its layout. `@be-music/player` exports `.` (the engine), `./signals`, `./lanes`, `./display`, `./ruleset`, `./playlog`, `./records`, `./course` and `./audio-sink`; `@be-music/player-web` exports `.`, `./host`, `./skin`, `./collection`, `./audio` and `./recording`. Everything else is internal. See [ADR 0005](./adr/0005-public-entry-points.md).
- **library / library chart / library entry**: What a select screen browses: the charts, grouped into folders at the root, and the course folders (`Library`); one chart in it is a library chart (`LibraryChart`), and one bar of its list is a chart, a folder or a course (`LibraryEntry`, `kind: 'chart' | 'folder' | 'course'`).
- **browse state**: Where the player is in the library and how the list is shaped: the open folders, the cursor at each depth, the search, the sort and filters (the list options) and the favourites (`BrowseState`). Its snapshot (`BrowseSnapshot`, taken with `captureBrowse` and restored with `restoreBrowse`) keeps it across the scenes a play goes through.
- **play state**: What every play screen reads of a play, fed by the engine's frames and judgments: the running gauge and EX score with their graphs, the combo, the timed judgments, and the view settings (`PlayState`, changed only through `reducePlayState`).
- **play result**: The one result payload of a single play, a course stage, a course run or a NONSTOP run (`PlayResult`); its run kind (`single`, `stage`, `course`, `nonstop`) says which. Every result screen reads it.
- **system sound set**: A theme's cues and jingles by slot (cursor, decide, folders, option panels, select BGM, clear / fail jingles, …), each resolved to bytes or to a path in the theme (`SystemSoundSet`).
- **scene session**: The one implementation of a screen's behaviour, shared by every skin family (`session/` in `@be-music/player-web`): browsing, chart preparation, the engine, input, sound and endings. Each tick it hands its family view a frame built over the scene models and takes back intents. See [ADR 0001](./adr/0001-skin-families-only-draw.md).
- **family view**: How one skin family draws a scene model (`view/built-in/`, `view/lr2/`, `view/beatoraja/`); it draws the session's frames, returns the player's actions as intents and never runs the engine.
- **family kit**: What a host hands a scene to draw it with, per skin family: a be-music skin with the player's settings for it (`built-in`), an LR2 skin (`lr2`) or a loaded beatoraja theme entry (`beatoraja`) (`SelectKit`, `DecideKit`, `PlayKit`, `ResultKit`).
- **host API**: `@be-music/player-web/host`: `PixiSceneHost`, which shows one scene at a time, and `createSelectScene`, `createDecideScene`, `createPlayScene` and `createResultScene`, which make each screen from a family kit as a `SessionScene`.
- **scene lifecycle**: The one contract every scene implements (`PixiScene`): `root`, `identity` (`{ kind, family }`), `enter`, `exit` and `dispose`. A host changes scenes only with `setScene`.
- **intent**: What a player's action on a view means for the scene: open a folder, start a course, cycle the gauge.
- **play loop / judge strategy**: The one engine loop every play runs through, and the manual, auto or replay judging plugged into it. See [ADR 0003](./adr/0003-one-play-loop.md).
- **scene router**: The host's single owner of the current scene and every transition (`app/scene-router.ts` in the web demo). See [ADR 0006](./adr/0006-scene-router.md).
- **audio service**: The one way the web player plays sounds outside a play's chart (`createAudioService` on `@be-music/player-web/audio`): the select BGM, cues, jingles, chart preview and skin sounds, on one system `AudioContext`. Each play opens its own context through it (`openPlayGraph`). A scene passes itself as the owner of what it starts and stops it with `stopOwned`. See [ADR 0007](./adr/0007-one-system-audio-context.md).

## Related Documents

- [Specification top](./README.md)
- [BMS implementation specification](./bms-spec.md)
- [BMSON implementation specification](./bmson-spec.md)
- [Bemuse implementation specification](./bemuse-spec.md)
- [Player implementation specification](./player-spec.md)
- [Terminal player implementation notes](./player-tui.md)
- [Browser player implementation notes](./player-web.md)
- [Scene models](./scene-model.md)
- [Architecture](./architecture.md)
- [Play log (play history) specification](./playlog.md)
- [Writing a be-music skin](./be-music-skin.md)
- [LR2 skin implementation notes](./lr2-skin.md)
- [beatoraja skin implementation notes](./beatoraja-skin.md)
- [BMS/BMSON intermediate representation (`@be-music/json`) implementation specification](./json-spec.md)
