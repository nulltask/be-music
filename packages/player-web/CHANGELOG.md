# @be-music/player-web

## 0.8.0

### Minor Changes

- cd83c89: Let hosts balance keysounds against BGM and tune each compressor.
  
  - The audio bus gains per-bus user volume (`setBusVolume` / `getBusVolume`, `initialVolumes`) applied at each source mixer ahead of the compressor stack, and live compressor tuning (`setCompressorParams` / `getCompressorParams`, `initialCompressorParams`) for the key, BGM, master, and legacy compressors, clamped to the Web Audio ranges.
  - New `@be-music/player-web/runtime` exports: `AudioBusChannel`, `TunableCompressor`, `MAX_BUS_VOLUME`, `sanitizeBusVolume`, `DEFAULT_COMPRESSOR_PARAMS`, `COMPRESSOR_PARAM_RANGES`, and `mergeCompressorParams`.
  - Gameplay views take `audioVolumes` and `audioCompressorParams` options and expose `setAudioVolume` / `setAudioCompressorParams` to change them live; the beatoraja gameplay prep accepts `audioBusOptions` for the same initial state.
- 9534c16: Add the be-music skin format and a second built-in skin, Synesthesia.
  
  The default (skinless) family now renders through a `BeMusicSkin`: a skin that draws every screen (gameplay, select, result) onto a canvas the player hands it, from plain per-frame data, over a fixed design canvas (the skin's `stage`, the 16:9 `wideStage` unless it declares another). The shared scenes keep input, timing, judging, and layout and show the skin's canvas, so skins can be swapped by passing `beMusicSkin` to `DefaultPixiGameplayView` / `DefaultPixiSongSelectView` / `DefaultPixiResultView`.
  
  - New exports: `BeMusicSkin` and its frame types, `createBeMusicSkinRegistry`, `resolveBeMusicLaneKind`, `resolveSelectListWindow`, `phantomSkin`, `synesthesiaSkin`, `latticeSkin`, `plainSkin`, and `BUILT_IN_BE_MUSIC_SKINS`.
  - Skins can be made outside the player with any renderer: the skin contract and its helpers now live in the new `@be-music/skin-sdk` package, which imports no rendering framework, and `@be-music/player-web` depends on it. A skin names the canvas context it wants, may create its own renderer in an async `setup` and release it in `teardown`, and brings its framework (PixiJS, three.js, …) as its own dependency. Phantom, Synesthesia, and Lattice run their Pixi scenes on their own renderer this way, and the built-in skins live under `src/skins/` importing only `@be-music/skin-sdk`, their framework, and their own files (a test enforces the boundary). The lane geometry, song entry, result data, and audio frame types the player shares with skins move to the SDK; `@be-music/player-web` keeps re-exporting them.
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
  - Skinless lanes now sit edge to edge (the 2 px gaps between lanes are gone) and every built-in skin draws notes and long notes across the full lane width. In IIDX double play (10 / 14 KEY) the 1P and 2P banks stand 60 px apart, about 0.31 of a side as on the arcade cabinet (`IIDX_DP_SIDE_GAP`), and every built-in skin draws the judgement line and lane grid per side (`resolveLaneRuns` in the skin SDK) so nothing crosses the gap; 48 KEY keeps its banks together.
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
  - The playfield stays deliberately plain and IIDX-like: flat white / blue / red notes, solid-rail long notes, a red judgement line, and a simple ring-and-core hit flash, so reading is never traded for style.
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
  `DEATH`, beatoraja `NORMAL` / `ASSIST-EASY` / `EASY` / `HARD` / `EX-HARD` / `HAZARD`, IIDX `NORMAL` / `EASY` /
  `ASSISTED-EASY` / `HARD` / `EX-HARD`) and the engine runs that gauge's real curve — per-judge deltas, TOTAL scaling,
  guts softening, death border, and the survival-vs-threshold clear rule. Previously the picker was cosmetic: HARD
  rendered red but ran GROOVE's numbers and reported CLEARED at 2 %.
  
  Consequences:
  
  - `PlayerSummary.gauge` gains `survival` and `failedMidPlay`, and its `type` widens from the LR2-only union to the
    ruleset-scoped gauge id.
  - The LR2 `#TOTAL` default is now LR2's note-count formula (`LR2_bmsload.cpp`) rather than a flat 160.
  - `@be-music/player/core/groove-gauge` keeps only `GrooveGaugeType` / `GrooveGaugeJudgeKind`; the gauge state helpers
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
  read. beatoraja shows an empty-POOR figure of its own and IIDX's counter is unmeasured, so both keep them apart.
  
  `ScoreSummary` gains `emptyPoor` and `@be-music/player/core/scoring` exports `resolveDisplayedPoor`.
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
- Updated dependencies [202a28b]
- Updated dependencies [d9958ac]
- Updated dependencies [202a28b]
- Updated dependencies [f24ed8b]
- Updated dependencies [202a28b]
- Updated dependencies [750c47d]
- Updated dependencies [b3fa635]
- Updated dependencies [2d7652c]
- Updated dependencies [0103435]
- Updated dependencies [9505684]
- Updated dependencies [1589105]
- Updated dependencies [1c6e7aa]
- Updated dependencies [08e62d0]
- Updated dependencies [41f5efb]
- Updated dependencies [40f1050]
- Updated dependencies [872c26c]
  - @be-music/chart@0.4.0
  - @be-music/player@0.7.0
  - @be-music/lr2-skin@0.1.6
  - @be-music/beatoraja-skin@0.2.0
  - @be-music/skin-sdk@0.1.0
  - @be-music/audio-renderer@0.2.4
  - @be-music/parser@0.2.4

