# @be-music/player-browser

## 0.13.2

### Patch Changes

- Updated dependencies: `@be-music/player-ui@0.5.0`

## 0.13.1

### Patch Changes

- Updated dependencies: `@be-music/player-ui@0.4.0`

## 0.13.0

### Minor Changes

- 38f2990: A BGA video the browser can't play (`.wmv`, `.avi`, `.mpg`, …) now starts playing while ffmpeg.wasm is still transcoding it, instead of after the whole file is done: the transcode streams fragmented MP4 into the `<video>` through Media Source Extensions (`ManagedMediaSource` on iPhone). Hosts opt in by installing two workers with the new `configureBGAVideoWorkers` from `./compute`, whose entries call the new `runBGAVideoDecodeWorker()` / `runBGAVideoEncodeWorker()`. On a cross-origin isolated page the frames are encoded with WebCodecs under `SharedArrayBuffer` flow control; elsewhere ffmpeg's own libx264 encodes them. Without the workers or MSE the whole-file transcode runs as before.
- 410843c: Load pre-play title artwork for Native decide screens with a text fallback, and expose the separate image to Canvas skins.
- 6e14d72: Retry distinct codec candidates after read or decode failure during gameplay and select previews. Preserve stage candidate chains in NONSTOP asset sources, including prefix and parent-folder fallbacks, while keeping cancellation and declared sample keys.
- 5cc0094: Apply BGA opacity channels `0B`–`0E` across Native, Canvas, LR2 and beatoraja gameplay, combining each plane's value with skin opacity and NONSTOP crossfades. Use each NONSTOP stage's own opacity history and expose all visible stage stacks to Canvas skins instead of only the leading stage. Restore prior values on seek and freeze cue changes at LR2 reversal.
- 5c820d9: Apply A1–A4 ARGB definitions to their selected BGA planes across Native, Canvas, LR2 and beatoraja. Share alpha with opacity controls, multiply skin colors, tint Canvas skin images and retain independent NONSTOP stage colors instead of applying definitions to BMP slots with matching ids.
- 9572a31: Apply EXBMP transparent-color keys to still-image pixels before cropping, preserving unkeyed colors and source alpha across Native, Canvas, LR2 and beatoraja scenes. Add `LoadTextureOptions.bmsColorKey` for keyed image loading and keep a black viewport behind transparent BGA base images.
- 4324783: Render input-driven SWBGA above normal and POOR BGA across Native, Canvas, LR2 and beatoraja skins. Load BMP00, EXBMP-only resources and placed aliases with definition-specific transparent-color keys, update keyed video crops on decoded frames, and restart video playback on fresh input.
- 458b6f3: Load and play remapped NONSTOP SWBGA across Native, Canvas, LR2 and beatoraja. Keep stage resources distinct, end held animations at boundaries and apply the FIT source-video rate to seeking, drift correction and playback.
- 17a4096: Keep BMS channels 07 and 0A as independent overlays across Native, Canvas, LR2 and beatoraja scenes, including NONSTOP stacks and POOR composition. Give reused video BMPs separate per-track playheads and resume both overlays after pausing.
- 3f3de70: Forward the bmson zero-total play policy through every skin family and restore the typed replay policy independently of the viewer’s current preference.
- 274133e: Carry engine-selected chart text in play frames and display it across native, Canvas, LR2 and beatoraja skins as literal, wrapping text.
  
  Connect NONSTOP stage text programs automatically, clearing previous-stage selections and miss text at ownership boundaries.
- d869b05: Apply EXBMP transparent-color keys to opaque movie frames across Native, Canvas, LR2 and beatoraja. Key each decoded frame before alias cropping, retain independent plane playback and preserve unselected black pixels and the black base viewport. Clean up keyed video callbacks and native textures with their owning play.

### Patch Changes

- 206afe9: Include every layered bmson source event in the browser slice map so manual inputs play each constituent at its authored source offset and duration.
- ceb5fcc: Use resolved source-channel slice metadata for bmson audio, including LN end keysounds and silent orphan boundaries, so browser playback matches Node and offline rendering.
- 3259b06: Fix clicks at bmson sound-slice boundaries in browser playback: a slice that starts inside its file, or a sound resumed partway after a seek, fades in over 1 ms on its own gain node, and a slice cut before the file's end rings on past its end while it fades out over 1 ms, so a continuation crossfades with the slice before it. Note timing and slice deduplication are unchanged.
- 87e176d: Play bmson continuation slices independently instead of suppressing them while the same stem is active; keep one voice per simultaneous chord slice.
- b13249a: Resolve static BGA sub-region dependencies independently of declaration order, compose nested placements and clip the source and destination edges. Preserve explicit BMP/EXBMP precedence and render fully clipped base/POOR images as black and overlays as transparent, including Canvas skins and NONSTOP courses.
- 4480fe0: Pass authored BGA sub-region placement to Canvas and beatoraja play views instead of centering the cropped image. Retain long internal resource ids in mixed NONSTOP dependencies and Canvas BGA frame metadata.
- df001aa: Draw engine-driven bmson BGA sequences across Native, Canvas, LR2 and beatoraja. Preload every image-set alternative, honor authored MISS lifetimes and frame clocks, and keep shared base/layer/POOR movies on independent playheads while preserving source alpha and opaque black. Load NONSTOP sidecars and apply sequence frames only to their owning stage during crossfades, with FIT movie playback.
- c781901: Stop applying `#SWBGAxx` as a cue-driven animation in Native, Canvas and LR2. A standard SWBGA whose id matched a cued `#BMPxx` replaced that BGA plane with its frames even without an `A5` selection or key input, unlike beatoraja and the terminal. SWBGA now animates only through the input-bound `A5` controller in every family.
- 12c1567: Connect chained BGA video sub-region cues to independent base, overlay and POOR playheads, preserve native crop coordinates through transcoding and honor cropped placement. Refresh Canvas skin video crops as playback advances, include POOR in pause/resume and release shared alias handles only once.
- 916e04c: Restore the white centre line down long-note bodies in the Synesthesia and Plain skins, which the translucent LN tail change had removed along with it, and fade it out over 300 ms when the player lets go early and the note is judged dropped, in Synesthesia, Plain and the default Pixi playfield. Long-note frames now carry `releasedElapsedMs` from the play session.
- b1cb060: Load referenced EXBMP-only image resources and the implicit EXBMP00 POOR image, preserving explicit BMP filename precedence.
- afc65fb: Render generic bmson keys in uniform columns across skin families, preserving second-bank columns as one keyboard. Map their printable and F1–F24 default bindings and use normal fallback notes in borrowed beatoraja note areas. Let a bound F5 reach its lane instead of restarting.
- 783422a: Keep every visible NONSTOP stage video playing through crossfades in Native, Canvas and LR2 views. Retain each stage's cue offset when the leading stage changes, pause departed videos and restore all active stage videos after seek or resume.
- 5992a52: Apply chart-authored HI-SPEED immediately across native, Canvas, LR2 and beatoraja views without clamping or changing saved preferences. Replay uses its recorded effective display program; older replays keep their original behavior.
- c13f3fa: Prepare separate WAVCMD/EXWAV effect buffers per sample slot before tempo stretching. Read encoded native sample rates for frequency effects, preserve base-62 slot identity and reuse the resulting duration through seek/retrigger. Host decoding supplies native sample rates for unprepared frequency-effect buffers; a sample whose container cannot report its native rate still plays instead of being discarded.
- 10951d6: Load and play EXWAV-only sample declarations, including in the select-screen preview, and prefer valid EXWAV filenames over shared WAV slots. Keep tempo preparation and audio-tail lookup on the same resource selection; apply corrected WAVCMD percentage volume.
- 86f4978: Apply long-note defaults after conditional branch selection, and keep replays recorded before HDX LONGMODE support on the long-note modes they recorded.
- 3e1855e: Apply intrinsic slot gain with authored WAVCMD and EXWAV volume so NONSTOP stages keep their original level.
- 460823d: Connect NONSTOP effective option programs and stage diagnostics automatically. Authored HI-SPEED follows each stage and restores the saved user speed when the next stage has no forced value; replay continues using its recorded program.
- 3928de4: Prepare independent COUPLE player state and preserve recorded or absent replay modes ahead of current header preferences.
- Updated dependencies: `@be-music/chart-model@0.8.0`, `@be-music/player-engine@0.12.0`, `@be-music/chart-parser@0.6.0`, `@be-music/chart-source@0.6.0`, `@be-music/shared-utils@0.7.0`, `@be-music/player-skin-sdk@0.6.0`, `@be-music/player-ui@0.3.0`, `@be-music/player-scene-model@0.4.0`, `@be-music/skin-lr2@0.5.0`, `@be-music/skin-beatoraja@0.5.1`

## 0.12.0

### Minor Changes

- 1cb4d60: Start beatoraja PLAY with the chart after the skin's READY interval, preserve that interval through slow media loading, and follow chart time through tempo changes and seeks. Add optional input and relative play-start timing stages to the family view contract.
- 1b3e0bd: Connect beatoraja result, score, HCN, and character timers to their scene facts. Add optional personal-best/target EX scores and music-end timing to scene contracts, and drive beatoraja's five-second chart-time ending and finishmargin through the existing engine loop.
- 7a776a0: Add a configurable shared worker pool for chart parsing and packing, ZIP expansion, and WSOLA. Preserve chart order, and fall back to the same local operations when workers are unavailable.
- f4b7d9e: Draw Visual CONSTANT on beatoraja skins: notes, mines, bar lines and BPM-change / STOP lines show only during the last note duration with the CONSTANT fade, as beatoraja's `LaneRenderer` does, and `#SPEED` is ignored while it is on. Light op 400 (CONSTANT) on the beatoraja select and play screens while the setting is on.
  
  A course with the `NO_SPEED` constraint now turns Visual CONSTANT off for its stages on every skin family, as beatoraja does.
