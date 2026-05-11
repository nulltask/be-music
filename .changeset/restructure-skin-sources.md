---
'@be-music/beatoraja-skin': patch
'@be-music/lr2-skin': patch
'@be-music/player-web': minor
---

Reorganize `beatoraja-skin`, `lr2-skin`, and `player-web` source trees into purpose-based subdirectories
and drop the redundant package-name prefix that every file used to carry.

- `@be-music/beatoraja-skin`: per-element modules collapse under `src/elements/` with kebab-case names
  (`bpmgraph` → `bpm-graph`, `floatvalue` → `float-value`, `songlist` → `song-list`, etc.); top-level
  files lose the `beatoraja-skin-` prefix (`beatoraja-skin.ts` → `skin.ts`, `beatoraja-skin-types.ts` →
  `types.ts`, …). The package's public `index.ts` re-exports the same symbols, so consumers that import
  from the package entry point are unaffected; deep imports into `packages/beatoraja-skin/src/*` need to
  use the new paths.
- `@be-music/lr2-skin`: top-level files lose the `lr2[-skin]-` prefix (`lr2-skin-assets.ts` → `assets.ts`,
  `lr2-skin.ts` → `skin.ts`, `lr2-dxa.ts` → `dxa.ts`, …). Same compatibility note — the entry point's
  exports are unchanged.
- `@be-music/player-web`: source tree splits into `browser/`, `chart/{,beatoraja}/`, `collection/`,
  `recording/`, `runtime/`, `scene/{,beatoraja,lr2}/`, and `skin/{beatoraja,lr2}/` so engine adapters,
  scene wiring, and per-skin rendering each live next to their siblings. Renames also tidy a few public
  symbols — most notably `BrowserSongLibrary` → `BrowserSongCollectionStore`, which is a breaking change
  for callers that constructed `BrowserSongLibrary` directly.

No behaviour changes — this is a pure rename + import-path refactor; types, tests, and the LR2 /
player-web docs are updated to point at the new paths.