## 0.7.0

### Minor Changes

- ab210cb: Record a play log (`*.bmplay.json` input replay) for every gameplay run: the LR2/default gameplay scene exposes it through `PixiGameplayResultData.playlog`, the beatoraja scene through `PixiBeatorajaGameplayView.getPlaylog()`, and the `@be-music/player-web/runtime` subpath re-exports the playlog serializer helpers (`serializePlaylog`, `parsePlaylog`, `resolvePlaylogFilename`) for hosts.

  The LR2/default gameplay scene also plays a recorded log back: `PixiGameplayViewOptions.replay` re-applies the log's resolved note arrangement onto the freshly prepared chart (`applyPlaylogArrangement` — RANDOM / MIRROR arrangements replay without re-rolling) and feeds the recorded inputs through the engine's deterministic replay path, restoring the log's judge-window ruleset. The `@be-music/player-web/collection` subpath adds `computeChartFileSha256` / `computeSha256Hex` for stamping and matching the playlog's chart-file hash, and both gameplay scenes accept the host-computed hash and judge ruleset for recording.

### Patch Changes

- Emit declaration-compatible types for the beatoraja theme's playable-variant constant so consumers building under `isolatedDeclarations` no longer fail on the inferred `as const satisfies ...` type.
- Updated dependencies
- Updated dependencies
- Updated dependencies [ab210cb]
  - @be-music/lr2-skin@0.1.5
  - @be-music/player@0.6.0

## 0.6.2

### Patch Changes

- f07ff77: Match the LR2 groove gauge bar rendering: remove the peak-hold / afterimage bead (LR2 has none — the bar tracks only the live value) and suppress the green clear-zone split for survival gauges (HARD / DEATH render the whole bar red in LR2, since they have no 80% clear border). GROOVE / EASY keep the green ≥80% zone. The per-bead cell selection is now the pure, tested `resolveGrooveGaugeBeads` helper.
- 99324e8: `#xxx97` / `#xxx98` dynamic volume changes in the WebAudio session now apply only to voices triggered after the event, matching the documented semantics and the Node engine. Previously the web runtime wrote the new gain onto the shared bus mixers, retroactively changing the volume of already-playing voices.
- Updated dependencies [b2c4f9b]
- Updated dependencies [b9922cf]
- Updated dependencies [4d5a89e]
- Updated dependencies [254e213]
- Updated dependencies [7bbf052]
- Updated dependencies [811cdfc]
- Updated dependencies [d0bb321]
- Updated dependencies [ebfdba7]
- Updated dependencies [ca1012c]
- Updated dependencies [6ce9173]
- Updated dependencies [7802f98]
- Updated dependencies [cdc42a1]
- Updated dependencies [ca1012c]
  - @be-music/parser@0.2.3
  - @be-music/json@0.2.2
  - @be-music/player@0.5.0
  - @be-music/audio-renderer@0.2.3
  - @be-music/utils@0.3.0
  - @be-music/chart@0.3.2
  - @be-music/lr2-skin@0.1.4
  - @be-music/beatoraja-skin@0.1.2

## 0.6.1

### Patch Changes

