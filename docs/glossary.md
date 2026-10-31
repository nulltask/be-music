[Japanese version](./glossary.ja.md)

# Glossary

This document defines terms used by the `be-music` specifications and implementation.
The definitions follow general BMS/bmson terminology where possible, but prioritize how this repository uses each term.

## Usage Rules

- **chart** is the default word for a playable arrangement of timed objects and resource references. A **chart file** serializes a chart; the arrangement and its file bytes are different identities.
- **track** names the musical work, independently of a playable arrangement. One work can have multiple charts; title and artist are descriptive metadata, not unique identifiers. Do not infer a separate track entity or identity from those fields.
- Use **track** / `Track` / `trackId` for individual musical works. **Music** may describe music in general, but is not the entity name. A track is distinct from an **audio asset** (a file payload) and an **audio track** (a recording or editor timeline lane). Keep screen names such as **Music Select** and external keys such as `preview_music` unchanged.
- **song** is not the default repository term. Use it only when referring to an external specification name or file name such as `song.mid`, `bemuse-song.json`, or `songs[]`.
- **Music Select** is a screen name. The unit selected and restored on that screen is still a chart.
- In the library a select screen browses, a chart is a **library chart** (`LibraryChart`): a chart bar is `{ kind: 'chart', chart }`, a folder lists its `charts` and a course stage names its `chart`. Code names now say chart (`PlayResult.chart`, `BrowserChartCollectionStore`, `BrowserAssetSource`, the skin SDK's `chartBestRecord`, `BeMusicChartBestRecord` and `resolveChartStats`).

## Preferred Spellings

Use these terms in documentation, source comments, and user-facing text. Code identifiers follow [the naming rules](../AGENTS.md); preserve names required by BMS, bmson and external services while aligning project-owned names with this vocabulary.

| Concept                               | English              | Japanese              | Code                                                             |
| ------------------------------------- | -------------------- | --------------------- | ---------------------------------------------------------------- |
| Playable arrangement                  | chart                | 譜面                  | `chart`                                                          |
| Musical work shared by charts         | track                | 楽曲                  | `track`                                                          |
| JSON-based chart format               | bmson                | bmson                 | `bmson` / `Bmson`; existing `BMSON_*` constants remain unchanged |
| Judgment result                       | judgment             | 判定                  | `judge` in existing APIs                                         |
| Recorded input replay                 | replay               | リプレイ              | `replay` / `Replay`                                              |
| Profile image                         | avatar               | アバター              | `avatar`                                                         |
| Unique public user name               | handle               | ユーザー名            | `handle`                                                         |
| Name shown beside an avatar           | display name         | 表示名                | `displayName`                                                    |
| Enter or end an authenticated session | sign in / sign out   | ログイン / ログアウト | `signIn` / `signOut`; preserve authentication library contracts  |
| Deployment environments               | production / preview | 本番 / プレビュー     | `production` / `preview`                                         |

Use **play history** for a collection or list of plays, and **replay** for one recorded replay; these are different concepts. Use **sign-in** and **sign-out** as modifiers or nouns, and **sign in** and **sign out** as verbs. A UI **icon** is a symbol for an action or entity; a user's profile image is an **avatar**.

Use **replay** for recorded playback data: `BeMusicReplay` for its type, `replay` for data, and verbs such as `parseReplay`, `serializeReplay` and `simulateReplay` for operations. Reserve **log** for diagnostic or execution logs.

Use **chart** in code names for playable arrangements and **track** for musical works. Keep external names such as beatoraja’s `song` table and `BMSONDecoder` unchanged.

Use `____` in source identifiers and project-owned serialized values, `????` for the displayed game name, and **That-Which-Must-Not-Be-Named** in English or **名前を言ってはいけないあのゲーム** in Japanese when describing the game. Previous identifiers are not supported or migrated.

## Score And Resources

- **BMS**: Be-Music Source text score format. It consists of header and object lines such as `#TITLE`, `#WAVxx`, and `#mmmcc:...`.
- **bmson**: JSON-based score format with structures such as `info`, `sound_channels`, `bga`, and `lines`.
- **chart**: A playable arrangement of timed objects and resource references. A chart file is its representation in BMS, bmson, or the internal JSON format; Music Select selects a library chart, not an abstract musical work.
- **metadata**: Descriptive data outside the note body, such as title, artist, genre, comments, `#STAGEFILE`, `#BACKBMP`, and `#BANNER`.
- **resource**: External audio, image, video, or text file referenced by a chart or skin.
- **keysound**: Audio resource used for notes and BGM. BMS usually uses `#WAVxx`; bmson uses `sound_channels`.
- **intrinsic sample gain**: A linear gain attached to a keysound slot, independent of the playback bus and user volume. Composition uses it to preserve a source stage's level.
- **audio preview**: Short audio played on Music Select. Qualify this as audio preview when deployment environments are also discussed. The runtime prefers `#PREVIEW` or bmson `info.preview_music`.
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
- **beat**: Musical position measured in quarter-note units; an ordinary 4/4 measure spans four beats, while a measure-length multiplier changes its span. Beats are distinct from seconds and from the fractional `position` inside a measure.
- **BPM**: Beats per minute. It controls score-time progression.
- **STOP**: Event that stops score time for a duration. It affects visual position and judgment time.
- **SCROLL**: Visual scroll coefficient. It changes note distance, not judgment time.
- **SPEED**: Interpolated visual spacing factor used with `SCROLL`.
- **long note (LN)**: Note with a start and end point. Hold, release, and end judgment depend on `LNMODE`.
- **LNOBJ**: BMS long-note terminator object declared by `#LNOBJ`.
- **LNMODE**: BMS long-note judgment rule. `1`, `2`, and `3` change end judgment and hold-break behavior.
- **mine**: Damage note. Following LR2, a mine explodes when its lane is held as it crosses the judge line or pressed within the `PGREAT` window; the explosion only drains the gauge by the chart-defined damage and is not a judgment.
- **judgment**: A note evaluation such as `PERFECT`, `GREAT`, `GOOD`, `BAD`, or `POOR`. Use judgment for the result and judge for the verb; use `JudgmentKind` for a kind and `JudgmentTiming` for a timed result. Verb-led engine names and format fields such as `judge` and `judgeRuleset` retain their roles.
- **FAST/SLOW**: Timing-direction display for early or late hits. The current implementation aggregates only `GREAT` and `GOOD`.
- **EX-SCORE**: That-Which-Must-Not-Be-Named-compatible score where `PERFECT=2`, `GREAT=1`, and other judgments add `0`.
- **SCORE**: The displayed score: LR2 uses its normalized 200,000-point money score; the other current rulesets display EX-SCORE.
- **groove gauge**: Clear gauge. The shared core defaults to LR2-compatible `GROOVE` (`NORMAL`); the exported helper also supports `HARD`, `DEATH`, and `EASY` for browser play options.
- **hi-speed**: The visual note-scroll setting; it changes the presentation and visible interval without changing note timing or playback tempo. External skin labels such as `HI-SPEED` and `HIGH-SPEED`, and existing `hiSpeed` names, keep their spellings.
- **MANUAL / AUTO SCRATCH / AUTO**: Playback modes. `MANUAL` uses player input, `AUTO SCRATCH` automates scratch lanes only, and `AUTO` automates all playable notes.
- **control flow**: BMS branch directives such as `#RANDOM`, `#IF`, and `#SWITCH`. The parser retains them; hosts resolve them once per play, before playback or rendering, with explicit `RandomDraws`.
- **RandomDraws**: The outcome of a chart's control flow for one play: one entry (command, range, value) per `#RANDOM` / `#SETRANDOM` / `#SWITCH` / `#SETSWITCH` line in file order. Drawn once with `drawRandomOutcomes` and shared by the resolver, the engine and the replay.
- **Source layer / Resolved layer**: The two layers a chart is read in. The Source layer (`BeMusicJSON`) is what the file says; the Resolved layer (`ResolvedChart`, built by `resolveChart` in `@be-music/chart-model`) is what the player plays, with every format default and de facto rule applied. See [Architecture](./architecture.md).

## Runtime Packages

- **player core**: The shared `@be-music/player-engine` rules and engine. The package root is the engine (`manualPlay`, `autoPlay`): it prepares a play from the resolved chart, judges it and owns the UI / audio / input runtime contracts. The other entries hold the rules (`./ruleset`, `./course`, `./records`, `./replay`) and what a host shares with a play (`./signals`, `./lanes`, `./display`). Timing, note resolution and timelines live in `@be-music/chart-model`.
- **Node audio adapter**: The Node audio implementation in `@be-music/player-node-audio`. Hosts pass `createAudioSession: createNodeAudioSession` to the engine. The engine owns the audio contract; the adapter owns decoding and output.
- **terminal player**: The `@be-music/player-terminal` CLI and TUI frontend. It provides Music Select, terminal gameplay, terminal BGA, loading screens, and SEA builds on top of the core engine.
- **browser player**: The `@be-music/player-browser` PixiJS/WebAudio runtime and the `@be-music/app-play` Vite host. The runtime makes every screen as a scene session drawn by a family view, behind its host API, and loads the library and the skins and records plays; the player handles browser drops, themes, the Debug Menu and the scene router.
- **skin family**: The kind of skin that draws a browser-player scene: `built-in` (be-music skins), `lr2` or `beatoraja` (`SceneFamily`). The host picks it from the loaded themes and the player's choice.
- **built-in family (default skin family)**: The skin family used when no external theme is active or when the host explicitly selects it. It draws select, play and result (and decide, when the skin declares one) through a be-music skin; its play view draws the shared playfield, as the LR2 one does, and the skin draws the chrome around it.
- **be-music skin**: Code-based skin written against `@be-music/player-skin-sdk`. It receives presentation frames and combines Canvas drawing with optional DOM screens. DOM replaces select, decide and result drawing, and adds a HUD beside the Canvas playfield during gameplay; a skin that sets `gameplay.drawsOnDOM` draws the playfield on DOM too.
- **built-in skins**: The be-music skins bundled with the browser player: Synesthesia (the default), Plain, and Native (DOM + Canvas). Native uses reusable components from `@be-music/player-ui`.
- **touch layout / portrait stage**: Gameplay layouts for touch-first devices. The touch layout spreads equal-width lanes across the stage; a skin with a `portraitStage` can also be shown on a portrait (9:16) stage.
- **LR2 skin**: Lunatic Rave 2 CSV skin format handled by `@be-music/skin-lr2`. The package parses skin files and resolves theme assets independently from PixiJS.
- **beatoraja skin**: beatoraja JSON or Lua skin format handled by `@be-music/skin-beatoraja`. The package parses headers and full skins, resolves options and assets, and normalizes elements independently from PixiJS.

## Internal Model

- **IR (`@be-music/chart-source`)**: Internal intermediate representation for BMS/bmson/JSON charts. It is not an external exchange format.
- **pure IR**: Design policy that `@be-music/chart-source` stores normalized structure and preservation data without owning score semantics.
- **sourceFormat**: IR attribute that records whether the chart came from `bms`, `bmson`, or `json`.
- **round-trip**: Recreate source structure as much as possible through `parse -> IR -> stringify`.
- **preservation**: Auxiliary source-level data retained for round-trip output, separate from normalized `events` and `measures`.
- **sourceLines**: BMS preservation data that keeps header, object, and control-flow lines in declaration order.
- **objectLines**: BMS preservation data that keeps object lines outside control-flow blocks.
- **event**: Normalized score event with `measure`, `channel`, `position`, and `value`.
- **position**: IR event position. `[numerator, denominator]` represents a relative position inside the measure.
- **chart semantics (`@be-music/chart-model`)**: Score semantics above IR, including beat resolution, event order, long-note resolution, sample triggers, BGA timelines, and reference BPM.
- **bms.controlFlow**: BMS control-flow array retained by the parser. Branches are not finalized during parsing; a resolved chart has an empty array.

## Identity And Profiles

- **user**: The identity that owns plays and data across services. Use its stable user ID to establish ownership (and the issuer with the subject at OIDC boundaries); a handle, display name, or avatar is not that identity.
- **account**: The user-facing means of accessing a user identity through authentication. Qualify **linked login account** for an external provider association: Better Auth's `account` table stores those associations, not separate be-music users.
- **guest / anonymous user**: A user identity created without a permanent sign-in credential. Guest describes the UI experience; anonymous describes the stored authentication state. It still has a user ID and can own plays.
- **profile**: A user's public presentation: handle, display name, and avatar. Editing it does not create a new user identity.
- **session**: Authentication state with a lifetime. An Accounts session and each app's local session are distinct even when they identify the same user; an engine play session or scene session is not an authentication session.
- **preview environment**: A deployment used to verify changes before production. It is unrelated to an audio preview.

## Chart Identity

- **chart file hash**: A digest of the file's raw bytes, such as SHA-256 or MD5. Reformatting or converting a file can change it without changing what is played. The terminal selection cache's `contentHash` is a chart file hash; its `cacheHash` instead checks the cached summary.
- **chart fingerprint**: The content-based identity used to group plays of a chart, including all its control-flow branches. It is distinct from the chart file hash and from any one branch selected for a play.
- **play fingerprint**: The content-based identity of the chart branch selected for a play. It does not identify a particular player's performance, and lane options such as RANDOM or MIRROR do not make it a play-result ID. See [Fingerprints](./fingerprint-spec.md).

## Runtime And Display

- **candidate note**: Unjudged note searched as the judgment target when an input event arrives for a lane set.
- **keysound fallback**: LR2-compatible blank-press sound routing. If no note is judged, manual play may retrigger the latest same-lane visible or invisible WAV whose early BAD window has already opened; it never looks ahead to a future pending WAV before that note's window opens.
- **empty POOR**: LR2-compatible blank-keystroke side effect. It flashes `POOR`, triggers POOR BGA, and applies the `EMPTY_POOR` gauge delta without changing judgment counters, combo, EX-SCORE, or score.
- **stateSignals / uiSignals**: Signal groups that send engine state to UI adapters, including judge, combo, frame, lane flash, and hold state (`createPlayerStateSignals`, `createPlayerUISignalBus` on `@be-music/player-engine/signals`).
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
- **replay**: A recording for deterministic replay of one play (`*.bmplay.json`), including the resolved chart, input events, and play settings. It is distinct from the summary of the play and from the collection called play history. `bms-replay` re-simulates it under the LR2, beatoraja, and That-Which-Must-Not-Be-Named rulesets.
- **PlayerSummary**: Final playback summary containing judgment counts, FAST/SLOW, EX-SCORE, SCORE, gauge, and clear state.

## Courses, Records And View

- **course run**: One play of a course: its stages in order, or, for NONSTOP, one stitched play. It is ranked and recorded as one run. _Avoid_: course session, course play.
- **stage**: One chart of a course run.
- **carry-in**: The gauge value, course combo and course max combo a stage starts from, left by the stage before it.
- **give up**: Leaving a course run with ESC. A run given up is a failed run.
- **stitched play**: The single chart a NONSTOP course is played as, built by stitching its stages with their connections and placement.
- **judge ruleset**: The game whose judge windows, gauges and lamps a play is judged and ranked by: `lr2`, `beatoraja` or `____`.
- **gauge type**: The gauge the player picks, in LR2's names: `GROOVE`, `HARD`, `DEATH` or `EASY` (`GaugeType`). Each judge ruleset plays it on a gauge of its own line-up, named by its gauge id (`NORMAL`, `HAZARD`, `CLASS`, ...).
- **clear lamp**: The class of clear a play earned (FAILED to MAX, `ClearLamp`). Each judge ruleset awards its own subset; one rule lamps every play (`resolveClearLamp`, `resolveCourseClearLamp` in `@be-music/player-engine/ruleset`).
- **BP**: The miss count: BADs, POORs and empty POORs, plus the notes the play never judged because it failed or was given up mid-way (for a course, the notes the run never reached too) (`resolveMissCount`).
- **best record**: The independently retained best clear lamp, highest EX-SCORE, highest max combo, and lowest BP across a player’s plays of a chart or course under one judge ruleset (`BestRecord`). These values can come from different plays; a best record is not a single play result.
- **view settings**: What the player saw, apart from what was judged: hi-speed, hi-speed fix, visible time and each side's SUDDEN+, HIDDEN+ and LIFT. _Avoid_: display options.
- **play tempo**: How fast a play runs relative to the chart (`speed`). A play at another tempo is practice.

## Architecture

- **scene model**: The state and rules of one screen, independent of the skin family: what it shows and how it responds. See [ADR 0002](./adr/0002-scene-model-package.md) and [Scene models](./scene-model.md).
- **designed entry point**: A package subpath made for its consumers rather than a file of its layout. `@be-music/player-engine` exports `.` (the engine), `./signals`, `./lanes`, `./display`, `./ruleset`, `./replay`, `./records`, `./course`; `@be-music/player-browser` exports `.`, `./host`, `./skin`, `./collection`, `./audio`, `./recording`, `./compute` and `./controller`. Everything else is internal. See [ADR 0005](./adr/0005-public-entry-points.md).
- **library / library chart / library entry**: What a select screen browses: the charts, grouped into folders at the root, and the course folders (`Library`); one chart in it is a library chart (`LibraryChart`), and one bar of its list is a chart, a folder or a course (`LibraryEntry`, `kind: 'chart' | 'folder' | 'course'`).
- **browse state**: Where the player is in the library and how the list is shaped: the open folders, the cursor at each depth, the search, the sort and filters (the list options) and the favourites (`BrowseState`). Its snapshot (`BrowseSnapshot`, taken with `captureBrowse` and restored with `restoreBrowse`) keeps it across the scenes a play goes through.
- **chart filter expression**: A search that starts with `?`: the SQL `WHERE` clause beatoraja random courses use, with an optional `ORDER BY` / `LIMIT`, run against each chart's song columns, best record (`score.*`) and song information (`information.*`) (`parseBrowseSearch`, `parseCourseChartFilter`).
- **play state**: What every play screen reads of a play, fed by the engine's frames and judgments: the running gauge and EX-SCORE with their graphs, the combo, the timed judgments, and the view settings (`PlayState`, changed only through `reducePlayState`).
- **play result**: The one result payload of a single play, a course stage, a course run or a NONSTOP run (`PlayResult`); its run kind (`single`, `stage`, `course`, `nonstop`) says which. Every result screen reads it.
- **system sound set**: A theme's cues and jingles by slot (cursor, decide, folders, option panels, select BGM, clear / fail jingles, …), each resolved to bytes or to a path in the theme (`SystemSoundSet`).
- **scene session**: The one implementation of a screen's behaviour, shared by every skin family (`session/` in `@be-music/player-browser`): browsing, chart preparation, the engine, input, sound and endings. Each tick it hands its family view a frame built over the scene models and takes back intents. See [ADR 0001](./adr/0001-skin-families-only-draw.md).
- **family view**: How one skin family draws a scene model (`view/built-in/`, `view/lr2/`, `view/beatoraja/`); it draws the session's frames, returns the player's actions as intents and never runs the engine.
- **family kit**: What a host hands a scene to draw it with, per skin family: a be-music skin with the player's settings for it (`built-in`), an LR2 skin (`lr2`) or a loaded beatoraja theme entry (`beatoraja`) (`SelectKit`, `DecideKit`, `PlayKit`, `ResultKit`).
- **host API**: `@be-music/player-browser/host`: `PixiSceneHost`, which shows one scene at a time, and `createSelectScene`, `createDecideScene`, `createPlayScene` and `createResultScene`, which make each screen from a family kit as a `SessionScene`.
- **scene lifecycle**: The one contract every scene implements (`PixiScene`): `root`, `identity` (`{ kind, family }`), `enter`, `exit` and `dispose`. A host changes scenes only with `setScene`.
- **intent**: What a player's action on a view means for the scene: open a folder, start a course, cycle the gauge.
- **play loop / judge strategy**: The one engine loop every play runs through, and the manual, auto or replay judging plugged into it. See [ADR 0003](./adr/0003-one-play-loop.md).
- **seek**: Moving a running play to another chart second: a command to the play loop (`{ kind: 'seek' }`), never a new run. The judge state there is the one a play from the start reaches, and every seek starts a new frame generation. A play that seeks is practice and records no replay. See [ADR 0016](./adr/0016-seek-play-loop-command.md).
- **scene router**: The host's single owner of the current scene and every transition (`app/scene-router.ts` in the web player). See [ADR 0006](./adr/0006-scene-router.md).
- **audio service**: The one way the web player plays sounds outside a play's chart (`createAudioService` on `@be-music/player-browser/audio`): the select BGM, cues, jingles, chart preview and skin sounds, on one system `AudioContext`. Each play opens its own context through it (`openPlayGraph`). A scene passes itself as the owner of what it starts and stops it with `stopOwned`. See [ADR 0007](./adr/0007-one-system-audio-context.md).

## Related Documents

- [Code domain vocabulary review](./code-vocabulary.md)

- [Specification top](./README.md)
- [BMS implementation specification](./bms-spec.md)
- [bmson implementation specification](./bmson-spec.md)
- [Bemuse implementation specification](./bemuse-spec.md)
- [Player implementation specification](./player-spec.md)
- [Terminal player implementation notes](./player-tui.md)
- [Browser player implementation notes](./player-web.md)
- [Scene models](./scene-model.md)
- [Architecture](./architecture.md)
- [Replay (play history) specification](./replay.md)
- [Writing a be-music skin](./be-music-skin.md)
- [LR2 skin implementation notes](./lr2-skin.md)
- [beatoraja skin implementation notes](./beatoraja-skin.md)
- [BMS/bmson intermediate representation (`@be-music/chart-source`) implementation specification](./json-spec.md)
