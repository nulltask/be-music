# @be-music/player-engine

## 0.11.0

### Minor Changes

- 3a5d9c3: Add optional full-combo eligibility to engine summaries and replay results so empty POOR combo breaks in beatoraja FIVEKEYS/PMS cannot earn FULL COMBO, PERFECT or MAX. Keep shared results, records and course lamps consistent with replay re-simulation.
- fcaef41: Expose authoritative HCN active/damage lane state and judged-note counts in UI frames so skins can follow the existing judge across manual play, AUTO, replay, and seeks without another simulation.
- 7f0386b: Move Node audio playback to `@be-music/player-node-audio`, removing the engine's audio renderer and Node audio dependencies. Supply `createAudioSession: createNodeAudioSession` for Node playback; an omitted factory or an unavailable adapter now plays silently. Audio factories receive the engine's resolved chart, and hosts can supply `loadAudioSampleDurations` for active-audio diagnostics. Import PCM sinks from `@be-music/player-node-audio/audio-sink`.
- 45aff53: Align LR2beta3 mines with strict ahead-only GREAT press reach and held crossing, retire passed mines immediately, and count one POOR/BP per hit without breaking combo or adding normal judgment damage. Add optional minePoor counts to summaries and replay/course results so mine hits do not hide unjudged notes in course BP.
- d08fdf9: Resolve lane-option key domains from the complete play-mode table, including five-key and both nine-key encodings. Accept optional prepared channel bindings to distinguish sparse PMS layouts while excluding scratch, wheel and the other side.
- a83e326: Rename the That-Which-Must-Not-Be-Named ruleset identifier to `____` and its rank and gauge exports accordingly. Replays now write `____` and `____/0`; previous identifiers are not supported or migrated.
- 69df53c: Allow bmson stages in intended-placement NONSTOP courses, emitting bmson IR for mixed courses with preserved slices, BGA layers, long-note modes, mine damage, per-stage judge-rank units and TOTAL units. LR2 placement stays BMS-only.
- 78faa63: Add course replay playback helpers to `@be-music/player-engine/replay`: `listCourseReplayStageCharts` and `matchesCourseReplayStageChart` name and match each stage's chart (SHA-256, then MD5, then chart fingerprint), and `planCourseReplayPlayback` lists the stage replays a course replay plays back, up to the first stage given up or failed, so a host can replay a whole course stage by stage.
- 21f705d: A single play that failed or was given up mid-way no longer records a BP that leaves out the notes it never judged: `recordPlayFromResult` and `recordPlayFromSummary` now count them, as LR2 and beatoraja do, and the course-stage variants reuse them so a stage counts them once. A mine POOR, which LR2 counts in POOR, is not taken for a judged note.
  New `abortedRecordPlayFromResult` reads what a single play given up with ESC contributes to its record (FAILED, the notes never reached in its BP, nothing when no note was judged), and new `resolveRulesetResultMissCount` gives a simulated result's BP with the same rule.
