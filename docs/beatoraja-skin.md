[Japanese version](./beatoraja-skin.ja.md)

# beatoraja skin implementation notes

This document summarizes the current `@be-music/beatoraja-skin` implementation. The package parses beatoraja JSON
and Lua skin themes into renderer-independent data structures. PixiJS rendering is the responsibility of
`@be-music/player-web`; CLI / TUI render paths do not load beatoraja skins.

## Scope

- `@be-music/beatoraja-skin` reads `*.json` and `*.luaskin` entries for the play, select, decide, result, and
  course-result scenes.
- Theme assets are resolved from a dropped folder or in-memory file map. Paths are normalized against the entry
  script's directory; `*` wildcards (e.g. `play/background/*.png`) and case-insensitive lookup are supported.
- The 2-phase Lua evaluation contract used by beatoraja is honored: the entry runs once with `skin_config = nil` to
  return a header (`property[]`, `filepath[]`, and custom `offset[]` schemas) and a second time with the user's picks
  injected to return the full skin table.
- The package returns plain TypeScript objects. It does not create PixiJS objects, WebAudio nodes, or browser DOM UI.

## Skin formats

beatoraja themes ship two interchangeable entry formats:

| extension | format | discovery |
| --- | --- | --- |
| `*.json` | static JSON skin tree (with optional trailing commas, which we strip) | parsed eagerly via `JSON.parse` |
| `*.luaskin` + sibling `*.lua` | Lua 5.3 script that returns a skin table; uses `require()` for sibling modules | evaluated by Fengari, see below |

Both formats produce values matching `BeatorajaSkin` (full) and `BeatorajaSkinHeader` (selector-UI summary).

## Skin types

The numeric `type` field on every skin matches beatoraja's upstream `SkinType` enum. The package exports
`BEATORAJA_SKIN_TYPE` and the helpers `playVariantForSkinType` / `sceneForSkinType` so consumers can route entries
without hard-coding integer literals.

| code | label | scene |
| --- | --- | --- |
| 0 | `PLAY_7KEYS` | play (`'7'`) |
| 1 | `PLAY_5KEYS` | play (`'5'`) |
| 2 | `PLAY_14KEYS` | play (`'14'`) |
| 3 | `PLAY_10KEYS` | play (`'10'`) |
| 4 | `PLAY_9KEYS` | play (`'9'`) |
| 5 | `MUSIC_SELECT` | select |
| 6 | `DECIDE` | decide |
| 7 | `RESULT` | result |
| 8 | `KEY_CONFIG` | other |
| 9 | `SKIN_SELECT` | other |
| 10 | `SOUND_SET` | other |
| 11 | `THEME` | other |
| 12 | `PLAY_7KEYS_BATTLE` | play (unsupported battle layout) |
| 13 | `PLAY_5KEYS_BATTLE` | play (unsupported battle layout) |
| 14 | `PLAY_9KEYS_BATTLE` | play (unsupported battle layout) |
| 15 | `COURSE_RESULT` | course-result |
| 16 | `PLAY_24KEYS` | play (`'24'`) |
| 17 | `PLAY_24KEYS_DOUBLE` | play (`'24d'`) |
| 18 | `PLAY_24KEYS_BATTLE` | play (unsupported battle layout) |

## Lua sandbox

`evaluateBeatorajaLuaSkin()` runs the entry script under a hand-built sandbox built on Fengari. Only the standard
libraries actually used by the reference theme (`base`, `table`, `string`, `math`) are exposed; `package`, `io`,
`os`, and `debug` are left out. `dofile`, `loadfile`, `load`, `loadstring`, and `collectgarbage` are nilled out so a
malicious skin can't reach beyond its own theme files.

`require()` is reimplemented on top of a registry of preloaded module sources. The host registers every `.lua`
neighboring the entry script (and one level up — beatoraja themes occasionally split helpers into a parent
`play_parts.lua`). Modules are cached so a `require()` call always returns the same table on subsequent invocations.

The two-phase contract:

```lua
local t = require("play24main")
if skin_config then
  return t.main()
else
  return t.header
end
```

Pass `skinConfig: undefined` for the first phase and a populated `BeatorajaSkinConfig` for the second.

## Conditional groups

`if`/`values` and `if`/`value` blocks inside any element list can be flattened to a flat element stream with
`flattenBeatorajaElements()`. Each normalized entry carries the active `if` op-codes so the renderer can gate
visibility at runtime via `isElementVisible()`. Negative codes are treated as negation (the op must NOT be active).

## Asset resolution

`resolveBeatorajaPath()` resolves a `path` field relative to its entry skin file. `..` segments are honored, slashes
are normalized, and lookup is case-insensitive — beatoraja themes shipped from Windows often differ in casing from
the strings authored in skin files.

`expandBeatorajaWildcard()` expands `*` patterns used in `source[]` / `filepath[]`. The user's `filepath[]`
selection (when present) overrides the wildcard; otherwise the first sorted match is picked deterministically.

## Theme discovery

`discoverBeatorajaTheme()` walks a file map and produces a `BeatorajaTheme` whose fields point at the per-scene
entries. Play skins are grouped by variant (`'7' / '5' / '9' / '10' / '14' / '24' / '24d'`); when both a `.json`
and a `.luaskin` cover the same variant, the JSON entry wins (parsing is faster and deterministic). Errors are
collected as `BeatorajaThemeDiscoveryWarning[]` instead of aborting discovery so a single bad skin can't break the
whole theme.

`pickBeatorajaPlaySkin(playSkins, desired)` resolves a chart's variant against a fallback chain.

## Browser player wiring

`@be-music/player-web` ships `loadBeatorajaThemeFromFiles()` and helper functions
(`loadBeatorajaPlaySkinFromBundle`, `loadBeatorajaSelectSkinFromBundle`, `loadBeatorajaResultSkinFromBundle`,
`loadBeatorajaDecideSkinFromBundle`) that wrap the parser pipeline behind a browser-friendly `File[]` API. The
state lives in parallel with the LR2 theme state; the demo logs both summaries when a drop carries either format.

PixiJS rendering for beatoraja skins is implemented in a follow-up patch — for now the parser is wired, theme
discovery runs on drop, and the resulting bundle is exposed for inspection.

## Compatibility boundary

The parser is intentionally permissive:

- Unknown skin types are surfaced as `'other'` and don't trigger an error.
- JSON trailing commas (`,]`/`,}`) are stripped before parsing.
- Lua tables that mix integer and string keys are returned as records (string-keyed objects); the array-vs-record
  decision uses the strict "all keys are 1..N integers and `#t == N`" rule.
- Conditional groups (`if`/`value(s)`) without `value` or `values` are dropped silently (they're no-ops in the
  reference theme).

The package does not run beatoraja's own `SkinObject` registry — it just exposes the raw skin tree and the
helpers a renderer needs to build PixiJS scenes on top.
