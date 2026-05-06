[Japanese version](./lr2-skin.ja.md)

# LR2 skin implementation notes

This document summarizes the current `@be-music/lr2-skin` implementation.
The package parses Lunatic Rave 2 skin files into renderer-independent data structures; PixiJS rendering belongs to `@be-music/player-web`, and CLI/TUI rendering does not consume LR2 skins.

## Scope

- `@be-music/lr2-skin` reads `.lr2skin` CSV files for select, decide, play, and result scenes.
- The package resolves theme assets from dropped folders or in-memory file maps, including case-insensitive paths, wildcard file references, TGA images, and DXA archives.
- The package keeps skin timing, op conditions, source rectangles, destination keyframes, and scene-specific element groups in plain TypeScript objects.
- The package does not create PixiJS objects, WebAudio nodes, or browser DOM UI.

## Scene model

Skin kind is derived from the skin path and scene directory.
Play skins are grouped by variant so the browser player can choose the layout that matches the chart:

- `5`
- `7`
- `9`
- `10`
- `14`

The parser keeps select, decide, play, and result data in one `Lr2Skin` shape.
Consumers read only the fields that make sense for their scene.

## Parsed directives

Implemented directives include:

- `#INCLUDE`
- `#IMAGE`
- `#LR2FONT`
- `#FONT`
- `#CUSTOMOPTION`
- `#CUSTOMFILE`
- `#SETOPTION`
- `#SCRATCH`
- `#STARTINPUT`
- `#LOADSTART`
- `#PLAYSTART`
- `#CLOSE`
- `#RELOADBANNER`
- `#IF`, `#ELSEIF`, `#ELSE`, `#ENDIF`

Implemented element families include:

- Image elements with `#SRC_IMAGE` / `#DST_IMAGE`
- Number, text, slider, bargraph, button, and mouse cursor elements
- Play-scene elements for BGA, groove gauge, judge line, measure line, judge/combo effects, key-on effects, LN hold effects, and bombs
- Select-scene bar body, title, level, lamp, rank, flash, cursor, and click-target elements
- Result-scene gauge chart and score chart elements
- LR2 special graphics for `STAGEFILE`, `BACKBMP`, `BANNER`, skin thumbnail, black, and white runtime-bound textures

## Asset resolution

`loadLr2SkinFromSourceFiles()` receives a collection of source files and resolves paths relative to the current skin file.
The resolver normalizes LR2-style path separators and performs case-insensitive lookup because real LR2 themes often mix path casing.

The resolver also supports wildcard asset references used by LR2 themes.
When an asset lives inside a DXA archive, the DXA reader exposes the archive entries to the same lookup path.
TGA images are decoded by `lr2-tga.ts`, and bitmap fonts are prepared from `#LR2FONT` declarations by `lr2-font.ts`.

## Browser player usage

`@be-music/player-web` consumes the parsed skin model in these scene modules:

- `pixi-select.ts`
- `pixi-decide.ts`
- `pixi-gameplay.ts`
- `pixi-result.ts`

Shared rendering helpers in `lr2-render.ts` and `lr2-scene-render.ts` evaluate destination keyframes, op-gated visibility, source cells, sprite transforms, text, numbers, sliders, and bargraphs.
The browser player binds runtime values such as song metadata, current judge, combo, gauge, score, BGA textures, play options, and result history onto the parsed skin elements.

## Compatibility boundary

The parser is intentionally permissive.
Malformed element lines are skipped when they cannot produce a useful object, while the rest of the skin continues to load.
This matches the practical needs of LR2 theme loading, where one broken optional asset should not block the whole browser player.

Only the Lunatic Rave 2 default skin set is treated as verified.
Other LR2 skins may load, but small layout differences, missing animation details, or unimplemented button behaviors can remain.

## Known gaps

- The parser does not implement every LR2 directive or every `button_type`.
- `#CUSTOMOPTION` and `#CUSTOMFILE` are parsed and surfaced, but full user-facing option persistence belongs to the host application.
- System font rendering is a browser-renderer concern; `@be-music/lr2-skin` only preserves the declared font metadata.
- Renderer-specific behavior such as PixiJS texture upload, video BGA playback, WebAudio system sounds, and DOM text input overlays lives outside this package.