- f9c1c24: Draw AC 34's BPM-change warning when `bpmChangeWarning` is on: `<current> » <next>` in a framed box centred on each side's lanes, from 2 s of chart time before each BPM change until the change, blue when the tempo rises and red when it falls. The built-in (Canvas and DOM skins), LR2 and beatoraja play screens draw it.
- a8896a9: The select screen's search takes chart filter expressions (`?level >= 12 AND score.clear < 5`), reading each chart's song columns, its best record under the active judge ruleset and its song information. The frame carries `searchError` and the select scene has `searchError()` while the expression does not parse. `createCourseChartRecord` fills the `information` row and takes a best-record reader for the `score` row, and `drawBrowserRandomCourse` takes one too, so random courses can filter by them.
- 85f13dc: Accept theme system sounds on play scenes and play the failure stop cue once through the audio service, without triggering it on normal completion or Escape.
- a95c53c: A play can change drawing family without starting again. `PlayScene.replaceFamily` attaches the new family's view to the running play and disposes the previous view. LR2 textures stay cached until the play ends, so switching back does not decode the same bytes again.
- c072506: A play takes the automatic judge-timing mode (`judgeTimingAutoAdjust`): beatoraja's calibration, or LR2's ON and SILENT. Under LR2 SILENT, as in LR2, the play loads none of the chart's keysounds, BGM or BGA and the built-in and LR2 play screens draw no judgment or combo; a replay follows the mode it recorded. An LR2 select skin's button 74 steps the judge timing by 1 ms within ±99, button 75 cycles OFF, ON and SILENT, and an LR2 play skin's number 12 shows the live judge timing (#777).
- 3e694df: Add Native, a built-in skin of DOM screens around a canvas playfield: collection browsing, search, settings, decide and result screens, and a gameplay information dashboard (judgment counts and timing, score and note progress, gauge history, speed, lane covers, course context and play settings) built from the `@be-music/player-ui` elements. Its BGA, lanes, notes, mines, measure lines, lane covers, judge line, bombs and judgment words each draw on a canvas the size of their part of the stage; the lanes stay as tall as the screen allows (a side HUD in landscape, a compact header in portrait, orientation read from the element the screens are mounted in), and touch lanes follow the fingers on its gameplay screen. Renderer-independent scene controllers and selected state stores are exposed through the controller entry, with native skin mount lifecycles and search inputs.
  The host hands each frame to a skin that sets `gameplay.drawsOnDOM` and creates no gameplay surface for it. A scene whose screens are all DOM reports `drawsOnCanvas: false`, and `PixiSceneHost` keeps its canvas in the page only while the active scene draws on it (also before the first scene) and exposes the element it was mounted in as `container`.
