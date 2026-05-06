---
'@be-music/beatoraja-skin': minor
'@be-music/player-web': minor
'@be-music/player-web-demo': patch
---

Add beatoraja JSON / Lua skin parsing.

- New `@be-music/beatoraja-skin` package — renderer-independent parser for beatoraja `*.json` and `*.luaskin`
  themes. Includes the 2-phase Lua evaluation contract (`skin_config = nil` → header, populated → `main()`),
  conditional `if`/`values` flattening, `*` wildcard expansion, case-insensitive asset lookup, and per-scene theme
  discovery (play / select / decide / result / course-result / grade-result).
- Lua evaluation runs on Fengari with a hardened sandbox: only `base` / `table` / `string` / `math` are exposed,
  `package` / `io` / `os` / `debug` are omitted, and `dofile` / `loadfile` / `load` / `loadstring` /
  `collectgarbage` are nilled out.
- `@be-music/player-web` exports `loadBeatorajaThemeFromFiles()` and per-scene loaders that wrap the parser
  pipeline behind the dropped-`File[]` API. Drop detection helpers `isLr2SkinFilePath` / `isBeatorajaLuaSkinFilePath` /
  `isBeatorajaSkinIndicator` are added to `drop.ts`.
- `@be-music/player-web-demo` parses beatoraja themes in parallel with LR2 themes when a drop carries either
  format. PixiJS rendering for beatoraja skins is a follow-up patch — for now the parser is wired and the bundle is
  exposed for inspection.