- a8896a9: Random-course filters read beatoraja's `score.` and `information.` columns: `CourseChartRecord` takes a `score` row (the best record: `clear` in beatoraja's numbering, `exscore`, `combo`, `minbp`, `playcount`, `notes`) and an `information` row (`n`, `ln`, `s`, `ls`, `total`, `density`, `peakdensity`, `enddensity`, `mainbpm`), and a chart without one reads NULL in its columns as beatoraja's outer join gives. A column only one table has can go unqualified (`playcount > 0 ORDER BY playcount DESC LIMIT 10` now parses), and columns be-music has no source for (`scorelog.*`, `score.epg`, …) stay unknown columns. New `beatorajaClearType` and `createCourseChartScore` map a best record onto the `score` row. Column expressions now carry their `table`.
- 6e676fe: Add the automatic judge timing, a mode `judgeTimingAutoAdjust: 'OFF' | 'BEATORAJA' | 'LR2-ON' | 'LR2-SILENT'` that runs under every judge ruleset: `BEATORAJA` is beatoraja's calibration, and LR2's ON and SILENT follow LR2 beta3: every PGREAT to BAD hit of a normal note adds its offset to a sum, and once per judging pass with more than nine hits the timing moves 1 ms by the sign of the sum; misses, empty POORs, long notes, AUTO, replays and a two-player BATTLE never adjust. Each step goes to the replay's `play.optionChanges`, and the mode to `play.options`. `@be-music/player-engine/display` exports `JudgeTimingAutoAdjust`, `JUDGE_TIMING_AUTO_ADJUST_MODES`, `resolveJudgeTimingAutoAdjust` and `isLR2JudgeTimingAutoAdjust`. A judge-combo effect marks a long note's judgment with `longNote` and a BAD carries its instant (#777).
- 9f41b30: Add the play options of LR2, beatoraja and AC. Each is applied in live play, recorded in the replay and applied again by replay simulation:
  
  - Independent AUTO SCRATCH sides, long scratch notes included, with helpers resolving the assisted sides and channels.
  - Source-specific LEGACY NOTE and LN REMOVE, applied before judging with head timing and keysounds kept.
  - EX-HARD independently of DEATH and HAZARD (not a new pick under LR2 beta3), and source-specific ASSIST EASY and ASSISTED EASY gauge tables, with their selected and effective names in the replay.
  - beatoraja's judgment algorithms (combo, duration, lowest), CUSTOM JUDGE window rates and judge display timing, and LR2 CONSTANT scrolling.
  - The lane arrangements R-RANDOM, SPIRAL, H-RANDOM with its BPM threshold, LR2 and PMS CONVERGE, ALL-SCR, RANDOM-EX, S-RANDOM-EX, PMS playable RANDOM and S-RANDOM, LR2 SCATTER in both its distributed and corrected nine-key modes, and BATTLE's SYNCHRONIZE and SYMMETRY RANDOM, with source seeds and fixed lanes.
  - beatoraja's chart modifiers (mine REMOVE, ADD RANDOM, ADD NEAR and ADD BLANK, long-note generation with ADD LN, CN, HCN and ALL at a rate, scroll REMOVE and ADD, EXTRA NOTE, 7 TO 9 and LN MODE for undefined long notes) and LR2 EXTRA MODE, each recording the effective chart so a replay never rolls it again.
  - beatoraja's gauge CONTINUE, SURVIVAL TO GROOVE, BEST CLEAR and SELECT TO UNDER, and LR2's P.ATTACK and G.ATTACK gauges with their course behaviour; a grade course resets EASY and G.ATTACK to GROOVE.
  - LR2 SP TO DP (with DP TO SP and 9 TO 7 on double-play and nine-key charts) and D-BATTLE, beatoraja BATTLE and BATTLE AS, and two-player play (LR2 BATTLE, COUPLE on a double-play chart, and AC two-player play), each player judged on its own side with its own gauge; the replay records the 2P gauge and result (`play.gauge2P`, `results.secondPlayer`).
  - beatoraja PRACTICE: a chart range played from a chosen gauge, TOTAL and judge rank, without a replay.
  
  Replays record the source option snapshot and the chart-timed option changes (several at one chart time included) apart from the scoring policy, with lossless option-state parsing, reconstruction and diff helpers.
  Options that only transform the chart are accepted under every judge ruleset, each with its own source's chart support: scroll REMOVE / ADD, mine REMOVE / ADD, beatoraja EXTRA, LR2 EXTRA MODE, 7 TO 9, automatic display timing, and the SP TO DP, D-BATTLE and BATTLE AS chart constructions. BATTLE keeps its LR2 meaning (two-player play), and the judge rules still come from the ruleset (#774).
  A stitched NONSTOP course keeps the last TOTAL declared across it, as LR2 does (stitching rules version 2; version 1 keeps the last stage's for existing replays).
- f994ec4: Preserve each stitched NONSTOP stage’s POOR BGA display mode for the host compositor.
- 4371c72: Add LR2's RANDOM MIX draw to `@be-music/player-engine/course`: `drawLR2RandomMix` draws a course by stage count, level limits, BPM limits, a BPM range around stage 1's max BPM and a favorite level, one stage per song folder, as LR2's `WriteRandomCourse` does, with the randomness passed in so a draw is reproducible. `LR2RandomMixSettings` with `DEFAULT_LR2_RANDOM_MIX_SETTINGS`, `LR2_RANDOM_MIX_SETTING_RANGES`, `stepLR2RandomMixSetting`, `normalizeLR2RandomMixSettings` and `resolveLR2RandomMixSettings` hold the settings LR2's buttons 260-266 edit.
- 3e694df: A running play can seek without starting again: a `{ kind: 'seek', seconds }` input command moves an AUTO play, a replay or a manual play to another chart second, and `startAtSeconds` starts a play there as its first seek. The engine rebuilds the judge state from the chart's start (AUTO and replays judge the notes before the target again, a manual play skips them without scoring), so the score, gauge, combo and max combo match a play from the start. It restores the long notes held across the target and the sounds still ringing there through the audio session's new optional `seek` and `triggerEventAt(event, offsetSeconds)`, applies the volume changes and recorded tempo changes before it, re-bases chart time on the play clock (`TempoClock.rebase`), keeps a paused play paused, and clamps a given-up replay to its recorded end.
  The UI gets a `seek` command with a snapshot of the summary and the judgments before the target, the long notes held across it and a frame at the target. Frames carry a seek `generation` and the `clock` their chart time holds at, and the summary carries `combo` and `maxCombo`.
  A play that seeks records no replay. A course run that seeks becomes practice while keeping its stage progression and its gauge and combo carry (course stage outcomes are kept apart from replays), and a practice course exports no replay.
  `waitForStart` holds chart time and audio until a `{ kind: 'start' }` command, so a host can prepare the engine during loading and pick the seek position before the chart starts.
- 3e694df: `checkReplayEligibility` and `checkCourseReplayEligibility` accept every play except a fully AUTO one and a log without fingerprints, and the Leaderboard decides what it shows (#788). A single play given up with ESC is eligible (a course run still is not when it gave up on any stage but the last one played), and a play at another tempo, a course stage sent on its own or a run of an unreleased course is accepted with the reason it does not rank in `unranked` (`ReplayUnrankedReason`, `CourseReplayUnrankedReason`). `ReplayIneligibleReason` drops `aborted`, `tempo` and `course-stage`, and `CourseReplayIneligibleReason` drops `tempo` and `unreleased`.
- 85250d8: Add randomizeSRandomNotes as a deterministic, runtime-neutral lane helper with injected randomness. Preserve active LN destinations, use LR2 free-lane placement and beatoraja's 40 ms/oldest-lane constraints, and return resolved channels without mutating inputs.

### Patch Changes

- ba3cc20: Count CN and HCN tails when deriving beatoraja TOTAL and gauge recovery, including default TOTAL and HARD/EX-HARD recovery limits. Charge-note charts no longer recover up to twice as fast; live play and replay simulation share the corrected count. LR2 counting remains unchanged.
- 7fca9a9: Use beatoraja's five-key, seven-key, PMS and keyboard gauge tables, including mode-specific borders, recovery, damage and keyboard default TOTAL. Preserve PMS's maximum of 120 in live frames while recording and simulating replay gauge results as percentages, so skins and stored results use their expected units.
- a9cc3d7: Scale beatoraja BAD windows above 100% judge rank instead of clamping them to the unscaled limits. VERY EASY and extended-rank BMS/bmson charts now judge the wider BAD range consistently in live play and replay simulation, while PMS retains its fixed BAD limits.
- 1c97afd: A tap BAD under LR2 now reuses the same press to judge the next tap on that lane at its own timing, stopping after a non-BAD or long-note head. This corrects EX score, combo, gauge and replay-derived results on dense patterns.
- 3d5e880: Re-simulating a course replay is about five times faster: `simulateCourseReplay` no longer deep-clones each stage's whole log to swap in its carry-in, and copies only the path down to `play.course` instead (`simulateReplay` never writes to the log it reads). The course log passed in stays untouched.
- b1ca2ce: Course chart filters with `LIKE` evaluate faster: the ASCII case fold returns text without capitals as it is and folds ASCII-only text with `toLowerCase`, keeping the letter-by-letter fold only for text with non-ASCII characters. Matching is unchanged; the fold was about a third of `evaluateCourseChartFilter`.
- aeac0d3: LR2 full combos now receive FULL COMBO before the gauge check, matching LR2 even when empty POORs or a low TOTAL leave the gauge below its clear border. Replay and local record lamp derivation use the same rule.
- acba3d5: Replay re-simulation is about 13% faster: each time advance walks the lanes as an array instead of a map iterator, skips sorting when it has fewer than two events, checks a mine's due points inline instead of through a fresh closure, and works out each mine's PGREAT reach once instead of on every advance. Results are unchanged.
- c35b845: The play loop no longer busy-waits: each 60 Hz tick sleeps its whole remainder in one timer (re-armed if the host fires it early) instead of sleeping 4 ms short and polling the rest with zero-delay timers. The polling kept the thread busy for the last milliseconds of every tick, about 5% of the browser's main thread on a dense chart; a JUDGE is timed by its `pressedAt` and audio is queued ahead of the write head, so nothing depended on the tick landing exactly. Inputs still wake the loop at once.
- Updated dependencies [a83e326]
- Updated dependencies [69df53c]
- Updated dependencies [f994ec4]
- Updated dependencies [c52d77d]
- Updated dependencies [69df53c]
- Updated dependencies [29e69c6]
- Updated dependencies [69df53c]
- Updated dependencies [29e69c6]
- Updated dependencies [2e435b9]
  - @be-music/chart-model@0.7.0
  - @be-music/chart-parser@0.5.0
  - @be-music/chart-source@0.5.0
  - @be-music/shared-utils@0.6.0

## 0.10.0

### Minor Changes

- 9a0c3f9: Use replay terminology throughout the recording API: import from `@be-music/player-engine/replay` and use `BeMusicReplay`, `parseReplay`, `serializeReplay`, `recordReplay`, and `onReplayRecorded`. Rename judgment and course-chart types and helpers, including `JudgmentKind`, `RulesetId`, and `CourseChartRecord`. The previous names and subpath are removed; serialized records use the replay format identifiers and field names.
  
  Rename the package from `@be-music/player` to `@be-music/player-engine` to identify its role consistently. Update imports and package filters to the new name.

### Patch Changes

- Updated dependencies [dca9a2f]
- Updated dependencies [dca9a2f]
- Updated dependencies [dca9a2f]
- Updated dependencies [dca9a2f]
- Updated dependencies [dca9a2f]
  - @be-music/chart-audio-renderer@0.4.0
  - @be-music/chart-model@0.6.0
  - @be-music/chart-parser@0.4.0
  - @be-music/chart-source@0.4.0
  - @be-music/shared-utils@0.5.0

## 0.9.0

### Minor Changes

- b2818d0: Provide one resolved-chart and deterministic judging pipeline for live play, replays and score verification.
  
  - Add EXPERT, GRADE and stitched NONSTOP courses, course fingerprints, constraints, random-course filters, course drafting and serialization, carry-over rules, trophies and complete course play logs. Newly created courses start unranked.
  - Add shared `ruleset` and `records` APIs for judgments, ranks, clear lamps, gauges, best records and course records.
  - Record chart/play fingerprints, explicit RANDOM outcomes, recorder identity, early/late counts, input-release capability, display state and ranking eligibility in play logs.
  - Support tempo changes, practice eligibility, immediate survival-gauge failure and an optional post-chart hold for scene outros.
  - Play 24/48-key wheel lanes, negative-BPM reversal, SCROLL/SPEED changes and lane modes using shared chart rules.
  - Match live and simulated results for long-note modes, mines, scratch/FREE ZONE behavior, dynamic judge windows, gauge selection, aborts and key releases. Process timed judgments deterministically at whole-microsecond boundaries.
  - Apply LR2's DEATH gauge table and preserve the default BMP00 POOR image unless POORBGA is 2.
  - Support qualified random-course SQL filters with ordering and limits, reject ambiguous columns, and accelerate simulation with binary searches.
  
  Migration: the root exports the engine; use `/signals`, `/lanes`, `/display`, `/ruleset`, `/playlog`, `/records`, `/course` and `/audio-sink` instead of removed file-based subpaths. Import chart timing and timelines from `@be-music/chart-model`. Use canonical uppercase-abbreviation names and `PlayerOptions` settings/runtime/tuning/debug/recording types. Resolve control flow once with `resolvePlayChart` and pass its chart and random draws to the engine; unresolved control flow without draws is rejected.

### Patch Changes

- Updated dependencies [b2818d0]
  - @be-music/chart-audio-renderer@0.3.0
  - @be-music/chart-model@0.5.0
  - @be-music/chart-source@0.3.0
  - @be-music/chart-parser@0.3.0
  - @be-music/shared-utils@0.4.0
## 0.8.0

### Minor Changes

- 73fd398: The engine now tells UI runtimes about long-note holds and about the ruleset a play is judged under, so a renderer no longer has to guess them from lane presses or re-derive the judge windows.
  
  - `PlayerUiCommand` gains `long-note-start` (channel, head beat, and the `ln` / `cn` / `hcn` mode the active ruleset actually plays the note in) and `long-note-end` (channel and a `complete` / `dropped` outcome). They are pushed in autoplay, auto-scratch, and manual play, next to the existing `hold-lane-until-beat` / `release-lane` pair.
  - `PlayerOptions.onRulesetResolved` is called once before playback with a `PlayerRulesetInfo`: the ruleset id, its long-note style, and its judge window tables in µs, after the judge ruleset, the debug window override, and a replay's recorded settings were applied. Under LR2 the tables are the ones in force at the start of the chart; a later `#EXRANKxx` change is not reported.

## 0.7.0

### Minor Changes

- d9958ac: Show empty POORs in the LR2 POOR counter, as real LR2 does.
  
  `RulesetConfig` gains `emptyPoorCountsInPoorDisplay` — a presentation rule, not a scoring one. LR2 is `true`:
  OpenLR2's `ApplyJudgeNote` increments `playerstat.poor` for the empty-POOR branch and LR2 exposes no separate stat,
  so a run judged under LR2 now folds `emptyPoor` into the POOR figure its result screen, BP, and per-judge rates
  read. beatoraja shows an empty-POOR figure of its own and That-Which-Must-Not-Be-Named's counter is unmeasured, so both keep them apart.
  
  `ScoreSummary` gains `emptyPoor` and `@be-music/player-engine/core/scoring` exports `resolveDisplayedPoor`.
  `PlayerSummary` always reports the split; only the display copy folds.
- 202a28b: Drive 24 KEY SP / 48 KEY DP charts end to end — the extended lane channels are now scorable notes, not just a display-mode guess.
  
  `extractTimedNotes` / `extractPlayableNotes` accept objects on the extended lane columns (`1A..1O` / `2A..2O`, plus the matching `3X`/`4X` invisible, `5X`/`6X` long-note, and `DX`/`EX` landmine families), so they land in `summary.total`, get judged, and reach the renderer. `ChartPlayVariant` gains `'24'` / `'48'`, and `resolveSideKeySlot`, `resolveLaneChannels`, and `createLaneBindings` resolve the 24 scratch-less columns per side in ascending channel order. `resolveLr2LaneIndex` returns `-1` for these variants because LR2 skins only define the 20 That-Which-Must-Not-Be-Named lane rects — hosts fall back to their own playfield instead of squeezing 24 lanes into the 7-key table.
  
  FREE ZONE is now variant-aware. Channels `17` / `27` only get the quarter-note FREE ZONE tail on the That-Which-Must-Not-Be-Named families; under `9 KEY` and the keyboard modes they are ordinary key columns, so a tap stays a tap and a `#LNOBJ` tail is no longer shadowed by the phantom one-beat tail. The variant is taken from the new `playVariant` extraction option when the host supplies one (`preparePlaybackChartData` forwards `PlayerOptions.playVariant`), and is otherwise classified from the chart the first time a `17` / `27` object appears.
- 750c47d: Add `resolvePlayVariantLaneChannels` to `@be-music/player-engine/core/lane-layout`: the full lane set of a chart's play variant (5 / 7 / 9 / 10 / 14 / 24 / 48 KEY) in rendering order, whether or not the chart puts notes on every lane. 9 KEY picks the PMS layout when the chart uses `22..25` and the BME layout otherwise, and lanes in use outside the variant are kept.
- 2d7652c: Charge empty POORs from the ruleset's own miss window, and surface the count.
  
  The engine hardcoded LR2's one-second early window for every ruleset and never reported the tally. It now reads the
  active ruleset's miss (`ms`) window — LR2's is early-only (`{0, 1 s}`), beatoraja's reaches 500 ms early and 150 ms
  late — and checks both neighbours of the press so the late side is honoured where a ruleset has one. Whether an empty
  POOR breaks the combo is the ruleset's call too: beatoraja's five-key and PMS rules say yes, LR2 and That-Which-Must-Not-Be-Named say no.
  
  `PlayerSummary` and the UI frame summary gain a required `emptyPoor` field. It is tracked apart from `poor` because an
  empty POOR consumes no note and never reaches EX-SCORE; whether a player's POOR counter displays the two summed is a
  presentation choice, and LR2's does (OpenLR2 `ApplyJudgeNote` increments `playerstat.poor` for it).
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
- 9505684: Play long notes the way the active ruleset does, and count their judgments accordingly.
  
  The engine used to read the chart's `#LNMODE` directly and always resolve a long note into a single combined
  judgment. It now maps the chart mode through the ruleset's long-note style first:
  
  - LR2 (`ln`) plays every long note as an LN — one deferred judgment, no CN or HCN, whatever `#LNMODE` asks for.
  - beatoraja (`per-note`) honours the chart: mode 1 is an LN, modes 2 and 3 are CN / HCN.
  - That-Which-Must-Not-Be-Named (`charge`) has no LN — every long note is a charge note (HCN where the chart says 3).
  
  Charge modes score the head on the press and the tail on the release, so one long note contributes two judgments,
  which is what `PlayerSummary.total` (the ruleset's EX-SCORE denominator) has always counted. Under That-Which-Must-Not-Be-Named a broken
  head cancels the tail (`headBadSkipsTail`).
  
  Two timing fixes fall out of this:
  
  - The tail is judged against the exact release instant instead of whichever frame noticed it. At high `speed` a frame
    can span hundreds of chart milliseconds, which quantized a clean release into a GOOD or worse.
  - Holding a charge note past its tail is no longer an immediate judgment: the player has until the tail's late window
    closes to let go, matching the play-log simulator and the reference players.
  
  The end-of-play backfill now counts unjudged notes instead of topping the tally up to `summary.total`, which was
  inventing a POOR for every That-Which-Must-Not-Be-Named charge note whose tail was cancelled.
- 1589105: Select the judged note with the ruleset's own algorithm, and add LR2's multi-BAD collector.
  
  The engine always resolved a press against the note closest in time (beatoraja's non-default `duration` behaviour).
  It now runs the active ruleset's `JudgeAlgorithm`: LR2 and That-Which-Must-Not-Be-Named use `lowest` (the oldest note in reach always wins),
  beatoraja uses `combo` (the press moves to the next note once the current one has fallen out of the late side of its
  GOOD window). LR2's `ignoreLateBadOnLnHead` is honoured too — a late BAD on a long-note head falls through instead of
  consuming the head.
  
  Under LR2, a press now also triggers lr2oraja's `MultiBadCollector`: every other unjudged note on the pressed lanes
  that sits inside the BAD window but outside the GOOD window resolves as a BAD, with the collector's own pruning for
  notes after the consumed one and for long notes before it.
  
  The selection primitives are exported from the ruleset module as `preferJudgeCandidate` and `selectJudgeCandidate`,
  and `lowerBoundBySeconds` is now exported from `@be-music/player-engine/judging`.
- 1c6e7aa: Score with the active ruleset's formula instead of an invented 200000-point curve.
  
  `summary.score` was computed from a made-up model — a 150000-point judge base plus a 50000-point combo bonus that
  capped at a combo of 10 — which matches no reference player. It now follows the ruleset:
  
  - LR2 reports its money score, `floor((4×PGREAT + 2×GREAT + GOOD) × 50000 / notes)`, capped at 200000. Purely a
    function of the judge tally: no combo term.
  - beatoraja and That-Which-Must-Not-Be-Named report EX-SCORE, which is what they display (That-Which-Must-Not-Be-Named retired its own money score in BISTROVER).
  
  `createScoreTracker` takes `{ moneyScore }`, `LR2_MONEY_SCORE_MAX` replaces `_____SCORE_MAX`, and the invented
  combo-bonus helpers are gone. The TUI result block prints the SCORE line only for rulesets that define one, and now
  also prints the empty-POOR count.
- 08e62d0: Judge with the active ruleset's signed, per-context judge windows instead of one symmetric width.
  
  The engine previously reduced every ruleset to a single `{pgreat, great, good, bad}` set of symmetric millisecond
  widths. It now reads the ruleset's four window tables — key vs scratch, note vs long-note end — and both legs of every
  window separately, so:
  
  - beatoraja's asymmetric BAD window is honoured: on a seven-key chart a press 250 ms late is a BAD, while the same
    press 250 ms early cannot reach the note at all and leaves it to miss on its own deadline.
  - Scratch lanes judge on the turntable tables (beatoraja's are 10 ms wider per judge than its key tables).
  - Long-note ends judge on the long-note-end tables, including LR2's GOOD-width release tolerance.
  - Each note's miss deadline comes from its own lane and its own chart time, so a mid-chart `#EXRANKxx` no longer needs
    a separate frozen-window cursor.
  - Mine detonation uses the GOOD window's early and late legs separately.
  
  A press that lands inside no window no longer consumes the note as a POOR — it falls through to the lane keysound and
  the empty-POOR path, which is what every reference player does.
  
  `resolveJudgeWindowsMsForRuleset` and `resolveBeatorajaJudgeRankPercent` are removed from
  `@be-music/player-engine/core/judge-window`; the per-ruleset tables live in the ruleset module, which now also exports
  `classifyRulesetJudge`, `selectJudgeWindowSet`, `judgeWindowLateReachUs`, `judgeWindowEarlyReachUs`, and
  `goodWindowReachUs`.

### Patch Changes

- f24ed8b: Detonate mines the way real LR2 does: a held crossing of the judge line, or a press within PGREAT.
  
  LR2's own changelog (the 080114 mine-implementation entry) gives two detonation conditions — passing
  a mine with the key held, or pressing within the PGREAT (ピカグレ) range — and no later entry revises
  it. The previous implementation followed losak's secondary writeup and used the GOOD window
  (±40-120 ms depending on rank) for both legs. Now the press leg uses the PGREAT window (±8-21 ms)
  and the hold-through leg anchors to the crossing itself, so a held mine can no longer slip through
  undetonated between two frame ticks when the window is narrower than the tick interval.
  `goodWindowReachUs` is renamed to `pgreatWindowReachUs` accordingly.
- b3fa635: Shorten the default POOR / miss BGA display window from 2000 ms to 500 ms, matching real LR2.
  
  LR2 ships `<poorbga>500</poorbga>` in its `config.xml` and its changelog documents 500 ms as the
  miss-BGA default, so the previous 2-second window held the miss layer four times longer than LR2.
  `DEFAULT_POOR_BGA_DISPLAY_SECONDS` is shared by the TUI compositor and the web LR2 scene, so both
  runtimes pick up the corrected timing.
- 41f5efb: Cap every inner judge window at the BAD gate under the That-Which-Must-Not-Be-Named ruleset. Classification walks PGREAT → GREAT → GOOD → BAD in order, so the uncapped GOOD window (116.67 ms) swallowed every press a `judgeWindowMs` debug override below it was meant to reject — a 50 ms override left the effective window at 116.67 ms. LR2 and beatoraja already capped; all three now share one code path.
  
  Resolve each note's miss deadline from the judge rank in force at that note's own time instead of the live window. The LR2 BAD gate is rank-invariant, so this is behaviour-neutral today; it stops a rank change from retroactively moving the deadline of already-passed notes once a ruleset whose BAD width scales with judgerank is wired in.
- 40f1050: Move the LR2 / beatoraja / That-Which-Must-Not-Be-Named ruleset tables out of the play-log simulator into a shared `src/ruleset/` module so the live engine and the simulator can resolve behaviour from one source of truth. The tables now take a neutral `RulesetChartFacts` record instead of reading a `PlaylogChart` directly, and each caller supplies an adapter — `rulesetChartFactsFromPlaylog` for recorded plays. `@be-music/player-engine/playlog` re-exports the ruleset surface unchanged, so this is behaviour-neutral for consumers.
- Updated dependencies [202a28b]
  - @be-music/chart-model@0.4.0
  - @be-music/chart-audio-renderer@0.2.4
  - @be-music/chart-parser@0.2.4

## 0.6.0

### Minor Changes

- ab210cb: Add the `@be-music/player-engine/playlog` subpath: a play-history ("playlog") format that records the resolved chart, the raw key press/release stream, and the play settings as an input replay, plus LR2 / beatoraja / That-Which-Must-Not-Be-Named ruleset simulators (`simulatePlaylog`) that re-derive judgments, EX-SCORE, max combo, money score, and groove gauge from the same recorded inputs.

  New `PlayerOptions.onPlaylogRecorded` / `PlayerOptions.recordPlaylog` enable engine-side recording for both `manualPlay` and `autoPlay` (including ESC-aborted runs), and `PlayerOptions.replayInputs` re-drives a recorded input stream deterministically for replay playback (live lane input is ignored while a replay is active). `PlayerOptions.judgeRuleset` switches the live judge windows between LR2 (default), beatoraja, and That-Which-Must-Not-Be-Named — recorded as `play.judgeRuleset` so replays re-apply the same windows — and the playlog stamps the source chart file's SHA-256 (`chart.sha256`) when the host supplies one. `ScoreTracker` now latches `maxCombo`, `resolveJudgeRankPercent` exposes the chart's initial judgerank percent, and the landmine gauge-damage rule moved to the shared `core/landmine.ts` helper.

### Patch Changes

- Bump the `node-web-audio-api` runtime dependency from `2.0.0` to `2.2.0`.

## 0.5.0

### Minor Changes

- 7bbf052: HARD / EASY / DEATH gauges now follow the LR2 tables (beatoraja GaugeProperty HARD_LR2 / EASY_LR2 / HAZARD_LR2): HARD recovers +0.1/+0.1/+0.05 with damage scaled by the #TOTAL multiplier table and softened ×0.6 under 30%; EASY damages -3.2/-4.8/-1.6 and clears at 80%; DEATH drains -10 on an empty POOR instead of dying and recovers +0.15/+0.06. Survival gauges collapse to 0% (FAILED, no recovery) below 2%, and raw deltas such as mine damage bypass the guts/TOTAL modifiers.
- 811cdfc: Judge windows are now the measured LR2 tables instead of That-Which-Must-Not-Be-Named-baseline linear scaling: #RANK 0/1/2/3 map to ±8/±15/±18/±21ms PGREAT (±24/±30/±40/±60 GREAT, ±40/±60/±100/±120 GOOD), #RANK 4 is treated as NORMAL, the BAD gate is fixed at ±200ms for every rank, and #DEFEXRANK / #EXRANKxx / bmson judge_rank interpolate piecewise-linearly between the rank anchors (lr2oraja JudgeWindowRule.LR2 model) without ever exceeding the BAD gate.
- d0bb321: Mines now follow the LR2 detonation model: a mine explodes while its lane's key is ON and the mine is within the GOOD window of the judge line — covering both presses with a mine in range and holding through a passing mine; a mine passing with the key up is harmless. Explosions only drain the gauge (raw base36 value as the damage percent, matching LR2 / beatoraja, instead of the nanasi value/2 rule) and play #WAV00 — no BAD verdict, no combo break, and mines no longer swallow presses aimed at nearby notes. Mine damage bypasses the HARD guts softening and #TOTAL multiplier; ZZ instantly fails survival gauges.

### Patch Changes

- b9922cf: Honour beatoraja bmson long-note type extensions (`info.ln_type` and per-note `t`: 1 LN / 2 CN / 3 HCN; per-note `t` wins). Charts that specify neither now default to LN (no tail release judgment, matching the LR2-aligned BMS default) instead of always being treated as CN.
- 254e213: Empty POORs (空 POOR) now follow the LR2 trigger condition: a phantom press charges only when a note on the same lane lies within the next 1 second (early side only, fixed window). Presses after a note or on lanes with no upcoming note are harmless keysound presses — previously every phantom press drained the gauge regardless of note proximity.
- ebfdba7: Bump the `node-web-audio-api` runtime dependency from 1.0.9 to 2.0.0 (semver-major). The Node audio sink now runs on the 2.x WebAudio backend with no change to the player's public API.
- ca1012c: Load `node-web-audio-api` through the SEA-aware optional-module loader. In a single executable application the bare-specifier import always fails, which permanently disabled audio playback; the player can now pick the module up from a `node_modules` directory next to the executable (or the working directory) before falling back to silent playback.
- 6ce9173: Missing, undefined, or undecodable `#WAVxx` references are now silent by default, matching LR2 / beatoraja. The synthesized sine fallback tone is opt-in via `PlayerOptions.missingSampleToneSeconds`.
- 7802f98: Fix four spec-compliance deviations found by the BMS spec audit:

  - HARD / DEATH gauges now report FAILED when they bottom out at 0 % (previously `isGrooveGaugeCleared` treated 0 % as cleared).
  - Dynamic `#EXRANKxx` (channel `A0`) values now go through the same `RANK 2 = 100` unit conversion as `#DEFEXRANK`, so `#EXRANK 100` restores exactly the NORMAL judgment width instead of widening it by 4/3.
  - bmson `key_channels[].notes[].damage` is now applied as the mine's gauge damage, taking precedence over the BMS `value / 2` rule.
  - `#SPEEDxx` now holds the first keyframe's value before its beat (Bemuse reference semantics) instead of ramping linearly from 1.0.

- Updated dependencies [b2c4f9b]
- Updated dependencies [b9922cf]
- Updated dependencies [4d5a89e]
- Updated dependencies [6ce9173]
- Updated dependencies [cdc42a1]
- Updated dependencies [ca1012c]
  - @be-music/chart-parser@0.2.3
  - @be-music/chart-source@0.2.2
  - @be-music/chart-audio-renderer@0.2.3
  - @be-music/shared-utils@0.3.0
  - @be-music/chart-model@0.3.2

## 0.4.3

### Patch Changes

- 9b7f269: Align the manual-play empty-press lane keysound fallback with LR2 / beatoraja.

  - Invisible `3x` / `4x` objects now always update a lane's current keysound during manual play, decoupled from the show-invisible debug overlay, so audio semantics no longer depend on rendering settings.
  - An empty press falls back to the latest same-lane visible/invisible keysound whose early-BAD window has already opened, instead of sounding the next pending note before its judgment window opens.

## 0.4.2

### Patch Changes

- eb92249: Drop the engine's bespoke `delayImmediate` cooperative-yield helper and route the sub-8 ms tail-spin through a dedicated `input-wakeup` primitive instead. The previous `setImmediate` / `queueMicrotask` fallback path kept appending continuations to the microtask queue when no input arrived, which dragged the loop's resident heap upward over a long session (visible as creeping `playback-state` RSS growth during multi-song TUI runs). The new wakeup module suspends on the input signal directly so an idle tail-spin holds no closures.

## 0.4.1

### Patch Changes

- 69f77d1: Two hot-loop optimisations:

  - `core/engine.ts`: hoist `resolveBmsBase(resolvedJson)` and `resolvedJson.resources.wav` out of the autoplay tick into local constants. Both fields are immutable from the autoplay entry point on, but were re-walked dozens of times per second (LN body, every triggered sample, mine resolution).
  - `judging.ts`: `lowerBoundBySeconds` now binary-searches `startIndex` when the caller declares `sortedBySeconds: true` and doesn't supply an explicit `startIndex`. Drops the per-call prefix scan from O(N) to O(log N) once the judge window opens deep into the chart.

- Updated dependencies [73dff9a]
  - @be-music/shared-utils@0.2.1
  - @be-music/chart-audio-renderer@0.2.2
  - @be-music/chart-source@0.2.1
  - @be-music/chart-parser@0.2.2
  - @be-music/chart-model@0.3.1

## 0.4.0

### Minor Changes

- 06a2db9: Add optional `PlayerOptions.playVariant` (`'5' | '7' | '9' | '10' | '14' | '24'`) so the host can pin the engine's lane mode. BME-format POPN-9 charts can now mount with the correct `f / v / g / b` bindings instead of falling back to 7-key SP.

  The player summary's `gauge` block now exposes the gauge `type` so consumers can label the clear lamp without inferring from the threshold (EASY 60 vs DEATH 0+ε collide). Long-note handling is aligned with upstream beatoraja: silent mid-hold mines, HCN gauge gain, and drain rate.

### Patch Changes

- Updated dependencies [06a2db9]
  - @be-music/chart-model@0.3.0
  - @be-music/chart-audio-renderer@0.2.1
  - @be-music/chart-parser@0.2.1

## 0.3.1

### Patch Changes

- b9a5f51: The manual LN-head path now emits `hold-lane-until-beat` for every LN start (mode 1 / 2 / 3), and `finalizeActiveLongNote` fires the matching `release-lane` at every manual LN resolution (early release, mode-1 grace expiry, or end-beat). Hosts that key LN-hold effects off those commands — previously they only arrived on the autoplay path — can now show sustain glow for a held LN and fade it at the tail.

## 0.3.0

### Minor Changes

- 5ea9072: Add `PlayerOptions.preparedChart` so the host can hand the engine a pre-built `PreparedPlaybackChartData`. When provided, `autoPlay` / `manualPlay` use it verbatim and skip the internal prepare pass; hosts that omit the option keep the prior behavior.

  Re-export `preparePlaybackChartData` and the `PreparedPlaybackChartData` type from the package root. `PlayerStateSignals` gains `drainPendingJudgeCombos()` so hosts can fan out per-judge effects for simultaneously-judged notes; the legacy `getJudgeCombo()` latch still returns the most recent state for HUD readout.

## 0.2.0

### Minor Changes

- 632f274: Honour the chart's `#BASE 62` object-ID base when resolving WAV / BMP slot IDs at playback time, so `#WAVaA` and `#WAVAA` map to distinct samples. Charts that don't declare `#BASE 62` keep the historical 36-base behaviour.

- 632f274: Engine-side gameplay improvements:

  - Landmine notes apply the chart-encoded damage value (default 4) on a manual mine hit and play `#WAV00` as the explosion sample.
  - Empty POORs (空 POOR) fire the LR2-compatible phantom-press verdict when the player presses a lane key with no note in window — drain the gauge without breaking combo or scoring, and trigger the POOR BGA swap window.
  - Opt-in Lanczos resampling for `#STAGEFILE` / `#BANNER` / `#BACKBMP` so high-res chart graphics down-scale cleanly to skin slot sizes.

- 632f274: Split the CLI / TUI frontend out of `@be-music/player-engine` into `@be-music/player-terminal`.

  `@be-music/player-engine` is now a pure playback-engine library: gameplay loop, scoring, lane layout, BGA timeline, signals, and the audio sink. New subpath exports land under `core/` (`bga-timeline`, `lane-layout`, `ui-options`) plus top-level `audio-sink`, `image-resize-algorithm`, `state-signals`, and `utils`. The `bms-player` bin and the Node-only dependencies (`libav.js`, `fast-bmp`, `fast-png`, `jpeg-js`) move to `@be-music/player-terminal`.

- 135f822: Open the engine to host-supplied runtimes so the browser player can share judging, gauging, scoring, and chart-finish semantics with the TUI.

  - `PlayerOptions.createAudioSession` — host-supplied audio backend; defaults to the bundled Node sink when omitted.
  - `PlayerOptions.createInputRuntime` / `createUiRuntime` — host-supplied DOM / runtime adapters.
  - `PlayerInputCommand.pressedAt` — wall-clock-ms timestamp on `lane-input` and `kitty-state` so the engine judges against the physical press time, not its drain time (removes up to ~16 ms of late-bias; `worker_threads`-safe via `performance.timeOrigin + performance.now()`).
  - Event-driven drain (`createInputWakeUp`) cuts the inter-tick sleep short on input arrival.
  - The engine module no longer imports from `node:path` / `node:timers/promises`; `createNodeAudioSink` is loaded lazily only when no `createAudioSession` factory is supplied, so browser bundles can import the engine as-is.

### Patch Changes

- 632f274: Resume cleanly after a `Space` pause that overlaps a `#STOP` segment. Previously the playhead froze for the rest of the stop's duration on resume because the stop-clock baseline wasn't rolled forward across the pause.
- Updated dependencies [632f274]
- Updated dependencies [135f822]
- Updated dependencies [135f822]
  - @be-music/chart-parser@0.2.0
  - @be-music/chart-model@0.2.0
  - @be-music/chart-audio-renderer@0.2.0
  - @be-music/chart-source@0.2.0
  - @be-music/shared-utils@0.2.0

## 0.1.0

### Minor Changes

- Initial release.

### Patch Changes

- Updated dependencies
  - @be-music/chart-audio-renderer@0.1.0
  - @be-music/chart-model@0.1.0
  - @be-music/chart-source@0.1.0
  - @be-music/chart-parser@0.1.0
  - @be-music/shared-utils@0.1.0
