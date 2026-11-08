# @be-music/app-play

## 0.13.1

### Patch Changes

- 7681fe4: Give Synesthesia a decide screen, and lead a RANDOM MIX result back to the select screen.
  
  - Start loading the play the moment a chart is picked on the select screen, when a decide screen follows, instead of after the select screen's launch animation, so the wait before the play is shorter.
  - Hide the site header as soon as a chart is picked instead of when the decide screen appears, so the stage no longer jumps in size in the middle of the launch animation in a window.
  - A RANDOM MIX's result now always leads back to the select screen. With Loops above 1 or Infinity in the RANDOM MIX dialog, a key on the result started the next run instead, and on AUTO its decide screen went straight on into the play, so there was no way back to the select screen. The dialog no longer asks for Loops: each RANDOM MIX is one draw, and deciding the bar again draws a new one.
- Updated dependencies: `@be-music/chart-model@0.10.0`, `@be-music/player-skin-sdk@0.11.1`, `@be-music/player-browser@0.18.0`, `@be-music/player-engine@0.17.0`, `@be-music/chart-parser@0.7.1`, `@be-music/player-scene-model@0.8.1`, `@be-music/player-ui@0.8.1`, `@be-music/skin-lr2@0.7.3`, `@be-music/skin-beatoraja@0.7.3`

## 0.13.0

### Minor Changes

- 0f3c127: Pick PRACTICE bars on the chart, set RANDOM MIX conditions, and show a camera in the BGA frame.
  
  - PRACTICE picks its range on the chart: with PRACTICE on, starting a chart opens its score, where a press on a bar plays that bar alone (another bar cuts it short), Shift or a drag picks a run of bars, and Start practice loops them (the whole chart with none picked). The dialog also sets GAUGE TYPE, GAUGE CATEGORY, GAUGE VALUE, JUDGERANK and TOTAL (saved with the settings, so it opens on the last values), and Play without practice plays the chart as a regular play this time, leaving PRACTICE on. Each chart's pick is kept for the page's life, so a retry loops the same bars. The START TIME / END TIME settings and the note-density range picker are removed from Options; settings saved with them still load.
  - The PRACTICE bar picker starts its score at measure 1 when measure 0 is empty, and a run of bars picked (Shift, a drag) now sounds whole once it settles, cutting the audition playing, as a press on one bar does.
  - The PRACTICE bar picker skips a measure 0 that only holds BGM, BGA or tempo setup. A PRACTICE play's MY BEST on the score graph now paces against the best record cut down to the bars looped (the best EX score times the share of the chart's notes in those bars) instead of the whole chart's best.
  - Deciding a RANDOM MIX bar no longer freezes the page on a large library: it used to hash every chart file and resolve every chart's tempo map at once, and now reads a chart's BPMs only when a draw walks it and hashes only the charts drawn. A RANDOM MIX now opens a dialog first that sets the key modes, a level range or the difficulties, the number of stages and the number of loops (either count can be Infinity); OK starts the mix from the charts that fit, and the dialog opens on the conditions last confirmed. An endless mix draws each stage as the run reaches it. A draw of more than five stages, or an endless one, is played without being kept as a course.
  - The dialog also sets the RANDOM MIX draw settings from Options → Course → My courses (favorite level, BPM range, max and min BPM) and, for a NONSTOP mix, the connection, and it remembers what was entered even when it is cancelled. My courses no longer lists the level limits and stage count, which the dialog now sets.
  - With the new Estimate a missing #DIFFICULTY option (on by default), narrowing by difficulty also takes a chart that names no `#DIFFICULTY`, by the difficulty the library estimates for it from its names or note count, as the select screen lists it.
  - A new Camera tab in Options shows a camera in the play's BGA frame instead of the chart's BGA, to film your hands on the keys or your face for a stream. Pick any camera (Allow camera access names them), mirror it, check it in a preview, and switch it during a play. The camera opens only during a play with the setting on, closes on every other screen, and the play falls back to the BGA when the camera is unplugged or its permission is taken back. The picture is not sent anywhere; a Capture recording includes it.
  - Charts without `#DIFFICULTY` are shown, sorted and filtered under the difficulty their subtitle, title brackets or file name suggest, else their note count gives, marked on the built-in skins with `?` (`HYPER?`) or, from the note count, `??` (`HYPER??`); LR2 and beatoraja skins draw them under that difficulty.
  - Help's Usage tab now explains the chart select search: plain text matches the title, subtitle, artist, genre or file name ignoring case, and text that starts with `?` is a chart filter (SQL `WHERE` clause with `ORDER BY` / `LIMIT`), with the columns it reads and examples that a test runs through the search. The old line said the search only covered the title, artist and genre.
  - While Play reads the Leaderboard account, the header, the start card's Leaderboard row and the Options dialog's Account field show shimmering placeholders the size of what replaces them, instead of flashing "Sign in", "Checking account…" or "Not signed in" and then shifting the layout. The start card takes the shape it had on the last visit, and the replay slots card no longer calls a slot empty before the slots have been read.
  - Options that the other options make meaningless stay in place, dimmed and disabled, instead of disappearing: the hi-speed modes' speeds, HS-FIX and Hi-speed while another mode is on, the CUSTOM JUDGE windows while it is off, EXTRA's minimum level, Scroll ADD's section lines and rate, and the long-note add rate. Turning one on no longer moves the rows under the pointer.
  - Fix skins drawing with the browser's default fonts after the player became cross-origin isolated: the service worker had cached the Google Fonts stylesheet as an opaque answer, which a COEP page cannot read back, so the stylesheet failed to load. The worker now fetches the fonts with CORS, never stores an opaque answer, treats an unreadable cache entry as a miss, and drops the old fonts cache on activation.

