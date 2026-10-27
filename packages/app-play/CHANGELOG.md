# @be-music/app-play

## 0.7.0

### Minor Changes

- f9c1c24: Add **BPM change warning (AC)** to Debug Menu → Play options, saved with the other settings and described in the Help.
- a92aaa4: Replay a whole course from its course replay: dropping a `*.bmcourse.json` (or picking it with Open files) plays the recorded run back as its course once every stage chart is loaded, each stage from its own replay with its recorded carry-in, showing each stage's result and the course result, and stopping where the run stopped. A NONSTOP run plays its stitched replay as one chart. A course replay keeps no record, saves no replay and submits nothing to the Leaderboard, and a dialog lists the stage charts that are missing. A dropped `*.bmplay.json` whose chart is not loaded now names it in the same dialog and returns to the select screen, instead of leaving the screen blank.
- 9768d05: Add the embed page `/embed/?track=<URL>`, a preview of a chart archive for iframes. A track with several charts lists them with each chart's `#STAGEFILE` (or its `#BANNER`), a single chart (or the one `&chart=<file name or path>` names) waits behind a play button, and the chart plays in AUTO with the lanes on the left and the BGA as large as fits beside them (above them on a tall screen), with the play status beside or under it. Video-player controls (a thin seek bar, mute with a volume slider, full screen, a click on the picture to play or pause, keyboard shortcuts) fade out with the pointer after 3 seconds without input during a play. A progress bar shows the download and the reading of the charts. Like a video, the preview plays its sound with an iPhone or iPad in silent mode. A play ends back on the list, or on a replay button.
  LR2 and beatoraja course files inside the archive can be previewed with `course` and an optional `courseName`: EXPERT and GRADE stages play in order with carried gauge and combo, and LR2 NONSTOP courses are stitched as in the player.
