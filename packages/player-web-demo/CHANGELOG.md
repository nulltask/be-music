# @be-music/player-web-demo

## 0.3.2

### Patch Changes

- Updated dependencies
- Updated dependencies
- Updated dependencies [ab210cb]
  - @be-music/lr2-skin@0.1.5
  - @be-music/player-web@0.7.0

## 0.3.1

### Patch Changes

- Updated dependencies [f07ff77]
- Updated dependencies [99324e8]
  - @be-music/player-web@0.6.2
  - @be-music/lr2-skin@0.1.4
  - @be-music/beatoraja-skin@0.1.2

## 0.3.0

### Minor Changes

- 9b7f269: Cloudflare Workers hosting and URL-based archive auto-load for the demo.

  - Serve the built SPA from Workers Static Assets and stream the ~31 MB ffmpeg.wasm core (over the 25 MiB per-file asset limit) from an R2 bucket through the Worker.
  - `deploy:cf` runs an md5-gated R2 sync before `wrangler deploy`, re-uploading the wasm core only when `@ffmpeg/core` actually changed (`cf:r2:push` forces an upload); CI keeps using `build:cf` + `wrangler deploy` and never touches R2.
  - Open the page with `?music=https://…/song.zip` and/or `?skin=https://…/theme.zip` to auto-load a chart archive and apply a skin at boot — the archive's charts are listed in the select screen. Cross-origin archive links are fetched through the demo proxy and must use HTTPS.

### Patch Changes

- Updated dependencies [9b7f269]
  - @be-music/player-web@0.6.1

## 0.2.7

### Patch Changes

- a36c2b1: Update the demo shell for the rearranged default gameplay layout (`index.html` / `styles.css`) and follow the new chrome-injection seam in `main.ts`.
- Updated dependencies [a36c2b1]
  - @be-music/player-web@0.6.0

## 0.2.6

### Patch Changes

- Updated dependencies [eb92249]
- Updated dependencies [eb92249]
  - @be-music/player-web@0.5.1

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
  - @be-music/player-web@0.5.0
  - @be-music/lr2-skin@0.1.3
  - @be-music/beatoraja-skin@0.1.1

## 0.2.4

### Patch Changes

- b826a39: Help modal now documents beatoraja skin support alongside Lunatic Rave 2. The verified-skin note lists LR2 default, beatoraja default (`skin/default`), `ModernChic`, and `GdbG Original Skin`. "LR2 skin's PLAY / PLAY OPTION" wording is generalized to "the active skin's" since both rendering paths surface those buttons. Mirrored across the English and Japanese help panes.

## 0.2.3

### Patch Changes

- 06a2db9: Add a beatoraja-theme path alongside LR2 themes: a "Beatoraja preview" folder in the debug menu, a variant dropdown (`7` / `5` / `14` / `10` / `9`), and an "Open preview" button that mounts `BeatorajaPlaySkinPreviewScene`. Texture caches are memoized per entry path, and skin-options panel state persists across mid-edit `replaceSkin` round-trips.

- Updated dependencies [06a2db9]
  - @be-music/beatoraja-skin@0.1.0
  - @be-music/player-web@0.4.0
  - @be-music/lr2-skin@0.1.2

## 0.2.2

### Patch Changes

- Updated dependencies [b9a5f51]
  - @be-music/player-web@0.3.1

## 0.2.1

### Patch Changes

- Updated dependencies [5ea9072]
  - @be-music/player-web@0.3.0

## 0.2.0

### Minor Changes

- 632f274: Initial Vite-based demo shell that wires `@be-music/player-web` into a single-page app, with a lil-gui settings panel, a drop overlay, a browser-compatibility check panel, and a Help dialog (usage guide plus the Open-Source attribution list resolved at build time).

- 135f822: The shared-engine path is the only playback path; the `useSharedEngine` opt-in flag and its Debug Menu checkbox are removed.

### Patch Changes

- Updated dependencies [632f274]
- Updated dependencies [135f822]
  - @be-music/player-web@0.2.0
  - @be-music/lr2-skin@0.1.1