### Patch Changes

- Updated dependencies: `@be-music/skin-beatoraja@0.7.2`, `@be-music/skin-lr2@0.7.2`, `@be-music/service-web-theme@0.5.0`, `@be-music/player-browser@0.17.0`, `@be-music/player-engine@0.16.0`, `@be-music/player-scene-model@0.8.0`, `@be-music/player-skin-sdk@0.11.0`, `@be-music/player-ui@0.8.0`

## 0.12.0

### Minor Changes

- b46629e: Choose when plays go to the Leaderboard, and polish Options, Help and guest accounts.
  
  - Options → Leaderboard → Submit when sends a play only when its EX-SCORE improves (a chart's first play is always sent), or every time. A play that is not sent says so on the result screen.
  - Call guest accounts guests, and say that a passkey, Google or Discord keeps one.
  - The Options dialog is regrouped so each tab holds one area: Play (Judge & gauge, Arrangement, Modifiers, Assist, Practice with the tempo, Replay / ghost), a new View tab (Hi-speed, Cover & LIFT, Effects, with Judged notes and Show invisible notes moved from the skin settings), Keys, Skin, Audio, Library (loading, records, the select screen's Sort and filters, courses, capture), Leaderboard, and Advanced (formerly Developer, now with the BGA video transcode). Every setting keeps its stored value.
  - The Options dialog gives every control its own help instead of one entry shared by several (the 1P and 2P options, each compressor setting, each lane key and screen operation), shows a label's source as a badge (`Scroll` with `beatoraja`, `Normal HI-SPEED` with `AC 32 measured`), lays the 5 / 7 / 10 / 14 KEY keys out in 1P and 2P panes, and heads the Screens keys by screen.
  - The Options dialog's help: a button's "?" sits inside it, right of its label, instead of wrapping onto a line of its own below the full-width button, and the help opens in the same black tooltip, pointing at the "?", as the header's icon buttons use.
  - The Options dialog's tab bars no longer wrap onto a second line: the dialog is wide enough for them in English and Japanese, and on a screen too narrow the tab bar alone scrolls sideways and keeps the selected tab in view.
  - Help's Keyboard tab draws a Mac keyboard on macOS (its caps, modifier order and key names such as Option, Command and Return) and a Windows keyboard elsewhere, and switches between a full-size keyboard and a laptop's, which has no navigation cluster or number pad and tucks the arrows into its bottom row. It starts on a laptop on macOS and on a full keyboard elsewhere.
  - Help's Keyboard tab keeps the screen and key map pickers and the keyboard at the top of the panel while the lists of operations scroll under them, so the keyboard stays in view when pointing at a line far down the list. On a phone the screen picker scrolls sideways on its own instead of the whole panel.
  - On a laptop keyboard, Help's Keyboard tab names a key the laptop lacks by the Fn combination that gives it and lights that combination: Fn+arrows for Home, End, Page Up and Page Down, fn+delete for a Mac's forward delete, and a Windows laptop's built-in number pad in the letter keys (Fn+M for Num 0 and so on). A key no combination gives, such as Pause on a laptop or the number pad on a Mac laptop, is marked "no key".
  - The Play header shows the signed-in player's avatar beside their handle, as the other services' headers do; it was missing because the player did not pass the avatar from the Leaderboard account.
  - The dev server isolates the page with `Cross-Origin-Embedder-Policy: credentialless` instead of `require-corp`, matching the deployed player, so Google Fonts and provider avatars load in development too.
  - The dev server titles the player page and its web app manifest "Be-Music Play (Development)", so an installed development player's window tells itself apart from production and the preview.

### Patch Changes

- Updated dependencies: `@be-music/player-browser@0.16.1`, `@be-music/player-engine@0.15.1`, `@be-music/player-scene-model@0.7.0`, `@be-music/player-skin-sdk@0.10.0`, `@be-music/service-web-theme@0.4.1`, `@be-music/skin-beatoraja@0.7.1`, `@be-music/skin-lr2@0.7.1`

## 0.11.0

### Minor Changes

- f3900b2: Improve player setup, keyboard controls, and offline use.

  - Load ZIP files dropped directly onto the player or selected with Open files. Keep ZIPs nested inside dropped folders unopened unless they are dropped separately.
  - Make Be-Music Play installable with an offline app shell and an Install button. Cache the FFmpeg core and UI fonts during service-worker installation on a best-effort basis, retry missing assets on use, and request persistent storage for installed players. Keep authentication, APIs, URL-loaded archives, and the embed page outside the offline cache.
  - Replace the Debug Menu with a localized Options dialog, grouped tabs, contextual help, and lane, START / SELECT, and screen-operation key configuration. Keep settings that apply live available during play; previously saved Debug Menu settings are not migrated.
  - Show each screen's configured keys in Help's Keyboard tab. Simplify the other Help tabs and place the language switch in the dialog header.
  - Add LR2 and beatoraja screen shortcuts, including fullscreen, screenshots, frame rate display, ranking links, saved replays, chart hash copying, folder AUTO play, and confirmation before closing the player window from select. Keep the library visible and explain how to close manually when the browser refuses the close request. Use Pause or Tab to pause gameplay; Space remains the pause shortcut for an embedded AUTO preview.
  - Reload dropped folders on the select screen to pick up added, changed, or removed charts. Retain chart difficulty and level edits and gameplay skin position and scale adjustments across plays.
  - Fix Options dialog horizontal overflow, restore gameplay focus after closing dialogs, align the inline search field with the skin, and persist compressor tuning resets.
  - Refresh the start screen, header controls, tooltips, and installed-window title bar. Render state-driven UI with Lit and reuse shared service authentication and header templates.
  - Load detected skins while their confirmation is open and retain them for later selection through Options even when application is declined. Recognize standalone beatoraja JSON themes by their headers.
  - Keep Help, Settings, and Exit full screen accessible in fullscreen, in that order. Pause active gameplay while Help or Settings is open without resuming a play the user had already paused.
  - Put replay slots, course creation, and skin configuration in reusable collapsible panels with configurable positions and persistent disclosure state. Slide page controls away during gameplay.
  - Match typed search text to the skin placeholder and preserve the authored skin aspect ratio in exported screenshots.

### Patch Changes

- Updated dependencies: `@be-music/player-browser@0.16.0`, `@be-music/player-engine@0.15.0`, `@be-music/player-skin-sdk@0.9.0`, `@be-music/service-web-theme@0.4.0`, `@be-music/skin-beatoraja@0.7.0`, `@be-music/skin-lr2@0.7.0`, `@be-music/player-scene-model@0.6.1`

## 0.10.1

### Patch Changes

- 7b7bd1e: The page title and the Help dialog's title read "Be-Music Play" (they were "be-music web player" and "be-music player"), and the preview embed's label and skin author spell the product name Be-Music, matching the site header.
- 9a1f18b: The replay slots and course maker cards no longer cover the Debug Menu: overlays now stack with the site header on top, then the Debug Menu, then every other card and panel.
- 8dea69b: PRACTICE is quicker to set up and to repeat:
  
  - Debug Menu's PRACTICE folder shows the note-density graph of the chart under the cursor with a start and an end handle to drag (mouse or touch), so aiming at a passage no longer means guessing millisecond numbers. The handles snap to measure starts, the caption shows the range's times (m:ss.s) and measure numbers, and START TIME / END TIME follow the handles and the other way round. The picker shows only while PRACTICE is on and is disabled during a play like the other PRACTICE settings.
  - The play starts one bar before the bar the range starts in and loops one bar after the bar it ends in, instead of 1000 ms on either side, so each loop comes back in time with the music.
  - Loops no longer show NOW LOADING: when the range ends, it plays again at once in the same play screen, without decoding the chart's samples again, until ESC.
- d07b3a2: Quick retry (F5, and R on the result screen) of a chart with many samples reaches its first note much sooner: its decoded samples are kept from the play before, so NOW LOADING no longer waits for them to decode again. The retry is still a fresh play with a new replay and RANDOM draw. The kept samples are freed on going back to the select screen, on starting another chart and when the page is left (`pagehide`).
- Updated dependencies: `@be-music/player-browser@0.15.0`, `@be-music/player-engine@0.14.0`, `@be-music/player-scene-model@0.6.0`, `@be-music/player-skin-sdk@0.8.0`, `@be-music/skin-beatoraja@0.6.1`, `@be-music/skin-lr2@0.6.1`

## 0.10.0

### Minor Changes

- 1b8b0b6: New play option Debug Menu → Play options → **ANY KEY (PC)** (off by default, shown with the ???? judge rules only): whichever key you press takes the nearest note on any lane, the scratch included, and a long note stays held until that key is released. As on the PC edition, a play with it saves no record and is stored unranked on the Leaderboard. It is disabled during a play, and a replay plays back with the switch it recorded.
- 64ccdf5: The player now keeps a dan rank: clearing a GRADE course named after a dan (`七段`, `発狂皆伝`, …) keeps the highest dan per judge ruleset and key mode, and the select screen of a be-music skin shows it. Only runs played from now on count; earlier course records are not read back.
- 3274fae: New replay ghost in Debug Menu → Play options → Replay / ghost (off by default):
  
  - **Ghost** picks the replay: OFF, OWN BEST (the chart's replay slot with the highest EX score), REPLAY SLOT 1-4, LEADERBOARD TOP (the replay of the chart's top run under your ruleset) or REPLAY FILE, chosen with **Ghost replay file…**.
  - **Ghost mode** picks how it shows: SECOND PLAYFIELD (beside the play on the built-in skins, for 5 / 7 KEY single play), PACEMAKER (the ghost's EX score at the notes you have judged, as the score graph's pacemaker and the target numbers on every skin family), or PACEMAKER + LANES (the pacemaker with the ghost's key presses and judgments over your own lanes on the built-in skins).
  - **Ghost status** says whether the chart under the cursor can show the pick and why not.
  
  The ghost never touches your records, replays or Leaderboard submission. Its controls are disabled during a play and on a course.

### Patch Changes

- 35ef882: The embed preview's ← / → seek five seconds only during AUTO play, as the main play does, and no longer seek while the viewer plays (`mode=play`). Help says the arrows seek in AUTO play.
- 232d977: Assisted plays no longer raise local best scores. Each play is recorded by its judge ruleset's assist rule: an assisted play moves only its limited lamp and its play count, LR2's D-BATTLE, SP TO DP and EXTRA MODE keep a lamp of their own, a `no-save` play (That-Which-Must-Not-Be-Named's BATTLE) keeps nothing, and an assisted course stage or run leaves the records alone. A play given up with ESC is recorded once its replay is ready, so the same rule applies to it. Records stored before this change keep their values.
- 539a2cb: The built-in play screen shows the signed-in Leaderboard account's name.
- 05b661c: A GRADE / EXPERT course stage no longer updates the record of a chart whose NOTES COPY makes it a double-play chart outside the course, because the stage plays it single.
- 8507c15: Courses you made can be registered for IR, from an LR2 skin's button 253 or the My courses dialog (after a confirmation), so their runs are ranked; a registered course's connections and constraints can no longer be changed. Courses saved without the flag now read back unregistered rather than ranked, so no course turns read-only without being registered.
- 20108bc: The collapsed Debug Menu keeps its normal width on phones instead of a separate 116px width. During play it still shrinks to the corner tab so it does not cover Pause.
- f68bc6a: Dragging a chart onto the player no longer lights a frame around the stage. The drop card is the only reaction.
- f4574b5: The Help dialog no longer jumps and recenters when the open-source license list replaces the loading line.
- de3e70e: The player shell, sign-in, loading, course maker, replay prompts and embed preview follow the browser language, in Japanese and English.
- 1b58c1b: Old local saves are ignored: replay slots, made courses, skin settings, chart best records, and debug menu settings are written as version 0, and any other version is treated as absent.
- e90a500: The player shows a Beta badge beside its title and in the corner of the embed preview, and the start screen and Help say Public Beta and that data may be deleted without notice, in English and Japanese.
- e15d741: The Debug Menu offers play options under every judge ruleset instead of only their source's:
  
  - Every lane and battle option, grouped by source with the ruleset's own first: RANDOM, S-RANDOM and CONVERGE once per source (RANDOM (LR2), RANDOM (beatoraja), ...), BATTLE (LR2) two-player play also under beatoraja rules, and BATTLE (beatoraja) and BATTLE (????) apart. Saved settings with a bare RANDOM, S-RANDOM, CONVERGE or BATTLE are read as the qualified value of the ruleset they were saved with.
  - ADD LN / CN / HCN / ALL and their add rate.
  - Seed 1P / 2P, since every lane option is now seeded.
  - PRACTICE: GAUGE TYPE lists the ruleset's own gauges, GAUGE CATEGORY shows under beatoraja only, and JUDGERANK and TOTAL hide under AC.
  - Gauge auto-shift, whose lowest gauge reads as the ruleset's gauges (EASY or GROOVE under LR2).
  
  The Leaderboard status line names the rulesets that judged a play only up to its failure or could not judge it at all.
- 9d2a360: The player uses the shared site header and stays dark. The play header spans the viewport, with the brand at the left edge and the actions at the right. Settings sits where other sites put Play and toggles the Debug Menu, and a fullscreen button sits beside it. Fullscreen covers the play surface with the Debug Menu inside it, which fullscreen used to hide, and leaves the site header and footer outside it.
- 07c2cf3: Dropping charts hashed every chart in the library again to match courses, even with no course to match. It now hashes them only when a course with fixed stages needs them, which took about 17% off loading a 34-track folder.
- 35ef882: Google and Discord in the player's sign-in and sign-up dialogs were disabled and labelled coming soon, so they now start Accounts the same way a passkey does. Each button shows its provider's mark (a Google G, the Discord logo, a passkey) beside the label, and the Google and Discord buttons no longer sit flush against each other.
- 9935868: The player loads only the web fonts a skin draws with (Orbitron and M PLUS 1p for Synesthesia), no longer Anton, Azeret Mono, Dela Gothic One, Inter, LINE Seed JP or Michroma, and the page uses the system faces in place of Geist.
- Updated dependencies: `@be-music/chart-model@0.9.0`, `@be-music/chart-parser@0.7.0`, `@be-music/chart-source@0.7.0`, `@be-music/player-browser@0.14.0`, `@be-music/player-engine@0.13.0`, `@be-music/player-scene-model@0.5.0`, `@be-music/player-skin-sdk@0.7.0`, `@be-music/service-web-theme@0.3.1`, `@be-music/skin-beatoraja@0.6.0`, `@be-music/skin-lr2@0.6.0`

## 0.9.0

### Minor Changes

- 100ff94: The embed can switch between the AUTO preview and the viewer's own play without changing `?mode=`: an **AUTO** checkbox sits in the chart list's header and under the play button of a single chart, starting from `?mode=`. Changing it under the play button loads the play again in the other mode.
- 7d04409: On a phone or tablet, and wherever the browser asks to save data, the embed no longer starts downloading the track as soon as it opens: it shows a **Load** button with the archive's file name and size, and downloads once it is pressed.

### Patch Changes

- 8710db8: The embed's lanes now reach down to just above the seek bar without running under it: on a phone held upright they stopped well short, on a phone held sideways the judgement line sat under the seek bar, and a DP chart on a phone held upright had the controls over its lanes.
- Updated dependencies: `@be-music/player-browser@0.13.2`

## 0.8.1

### Patch Changes

- ba88581: A tap or click on the stage no longer pauses the viewer's own play in the embed (`mode=play`): it is part of playing, not a request to stop. Pause with the controls bar or the play's pause key instead. The AUTO preview still pauses and resumes on a click.
- dd39de0: A phone or tablet had no way to leave an embed's play for the chart list before the chart ended, since Escape is its only exit. A paused play now shows **Back** under the play button, which leaves the play for the list (or the replay button).
- Updated dependencies: `@be-music/player-browser@0.13.1`

## 0.8.0

### Minor Changes

- 5578573: The embed can now let the viewer play a chart instead of only previewing it: add `mode=play` to `/embed/?track=…` to play with the default lane keys, judged as a normal play without seeking. While playing, M and F are lanes, so the mute and full-screen shortcuts apply only before the play starts. `mode=preview` or no `mode` keeps the AUTO preview. Neither mode records a replay or score.

### Patch Changes

- Updated dependencies: `@be-music/chart-model@0.8.0`, `@be-music/player-browser@0.13.0`, `@be-music/player-engine@0.12.0`, `@be-music/chart-parser@0.6.0`, `@be-music/chart-source@0.6.0`, `@be-music/shared-utils@0.7.0`, `@be-music/player-skin-sdk@0.6.0`, `@be-music/player-scene-model@0.4.0`, `@be-music/skin-lr2@0.5.0`, `@be-music/skin-beatoraja@0.5.1`

## 0.7.0

### Minor Changes

- 1b43203: Add **BPM change warning (AC)** to Debug Menu → Play options, saved with the other settings and described in the Help.
- 566afa7: Replay a whole course from its course replay: dropping a `*.bmcourse.json` (or picking it with Open files) plays the recorded run back as its course once every stage chart is loaded, each stage from its own replay with its recorded carry-in, showing each stage's result and the course result, and stopping where the run stopped. A NONSTOP run plays its stitched replay as one chart. A course replay keeps no record, saves no replay and submits nothing to the Leaderboard, and a dialog lists the stage charts that are missing. A dropped `*.bmplay.json` whose chart is not loaded now names it in the same dialog and returns to the select screen, instead of leaving the screen blank.
- 5a303ce: Add the embed page `/embed/?track=<URL>`, a preview of a chart archive for iframes. A track with several charts lists them with each chart's `#STAGEFILE` (or its `#BANNER`), a single chart (or the one `&chart=<file name or path>` names) waits behind a play button, and the chart plays in AUTO with the lanes on the left and the BGA as large as fits beside them (above them on a tall screen), with the play status beside or under it. Video-player controls (a thin seek bar, mute with a volume slider, full screen, a click on the picture to play or pause, keyboard shortcuts) fade out with the pointer after 3 seconds without input during a play. A progress bar shows the download and the reading of the charts. Like a video, the preview plays its sound with an iPhone or iPad in silent mode. A play ends back on the list, or on a replay button.
  LR2 and beatoraja course files inside the archive can be previewed with `course` and an optional `courseName`: EXPERT and GRADE stages play in order with carried gauge and combo, and LR2 NONSTOP courses are stitched as in the player.
- 082f08e: Add **Local data…** to Debug Menu → Library & records: a read-only view of what the player keeps in this browser (its `localStorage` keys, its IndexedDB databases with their records, and the storage estimate), with each value shown on demand and a replay slot's compressed replay readable as JSON.
- 1d82191: Add LR2's RANDOM MIX bar to MY COURSES and MY NONSTOP: deciding it draws a course from the library by the RANDOM MIX settings in the key filter's key mode and plays it (AUTO plays it on AUTO), keeping the draw as the folder's newest course `RANDOM MIX` until the next draw replaces it. The settings are edited with an LR2 skin's buttons 260-266 or in Debug Menu → Course → My courses…, and are kept in this browser with the courses.
- 54698f1: Keep up to four replays per chart and per course in the browser, as beatoraja does: save a play into a slot on its result screen (keys 1-4, a beatoraja skin's replay buttons, or the replay-slot card on the built-in, Native and LR2 skins), give each slot an auto-save rule in Debug Menu → Library & records → Replay slots (by default slot 1 keeps the best EX score, slot 2 the best clear lamp, slot 3 the fewest BP and slot 4 the latest play), and replay a slot from the select screen. Replays are stored gzip-compressed in their own IndexedDB database (`be-music-replays`) under a 500 MB budget; past it the lowest-scoring replays are removed first.
- dea04e3: With Submit to Leaderboard on, a play at another tempo (finished or given up with ESC), a course run with a stage at another tempo and a run of a made or random course are now sent instead of skipped, and the status line says when the Leaderboard stored one without ranking it (#788). Fully AUTO plays and replay playback are still not sent.
- 04cb631: Offer Native (DOM screens around a canvas playfield) alongside the Canvas skins in the built-in skin picker. Search shortcuts go to its search input, and the double-click fullscreen toggle and the phone's first-tap fullscreen work on its screens.
  Group skin settings into Built-in, LR2 and beatoraja tabs and confirm detected skin imports before switching, keeping the current skin when canceled while still importing dropped charts.
- 7b27393: Replace lil-gui with Tweakpane throughout the Debug Menu and skin configuration. Use native action buttons, read-only multiline status monitors, an FPS history graph, mutable theme lists, and tabbed skin options with 2D position controls. Preserve remembered folder states, live settings, play-time locks, and recording feedback.

### Patch Changes

- 745a0db: Display `????` in the judgment ruleset selector and store new best records under `____`.
- 823a99e: The player's HTML chrome (dialogs, buttons, cards, inputs, the embed overlay, drop, help, search and the Debug Menu) uses Basecoat and its primary and destructive colors, the same components as the other services, instead of the old gold accent. The playfield stays on the skin.
- a82ec63: Allow intended-placement NONSTOP courses to include bmson stages and identify the mixed stitched play as a bmson chart.
- 48f2fe2: Type `?` and an SQL filter in the select screen's search to list the charts it selects, such as `?level >= 12 AND score.clear < 5` (beatoraja's random-course filters, with `score.` and `information.` columns). While the filter does not parse, the search field is marked and the reason shows under it. Random courses now filter by the player's best records too.
- 95cdf96: Remember every Debug Menu setting immediately, and restore it after Safari deletes script-written storage. Keep reset retries across visits, prevent late responses from reverting edits, and persist individual skin resets.
  Move settings, best records and saved courses from the former demo storage namespace to the player's without overwriting current data.
- 732ee96: A single play quit with ESC is now saved as a FAILED play, as LR2 and beatoraja save one, and sent to the Leaderboard: before, it returned to select with no record. Every play's BP now also counts the notes it never judged, so a play that dies early no longer lowers the best BP; existing records are left as they are.
- b3f593e: Wire LR2 and beatoraja theme stop sounds into gameplay so failed stages play their stop cue.
- 1f4944a: beatoraja Lua skins spend less time per frame: the bundled fengari-web is patched to clear Lua stack slots by assignment instead of `delete`, which left the stack array holey on every call and return. Evaluating ModernChic's per-frame Lua functions takes about 2.3x less time on the play skin and 3.2x less on the music select skin.
- c67a1af: Show the shared service footer on the player's start screen, and leave the help overlay's build line at the bottom of that dialog.
- cf6ed23: Rework the Help:
  
  - Usage covers Native, the 2P seventh key, PMS keys, the lane cover keys, seeking, courses and saved settings. It had still listed two built-in skins and six 2P keys.
  - A new Options tab describes every Debug Menu control folder by folder, the play options included, and when each control appears.
  - Open source lists the third-party packages the build actually includes, read from the bundled modules (with the stylesheet's frameworks and the served ffmpeg core), instead of walking dependencies: packages it missed (Lit, fengari, alien-signals, Tailwind CSS, Basecoat) are listed, type-only and tree-shaken packages are not, and packages that publish no LICENSE file show their upstream text (@ffmpeg/core's says where its GPL source is). Each license text starts folded, and the list loads when the tab opens.
- 031f430: Keep successful random-course draws as fixed bars in their source folders, with local timestamps and unique identifiers, so the same stages can be played again. Retain the latest 100 draws for the session and return the cursor to the new bar.
- 5bde3c2: Skin system stays available during a play and swaps the drawing family without ending the chart, and so does dropping an LR2 or beatoraja skin during a play; a drop that also brings charts still returns to the select screen. The other skin controls stay disabled during a play, and the select screen uses the new family when the play returns.
- 7a6fb92: Debug Menu's **Auto judge timing** picks OFF, beatoraja's calibration, or LR2's ON or SILENT under every judge ruleset, and **Judge timing (ms)** is the timing both move. The Help describes the modes (#777).
- fdf75c4: Add a Debug Menu Audio switch, Peak gain (next play), that stays off until it is turned on for the visit.
- e091cfa: Starting a chart with a lane option that does not fit it (for example beatoraja CONVERGE on a 7KEY chart) no longer leaves the play screen black: a dialog names the option, and closing it goes back to the select screen to change it.
- 9995058: Expose every new play option in Debug Menu with saved preferences, offering each ruleset its own choices and locking the ones a running play cannot change: HS-FIX including START BPM (kept in sync with the select screens), the four AC 34 display-area information choices and the per-side cover settings, independent AUTO SCRATCH sides, the source-specific LEGACY NOTE and LN REMOVE, AC 34's A-SCR & LEGACY NOTE preset in one action, EX-HARD for beatoraja and AC rules with HAZARD labelled apart, ASSIST EASY for beatoraja and ASSISTED EASY for AC rules, and the other judgment, hi-speed, view, arrangement, modifier, gauge, battle and PRACTICE options.
  The options that only transform the chart or the view are offered under every judge ruleset and kept when Judgment windows changes: HS-FIX CONSTANT, CLASSIC / Normal / FLOATING HI-SPEED and the fixed display area, scroll and mine modifiers, both EXTRAs, 7 TO 9, BATTLE AS / D-BATTLE / SP TO DP, the source-specific lane options, SYNCHRONIZE / SYMMETRY RANDOM, M-RAN, and Reuse previous arrangement (for a play under the same rules). Choices the new ruleset does not support are reset (#774).
  A replay restores each recorded AUTO SCRATCH side on its own, and an older replay's combined switch applies to both sides.
  A battle mode plays on the converted chart's LR2 play skin, PRACTICE starts again after each run, and a two-player result stays out of the records and the Leaderboard while its replay is still saved.
- 283d6ba: Drop the hidden Phantom and Lattice skins and the "Add Lattice" button. "Add skin" (a skin module from a URL) stays hidden behind `ADD_SKIN_ENABLED`.
- e973ff7: Add a persistent Audio mute switch that silences all player sounds while retaining the master volume setting.
- 24ac39a: Keep bulk chart imports, ZIP expansion, and WSOLA time stretching off the main thread. Add a persistent Debug Panel CPU worker setting, defaulting to half the browser-reported logical CPU count, rounded down with a minimum of one.
  
  Add a persistent Tempo enable switch that bypasses the saved percentage when off, and make WSOLA the default and first keep-pitch algorithm.
- Updated dependencies: `@be-music/skin-beatoraja@0.5.0`, `@be-music/player-engine@0.11.0`, `@be-music/player-browser@0.12.0`, `@be-music/chart-model@0.7.0`, `@be-music/chart-parser@0.5.0`, `@be-music/chart-source@0.5.0`, `@be-music/player-scene-model@0.3.0`, `@be-music/skin-lr2@0.4.0`, `@be-music/player-skin-sdk@0.5.0`, `@be-music/service-web-theme@0.3.0`, `@be-music/shared-utils@0.6.0`

## 0.6.1

### Patch Changes

- 7a10f67: Display the build timestamp and source revision in the start-card and help footers without covering the playfield.
  
  Rename the package from `@be-music/player-web-demo` to `@be-music/app-play` to identify its role consistently. Update imports and package filters to the new name.
- ad210fa: Use chart-based navigation, image, and best-record names, and replay terminology for saved recording data and controls. Update the test hook to expose chart bars and chart counts consistently.
  
  Align help, course messages, loading statuses, and replay controls with the chart and replay vocabulary.
- Updated dependencies: `@be-music/skin-beatoraja@0.4.0`, `@be-music/chart-model@0.6.0`, `@be-music/chart-parser@0.4.0`, `@be-music/chart-source@0.4.0`, `@be-music/skin-lr2@0.3.0`, `@be-music/player-engine@0.10.0`, `@be-music/player-browser@0.11.0`, `@be-music/player-scene-model@0.2.0`, `@be-music/player-skin-sdk@0.4.0`, `@be-music/service-web-theme@0.2.0`

## 0.6.0

### Minor Changes

- 8a051a5: Offer course playback, recording, Accounts sign-in and Leaderboard submission in the browser player.
  
  - Load LR2/beatoraja courses and difficulty-table courses, create and persist EXPERT/NONSTOP/GRADE courses, edit constraints and connections, and export course files. New user-created courses start unranked.
  - Submit eligible manual single plays and complete course runs to Leaderboard, retain local records, and replay or retry with the recorded mode and random outcomes.
  - Add tempo/pitch controls, persistent hi-speed, automatic render-resolution selection, MP4/WebM recording and silent-mode audio support on compatible mobile browsers.
  - Consolidate the start screen, provide in-place chart search only on the select screen, and organize everyday settings in the Debug Menu.
  - Preserve recordings, browse selection, records and scene flow across retries, drops, reloads and theme changes.
  - Open Accounts for sign-in and account management, and link rankings to the Leaderboard host of the same environment.
  
  The deployment Worker is provided by `@be-music/worker-play`.

### Patch Changes

- Updated dependencies: `@be-music/skin-beatoraja@0.3.0`, `@be-music/chart-model@0.5.0`, `@be-music/chart-source@0.3.0`, `@be-music/skin-lr2@0.2.0`, `@be-music/chart-parser@0.3.0`, `@be-music/player-engine@0.9.0`, `@be-music/player-browser@0.10.0`, `@be-music/player-scene-model@0.1.0`, `@be-music/player-skin-sdk@0.3.0`
## 0.5.0

### Minor Changes

- The demo now plays on phones and tablets: touch-first devices default the skin effects to Reduced, play with the touch layout (Debug Menu "Play layout": Auto / Desktop / Touch), show pause and quit buttons during play, ask for fullscreen and landscape on a phone's first tap, and block pinch zoom and double-tap fullscreen during play. The Help button and search box no longer sit on top of the play screen.
  
  Be-music skins get more from the demo:
  
  - A Skin settings folder in the Debug Menu, built from the active skin's settings schema; values are stored per skin and apply at once, with a reset button.
  - A skin's decide screen is shown between select and play when the skin defines one.
  - A best record per chart (lamp, EX score, max combo, fewest misses, play count) is kept in localStorage and handed to the select skin.
  
  Play-history auto-save is now off by default.

### Patch Changes

- dc99100: Large folder drops reach the song list faster because the demo now hands song-bundle files to the collection loader unopened and only opens theme files before mounting a theme.
- 7051b53: Phones held upright no longer get the rotate prompt on screens drawn on the skin's portrait stage (Synesthesia), only where the screen stays landscape (other skins, double play, 24 / 48 KEY). During play the collapsed Debug Menu shrinks to its chevron, so it stays off the skin's header.
- Updated dependencies: `@be-music/player-browser@0.9.0`

## 0.4.0

### Minor Changes

- The demo's Debug Menu gains controls for the new player features, and the page is easier to use full screen.
  
  - A built-in skin picker (Synesthesia by default), a _Skin effects_ level, and an _Add skin_ folder that adds the optional Lattice skin or a skin module from a URL (after a trust prompt); every registered skin's fonts are preloaded so its first frames don't fall back to another face.
  - Volume and compressor sections: master, keysound, and BGM volume, plus live tuning of the key, BGM, master, and legacy compressors.
  - Double-clicking the canvas toggles fullscreen, and the help button sits centred along the bottom edge.

### Patch Changes

- Updated dependencies: `@be-music/player-browser@0.8.0`, `@be-music/skin-lr2@0.1.6`, `@be-music/skin-beatoraja@0.2.0`

## 0.3.2

### Patch Changes

- Updated dependencies: `@be-music/skin-lr2@0.1.5`, `@be-music/player-browser@0.7.0`

## 0.3.1

### Patch Changes

- Updated dependencies: `@be-music/player-browser@0.6.2`, `@be-music/skin-lr2@0.1.4`, `@be-music/skin-beatoraja@0.1.2`

## 0.3.0

### Minor Changes

- 9b7f269: Cloudflare Workers hosting and URL-based archive auto-load for the demo.

  - Serve the built SPA from Workers Static Assets and stream the ~31 MB ffmpeg.wasm core (over the 25 MiB per-file asset limit) from an R2 bucket through the Worker.
  - `deploy:cf` runs an md5-gated R2 sync before `wrangler deploy`, re-uploading the wasm core only when `@ffmpeg/core` actually changed (`cf:r2:push` forces an upload); CI keeps using `build:cf` + `wrangler deploy` and never touches R2.
  - Open the page with `?music=https://…/song.zip` and/or `?skin=https://…/theme.zip` to auto-load a chart archive and apply a skin at boot — the archive's charts are listed in the select screen. Cross-origin archive links are fetched through the demo proxy and must use HTTPS.

### Patch Changes

- Updated dependencies: `@be-music/player-browser@0.6.1`

## 0.2.7

### Patch Changes

- a36c2b1: Update the demo shell for the rearranged default gameplay layout (`index.html` / `styles.css`) and follow the new chrome-injection seam in `main.ts`.
- Updated dependencies: `@be-music/player-browser@0.6.0`

## 0.2.6

### Patch Changes

- Updated dependencies: `@be-music/player-browser@0.5.1`

## 0.2.5

### Patch Changes

- 69f77d1: `discoverLr2Themes` scopes its return to `LR2files/Theme/<name>/`, which dropped shared `LR2files/` siblings (`WallPaper/`, `Bgm/`, `Sound/`, …) from the file list handed to the skin loader. The LR2 default select skin references its backdrop via the wildcard `LR2files/WallPaper/Select/*.bmp`; without the siblings the lookup failed and the select scene painted black. Union the theme's own files with all other files under `LR2files/` that aren't part of any other theme subtree, so wildcard `#CUSTOMFILE` assets resolve as before.
- Updated dependencies: `@be-music/player-browser@0.5.0`, `@be-music/skin-lr2@0.1.3`, `@be-music/skin-beatoraja@0.1.1`

## 0.2.4

### Patch Changes

- b826a39: Help modal now documents beatoraja skin support alongside Lunatic Rave 2. The verified-skin note lists LR2 default, beatoraja default (`skin/default`), `ModernChic`, and `GdbG Original Skin`. "LR2 skin's PLAY / PLAY OPTION" wording is generalized to "the active skin's" since both rendering paths surface those buttons. Mirrored across the English and Japanese help panes.

## 0.2.3

### Patch Changes

- 06a2db9: Add a beatoraja-theme path alongside LR2 themes: a "Beatoraja preview" folder in the debug menu, a variant dropdown (`7` / `5` / `14` / `10` / `9`), and an "Open preview" button that mounts `BeatorajaPlaySkinPreviewScene`. Texture caches are memoized per entry path, and skin-options panel state persists across mid-edit `replaceSkin` round-trips.

- Updated dependencies: `@be-music/skin-beatoraja@0.1.0`, `@be-music/player-browser@0.4.0`, `@be-music/skin-lr2@0.1.2`

## 0.2.2

### Patch Changes

- Updated dependencies: `@be-music/player-browser@0.3.1`

## 0.2.1

### Patch Changes

- Updated dependencies: `@be-music/player-browser@0.3.0`

## 0.2.0

### Minor Changes

- 632f274: Initial Vite-based demo shell that wires `@be-music/player-browser` into a single-page app, with a lil-gui settings panel, a drop overlay, a browser-compatibility check panel, and a Help dialog (usage guide plus the Open-Source attribution list resolved at build time).

- 135f822: The shared-engine path is the only playback path; the `useSharedEngine` opt-in flag and its Debug Menu checkbox are removed.

### Patch Changes

- Updated dependencies: `@be-music/player-browser@0.2.0`, `@be-music/skin-lr2@0.1.1`