- cd8cae6: Add **Local data…** to Debug Menu → Library & records: a read-only view of what the player keeps in this browser (its `localStorage` keys, its IndexedDB databases with their records, and the storage estimate), with each value shown on demand and a replay slot's compressed replay readable as JSON.
- cc1495f: Add LR2's RANDOM MIX bar to MY COURSES and MY NONSTOP: deciding it draws a course from the library by the RANDOM MIX settings in the key filter's key mode and plays it (AUTO plays it on AUTO), keeping the draw as the folder's newest course `RANDOM MIX` until the next draw replaces it. The settings are edited with an LR2 skin's buttons 260-266 or in Debug Menu → Course → My courses…, and are kept in this browser with the courses.
- d0939cc: Keep up to four replays per chart and per course in the browser, as beatoraja does: save a play into a slot on its result screen (keys 1-4, a beatoraja skin's replay buttons, or the replay-slot card on the built-in, Native and LR2 skins), give each slot an auto-save rule in Debug Menu → Library & records → Replay slots (by default slot 1 keeps the best EX score, slot 2 the best clear lamp, slot 3 the fewest BP and slot 4 the latest play), and replay a slot from the select screen. Replays are stored gzip-compressed in their own IndexedDB database (`be-music-replays`) under a 500 MB budget; past it the lowest-scoring replays are removed first.
- 6a447df: With Submit to Leaderboard on, a play at another tempo (finished or given up with ESC), a course run with a stage at another tempo and a run of a made or random course are now sent instead of skipped, and the status line says when the Leaderboard stored one without ranking it (#788). Fully AUTO plays and replay playback are still not sent.
- 74127d3: Offer Native (DOM screens around a canvas playfield) alongside the Canvas skins in the built-in skin picker. Search shortcuts go to its search input, and the double-click fullscreen toggle and the phone's first-tap fullscreen work on its screens.
  Group skin settings into Built-in, LR2 and beatoraja tabs and confirm detected skin imports before switching, keeping the current skin when canceled while still importing dropped charts.
- a27908a: Replace lil-gui with Tweakpane throughout the Debug Menu and skin configuration. Use native action buttons, read-only multiline status monitors, an FPS history graph, mutable theme lists, and tabbed skin options with 2D position controls. Preserve remembered folder states, live settings, play-time locks, and recording feedback.

### Patch Changes

- a83e326: Display `????` in the judgment ruleset selector and store new best records under `____`.
- e95c9bb: The player's HTML chrome (dialogs, buttons, cards, inputs, the embed overlay, drop, help, search and the Debug Menu) uses Basecoat and its primary and destructive colors, the same components as the other services, instead of the old gold accent. The playfield stays on the skin.
- 69df53c: Allow intended-placement NONSTOP courses to include bmson stages and identify the mixed stitched play as a bmson chart.
- a8896a9: Type `?` and an SQL filter in the select screen's search to list the charts it selects, such as `?level >= 12 AND score.clear < 5` (beatoraja's random-course filters, with `score.` and `information.` columns). While the filter does not parse, the search field is marked and the reason shows under it. Random courses now filter by the player's best records too.
- 4a4b111: Remember every Debug Menu setting immediately, and restore it after Safari deletes script-written storage. Keep reset retries across visits, prevent late responses from reverting edits, and persist individual skin resets.
  Move settings, best records and saved courses from the former demo storage namespace to the player's without overwriting current data.
- 911cbe7: A single play quit with ESC is now saved as a FAILED play, as LR2 and beatoraja save one, and sent to the Leaderboard: before, it returned to select with no record. Every play's BP now also counts the notes it never judged, so a play that dies early no longer lowers the best BP; existing records are left as they are.
- 85f13dc: Wire LR2 and beatoraja theme stop sounds into gameplay so failed stages play their stop cue.
- 8c7b28e: beatoraja Lua skins spend less time per frame: the bundled fengari-web is patched to clear Lua stack slots by assignment instead of `delete`, which left the stack array holey on every call and return. Evaluating ModernChic's per-frame Lua functions takes about 2.3x less time on the play skin and 3.2x less on the music select skin.
- 17aebd5: Show the shared service footer on the player's start screen, and leave the help overlay's build line at the bottom of that dialog.
- 3e694df: Rework the Help:
  
  - Usage covers Native, the 2P seventh key, PMS keys, the lane cover keys, seeking, courses and saved settings. It had still listed two built-in skins and six 2P keys.
  - A new Options tab describes every Debug Menu control folder by folder, the play options included, and when each control appears.
  - Open source lists the third-party packages the build actually includes, read from the bundled modules (with the stylesheet's frameworks and the served ffmpeg core), instead of walking dependencies: packages it missed (Lit, fengari, alien-signals, Tailwind CSS, Basecoat) are listed, type-only and tree-shaken packages are not, and packages that publish no LICENSE file show their upstream text (@ffmpeg/core's says where its GPL source is). Each license text starts folded, and the list loads when the tab opens.
- db37600: Keep successful random-course draws as fixed bars in their source folders, with local timestamps and unique identifiers, so the same stages can be played again. Retain the latest 100 draws for the session and return the cursor to the new bar.
- a95c53c: Skin system stays available during a play and swaps the drawing family without ending the chart, and so does dropping an LR2 or beatoraja skin during a play; a drop that also brings charts still returns to the select screen. The other skin controls stay disabled during a play, and the select screen uses the new family when the play returns.
- bc52a10: Debug Menu's **Auto judge timing** picks OFF, beatoraja's calibration, or LR2's ON or SILENT under every judge ruleset, and **Judge timing (ms)** is the timing both move. The Help describes the modes (#777).
- 0b4e3c4: Add a Debug Menu Audio switch, Peak gain (next play), that stays off until it is turned on for the visit.
- 1e62cb3: Starting a chart with a lane option that does not fit it (for example beatoraja CONVERGE on a 7KEY chart) no longer leaves the play screen black: a dialog names the option, and closing it goes back to the select screen to change it.
- b09a6cf: Expose every new play option in Debug Menu with saved preferences, offering each ruleset its own choices and locking the ones a running play cannot change: HS-FIX including START BPM (kept in sync with the select screens), the four AC 34 display-area information choices and the per-side cover settings, independent AUTO SCRATCH sides, the source-specific LEGACY NOTE and LN REMOVE, AC 34's A-SCR & LEGACY NOTE preset in one action, EX-HARD for beatoraja and AC rules with HAZARD labelled apart, ASSIST EASY for beatoraja and ASSISTED EASY for AC rules, and the other judgment, hi-speed, view, arrangement, modifier, gauge, battle and PRACTICE options.
  The options that only transform the chart or the view are offered under every judge ruleset and kept when Judgment windows changes: HS-FIX CONSTANT, CLASSIC / Normal / FLOATING HI-SPEED and the fixed display area, scroll and mine modifiers, both EXTRAs, 7 TO 9, BATTLE AS / D-BATTLE / SP TO DP, the source-specific lane options, SYNCHRONIZE / SYMMETRY RANDOM, M-RAN, and Reuse previous arrangement (for a play under the same rules). Choices the new ruleset does not support are reset (#774).
  A replay restores each recorded AUTO SCRATCH side on its own, and an older replay's combined switch applies to both sides.
  A battle mode plays on the converted chart's LR2 play skin, PRACTICE starts again after each run, and a two-player result stays out of the records and the Leaderboard while its replay is still saved.
- 4b9f91d: Drop the hidden Phantom and Lattice skins and the "Add Lattice" button. "Add skin" (a skin module from a URL) stays hidden behind `ADD_SKIN_ENABLED`.
- a8b3052: Add a persistent Audio mute switch that silences all player sounds while retaining the master volume setting.
- 7a776a0: Keep bulk chart imports, ZIP expansion, and WSOLA time stretching off the main thread. Add a persistent Debug Panel CPU worker setting, defaulting to half the browser-reported logical CPU count, rounded down with a minimum of one.
  
  Add a persistent Tempo enable switch that bypasses the saved percentage when off, and make WSOLA the default and first keep-pitch algorithm.
- Updated dependencies [1b3e0bd]
- Updated dependencies [ba3cc20]
- Updated dependencies [dff4d15]
- Updated dependencies [cc6b4b4]
- Updated dependencies [166f2d2]
- Updated dependencies [1cb4d60]
- Updated dependencies [bd5f119]
- Updated dependencies [b6f6a72]
- Updated dependencies [7fca9a9]
- Updated dependencies [b6f6a72]
- Updated dependencies [1cb4d60]
- Updated dependencies [a9cc3d7]
- Updated dependencies [1b3e0bd]
- Updated dependencies [7a776a0]
- Updated dependencies [74838c5]
- Updated dependencies [a83e326]
- Updated dependencies [69df53c]
- Updated dependencies [f994ec4]
- Updated dependencies [c52d77d]
- Updated dependencies [69df53c]
- Updated dependencies [29e69c6]
- Updated dependencies [69df53c]
- Updated dependencies [29e69c6]
- Updated dependencies [3a5d9c3]
- Updated dependencies [3a5d9c3]
- Updated dependencies [3a5d9c3]
- Updated dependencies [d08fdf9]
- Updated dependencies [fcaef41]
- Updated dependencies [7f0386b]
- Updated dependencies [45aff53]
- Updated dependencies [582ad35]
- Updated dependencies [7ab40af]
- Updated dependencies [45aff53]
- Updated dependencies [1c97afd]
- Updated dependencies [d08fdf9]
- Updated dependencies [74127d3]
- Updated dependencies [a83e326]
- Updated dependencies [f4b7d9e]
- Updated dependencies [b54a1da]
- Updated dependencies [69df53c]
- Updated dependencies [f9c1c24]
- Updated dependencies [0c67b28]
- Updated dependencies [a8896a9]
- Updated dependencies [85f13dc]
- Updated dependencies [935610f]
- Updated dependencies [a95c53c]
- Updated dependencies [c072506]
- Updated dependencies [582ad35]
- Updated dependencies [7ab40af]
- Updated dependencies [3e694df]
- Updated dependencies [5565fe4]
- Updated dependencies [0b4e3c4]
- Updated dependencies [1e62cb3]
- Updated dependencies [b09a6cf]
- Updated dependencies [f994ec4]
- Updated dependencies [3b75adf]
- Updated dependencies [4b9f91d]
- Updated dependencies [d0939cc]
- Updated dependencies [3e694df]
- Updated dependencies [0bee40e]
- Updated dependencies [a83e326]
- Updated dependencies [69df53c]
- Updated dependencies [78faa63]
- Updated dependencies [3d5e880]
- Updated dependencies [21f705d]
- Updated dependencies [a8896a9]
- Updated dependencies [b1ca2ce]
- Updated dependencies [6e676fe]
- Updated dependencies [aeac0d3]
- Updated dependencies [9f41b30]
- Updated dependencies [f994ec4]
- Updated dependencies [4371c72]
- Updated dependencies [acba3d5]
- Updated dependencies [3e694df]
- Updated dependencies [3e694df]
- Updated dependencies [c35b845]
- Updated dependencies [a83e326]
- Updated dependencies [a8896a9]
- Updated dependencies [85f13dc]
- Updated dependencies [3c2ea6b]
- Updated dependencies [aeac0d3]
- Updated dependencies [b09a6cf]
- Updated dependencies [85e11f7]
- Updated dependencies [d0939cc]
- Updated dependencies [3e694df]
- Updated dependencies [a83e326]
- Updated dependencies [01cd4cd]
- Updated dependencies [29e69c6]
- Updated dependencies [f994ec4]
- Updated dependencies [6fc13f5]
- Updated dependencies [a8896a9]
- Updated dependencies [f872467]
- Updated dependencies [238bd8b]
- Updated dependencies [85250d8]
- Updated dependencies [17aebd5]
- Updated dependencies [051e0c0]
- Updated dependencies [6f94ff0]
- Updated dependencies [2e435b9]
- Updated dependencies [3ab8eac]
- Updated dependencies [85f13dc]
- Updated dependencies [b09a6cf]
- Updated dependencies [0bee40e]
- Updated dependencies [d0939cc]
- Updated dependencies [edc1112]
- Updated dependencies [a83e326]
- Updated dependencies [85f13dc]
- Updated dependencies [b506535]
- Updated dependencies [3d2bc84]
- Updated dependencies [77d8ec1]
- Updated dependencies [3ffc4f8]
- Updated dependencies [affc51c]
- Updated dependencies [2e435b9]
- Updated dependencies [85250d8]
- Updated dependencies [9065e03]
- Updated dependencies [00139f5]
  - @be-music/skin-beatoraja@0.5.0
  - @be-music/player-engine@0.11.0
  - @be-music/player-browser@0.12.0
  - @be-music/chart-model@0.7.0
  - @be-music/chart-parser@0.5.0
  - @be-music/chart-source@0.5.0
  - @be-music/player-scene-model@0.3.0
  - @be-music/skin-lr2@0.4.0
  - @be-music/player-skin-sdk@0.5.0
  - @be-music/service-web-theme@0.3.0
  - @be-music/shared-utils@0.6.0

## 0.6.1

### Patch Changes

- ebff0e7: Display the build timestamp and source revision in the start-card and help footers without covering the playfield.
  
  Rename the package from `@be-music/player-web-demo` to `@be-music/app-play` to identify its role consistently. Update imports and package filters to the new name.
- 9a0c3f9: Use chart-based navigation, image, and best-record names, and replay terminology for saved recording data and controls. Update the test hook to expose chart bars and chart counts consistently.
  
  Align help, course messages, loading statuses, and replay controls with the chart and replay vocabulary.
- Updated dependencies [9a0c3f9]
- Updated dependencies [dca9a2f]
- Updated dependencies [dca9a2f]
- Updated dependencies [dca9a2f]
- Updated dependencies [9a0c3f9]
- Updated dependencies [9a0c3f9]
- Updated dependencies [9a0c3f9]
- Updated dependencies [9a0c3f9]
- Updated dependencies [9a0c3f9]
- Updated dependencies [ebff0e7]
  - @be-music/skin-beatoraja@0.4.0
  - @be-music/chart-model@0.6.0
  - @be-music/chart-parser@0.4.0
  - @be-music/chart-source@0.4.0
  - @be-music/skin-lr2@0.3.0
  - @be-music/player-engine@0.10.0
  - @be-music/player-browser@0.11.0
  - @be-music/player-scene-model@0.2.0
  - @be-music/player-skin-sdk@0.4.0
  - @be-music/service-web-theme@0.2.0

## 0.6.0

### Minor Changes

- b2818d0: Offer course playback, recording, Accounts sign-in and Leaderboard submission in the browser player.
  
  - Load LR2/beatoraja courses and difficulty-table courses, create and persist EXPERT/NONSTOP/GRADE courses, edit constraints and connections, and export course files. New user-created courses start unranked.
  - Submit eligible manual single plays and complete course runs to Leaderboard, retain local records, and replay or retry with the recorded mode and random outcomes.
  - Add tempo/pitch controls, persistent hi-speed, automatic render-resolution selection, MP4/WebM recording and silent-mode audio support on compatible mobile browsers.
  - Consolidate the start screen, provide in-place chart search only on the select screen, and organize everyday settings in the Debug Menu.
  - Preserve recordings, browse selection, records and scene flow across retries, drops, reloads and theme changes.
  - Open Accounts for sign-in and account management, and link rankings to the Leaderboard host of the same environment.
  
  The deployment Worker is provided by `@be-music/worker-play`.

### Patch Changes

- Updated dependencies [b2818d0]
  - @be-music/skin-beatoraja@0.3.0
  - @be-music/chart-model@0.5.0
  - @be-music/chart-source@0.3.0
  - @be-music/skin-lr2@0.2.0
  - @be-music/chart-parser@0.3.0
  - @be-music/player-engine@0.9.0
  - @be-music/player-browser@0.10.0
  - @be-music/player-scene-model@0.1.0
  - @be-music/player-skin-sdk@0.3.0
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
- Updated dependencies [38a2568]
- Updated dependencies [00e8bce]
- Updated dependencies [6808622]
- Updated dependencies [dc99100]
- Updated dependencies [3f1b6b3]
- Updated dependencies [e265198]
- Updated dependencies [d2f7f82]
- Updated dependencies [1518e28]
- Updated dependencies [9dbb569]
- Updated dependencies [7260b23]
- Updated dependencies [5f76923]
- Updated dependencies [c749205]
- Updated dependencies [77b070f]
- Updated dependencies [0848402]
- Updated dependencies [5dfc779]
  - @be-music/player-browser@0.9.0

## 0.4.0

### Minor Changes

- The demo's Debug Menu gains controls for the new player features, and the page is easier to use full screen.
  
  - A built-in skin picker (Synesthesia by default), a _Skin effects_ level, and an _Add skin_ folder that adds the optional Lattice skin or a skin module from a URL (after a trust prompt); every registered skin's fonts are preloaded so its first frames don't fall back to another face.
  - Volume and compressor sections: master, keysound, and BGM volume, plus live tuning of the key, BGM, master, and legacy compressors.
  - Double-clicking the canvas toggles fullscreen, and the help button sits centred along the bottom edge.

### Patch Changes

- Updated dependencies [cd83c89]
- Updated dependencies [9534c16]
- Updated dependencies [36bcb71]
- Updated dependencies [2c368ed]
- Updated dependencies [d9958ac]
- Updated dependencies [202a28b]
- Updated dependencies [0319694]
- Updated dependencies [202a28b]
- Updated dependencies [750c47d]
- Updated dependencies [b3fa635]
- Updated dependencies [4ab6e91]
- Updated dependencies [8b07494]
- Updated dependencies [d5e558c]
- Updated dependencies [0103435]
  - @be-music/player-browser@0.8.0
  - @be-music/skin-lr2@0.1.6
  - @be-music/skin-beatoraja@0.2.0

## 0.3.2

### Patch Changes

- Updated dependencies
- Updated dependencies
- Updated dependencies [ab210cb]
  - @be-music/skin-lr2@0.1.5
  - @be-music/player-browser@0.7.0

## 0.3.1

### Patch Changes

- Updated dependencies [f07ff77]
- Updated dependencies [99324e8]
  - @be-music/player-browser@0.6.2
  - @be-music/skin-lr2@0.1.4
  - @be-music/skin-beatoraja@0.1.2

## 0.3.0

### Minor Changes

- 9b7f269: Cloudflare Workers hosting and URL-based archive auto-load for the demo.

  - Serve the built SPA from Workers Static Assets and stream the ~31 MB ffmpeg.wasm core (over the 25 MiB per-file asset limit) from an R2 bucket through the Worker.
  - `deploy:cf` runs an md5-gated R2 sync before `wrangler deploy`, re-uploading the wasm core only when `@ffmpeg/core` actually changed (`cf:r2:push` forces an upload); CI keeps using `build:cf` + `wrangler deploy` and never touches R2.
  - Open the page with `?music=https://…/song.zip` and/or `?skin=https://…/theme.zip` to auto-load a chart archive and apply a skin at boot — the archive's charts are listed in the select screen. Cross-origin archive links are fetched through the demo proxy and must use HTTPS.

### Patch Changes

- Updated dependencies [9b7f269]
  - @be-music/player-browser@0.6.1

## 0.2.7

### Patch Changes

- a36c2b1: Update the demo shell for the rearranged default gameplay layout (`index.html` / `styles.css`) and follow the new chrome-injection seam in `main.ts`.
- Updated dependencies [a36c2b1]
  - @be-music/player-browser@0.6.0

## 0.2.6

### Patch Changes

- Updated dependencies [eb92249]
- Updated dependencies [eb92249]
  - @be-music/player-browser@0.5.1

## 0.2.5

### Patch Changes

- 69f77d1: `discoverLr2Themes` scopes its return to `LR2files/Theme/<name>/`, which dropped shared `LR2files/` siblings (`WallPaper/`, `Bgm/`, `Sound/`, …) from the file list handed to the skin loader. The LR2 default select skin references its backdrop via the wildcard `LR2files/WallPaper/Select/*.bmp`; without the siblings the lookup failed and the select scene painted black. Union the theme's own files with all other files under `LR2files/` that aren't part of any other theme subtree, so wildcard `#CUSTOMFILE` assets resolve as before.
- Updated dependencies [3ee4d90]
- Updated dependencies [d4b427c]
- Updated dependencies [69f77d1]
- Updated dependencies [69f77d1]
- Updated dependencies [69f77d1]
- Updated dependencies [69f77d1]
- Updated dependencies [69f77d1]
- Updated dependencies [69f77d1]
- Updated dependencies [69f77d1]
- Updated dependencies [69f77d1]
- Updated dependencies [69f77d1]
- Updated dependencies [69f77d1]
- Updated dependencies [69f77d1]
- Updated dependencies [69f77d1]
- Updated dependencies [69f77d1]
- Updated dependencies [4275fef]
- Updated dependencies [69f77d1]
- Updated dependencies [69f77d1]
- Updated dependencies [cc37f42]
- Updated dependencies [18e4a48]
- Updated dependencies [69f77d1]
- Updated dependencies [69f77d1]
- Updated dependencies [69f77d1]
- Updated dependencies [a66b7aa]
- Updated dependencies [73dff9a]
  - @be-music/player-browser@0.5.0
  - @be-music/skin-lr2@0.1.3
  - @be-music/skin-beatoraja@0.1.1

## 0.2.4

### Patch Changes

- b826a39: Help modal now documents beatoraja skin support alongside Lunatic Rave 2. The verified-skin note lists LR2 default, beatoraja default (`skin/default`), `ModernChic`, and `GdbG Original Skin`. "LR2 skin's PLAY / PLAY OPTION" wording is generalized to "the active skin's" since both rendering paths surface those buttons. Mirrored across the English and Japanese help panes.

## 0.2.3

### Patch Changes

- 06a2db9: Add a beatoraja-theme path alongside LR2 themes: a "Beatoraja preview" folder in the debug menu, a variant dropdown (`7` / `5` / `14` / `10` / `9`), and an "Open preview" button that mounts `BeatorajaPlaySkinPreviewScene`. Texture caches are memoized per entry path, and skin-options panel state persists across mid-edit `replaceSkin` round-trips.

- Updated dependencies [06a2db9]
  - @be-music/skin-beatoraja@0.1.0
  - @be-music/player-browser@0.4.0
  - @be-music/skin-lr2@0.1.2

## 0.2.2

### Patch Changes

- Updated dependencies [b9a5f51]
  - @be-music/player-browser@0.3.1

## 0.2.1

### Patch Changes

- Updated dependencies [5ea9072]
  - @be-music/player-browser@0.3.0

## 0.2.0

### Minor Changes

- 632f274: Initial Vite-based demo shell that wires `@be-music/player-browser` into a single-page app, with a lil-gui settings panel, a drop overlay, a browser-compatibility check panel, and a Help dialog (usage guide plus the Open-Source attribution list resolved at build time).

- 135f822: The shared-engine path is the only playback path; the `useSharedEngine` opt-in flag and its Debug Menu checkbox are removed.

### Patch Changes

- Updated dependencies [632f274]
- Updated dependencies [135f822]
  - @be-music/player-browser@0.2.0
  - @be-music/skin-lr2@0.1.1
