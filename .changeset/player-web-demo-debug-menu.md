---
'@be-music/player-web-demo': minor
---

Reorganise the Debug Menu so everyday controls come first: the top level holds loading, the skin family and built-in skin, Record, and Screenshot, followed by the Play options and Audio folders (open by default; Audio holds the volumes, Play in silent mode, and the Compressor folder) and the Skin & display, Library & records, and Developer folders (closed by default). Each folder remembers whether it was left open. Stored settings keep their keys.

New controls:

- Open files (ZIP / play log): pick chart ZIP archives or a play log to replay, which the folder picker could not select.
- Toggle fullscreen, the same as double-clicking the playfield.
- Music / Skin ZIP URL with Load from URLs, the `?music=` / `?skin=` loading on demand.
- Clear best records, and Reset settings and reload (clears every stored demo setting except the best records).
- An FPS read-out in the Developer folder.

The Beatoraja skins folder now only shows while a beatoraja theme is loaded, and the LR2 theme picker sits next to it instead of at the bottom of the panel. The panel's dark / yellow theme and the Record button's recording / armed colours apply again: their selectors still used class names that lil-gui 0.21 renamed, and the theme now reaches the controls inside folders too.
