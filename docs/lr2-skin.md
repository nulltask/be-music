[Japanese version](./lr2-skin.ja.md)

# LR2 skin implementation notes

This document summarizes the current `@be-music/lr2-skin` implementation.
The package parses Lunatic Rave 2 skin files into renderer-independent data structures; PixiJS rendering belongs to `@be-music/player-web`, and CLI/TUI rendering belongs to `@be-music/player-tui`, which does not consume LR2 skins.

## Scope

- `@be-music/lr2-skin` reads `.lr2skin` CSV files for select, decide, play, and result scenes.
- The package resolves theme assets from dropped folders or in-memory file maps, including case-insensitive paths, wildcard file references, TGA and DDS images, and DXA archives.
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

LR2 never shipped keyboard-mode play skins, so `24` / `48` KEY charts borrow a `7` / `14` play skin (`PLAY_SKIN_FALLBACKS` in `play-skin.ts`): the skin supplies the frame, gauge, and judge graphics, and the lanes fall back to the host's playfield.

The parser keeps select, decide, play, and result data in one `Lr2Skin` shape.
Consumers read only the fields that make sense for their scene.

## Courses

LR2 has a scene of its own for the result of a whole course: `#INFORMATION` type 15, conventionally under `CourseResult/`. `loadLr2ThemeSkinsFromFiles` loads it as `courseResultSkin`, along with the course-result jingles. A `result` lookup never picks it.

LR2 finds its BGM and system sounds through the sound set, `LR2files/Sound/*.lr2ss`, which names each file: the stock `lr2.lr2ss` maps `#COURSECLEAR` / `#COURSEFAIL` to `Sound/lr2/course_clear.wav` / `course_fail.wav`. `loadLr2ThemeSkinsFromFiles` reads the dropped sound set (`lr2.lr2ss` first) for the select / decide BGM, the clear / fail / course jingles and the cursor, folder and option sounds, filling a `*` folder with its `#CUSTOMFILE` default and taking another audio extension when the named file is missing. Without a sound set, or for a file it does not name, it looks the stem up under `Sound/lr2/` (`course_clear` or `courseclear` for the course jingles).

LR2 reads a skin each time its scene starts, so an `#IF` block can test state that holds for the whole scene. In a course that means the course ops (OpenLR2 `LR2f.cpp` L5403-L5444):

| Op              | Meaning                                           |
| --------------- | ------------------------------------------------- |
| 280-288         | Stage 1-9 is played and is not the last one       |
| 289             | The last stage                                    |
| 290             | A course: the selected bar, or the running course |
| 291 / 292 / 293 | Its kind: NONSTOP / EXPERT / GRADE                |

The theme is parsed once, with these ops off. `Lr2ThemeSkins.loadSkin({ kind, playVariant, parseOps })` parses one of its skins again from the files already read, with extra ops held true while `#IF` / `#ELSEIF` are evaluated (`LoadLr2SkinOptions.parseOps`). `pickLr2PlaySkinVariant` names the play-skin variant a chart plays on, so a host can parse that skin again for a course stage.

The values a course skin reads (numbers 250-259, texts 150-170, the course combo on 104 / 105) are scene state; `@be-music/player-web` supplies them. See [Courses and dan certification](./player-web.md#courses-and-dan-certification).

## Parsed directives

Implemented directives include:

- `#INFORMATION`, `#ENDOFHEADER`
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
- `#RESOLUTION`, `#TRANSCOLOR`, `#FADEOUT`, `#SKIP`, `#LOADEND`
- `#FLIPSIDE`, `#FLIPRESULT`, `#DISABLEFLIP`
- `#IF`, `#ELSEIF`, `#ELSE`, `#ENDIF`

Implemented element families include:

- Image elements with `#SRC_IMAGE` / `#DST_IMAGE`
- Number, text, slider, bargraph, button, and mouse cursor elements
- Play-scene elements for BGA, groove gauge, judge line, measure line, judge/combo effects, key-on effects, LN hold effects, and bombs
- Play-scene note graphics: `#SRC_NOTE`, `#SRC_LN_START` / `#SRC_LN_BODY` / `#SRC_LN_END`, `#SRC_MINE`, and their `#SRC_AUTO_*` autoplay variants
- `#SRC_README` / `#DST_README` and `#SRC_ONMOUSE` / `#DST_ONMOUSE` elements
- Select-scene bar body, title, level, lamp, my lamp, rival / rival lamp, rank, flash, cursor, and click-target elements
- Result-scene gauge chart and score chart elements
- LR2 special graphics for `STAGEFILE`, `BACKBMP`, `BANNER`, skin thumbnail, black, and white runtime-bound textures

## Asset resolution

`loadLr2SkinFromSourceFiles()` receives a collection of source files and resolves paths relative to the current skin file.
The resolver normalizes LR2-style path separators and performs case-insensitive lookup because real LR2 themes often mix path casing.

The resolver also supports wildcard asset references used by LR2 themes.
When an asset lives inside a DXA archive, the DXA reader exposes the archive entries to the same lookup path.
TGA images are decoded by `tga.ts` and DDS images by `dds.ts` (the browser player registers it as the `.dds` decoder, since browsers cannot decode DDS), and bitmap fonts are prepared from `#LR2FONT` declarations by `font.ts`.

## Browser player usage

`@be-music/player-web` consumes the parsed skin model in these scene modules:

- `scene/lr2/select.ts`
- `scene/lr2/decide.ts`
- `scene/lr2/gameplay.ts`
- `scene/lr2/result.ts`

Shared rendering helpers in `skin/lr2/render.ts` and `skin/lr2/scene-render.ts` evaluate destination keyframes, op-gated visibility, source cells, sprite transforms, text, numbers, sliders, and bargraphs.
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