- 9b7f269: Song-select preview, skinless DP chrome, same-slot retrigger, and audio-bus fixes for the browser player.

  - Song-select chart preview now auditions AUTO PLAY-style — visible play-lane keysounds and BGM are audible, while invisible `3x` / `4x` objects are excluded (they only update lane keysound state during gameplay, not the preview), and previews fade out over 250 ms when switching or stopping instead of cutting abruptly.
  - Skinless (default-skin) DP gameplay chrome reworked: dropped the top info bar, added a dedicated score panel, and made the fallback playfield layout side-aware so 2P / DP charts render their lanes correctly.
  - Retriggering the same `#WAV` slot now stops the previously playing BMS source instead of letting both ring out, fixing the doubled/overlapping sample on rapid same-slot retrigger.
  - Rebalanced the Web Audio bus gain staging: a -3 dB input trim ahead of the per-bus / master compressors with a matching +3 dB makeup after, plus retuned compressor params (higher thresholds, gentler ratios, softer knees), so hot source files keep headroom and the compressors act on real overloads instead of smashing normal hits. `off` mode still bypasses trim, compressors, and makeup.
  - Bump pixi.js to 8.19.0.

- Updated dependencies [9b7f269]
  - @be-music/player@0.4.3

## 0.6.0

### Minor Changes

- a36c2b1: Separate default-chrome injection from the LR2 gameplay scene so the default gameplay scene can paint its own chrome without dragging the LR2 skin pipeline along.

  New `scene/gameplay-chrome.ts` and `scene/gameplay-lanes.ts` modules hold the shared chrome / lane drawing; the LR2 gameplay scene now consumes those modules. The default scene's font setup, lane sizing, and decide / result transitions land closer to the LR2 skin's authored values, so charts that load without a skin render a more readable playfield.

## 0.5.1

### Patch Changes

- eb92249: Bump `fflate` from 0.8.2 to 0.8.3.
- eb92249: Cap beatoraja texture decoding at four concurrent jobs through `runWithConcurrency` instead of dispatching every asset in parallel via `Promise.all`. Themes that ship hundreds of bitmaps (the LITONE families, several Hi-Speed packs) used to allocate every decoded `ImageBitmap` plus its backing `ArrayBuffer` at the same time, peaking gameplay heap by several hundred MB before the GC could reclaim the input buffers. The bounded scheduler keeps memory pressure proportional to the worker count.
- Updated dependencies [eb92249]
  - @be-music/player@0.4.2

## 0.5.0

### Minor Changes

- 69f77d1: Split `@be-music/player-web`'s public surface from a single grab-bag `./` entry into five per-area subpaths: `./scenes`, `./skin`, `./chart`, `./collection`, `./runtime`. The main `.` export keeps re-exporting everything, so existing imports continue to work unchanged. New code should prefer the per-area subpaths to make the dependency surface explicit (e.g. importing only from `@be-music/player-web/scenes` shows the consumer doesn't reach into chart preprocessing or song-collection helpers).

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
- Updated dependencies [69f77d1]
- Updated dependencies [69f77d1]
- Updated dependencies [69f77d1]
- Updated dependencies [69f77d1]
- Updated dependencies [956fd01]
- Updated dependencies [73dff9a]
  - @be-music/lr2-skin@0.1.3
  - @be-music/beatoraja-skin@0.1.1
  - @be-music/player@0.4.1
  - @be-music/utils@0.2.1
  - @be-music/audio-renderer@0.2.2
  - @be-music/json@0.2.1
  - @be-music/parser@0.2.2
  - @be-music/chart@0.3.1

## 0.4.0

### Minor Changes

- 06a2db9: Add beatoraja skin support alongside the existing LR2 path.

  Public entry points include `loadBeatorajaThemeFromFiles()`, `loadBeatorajaTexturesFromBundle()`, `destinationToSpriteProps()`, `BeatorajaPlaySkinView`, the `BeatorajaRuntimeAdapter`, Pixi scenes for decide / gameplay / result / select, drop-detection helpers (`isBeatorajaSkinIndicator`, `isBeatorajaLuaSkinFilePath`, `isLr2SkinFilePath`), and chart helpers (`prepareBeatorajaGameplayChart`, `computeBeatorajaChartMarkers`, `pickBeatorajaPlayableVariant`).

  Rendering fixes that landed with the beatoraja path: POPN-9 (PMS-STD) routing, LN / CN / HCN cap pairing and orientation, LN body / tail visibility after head judge, upstream `rxhs / 4` note scroll, BMFont negative-`size=` normalization, destination clipping to the authored canvas, and related select / judge-popup wiring.

  **Breaking** — `BrowserSongLibrary` is renamed to `BrowserSongCollectionStore`. The package source tree is reorganized into purpose-based subdirectories; the package entry point re-exports the same symbols, so consumers that import from the package root are unaffected.

