# @be-music/app-play

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