- 0b4e3c4: Add an optional `peakGain` play setting that scales a chart's decoded samples together so the loudest peak sits near −3 dBFS. When it is omitted, charts keep the level they were authored at.
- 1e62cb3: A play whose selected options do not fit its chart (beatoraja CONVERGE or playable RANDOM on a non-PMS chart, LR2 SCATTER on a non-9KEY chart, SP TO DP or EXTRA MODE on bmson, ...) now rejects its `prepare` with the new `PlayOptionMismatchError` from `@be-music/player-browser/host`, which names the selected options that convert the chart, instead of an unexplained `RangeError`. Replays, kept arrangements and other load errors reject as before.
- b09a6cf: Apply the new play options in the play session for every skin family: the judgment, hi-speed and view options (HS-FIX including START BPM, AC normal and floating hi-speed, the fixed display area, per-side LIFT, CONSTANT, BPM GUIDE, judge display timing), the lane arrangements, the chart modifiers, the gauge options, the battle and conversion modes and PRACTICE. The source-specific lane options, HS-FIX CONSTANT, the measured hi-speed modes (with numpad 0 and the fixed display area), the scroll and mine modifiers, both EXTRAs, 7 TO 9, the battle chart constructions, SYNCHRONIZE / SYMMETRY RANDOM and M-RAN are prepared under every judge ruleset, each with its own source's algorithm; RANDOM-EX always runs beatoraja's shuffle, and a reused previous arrangement must come from a play under the same judge rules (#774).
  Record every selected play option and live hi-speed edit in the replay, and restore the option timeline during replay playback and seeking, the independent AUTO SCRATCH switches and the head-only notes of LEGACY NOTE and LN REMOVE included.
  Show the cover lengths and green numbers on the selected cover edges for the Native, Canvas, LR2 and beatoraja views.
  Draw a two-player BATTLE on the Plain, Native and Synesthesia skins with each player's gauge and figures, and on LR2 skins with the BATTLE play skins, the 2P numbers, ranks and gauge. Synesthesia takes the lane cover keys, draws each side's LIFT and labels the floating hi-speed, as Plain and Native do.
  Wire beatoraja select skins' option buttons to the play options: LNMODE, DP option, gauge auto shift, judgment algorithm, mine, scroll and long-note modes, 7 TO 9, EXTRA NOTE depth, and RANDOM 1P / 2P (42 / 43), which step through beatoraja's lane options for the focused chart's play mode and show the choice. PRACTICE starts from its button, and the LNMODE image shows the player's LN MODE instead of the focused chart's mode.
  Keep LR2 skin gauge buttons on the original four choices when extended gauges are selected from Debug Menu.
- f994ec4: Honor POOR BGA overlay and hidden modes across built-in, LR2, beatoraja and DOM frames, including each NONSTOP stage’s policy. Mode 2 suppresses explicit channel-06 cues as well as BMP00.
- 3b75adf: The player's MY COURSES and MY NONSTOP folders end with LR2's RANDOM MIX bar (`createRandomMixEntry`, listed by `resolveCourseMakerFolders`). `CourseMaker` keeps the RANDOM MIX settings (`randomMixSettings`, `stepRandomMixSetting`) and `drawRandomMix` keeps each folder's last draw as its newest course in place of the previous one; `createRandomMixChart` and `createDrawnRandomMixEntry` turn library charts into draw candidates and a draw into a course bar. On an LR2 select skin, buttons 260-266 step the settings with the option-change cue and texts 190-196 show them.
- 4b9f91d: Remove the Phantom and Lattice skins: `phantomSkin` and `latticeSkin` are no longer exported, and `BUILT_IN_BE_MUSIC_SKINS` holds Synesthesia, Plain and Native. Neither was shipped by the player. The playfield the built-in and LR2 families fall back to when a skin or theme leaves the lanes, notes, long notes or bombs to the host keeps its look; it no longer comes from Phantom. A stored skin id of `phantom` or `lattice` resolves to the default skin.
- d0939cc: Add replay slots to the result and select scenes: `createResultScene` takes `replaySlots` and `on.saveReplay` (keys 1-4, a beatoraja skin's replay buttons), `SelectRecords.replaySlots` lets the select screen pick a slot (beatoraja's 4 / F / V keys and replay buttons) and hand it to `on.start` as `replaySlot`, `SelectScene.replay(slot)` replays one, and `on.focus` reports the bar under the cursor. A result now stops its jingle and plays the theme's `resultclose` / `course_close` sound as it starts to fade out.
- 3e694df: A play can seek: `PlayScene.seek(seconds)`, a `seek` play intent and `PlayFrame.seekable`. AUTO and replay playback also seek five seconds with the left and right arrow keys, and the host's `allowSeek: 'practice'` lets a manual play seek and marks its result as practice.
  A seek sends the running play the engine's seek command and resolves once the play shows the second sought. The chart clock runs on from every engine frame and a paused play stays paused; the combo, max combo, graphs, timings and held long notes come from the engine's snapshot of the target, and a replay's recorded view is restored there. What the play showed of the old position (key beams, bombs, held long notes, judge plates, the POOR image, a lead-out under way) is cleared, the LR2 and beatoraja play views stop their per-judgment timers, and the Web Audio session stops the sounds playing, starts the ones still ringing partway (`triggerEventAt`), resets the dynamic volumes and moves a NONSTOP chart's fades.
  The engine is prepared during loading and starts the chart at the skin's PLAY START cue, so a seek during the intro picks the starting position. Course stages and NONSTOP runs can seek too: the run stays practice for its later stages and keeps no course record, ranking or auto-saved replay after a seek.
  beatoraja BGA videos stay at chart time from their cues through seeks, pauses, tempo changes and NONSTOP crossfades instead of restarting at the beginning, and BGA videos are set back in step with the chart when they drift.

### Patch Changes

- b6f6a72: Connect Lua event_index to image-ref values and allow scene-local custom animation timers to start, change and stop. Lua and numeric destinations now observe the same timer writes immediately, while gameplay timers remain protected.
- 74838c5: Reduce repeated allocations during gameplay by retaining debug labels, resolving Canvas and DOM HUD values once per frame, and preserving active particle lists while skipping unchanged colors. Previously published HUD snapshots remain intact.
- 3a5d9c3: Carry final combo eligibility from the engine into result scores so beatoraja FIVEKEYS/PMS results do not award full-combo lamps after empty POOR broke the combo.
- d08fdf9: MIRROR and RANDOM now permute every key lane of the resolved mode instead of only occupied lanes. This fixes sparse charts, preserves long-note endpoints and secondary-note placement, and keeps historical replay arrangements unchanged.
- 45aff53: Preserve the engine's mine-POOR count in result scores so LR2 course-stage records count mine hits and unjudged notes correctly.
- a83e326: Display the That-Which-Must-Not-Be-Named ruleset as `????` in built-in skins and use `____` for engine and replay identifiers.
- b54a1da: Fix missing landmine notes in beatoraja skins by including the engine's separate mine list in the sorted note drawing stream, including the READY display before playback starts.
  
  Honor Show invisible notes in beatoraja skins, displaying hidden keysound objects as green inspection markers only while the option is enabled, including changes during play.
- 69df53c: Play stitched bmson resources with extended keys and map source-audio slices into keep-pitch FIT buffers, including seeking and audio-tail cleanup.
- 0c67b28: Fix the built-in skins' layout:
  
  - The stage canvas now follows its container when the container changes size without a window resize. Plain drew into an 800 px corner of a wide screen and kept its landscape layout on a phone held upright.
  - Plain's landscape header no longer draws over the lanes, and its 1P gauge and track line up with the lanes' left edge.
- 935610f: Mark a replay played back: its result carries `fromReplay`, and the LR2 play screen lights REPLAY PLAYING (op 84) instead of REPLAY OFF (op 82), as LR2 does.
- 582ad35: Restore judgment-colored lasers and authored key-release animations in LR2 skins, including LITONE4. Align measure lines with the note timing origin and respect their display conditions so HD skins keep notes and bar lines together. Hide missing-glyph placeholders when their loading text fades out. Decode PNG font sheets through the shared image loader so mixed PNG/TGA fonts render their text instead of empty boxes.
  
  Load beatoraja bitmap font pages through the shared image decoder so WMII_FHD TGA sheets render with their authored font.
- 7ab40af: HD LR2 gameplay now uses the skin’s authored canvas for chrome, notes, measure lines and BGA, preserving its aspect ratio and keeping scroll speed and replay-visible time consistent across resolutions. Load dedicated judgement-line, measure-line, bargraph and slider textures as well.
- 5565fe4: Cut the built-in skins' particle cost: a point writes the particle's packed color directly instead of going through Pixi's `tint` setter (a `Color` parse per point per frame), and a particle layer checks its place among its siblings once per frame instead of on every point. On a dense chart with Synesthesia the frame loop's CPU time drops about 12 %. The built-in play view also prints its `?perf` section summary each second, as the LR2 play view does.
- 0bee40e: Chart loading no longer waits on clamped timers between tasks: the worker pool's local fallback and the collection loader's progress yields go through `scheduler.yield()` or a `MessageChannel` message instead of `setTimeout(…, 0)`, which nested calls clamp to 4 ms in browsers and 1 ms in Node.
- f872467: Fix missing POOR BGA after empty presses by stamping the pause-aware millisecond play clock instead of chart seconds. Use an explicit inactive sentinel so a real miss at clock zero displays, and reject future or expired stamps.
- 238bd8b: Remove the unused multithreaded FFmpeg core dependency from the browser player package.
- 85250d8: S-RANDOM no longer places new notes inside held long notes. Select the active judge ruleset's arrangement constraints, preserve both LN endpoints and mode/side boundaries, and continue recording final channels for unchanged replay playback.
- 9065e03: Synesthesia projects its point clouds, bomb grains, light rivers and manta schools without allocating per point: rotation bases are computed once per object or frame and each point is written into a reused result, so the play loop spends less time per frame and produces far less garbage.
- 00139f5: Update mediabunny to the latest release.
- Updated dependencies: `@be-music/skin-beatoraja@0.5.0`, `@be-music/player-engine@0.11.0`, `@be-music/chart-model@0.7.0`, `@be-music/chart-parser@0.5.0`, `@be-music/chart-source@0.5.0`, `@be-music/player-scene-model@0.3.0`, `@be-music/skin-lr2@0.4.0`, `@be-music/player-skin-sdk@0.5.0`, `@be-music/player-ui@0.2.0`, `@be-music/shared-utils@0.6.0`

## 0.11.0

### Minor Changes

- 9a0c3f9: Use `BrowserChartCollection`, `BrowserAssetSource`, chart-based result and image fields, and explicit chart/course best-record callbacks. Expose replay-named recording helpers and adopt the player replay API without compatibility aliases.
  
  Rename the package from `@be-music/player-web` to `@be-music/player-browser` to identify its role consistently. Update imports and package filters to the new name.

### Patch Changes

- Updated dependencies: `@be-music/skin-beatoraja@0.4.0`, `@be-music/chart-model@0.6.0`, `@be-music/chart-parser@0.4.0`, `@be-music/chart-source@0.4.0`, `@be-music/skin-lr2@0.3.0`, `@be-music/player-engine@0.10.0`, `@be-music/player-scene-model@0.2.0`, `@be-music/shared-utils@0.5.0`, `@be-music/player-skin-sdk@0.4.0`

## 0.10.0

### Minor Changes

- b2818d0: Provide shared select, decide, play and result scene sessions for built-in, LR2 and beatoraja skins, with family-specific views over one scene model.
  
  - Expose the host API through `/host`, skin loading through `/skin`, library/course handling through `/collection`, audio through `/audio` and video capture through `/recording`.
  - Use one audio service for system sounds, previews, jingles and gameplay, with shared master volume and platform audio-session handling.
  - Load LR2/beatoraja course files, difficulty-table courses and random courses; support course drafting, constraints, stage carry-over, trophies and stitched NONSTOP transitions.
  - Support live hi-speed control, lane covers, tempo and pitch modes, lazy-loaded Signalsmith Stretch with WSOLA fallback, keyboard-wheel lanes and configurable render resolution.
  - Record MP4 or WebM with codec selection and seekable output, using Mediabunny 1.61.6. Remove mp4-muxer and ts-ebml, avoiding their Node-polyfill requirements.
  - Preserve random outcomes, recording state, replay inputs and scene transitions consistently; support quick retry and holding Backspace to quit.
  - Match LR2/beatoraja note drawing, negative-BPM reversal, BGA/POOR layers, NONSTOP BGA cross-fades, failure timing, result lamps, rank values, density readouts and theme sounds.
  - Preserve browse position, filters and search across scene changes, improve frame stability and loading, and cap either canvas dimension at 4096 pixels.
  
  Migration: replace `/scenes` with `/host` scene factories. Audio and capture exports formerly under `/runtime` move to `/audio` and `/recording`; `/chart` preview APIs move to `/audio`. Use library models from `@be-music/player-scene-model`, chart timing from `@be-music/chart-model`, skin contracts from `@be-music/player-skin-sdk` and play logs from `@be-music/player-engine/playlog`. Use canonical uppercase-abbreviation names.

### Patch Changes

- Updated dependencies: `@be-music/skin-beatoraja@0.3.0`, `@be-music/chart-model@0.5.0`, `@be-music/chart-source@0.3.0`, `@be-music/skin-lr2@0.2.0`, `@be-music/chart-parser@0.3.0`, `@be-music/player-engine@0.9.0`, `@be-music/player-scene-model@0.1.0`, `@be-music/player-skin-sdk@0.3.0`, `@be-music/shared-utils@0.4.0`
## 0.9.0

### Minor Changes

- dc99100: Dropping a large BMS folder no longer stalls on "Collecting files…": the drop walk now lists the tree first and only opens the files needed right away (theme candidates outside chart folders, play-logs and archives), while charts, audio and BGA stay as unopened `DeferredDroppedFile` handles that open on first read. The chart parser also keeps a few chart reads in flight ahead of the chart it is parsing.
  
  Dropping a whole BMS library no longer slows to a crawl part-way through "Parsing charts…" (and eventually crashes the tab): every parsed chart kept in the collection now drops the stringifier-only `preservation` layers, stops pinning the decoded chart source, and keeps its `events` packed in typed arrays that are rebuilt on read (the most recently read charts stay unpacked). On a 5,537-chart library this takes the JS heap after loading from about 2 GB to about 0.5 GB. A 686k-file / 5,537-chart drop now finishes in about 36 s at a steady parse rate instead of stalling after ~2,500 charts.
  
  - `readDroppedFiles` now returns `BrowserDroppedFile[]` (`File | DeferredDroppedFile`), and the collection loaders and `BrowserSongAssetEntry` accept the deferred handles.
  - New `materializeDroppedFiles` opens deferred handles into plain `File`s for APIs that need them, and `createEagerDropPathPredicate` exposes the open-now rule.
- 9dbb569: Be-music skins that declare a `portraitStage` are drawn on it while the screen is taller than wide, on every screen (select, decide, gameplay, result); 5 / 7 / 9 KEY play gets the portrait playfield in both layout modes, and double play and the keyboard modes stay on the landscape stage. Rotating the device re-lays the current screen out on the next frame, mid-play included, and `PixiSceneHost.getStageOrientation()` tells hosts which stage the active screen uses.
- 7260b23: Be-music skins can change play options and open the readme from the select screen through the new `setPlayOption`, `cyclePlayOption`, and `toggleReadme` actions (unknown keys and values outside an option's choices are ignored, `hiSpeed` and `shutter` are clamped, and each change bumps the select frame's `revision`). `PixiPlayOptions` and its value unions are now aliases of the SDK's `BeMusicPlayOptions` types.
  
  The player now fills these new skin fields:
  
  - Runtime: `song`, `lastJudgeDeltaMs` / `judgeTimings`, `minBpm` / `maxBpm` / `mainBpm`, `songLengthMs` / `songElapsedMs`, `failedAtMs` / `allNotesDoneAtMs` / `outroAtMs`, `gaugeRiseAtMs` / `gaugeMaxAtMs`, `scoreHistory` / `gaugeHistory`, `laneCovers` / `visibleMs` / `greenNumber` (beatoraja's duration and green number, over the current scroll and BPM), and `judgeWindows` (the engine's resolved windows in ms; a mid-chart `#EXRANK` change is not reflected).
  - Lanes and notes: each lane's `pressedAtMs` / `releasedAtMs` and `holding` / `holdStartedAtMs`, each long note's `mode` (as the active ruleset plays it) and `state` (`pending` / `held` / `dropped` / `done`), `autoplay` on notes and long notes played by autoplay or auto-scratch, the `judge` that set off each bomb, and `measureLines` (one per lane run) for skins that set `drawsMeasureLines`.
  - Select: `pointer` in the stage's design pixels, `hit` returns whether the pointer is over the rect, and `songRecord(song)` answers from the new `resolveSongRecord` select-scene option, through which a host hands skins its per-chart best records (lamp, EX score, max combo, miss count, play count); without it every song reads as never played.
  - Result data: `lamp`, `gaugeType`, `judgeRuleset`, `fast` / `slow`, and `judgeTimings`.
  - Song images: `songImage(song, kind)` on the select, decide, gameplay, and result frames returns the song's `#STAGEFILE`, `#BANNER`, or `#BACKBMP` as an `ImageBitmap`, loaded lazily from the song collection (select bumps `revision` when one arrives). Each scene keeps at most 32 decoded images and closes the least recently used one beyond that.
  - Skin settings: every frame carries `settings`. The gameplay, select, result, and decide scenes take the player's stored values through the new `beMusicSkinSettings` option, check them with `resolveBeMusicSkinSettings` (now also exported from `@be-music/player-browser/skin`), and take changes through `setBeMusicSkinSettings`, which the skin sees from the next frame (select also bumps `revision`). Without stored values the skin draws with its defaults.
  - BGA: a skin that sets `drawsBga` receives `frame.bga` with the active base, layer, and POOR images and `poorActive`.
  
  A skin that sets `drawsLaneCover`, `drawsMeasureLines`, or `drawsBga` now draws the lane covers, measure lines, or BGA itself, and the player stops drawing its own.
  
  The new `DefaultPixiDecideView` shows a skin's `decide` screen between select and play for its `durationMs` (Enter, Space, or a click skips ahead; Escape cancels back to select); hosts mount it only when the skin declares one.
- 0848402: The play screen can use the skin SDK's touch layout: pass `layoutMode: 'touch'` in the gameplay view options and the be-music skins get wide, equal-width lanes across most of the stage, a slightly lower judgement line, and no BGA. Notes, lane beams, touch zones, and the skin's `frame.layout` all follow the touch lanes, and notes scroll in at the lane top instead of drawing over the skin's header. The 24 / 48 KEY modes, themes, and a host `skinlessChromeRenderer` keep the standard layout. Default `'standard'` leaves play unchanged.
  
  - Synesthesia's judgement tally no longer slides up under the header when there is no BGA monitor (touch layout, 48 KEY).
  - Lattice's onset ripples no longer start from the stage's top-left corner when there is no BGA monitor.
- 5dfc779: The built-in and LR2 play screens can be played on a touch screen, and the select list scrolls with a swipe.
  
  - Each lane is a touch zone from the lower part of the lane down to the bottom of the stage, with gaps between lanes split between neighbours. Every finger presses, holds, and releases its lane independently, and sliding a finger into another lane releases the old lane and presses the new one. Touches are fed to the engine through the same lane-input path as the keyboard, with the pointer event's timestamp, so judgement, long notes, key beams, auto scratch, and play logs behave as with keys. Mouse clicks keep their old behaviour.
  - The play scene keeps the page from scrolling or zooming under the fingers (`touch-action: none` on the canvas during play) and lifts every finger when the play pauses.
  - `CoreGameplayView` gains `requestTogglePause()`, `isPaused()`, and `requestExit()` (Escape's exit, fade-out included), so a host can offer on-screen pause / quit controls on devices without a keyboard.
  - On the select screen a touch acts on lift: a tap picks a row as a click does, and a swipe along the list moves the cursor one entry per row travelled (or pans the open README).

### Patch Changes

- 38a2568: Fix the beatoraja select screen showing a chart's LN mode one step off: `#LNMODE` counts from 1 (1 = LN, 2 = CN, 3 = HCN), so a CN chart showed as HCN and an HCN chart as LN. The authored value is now mapped onto the LNMODE button index before it is shown or cycled.
- 00e8bce: BGA images (`#BMPxx`) and the LR2 skins' stage file, banner and back BMP now look for a `.webp` of the same name first, ahead of `.png` / `.jpg` / `.jpeg` / `.gif` / `.bmp`, so a pack re-encoded to WebP loads without editing its charts. The bytes are decoded by content, so a `#BMPxx foo.bmp` resolved to `foo.webp` decodes as WebP.
- 6808622: Measure lines in double play no longer cross the gap between the two lane banks: the built-in fallback now draws one line per bank instead of a single line from the leftmost lane to the rightmost.
- 3f1b6b3: The play screen's BPM readout now follows the chart's tempo changes instead of showing its header BPM throughout, and every built-in skin shows the genre on its select and play screens. Synesthesia and Lattice put it where their fixed NOW SELECTING caption was.
- e265198: Long song titles, artists, genres, and stat values in the built-in skins no longer get squeezed until they are unreadable: text is narrowed to at most 85% width, and anything still too long is clipped to its box and scrolls through it like a marquee (rests at the start, scrolls, rests at the end, then returns), including on screens that are not redrawn every frame. Synesthesia, Lattice, and Phantom share this through their Pixi helpers, with unfocused list rows clipped at the start instead of scrolling; Plain does the same with its own Canvas 2D code.
  
  Also fixes text that ran outside its panel: the genre line on Synesthesia's result screen, and the BPM, gimmick, and other stat values (plus the list row facts and folder label) on Plain's screens.
- d2f7f82: The built-in mine's caution stripes no longer spill out of the mine into the neighbouring lanes. Mine notes now reach be-music skins that draw them (`gameplay.drawsMines`), and the built-in Pixi skins draw them through an optional `renderMine`, falling back to the caution-striped bar.
  
  Synesthesia draws its own mines: note-shaped but dark crimson, with a broken filament that flickers where a note carries its clean white one.
- 1518e28: Plain has a portrait layout for phones and tablets held upright: the select screen puts the focused song (genre, title, artist, its facts, PLAY and AUTO) in a card above a full-width list with two-line, thumb-sized rows; the play screen keeps its header, the track, the score figures, the judgement counts, and the gauge in the band above the lanes, beside the BGA; and the result stacks its sections. The landscape layout is unchanged.
- 5f76923: Every built-in skin now heads the song with its genre, then the title, then the artist, on the select, play, and result screens (Plain's result screen gains the genre). The play screen's rank letter (F to AAA) in Synesthesia, Lattice, and Phantom sat below its RANK label; it now lines up with the label, and Phantom's rank badge no longer breaks out of the score plate. Synesthesia's playfield floor rule no longer runs four pixels past the right rail.
- c749205: Synesthesia's audio orb is now a charge cloud: five small dark orbs, each lit by how far its own slice of the spectrum jumps above its recent level (a one-frame flash with light shafts, then a glow that fades over about a second), so loud passages keep their peaks instead of washing out, hang in a GPU-simulated fluid of up to ~150,000 particles, drawn as the same square dots as the skin's other point clouds. The particles are drawn to or driven off the orbs by charge, with each particle tuned to one spectrum band, and flock through a coarse velocity/density grid so the cloud folds into smoky sheets lit pink to white near a flaring orb and deep indigo elsewhere. The select screen's foreground orb and the gameplay idle monitor use it; the old particle shell, its fibres, the smaller background orb and the black moon are gone.
  
  Every other Synesthesia particle (floor, pyramids, rivers, dust, schools, star trails, hit sparks) now shares the cloud's finer texture: square points break into clusters of grains about a pixel across, and segments into trails of such grains, giving off about the same light as before.
  
  Synesthesia's fish now carry a soft glow around their heads that brightens and spreads with the music (the ember school with the bass, the blue with the mids, the magenta with the highs), and flick up and flash white on every kick drum (an envelope that fires only on the attack of the lowest bands, gone within about 0.15 s), their glow blooming with them. The gameplay dust no longer flickers and teleports when the music's level changes its speed, and the gameplay floor and rivers no longer jump on entering a zone: they now move by accumulated travel, as the select screen already did.
  
  Synesthesia's judgement line loses the bloom around it and stays a crisp filament; the beat now rises above it as an ember gradient that leaps up the lanes on each beat.
  
  Synesthesia's 100-combo milestones now play in the middle of the BGA monitor even while a BGA is showing, instead of shrinking onto its top edge.
  
  Synesthesia's floor now shows the music's spectrum: bass on the left of the screen to highs on the right, each band rising as a ridge that leaves the viewer and rolls out into the distance, so the ground in front of the camera shows what is playing now; near rows get denser points so they read as waveforms, over low Perlin-noise ground.
  
  Synesthesia's mines no longer sink into the lane: they burn bright crimson inside a red halo that throbs like a warning light, with a white-hot flickering filament.
  
  On launch the camera now flies past Synesthesia's charge cloud: its dark orbs stream out of the vanishing point with the stars, swelling until they leave the screen.
  
  Synesthesia's schools are now mantas instead of fish: each one beats its wings out of step with the rest of its school, and a kick flings the wings wide and white-hot.
  
  Synesthesia's hit bursts throw more particles: a skirt of fine, dimmer powder now spreads along the judgement line under each fountain, rising only about a lane's width, so bursts read fuller without dusting the lanes the next notes fall down.
- 77b070f: Synesthesia has a portrait layout for phones and tablets held upright: the select screen puts the focused song in a card above a full-width list with thumb-sized rows, the play screen runs the lanes down the lower part of the screen under the BGA monitor, a HUD column, and a full-width gauge, and the result stacks its panels.
  
  - The 100-combo cut-in no longer covers the bottom HUD when there is no BGA monitor (the landscape touch layout, 48 KEY): it plays in the side column under the judgement tally.
  - The play header keeps its top corners clear for the host's controls, so a touch pause button no longer covers the PLAY label and a menu tab no longer covers the ruleset label.
- Updated dependencies: `@be-music/player-engine@0.8.0`, `@be-music/player-skin-sdk@0.2.0`

## 0.8.0

### Minor Changes

- cd83c89: Let hosts balance keysounds against BGM and tune each compressor.
  
  - The audio bus gains per-bus user volume (`setBusVolume` / `getBusVolume`, `initialVolumes`) applied at each source mixer ahead of the compressor stack, and live compressor tuning (`setCompressorParams` / `getCompressorParams`, `initialCompressorParams`) for the key, BGM, master, and legacy compressors, clamped to the Web Audio ranges.
  - New `@be-music/player-browser/runtime` exports: `AudioBusChannel`, `TunableCompressor`, `MAX_BUS_VOLUME`, `sanitizeBusVolume`, `DEFAULT_COMPRESSOR_PARAMS`, `COMPRESSOR_PARAM_RANGES`, and `mergeCompressorParams`.
  - Gameplay views take `audioVolumes` and `audioCompressorParams` options and expose `setAudioVolume` / `setAudioCompressorParams` to change them live; the beatoraja gameplay prep accepts `audioBusOptions` for the same initial state.
- 9534c16: Add the be-music skin format and a second built-in skin, Synesthesia.
  
  The default (skinless) family now renders through a `BeMusicSkin`: a skin that draws every screen (gameplay, select, result) onto a canvas the player hands it, from plain per-frame data, over a fixed design canvas (the skin's `stage`, the 16:9 `wideStage` unless it declares another). The shared scenes keep input, timing, judging, and layout and show the skin's canvas, so skins can be swapped by passing `beMusicSkin` to `DefaultPixiGameplayView` / `DefaultPixiSongSelectView` / `DefaultPixiResultView`.
  
  - New exports: `BeMusicSkin` and its frame types, `createBeMusicSkinRegistry`, `resolveBeMusicLaneKind`, `resolveSelectListWindow`, `phantomSkin`, `synesthesiaSkin`, `latticeSkin`, `plainSkin`, and `BUILT_IN_BE_MUSIC_SKINS`.
  - Skins can be made outside the player with any renderer: the skin contract and its helpers now live in the new `@be-music/player-skin-sdk` package, which imports no rendering framework, and `@be-music/player-browser` depends on it. A skin names the canvas context it wants, may create its own renderer in an async `setup` and release it in `teardown`, and brings its framework (PixiJS, three.js, …) as its own dependency. Phantom, Synesthesia, and Lattice run their Pixi scenes on their own renderer this way, and the built-in skins live under `src/skins/` importing only `@be-music/player-skin-sdk`, their framework, and their own files (a test enforces the boundary). The lane geometry, song entry, result data, and audio frame types the player shares with skins move to the SDK; `@be-music/player-browser` keeps re-exporting them.
  - Hosts extend a skin registry at runtime: `BeMusicSkinRegistry.add` registers another skin (validated; a skin with a known id replaces it) and `subscribe` reports additions so a picker can refresh. `BUILT_IN_BE_MUSIC_SKINS` now loads Synesthesia (the default), Phantom, and Plain; Lattice still ships as `latticeSkin` for hosts to add. The demo's Debug Menu can add Lattice or a skin module from a URL (after a trust prompt).
  - A skin declares `apiVersion` (`BE_MUSIC_SKIN_API_VERSION`), its own semantic `version`, and an `author` (name and optional URL), with an optional `description`, `homepage`, and `license`. `defineBeMusicSkin` / `validateBeMusicSkin` check the declaration, and `createBeMusicSkinRegistry` leaves out skins written for an unsupported API revision or with a malformed declaration (reporting them through `onRejected`) instead of letting them break the host.
  - The player collects each gameplay frame's layout, lanes, notes, long notes, hit effects, and HUD values and calls the skin's `draw` once before rendering; select and result draw every frame, select with a `revision` that moves when its state changes and a `hit` callback for clickable areas. `'2d'` canvases come cleared and scaled to design pixels. Each canvas is sized to the device pixels the stage covers on screen (viewport scale × `devicePixelRatio`) and shown dot by dot with nearest sampling. A new built-in example skin, Plain (`plainSkin`), is drawn with the Canvas 2D API only.
  - Each gameplay frame carries the `layout` (stage, lanes, playfield bounds, judgement line, and BGA rect) resolved by the host through `resolveGameplayLayout`, so skins place their chrome from it instead of computing geometry themselves.
  - Phantom is the existing poster skin. Its showpieces now cut in on torn-paper strips (a red splash behind a ripped white rim around an ink band, with speed lines racing through it) carrying ransom-note lettering — READY? / GO!!, every 100 combo, and FULL COMBO; launching a chart splits the screen on a torn diagonal seam between a red bokeh strip on the left quarter and a black-and-white starburst carrying the title; and the result wipe tears away along a ripped edge with RESULT cut from magazines.
  - Synesthesia is inspired by synaesthetic sound-and-light rhythm shooters: a black void, a world built from fine ember / gold particles with electric blue and magenta accents, data dust pouring out of the vanishing point (no speed lines radiating from it), a floor of light points, rivers of particles, point-cloud pyramids, and a roaming audio orb in the manner of classic music visualizers — a hollow shell of violet / blue / pink sparks bristling with fibres, orbited by a black moon that reflects its light. Schools of light fish (3D boids in ember, blue, and magenta) swim through the space, tightening on the beat and scattering on every key press, and the 3D backdrop roams between random camera shots — flying or hard-cutting, with a handheld drift — while the idle BGA monitor follows the orb. Hits detonate as perspective-projected 3D fountains of fine powder — dense, tiny grains with only the coarsest few trailing a hairline or carrying a glint — a light pillar, a core flash, an anamorphic streak, and a lock-on reticle that snaps shut; HUD panels are hairline frames with lock-on corners. Select snaps a lock-on reticle onto the focused chart over the particle world; result has an entrance timeline with sparks bursting as the rank ignites. It draws with Michroma and M PLUS 1p, which hosts should load.
  - Lattice is a third built-in skin in the manner of precise, typographic interaction design: warm paper with graph-paper rules, ink with one cobalt accent, and a field of fine needles that turns like iron filings to the beat, to every key press, toward a combo milestone, and into a swirl on a full combo. Text decodes in with a text scramble throughout, the combo is an odometer, judgements drop in letter by letter on a spring, bead-chain pendulums swing under Verlet physics when keys strike them, select rows and level squares drop and bounce into place, and launching flips the page to ink tile by tile. It draws with Inter, Azeret Mono, and M PLUS 1p, which hosts should load.
  - Skins can now react to what is playing: a new `BeMusicAudioFrame` (loudness in 0..1 and dBFS, bass / mid / high energy, a 16-band log spectrum, and an onset envelope from spectral-flux transient detection) reaches every gameplay and select frame (`audio`). Gameplay analyses the whole mix off the audio bus output; select analyses the BGM and chart preview. Each band and the bass / mid / high energies are placed within the range they covered over the last few seconds (an automatic gain), so a loud, compressed mix no longer pins the spectrum at the top: bars drop between hits and reach the top on them, and the skins' audio-driven sizes (Phantom's halftone, bursts, and rank badge, Synesthesia's orb) swing much wider. The built-in skins use it, gated by the effects level: Phantom's halftone and bursts pump on the bass and a slanted spectrum strip sits under the monitor (and along the select list); Synesthesia's dust, haze, floor, rivers, and fish schools follow loudness, bass, mids, and onsets, and the orb's latitudes swell and grow fibres with their spectrum bands, breathe on the bass, and burst on onsets; Lattice's needles stand up into an equalizer on the select page, onsets ripple through the field and strike the pendulums, the idle monitor becomes a tile equalizer, and the tally shows a live spectrum and dB readout.
  - 24 KEY and 48 KEY charts no longer squeeze 24 lanes per side into the 7K playfield (8 px each): 24 KEY fills the column left of the BGA monitor (about 10.5 px a lane, the monitor stays), and 48 KEY spreads both banks across 616 px (about 12.8 px a lane). The core lane renderer and every built-in skin share the new layout, so chrome, notes, and judgements line up.
  - Key beams read more clearly in every built-in skin: a pressed lane lights a laser in its colour (cool white, electric blue, and red in Phantom; each lane's light in Synesthesia; graphite, cobalt, and vermilion ink in Lattice) that stands near solid at the judgement line and eases out up the lane, so the upper lane where notes are still falling only carries a faint tint.
  - 5 / 7 / 10 / 14 KEY lanes now have fixed widths in proportions taken from the arcade cabinet — a 41 px scratch, 24 px white keys, 19 px black keys (a 7K side stays 194 px) — so a 5K or DP chart never stretches its lanes sideways; the playfield narrows or widens instead. White-key lanes also get their own background tone in every built-in skin, while the scratch lane shares the black keys' background.
  - Skinless lanes now sit edge to edge (the 2 px gaps between lanes are gone) and every built-in skin draws notes and long notes across the full lane width. In That-Which-Must-Not-Be-Named double play (10 / 14 KEY) the 1P and 2P banks stand 60 px apart, about 0.31 of a side as on the arcade cabinet (`_____DP_SIDE_GAP`), and every built-in skin draws the judgement line and lane grid per side (`resolveLaneRuns` in the skin SDK) so nothing crosses the gap; 48 KEY keeps its banks together.
  - Built-in skin text is now vertically aligned by its capitals: Pixi sizes a line box from accent and descender ink, so faces like Anton and Michroma sat visibly low in every plate and button; each face's offset is measured once and corrected through the text pivot.
  - Built-in skin text now rasterizes at the final device density (viewport scale x renderer resolution) instead of being magnified from the 640x480 design canvas, so labels and numbers stay crisp at any window size; glow shadows get texture padding so they no longer clip into hard rectangles.
  - The Pixi renderer now uses the display's full `devicePixelRatio` instead of capping it at 2x, so 3x displays render the scenes at native density.
  - Showpieces for both built-in skins: a count-in before the first beat (Phantom slashes READY? into GO!!, Synesthesia condenses READY and flares START), a cut-in every 100 combo, a CLEAR LINE flourish when the gauge crosses the clear line (marking the line, not a cleared song), and a full-combo finale (Phantom's turning burst with confetti, Synesthesia's 3D spark sphere). Phantom's result screen opens with an ink wipe carrying a giant RESULT slug.
  - Synesthesia enters a zone as the combo builds: from 25 / 50 / 100 / 200 combo the dust speeds up and multiplies, the floor burns hotter, more particle rivers appear, and hits throw more sparks further. Overlapping hits now dim their white flash so colour stays the hero.
  - Judgements and the combo counter punch in on every hit, and lanes, rails, and the Synesthesia sky react to each key press. A BAD / POOR draws no effect at all — no shake, vignette, glitch, needle jitter, or combo-break shatter — so the playfield stays still and the next notes stay readable.
  - Phantom's judgement and combo count are cut out of magazines like its READY? / GO!! count-in: each hit sets them as fresh ransom notes whose cards pop in one after another, with the judgement colour on the letters of the dark cards (the combo turns gold from 200). Both are set small so the notes falling through them stay readable.
  - A PERFECT now prints as a colour-cycling GREAT, as on the arcade cabinet, in every built-in skin (each with its own palette); a plain GREAT keeps its steady colour.
  - Starting a chart from select now plays a short launch outro (Phantom's ink slabs with LET'S GO!, Synesthesia's dash through black space, its particles trailing toward the chosen title at the centre) before gameplay begins; input is ignored while it plays.
  - Moments and HUD frames make room for a BGA when one is shown, and HUD labels are no smaller than 9 px. The 100-combo cut-in no longer covers the lanes: it sits in the column beside them in single play and in the band below them when a double-play field fills that column.
  - The built-in skins draw much less per frame. Synesthesia's floor lattice, dust, powder, point clouds, and orb shells and Lattice's needle field are drawn as GPU particles (a shared `particle-layer` that rides along with a pooled graphics) instead of `Graphics` geometry rebuilt every frame; the remaining Synesthesia light shapes are merged into one fill per colour bucket, colour maths no longer allocates, and overlapping bombs share a per-frame spark budget. HUD text takes its fill from a tint so colour changes reuse the glyph texture, the cap-height alignment no longer re-measures fonts every frame while a face is still loading, Lattice's paper grid is drawn once, Phantom's halftone fields fill in one pass, and the rebuilt-every-frame result screens reuse their label textures. On a dense 7K chart this cuts the gameplay frame work by roughly 38 % (Synesthesia), 10 % (Phantom), and the Lattice select screen by about 15 %.
  - Every built-in skin's select, gameplay, and result screens are set on a layout grid — a fixed page margin and gutter, blocks sharing their top, bottom, and side lines across columns, and rows on one pitch inside each panel (score panels pair SCORE / COMBO, EX SCORE / MAX, EX RATE / RANK on shared rows; result judgement rows end on the graphs' baseline) — so related figures read as groups and the screens feel ordered.
  - Built-in skin type no longer collides with rules and frames: Phantom's judge tally clears the status bar's teeth, Synesthesia's header backs its type over the playfield rails, CLEAR sits clear of the playfield frame, SOUND ONLY gets a slip over the idle monitor, the select cursor marker no longer sits on the panel frame, and Lattice's needle field leaves the footer readouts and the milestone figures clean.
  - New `beMusicEffects` option (`'full'` / `'reduced'` / `'off'`) on the default gameplay, select, and result views tones down or disables flashes, particles, and animation for comfort or low-end devices; select renderers can declare an `outroMs` and receive `effects` and `launchAt` in their frame.
  - The built-in skins are 16:9: they declare a new `BeMusicSkin.stage` (854x480 with a `resolveBgaRect` hook) and the default gameplay, select, and result scenes size their design canvas from it, while LR2 / beatoraja themes keep their own canvas. The playfield keeps its 4:3 pixels — same lane widths, judgement line, and note speed — and the extra width goes to the BGA and HUD: the BGA grows to a 284 px square centred between the lanes and a right-hand judge column (Phantom adds a spectrum under the tally there), shrinks to fit beside a double-play field instead of disappearing, the score panel moves to the right margin, and the track card widens so long titles keep their room.
  - Select-list rows use the wider list to show what a player checks before picking a chart: the artist after the title, gimmick tags (LN, SOFLAN, STOP, MINE), the note count, the play length, and the tempo range, in fixed columns that line up down the list.
  - Result screens gain a track column: title, artist, genre, mode, level, BPM, combo breaks, and the clear lamp (PERFECT / FULL COMBO / CLEAR / FAILED), replacing the title line in the header.
  - While a chart's audio decodes or its BGA video transcodes, the lanes show NOW LOADING in each skin's style (Phantom's ransom note, Synesthesia's breathing light, Lattice's re-decoding caption with a sweeping plotter head) and the count-in waits for it; `mount()` now shows the playfield during this load instead of a blank stage.
  - `SkinlessGameplayChromeRuntime` gains `totalNotes`, `chartMs`, `judgeAtMs`, `impulseAtMs`, `impulseKind`, `effects`, and `loading`, and the be-music lane and bomb contexts gain `combo` and `effects`.
  - With no BGA, every built-in skin's monitor now reads SOUND ONLY instead of STAND BY / STANDBY / NO BGA; Phantom cuts it out of magazines as a ransom note, re-cut every so often over its turning starburst.
  - Long notes share one shape across the built-in skins, taken from Synesthesia: a translucent beam in the lane colour with a centre filament between the head and tail bars (Phantom in poster tones with a paper-white filament, Lattice as a faint ink wash with an ink filament, Plain with a white centre line).
  - Select-list rows label the note count NOTES instead of a bare N.
  - Phantom drops the sheet-music staves from its floor wedge and result slash, and Synesthesia drops its ember horizon and every elliptical effect (hit shockwave rings, floor beat rings, the count-in ring, the 100-combo shockwave, and the result rank ring).
  - The built-in skins do much less work per frame: notes share one Graphics, the select screen keeps unchanged labels' text textures through its transitions, skin canvases no longer preserve their drawing buffer, Phantom's static ground and halftone fields come from cached geometry, result screens stop rebuilding their static backgrounds and per-dot fills, Synesthesia projects its particle fields without allocating, Lattice works its needle field out by row and column, and Plain reuses its gradient and font strings. Phantom gameplay drops from about 430 to 155 ms of main-thread time per second, and Synesthesia gameplay from about 340 to 235.
  - Screen transitions are smoother: with a be-music skin the play screen fades up from black as it appears and fades to black with the audio before the result or select screen takes over, the full-combo showpieces close within the post-chart hold, and the result entrances settle sooner.
- 2c368ed: Redesign the default (skinless) skin family in a "Phantom" poster style: ink-black ground, blood-red slabs and halftone fields, slanted paper plates, jagged starbursts, and condensed italic type. Gameplay, song select, and result all share the new look while keeping the same geometry contract (LR2 default 7-keys lane positions, 640x480 design canvas, unchanged select hit areas).
  
  - Gameplay chrome: sawtooth header kicker that swells on the beat, slanted mode / ruleset tags, a halftone floor wedge under a slanted score plate with a starburst rank badge, a segmented slanted-cell groove gauge, a paper "track card" song plate, ransom-note judge tally chips, and a BGA monitor that idles on a turning starburst "STAND BY" screen.
  - The playfield stays deliberately plain and That-Which-Must-Not-Be-Named-like: flat white / blue / red notes, solid-rail long notes, a red judgement line, and a simple ring-and-core hit flash, so reading is never traded for style.
  - Judgement words and all live numerals (score, EX score, combo, gauge, tally, BPM / HI-SPEED) use Anton with tabular figures, laid out per glyph in fixed-width cells so changing values never jitter sideways.
  - Song select: red halftone slab with a drifting dot field, a starburst that pulses at the focused chart's BPM, speed streaks, a scrolling header kicker, a beat-kicking row pointer, a glint sweeping the focused card, a staggered fly-in of the song list on entry, and a slide-in of the focused card and title on every cursor move. PLAY is now the primary (larger) action and AUTO PLAY secondary.
  - Result: an entrance timeline — the red halftone slash sweeps in, the STAGE CLEAR / FAILED tag slams down, metric plates and judgement rows slide in one after another while every counter rolls up, count bars grow, run graphs draw left to right, and the rank burst pops before its letter stamps down. Afterwards the burst keeps turning and pulsing, the halftone drifts, the header kicker scrolls, speed streaks rake across, and a glint sweeps the verdict tag; a skip jumps straight to the settled layout.
  - Type stack: Anton for Latin display text, Dela Gothic One for song titles, and M PLUS 1p for small UI and Japanese text, with LINE Seed JP as the fallback. Hosts should load these faces (the demo does via Google Fonts).
  
  `SkinlessGameplayChromeRuntime` gains `nowMs`, `progressRatio`, `beatPhase`, `rulesetLabel`, `gaugeLabel`, `gaugeSurvival`, `fast`, and `slow`.
- 0319694: Add a master volume over every sound the player makes — gameplay keysounds and BGM, select BGM, chart previews and system sounds, result BGM, and theme sounds. `setMasterVolume` / `getMasterVolume` set and read it (linear, 0..2), and every audible path now ends in `masterOutput(context)`, a per-context gain at that level. The gameplay recorder taps the mix before it, so recordings keep their level whatever the listening volume.
- 202a28b: Mount 24 KEY SP / 48 KEY DP charts in both skin families.
  
  The beatoraja path accepts the `'24'` / `'24d'` play skins the parser already discovers: `pickBeatorajaPlayableVariant` maps the keyboard chart shapes onto them, the runtime adapter lights `KEYSONG_24K` / `KEYSONG_24K_DP` and addresses lanes through the `1000`-block timer bases, and the note layer places the 24 columns on the skin's leading lane slots (the 2P bank starting after the `note-su` / `note-sd` pair) with a piano white/black fallback tint. The new `chartPlayVariantForBeatorajaVariant` helper translates the skin's `'24d'` spelling into the engine's `'48'`.
  
  The song-select scene resolves keymode index 6 / 7 for these charts, so beatoraja's MODE filter and `modeset` badge cover 24K and 24K-DP; the LR2 select / result ops fold them onto the closest same-shape op (SP → 7 keys, DP → 14 keys) since LR2's op space has no keyboard entry. The LR2 gameplay scene renders the lanes through the fallback playfield and no longer stamps out-of-range LR2 lane timers — a lane-24 bomb used to spill from the bomb bank (`50 + 24`) into the LN-hold bank at 70+.
- d5e558c: Fix gameplay recordings showing the picture ~40-50 ms ahead of the sound. `MediaRecorder` stamps video and audio on arrival and the Web Audio path reaches it later than the canvas, by an amount that varies per machine; the recorder now encodes with WebCodecs and muxes with Mediabunny (new runtime dependency `mediabunny`), stamping frames with the `AudioContext` time they were drawn at and audio from an `AudioWorklet` by sample position, so both tracks share the gameplay clock (measured offset within 4 ms, against 41-47 ms before). Browsers without WebCodecs / `AudioWorklet` or a WebM encoder keep the `MediaRecorder` path.
  
  - New `GameplayRecorderOptions.subscribeFrame` captures each frame right after the scene renders (the built-in gameplay views pass `PixiSceneHost.onAfterRender`), and `backend` forces a backend.
  - `GameplayRecorderResult.seekable` tells whether the file already carries its seek index; `makeWebmSeekable` is only needed when it is `false`.
  - New exports `alignAudioChunk`, `resolveFrameTimestamp` and `supportsWebCodecsRecording`.
- 0103435: Run the selected gauge through the active compat ruleset instead of a hardcoded LR2 groove curve.
  
  `PlayerOptions.gauge` now picks a gauge out of the ruleset's own line-up (LR2 `GROOVE` / `EASY` / `HARD` / `EX-HARD` /
  `DEATH`, beatoraja `NORMAL` / `ASSIST-EASY` / `EASY` / `HARD` / `EX-HARD` / `HAZARD`, That-Which-Must-Not-Be-Named `NORMAL` / `EASY` /
  `ASSISTED-EASY` / `HARD` / `EX-HARD`) and the engine runs that gauge's real curve — per-judge deltas, TOTAL scaling,
  guts softening, death border, and the survival-vs-threshold clear rule. Previously the picker was cosmetic: HARD
  rendered red but ran GROOVE's numbers and reported CLEARED at 2 %.
  
  Consequences:
  
  - `PlayerSummary.gauge` gains `survival` and `failedMidPlay`, and its `type` widens from the LR2-only union to the
    ruleset-scoped gauge id.
  - The LR2 `#TOTAL` default is now LR2's note-count formula (`LR2_bmsload.cpp`) rather than a flat 160.
  - `@be-music/player-engine/core/groove-gauge` keeps only `GrooveGaugeType` / `GrooveGaugeJudgeKind`; the gauge state helpers
    (`createGrooveGaugeState`, `applyGrooveGaugeJudge`, `applyGrooveGaugeRawDelta`, `isGrooveGaugeCleared`) are removed
    in favour of the ruleset's `RulesetGauge`.
  - `beatorajaGaugeModeFromString` and `computeClearLampOp` accept every ruleset's gauge id, so beatoraja skins show the
    ASSIST-EASY and EX-HARD lamps instead of collapsing them onto NORMAL.

### Patch Changes

- 36bcb71: Retune the default gameplay compressor stack so keysounds keep their attack.
  
  - Key bus: a slower attack (12 ms) lets each hit's transient through before compression, with a gentler ratio (3:1), a firmer knee, and a faster release so one hit's gain reduction doesn't dull the next.
  - BGM bus: lighter glue (2:1 from −10 dB) with a 25 ms attack, so the background bed sits steadily under the keysounds while its drums keep their own attack.
  - Master: a firmer, less intrusive ceiling (−1.5 dB, 20:1, 2 ms attack, 150 ms release) that catches clipping peaks without shaving the front of every hit or pumping on bass.
  - The `legacy` single-compressor mode is unchanged.
- d9958ac: Show empty POORs in the LR2 POOR counter, as real LR2 does.
  
  `RulesetConfig` gains `emptyPoorCountsInPoorDisplay` — a presentation rule, not a scoring one. LR2 is `true`:
  OpenLR2's `ApplyJudgeNote` increments `playerstat.poor` for the empty-POOR branch and LR2 exposes no separate stat,
  so a run judged under LR2 now folds `emptyPoor` into the POOR figure its result screen, BP, and per-judge rates
  read. beatoraja shows an empty-POOR figure of its own and That-Which-Must-Not-Be-Named's counter is unmeasured, so both keep them apart.
  
  `ScoreSummary` gains `emptyPoor` and `@be-music/player-engine/core/scoring` exports `resolveDisplayedPoor`.
  `PlayerSummary` always reports the split; only the display copy folds.
- 750c47d: Fix sparse charts playing on only the lanes they use: a chart with notes on a single lane laid out a single lane. Gameplay now lays out every lane of the chart's play variant (5 / 7 / 9 / 10 / 14 / 24 / 48 KEY), so the playfield, key bindings, and skins always show the whole keyboard.
- b3fa635: Shorten the default POOR / miss BGA display window from 2000 ms to 500 ms, matching real LR2.
  
  LR2 ships `<poorbga>500</poorbga>` in its `config.xml` and its changelog documents 500 ms as the
  miss-BGA default, so the previous 2-second window held the miss layer four times longer than LR2.
  `DEFAULT_POOR_BGA_DISPLAY_SECONDS` is shared by the TUI compositor and the web LR2 scene, so both
  runtimes pick up the corrected timing.
- 4ab6e91: Fix gameplay recordings drifting out of sync with their audio on high-DPR displays: a canvas larger than 1920×1080 is now scaled down before encoding (configurable via `maxVideoSize`), since software VP9 could not encode ~3000×2000 frames in real time and dropped frames until the video stuttered behind the sound.
- 8b07494: Fix gameplay recordings dropping below 60 fps.
  
  `captureStream(fps)` samples the canvas on its own timer, which drifts against the render loop: a 60 fps capture of a 60 fps scene measured about 54 fps, with regular one-frame gaps. The recorder now captures with frame rate 0 and requests a frame on every animation frame (thinned to the `fps` option), so it takes exactly the frames the scene painted — measured at 60.0 fps with no gaps. Browsers without `requestFrame` keep the timer-driven capture.
- Updated dependencies: `@be-music/chart-model@0.4.0`, `@be-music/player-engine@0.7.0`, `@be-music/skin-lr2@0.1.6`, `@be-music/skin-beatoraja@0.2.0`, `@be-music/player-skin-sdk@0.1.0`, `@be-music/chart-audio-renderer@0.2.4`, `@be-music/chart-parser@0.2.4`

## 0.7.0

### Minor Changes

- ab210cb: Record a play log (`*.bmplay.json` input replay) for every gameplay run: the LR2/default gameplay scene exposes it through `PixiGameplayResultData.playlog`, the beatoraja scene through `PixiBeatorajaGameplayView.getPlaylog()`, and the `@be-music/player-browser/runtime` subpath re-exports the playlog serializer helpers (`serializePlaylog`, `parsePlaylog`, `resolvePlaylogFilename`) for hosts.

  The LR2/default gameplay scene also plays a recorded log back: `PixiGameplayViewOptions.replay` re-applies the log's resolved note arrangement onto the freshly prepared chart (`applyPlaylogArrangement` — RANDOM / MIRROR arrangements replay without re-rolling) and feeds the recorded inputs through the engine's deterministic replay path, restoring the log's judge-window ruleset. The `@be-music/player-browser/collection` subpath adds `computeChartFileSha256` / `computeSha256Hex` for stamping and matching the playlog's chart-file hash, and both gameplay scenes accept the host-computed hash and judge ruleset for recording.

### Patch Changes

- Emit declaration-compatible types for the beatoraja theme's playable-variant constant so consumers building under `isolatedDeclarations` no longer fail on the inferred `as const satisfies ...` type.
- Updated dependencies: `@be-music/skin-lr2@0.1.5`, `@be-music/player-engine@0.6.0`

## 0.6.2

### Patch Changes

- f07ff77: Match the LR2 groove gauge bar rendering: remove the peak-hold / afterimage bead (LR2 has none — the bar tracks only the live value) and suppress the green clear-zone split for survival gauges (HARD / DEATH render the whole bar red in LR2, since they have no 80% clear border). GROOVE / EASY keep the green ≥80% zone. The per-bead cell selection is now the pure, tested `resolveGrooveGaugeBeads` helper.
- 99324e8: `#xxx97` / `#xxx98` dynamic volume changes in the WebAudio session now apply only to voices triggered after the event, matching the documented semantics and the Node engine. Previously the web runtime wrote the new gain onto the shared bus mixers, retroactively changing the volume of already-playing voices.
- Updated dependencies: `@be-music/chart-parser@0.2.3`, `@be-music/chart-source@0.2.2`, `@be-music/player-engine@0.5.0`, `@be-music/chart-audio-renderer@0.2.3`, `@be-music/shared-utils@0.3.0`, `@be-music/chart-model@0.3.2`, `@be-music/skin-lr2@0.1.4`, `@be-music/skin-beatoraja@0.1.2`

## 0.6.1

### Patch Changes

- 9b7f269: Song-select preview, skinless DP chrome, same-slot retrigger, and audio-bus fixes for the browser player.

  - Song-select chart preview now auditions AUTO PLAY-style — visible play-lane keysounds and BGM are audible, while invisible `3x` / `4x` objects are excluded (they only update lane keysound state during gameplay, not the preview), and previews fade out over 250 ms when switching or stopping instead of cutting abruptly.
  - Skinless (default-skin) DP gameplay chrome reworked: dropped the top info bar, added a dedicated score panel, and made the fallback playfield layout side-aware so 2P / DP charts render their lanes correctly.
  - Retriggering the same `#WAV` slot now stops the previously playing BMS source instead of letting both ring out, fixing the doubled/overlapping sample on rapid same-slot retrigger.
  - Rebalanced the Web Audio bus gain staging: a -3 dB input trim ahead of the per-bus / master compressors with a matching +3 dB makeup after, plus retuned compressor params (higher thresholds, gentler ratios, softer knees), so hot source files keep headroom and the compressors act on real overloads instead of smashing normal hits. `off` mode still bypasses trim, compressors, and makeup.
  - Bump pixi.js to 8.19.0.

- Updated dependencies: `@be-music/player-engine@0.4.3`

## 0.6.0

### Minor Changes

- a36c2b1: Separate default-chrome injection from the LR2 gameplay scene so the default gameplay scene can paint its own chrome without dragging the LR2 skin pipeline along.

  New `scene/gameplay-chrome.ts` and `scene/gameplay-lanes.ts` modules hold the shared chrome / lane drawing; the LR2 gameplay scene now consumes those modules. The default scene's font setup, lane sizing, and decide / result transitions land closer to the LR2 skin's authored values, so charts that load without a skin render a more readable playfield.

## 0.5.1

### Patch Changes

- eb92249: Bump `fflate` from 0.8.2 to 0.8.3.
- eb92249: Cap beatoraja texture decoding at four concurrent jobs through `runWithConcurrency` instead of dispatching every asset in parallel via `Promise.all`. Themes that ship hundreds of bitmaps (the LITONE families, several Hi-Speed packs) used to allocate every decoded `ImageBitmap` plus its backing `ArrayBuffer` at the same time, peaking gameplay heap by several hundred MB before the GC could reclaim the input buffers. The bounded scheduler keeps memory pressure proportional to the worker count.
- Updated dependencies: `@be-music/player-engine@0.4.2`

## 0.5.0

### Minor Changes

- 69f77d1: Split `@be-music/player-browser`'s public surface from a single grab-bag `./` entry into five per-area subpaths: `./scenes`, `./skin`, `./chart`, `./collection`, `./runtime`. The main `.` export keeps re-exporting everything, so existing imports continue to work unchanged. New code should prefer the per-area subpaths to make the dependency surface explicit (e.g. importing only from `@be-music/player-browser/scenes` shows the consumer doesn't reach into chart preprocessing or song-collection helpers).

### Patch Changes

- 69f77d1: `BeatorajaMarkerLayer.update` previously picked only the first prototype per marker kind (`group` / `bpm` / `stop` / `time`) via `kind.find(...)` and painted it at every beat. DP skins that author one destination per side (1P-side + 2P-side) only saw markers rendered on the 1P side as a result. Iterate every registered prototype per kind, matching beatoraja's upstream `LaneRenderer.java` loop, so both sides paint measure lines / BPM-change lines / STOP markers / time-tick markers.
- 69f77d1: Bound the zip-archive decode path's working memory so opening a multi-gigabyte chart pack no longer materializes every entry in RAM at once. Entries are now streamed through the song-collection loader and released as soon as their files are handed off.
- 69f77d1: Destroy beatoraja-scene Pixi `GraphicsContext` instances during scene teardown so the underlying GPU resources are released. Without this the WebGL renderer's context cache grew unbounded as the player moved between scenes.
- 69f77d1: Discard scenes whose `enter()` throws (e.g. a skin failed to prepare, or an audio dependency rejected) instead of leaving them attached to the shared `PixiSceneHost`. Subsequent mounts no longer inherit half-initialized state from the failed predecessor.
- 69f77d1: Disconnect each per-source `GainNode` from the Web Audio graph as soon as its `BufferSourceNode` ends, so long sessions no longer leak nodes that the audio session's `dispose()` would have to chase down on shutdown.
- 69f77d1: Drain pending staggered-texture cleanup queues during scene shutdown so textures scheduled for delayed destruction don't outlive their owning scene and leak into the next chart's prepare pass.
- 69f77d1: Skip beatoraja sprite props whose `src` index points at a missing image entry so a malformed theme no longer renders a placeholder rectangle in its place.
- 69f77d1: Suppress beatoraja BGA sprites whose backing texture failed to load instead of painting a transparent placeholder; charts referencing missing BMP entries no longer leak unbacked sprites onto the BGA composite layer.
- 69f77d1: Prevent the chart-preview audio scheduler from resuming playback after the preview has been disposed (e.g. the user moved off the song before the buffer decoded), so a previously-disposed `ChartPreview` no longer emits sample triggers into the next preview's audio context.
- 69f77d1: Reject LR2 `#SRC_*` entries whose crop rectangle is empty or extends past the source texture, so the renderer never asks Pixi to crop to a zero-area or out-of-bounds region.
- 69f77d1: Cache dynamic beatoraja crop textures across frames in the skin view so animated sprite layers no longer allocate a fresh cropped `Texture` per tick. Frees the GC pressure that surfaced as periodic stalls on sprite-heavy beatoraja themes.
- 4275fef: Call `scheduler.yield()` through the `scheduler` receiver instead of extracting the method into a bare variable. Detached method invocation lost the `this` binding and crashed with `Illegal invocation` on browsers that ship the Scheduler API natively, so `loadSongCollectionFromFiles` froze mid-parse on Chrome's scheduler-yield code path. The `setTimeout(0)` fallback for browsers without the API is unchanged.
- 69f77d1: Serialize BGA video FFmpeg transcodes through a single-flight queue so charts that reference several `.mpg` / `.avi` BGAs no longer launch parallel `ffmpeg.wasm` workers and exhaust browser memory.
- 69f77d1: Yield to macrotasks while parsing a large chart so the page stays responsive (loading overlay animation, scrollbar, click handlers) and the browser doesn't flag the tab as unresponsive on multi-MB BMS / BMSON files.
- 69f77d1: Precompute `sortedChromeEntries` (tagged union over image / number / text / button / onMouse / slider) once per LR2 select-scene skin reference. The previous render path merged six arrays into `work[]` and called `.sort()` every frame; the underlying skin is frozen after parse so the order is static. Per-frame visibility (op gating, panel-open gating, DST keyframe evaluation) still happens during the switch dispatch — only the merge / sort step is hoisted out.
- Updated dependencies: `@be-music/skin-lr2@0.1.3`, `@be-music/skin-beatoraja@0.1.1`, `@be-music/player-engine@0.4.1`, `@be-music/shared-utils@0.2.1`, `@be-music/chart-audio-renderer@0.2.2`, `@be-music/chart-source@0.2.1`, `@be-music/chart-parser@0.2.2`, `@be-music/chart-model@0.3.1`

## 0.4.0

### Minor Changes

- 06a2db9: Add beatoraja skin support alongside the existing LR2 path.

  Public entry points include `loadBeatorajaThemeFromFiles()`, `loadBeatorajaTexturesFromBundle()`, `destinationToSpriteProps()`, `BeatorajaPlaySkinView`, the `BeatorajaRuntimeAdapter`, Pixi scenes for decide / gameplay / result / select, drop-detection helpers (`isBeatorajaSkinIndicator`, `isBeatorajaLuaSkinFilePath`, `isLr2SkinFilePath`), and chart helpers (`prepareBeatorajaGameplayChart`, `computeBeatorajaChartMarkers`, `pickBeatorajaPlayableVariant`).

  Rendering fixes that landed with the beatoraja path: POPN-9 (PMS-STD) routing, LN / CN / HCN cap pairing and orientation, LN body / tail visibility after head judge, upstream `rxhs / 4` note scroll, BMFont negative-`size=` normalization, destination clipping to the authored canvas, and related select / judge-popup wiring.

  **Breaking** — `BrowserSongLibrary` is renamed to `BrowserSongCollectionStore`. The package source tree is reorganized into purpose-based subdirectories; the package entry point re-exports the same symbols, so consumers that import from the package root are unaffected.

### Patch Changes

- Updated dependencies: `@be-music/skin-beatoraja@0.1.0`, `@be-music/chart-model@0.3.0`, `@be-music/player-engine@0.4.0`, `@be-music/skin-lr2@0.1.2`, `@be-music/chart-audio-renderer@0.2.1`, `@be-music/chart-parser@0.2.1`

## 0.3.1

### Patch Changes

- b9a5f51: Fix two LN-effect regressions.

  - AUTO LN lane laser no longer fades out ~150 ms into the sustain: `hold-lane-until-beat` now keeps the lane in `pressedChannels` so the same-tick `flash-lane` auto-release is skipped.
  - MANUAL LN-hold effects (sustain glow / hold sparkles) now show: the renderer starts the LR2 LN-hold timer (70..89) for every LN start and fades it at the tail.

- Updated dependencies: `@be-music/player-engine@0.3.1`

## 0.3.0

### Minor Changes

- 5ea9072: `PixiGameplayView.prepareSong` now builds a `PreparedPlaybackChartData` and forwards it to the engine through `engineOptions.preparedChart`, so the renderer and the engine share the same note instances instead of mirroring `note.hit` through an index-based sync.

  That removes the class of view ↔ engine drift bugs: notes vanishing mid-lane (HIDE-on-judge dropouts), mid-chart full-combo cues, AUTO PLAY falling short of EX-MAX, PMS keys 6-9 mapping to That-Which-Must-Not-Be-Named 2P, chord bombs only on the right-most lane, AUTO LN lasers staying lit after the tail, and MANUAL LN BAD-failing mid-sustain while the key is held. Simultaneously-judged AUTO PLAY chords now produce one bomb sprite per chord note via `drainPendingJudgeCombos`.

### Patch Changes

- Updated dependencies: `@be-music/player-engine@0.3.0`

## 0.2.0

### Minor Changes

- 632f274: Initial browser player: a PixiJS scene host for the LR2 chart-player flow (select / decide / play / result) driven by the parsed LR2 skin (`#IMAGE` / `#SRC_*` / `#DST_*` keyframes, `#LR2FONT` bitmap fonts, op-gated visibility, scene-stage timers). Charts and themes load from drag-drop or file picker.

  Headline capabilities:

  - LR2 skin rendering: frame chrome, BGA, lane lasers, scratch turntable, bomb / FC / hold timers, animated bitmap fonts, gauge / combo / score, scroll slider.
  - PMS / 9 KEY (Pop'n) skin support alongside That-Which-Must-Not-Be-Named 7 / 14-key layouts, with single-side judge / combo plate rendering for PMS-STD charts that source lanes from the `2X` channel block.
  - BGA pipeline: native `<video>` decode with an ffmpeg.wasm transcode fallback, held until the chart-start gate.
  - Web Audio bus: split key / BGM / master compressor topology, per-sample latency tuning, and `MediaRecorder` + canvas `captureStream` for WebM gameplay capture.
  - LR2 button wiring: RANDOM / MIRROR, AUTO-SCRATCH, gauge type, HIDDEN / SUDDEN + shutter, HS-FIX, DP FLIP, BGA / score-graph / filter controls.

- 135f822: Drive gameplay through the shared `@be-music/player-engine` engine (`manualPlay` / `autoPlay`) instead of the in-tree self-judge ladder, so the browser player shares judging, gauging, scoring, fallback keysound routing, long-note handling, mine priority, and chart-finish semantics with the TUI.

  New host adapters: `WebAudioSession` (Web Audio API `AudioSession`), `WebInputRuntime` (DOM keydown / keyup with `pressedAt` from `performance.timeOrigin + KeyboardEvent.timeStamp`), `WebUiRuntime` (engine `uiSignals` → Pixi callbacks), and `runEngineDriver` glue.

  Latency / audio: pin Pixi to `powerPreference: 'high-performance'`, isolate the gameplay canvas with `contain: content`, and pin master makeup gain at unity so fallback-keysound density doesn't pump the compressor.

### Patch Changes

- Updated dependencies: `@be-music/chart-parser@0.2.0`, `@be-music/chart-model@0.2.0`, `@be-music/player-engine@0.2.0`, `@be-music/chart-audio-renderer@0.2.0`, `@be-music/chart-source@0.2.0`, `@be-music/shared-utils@0.2.0`, `@be-music/skin-lr2@0.1.1`