### Patch Changes

- Updated dependencies [06a2db9]
  - @be-music/beatoraja-skin@0.1.0
  - @be-music/chart@0.3.0
  - @be-music/player@0.4.0
  - @be-music/lr2-skin@0.1.2
  - @be-music/audio-renderer@0.2.1
  - @be-music/parser@0.2.1

## 0.3.1

### Patch Changes

- b9a5f51: Fix two LN-effect regressions.

  - AUTO LN lane laser no longer fades out ~150 ms into the sustain: `hold-lane-until-beat` now keeps the lane in `pressedChannels` so the same-tick `flash-lane` auto-release is skipped.
  - MANUAL LN-hold effects (sustain glow / hold sparkles) now show: the renderer starts the LR2 LN-hold timer (70..89) for every LN start and fades it at the tail.

- Updated dependencies [b9a5f51]
  - @be-music/player@0.3.1

## 0.3.0

### Minor Changes

- 5ea9072: `PixiGameplayView.prepareSong` now builds a `PreparedPlaybackChartData` and forwards it to the engine through `engineOptions.preparedChart`, so the renderer and the engine share the same note instances instead of mirroring `note.hit` through an index-based sync.

  That removes the class of view ↔ engine drift bugs: notes vanishing mid-lane (HIDE-on-judge dropouts), mid-chart full-combo cues, AUTO PLAY falling short of EX-MAX, PMS keys 6-9 mapping to IIDX 2P, chord bombs only on the right-most lane, AUTO LN lasers staying lit after the tail, and MANUAL LN BAD-failing mid-sustain while the key is held. Simultaneously-judged AUTO PLAY chords now produce one bomb sprite per chord note via `drainPendingJudgeCombos`.

### Patch Changes

- Updated dependencies [5ea9072]
  - @be-music/player@0.3.0

## 0.2.0

### Minor Changes

- 632f274: Initial browser player: a PixiJS scene host for the LR2 chart-player flow (select / decide / play / result) driven by the parsed LR2 skin (`#IMAGE` / `#SRC_*` / `#DST_*` keyframes, `#LR2FONT` bitmap fonts, op-gated visibility, scene-stage timers). Charts and themes load from drag-drop or file picker.

  Headline capabilities:

  - LR2 skin rendering: frame chrome, BGA, lane lasers, scratch turntable, bomb / FC / hold timers, animated bitmap fonts, gauge / combo / score, scroll slider.
  - PMS / 9 KEY (Pop'n) skin support alongside IIDX 7 / 14-key layouts, with single-side judge / combo plate rendering for PMS-STD charts that source lanes from the `2X` channel block.
  - BGA pipeline: native `<video>` decode with an ffmpeg.wasm transcode fallback, held until the chart-start gate.
  - Web Audio bus: split key / BGM / master compressor topology, per-sample latency tuning, and `MediaRecorder` + canvas `captureStream` for WebM gameplay capture.
  - LR2 button wiring: RANDOM / MIRROR, AUTO-SCRATCH, gauge type, HIDDEN / SUDDEN + shutter, HS-FIX, DP FLIP, BGA / score-graph / filter controls.

- 135f822: Drive gameplay through the shared `@be-music/player` engine (`manualPlay` / `autoPlay`) instead of the in-tree self-judge ladder, so the browser player shares judging, gauging, scoring, fallback keysound routing, long-note handling, mine priority, and chart-finish semantics with the TUI.

  New host adapters: `WebAudioSession` (Web Audio API `AudioSession`), `WebInputRuntime` (DOM keydown / keyup with `pressedAt` from `performance.timeOrigin + KeyboardEvent.timeStamp`), `WebUiRuntime` (engine `uiSignals` → Pixi callbacks), and `runEngineDriver` glue.

  Latency / audio: pin Pixi to `powerPreference: 'high-performance'`, isolate the gameplay canvas with `contain: content`, and pin master makeup gain at unity so fallback-keysound density doesn't pump the compressor.

### Patch Changes

- Updated dependencies [632f274]
- Updated dependencies [632f274]
- Updated dependencies [632f274]
- Updated dependencies [632f274]
- Updated dependencies [135f822]
- Updated dependencies [135f822]
  - @be-music/parser@0.2.0
  - @be-music/chart@0.2.0
  - @be-music/player@0.2.0
  - @be-music/audio-renderer@0.2.0
  - @be-music/json@0.2.0
  - @be-music/utils@0.2.0
  - @be-music/lr2-skin@0.1.1
