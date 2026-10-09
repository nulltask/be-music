[Japanese version](./be-music-skin.ja.md)

# Writing a be-music skin

This guide is for people who want to make a skin for the browser player's built-in (default) family. Skins are written against the `@be-music/skin-sdk` package. The built-in skins use exactly this package: Synesthesia, Phantom, Lattice, and Plain import nothing else from the player. Anything they do, your skin can do too.

A be-music skin is code, not a data file. LR2 and beatoraja themes are interpreted by a scene; a be-music skin draws every screen itself. The player keeps ownership of everything else:

- input, timing, audio, and judging;
- the lane layout and note positions;
- select-list hit-testing.

Each frame, the player hands your skin a canvas and the frame's content as plain data. Your skin decides how it looks.

## Bring your own renderer

The SDK does not draw and imports no rendering framework. Draw the canvas with whatever suits your skin:

| Renderer                     | `context`                            | How                                                                                       | Example                                                                                     |
| ---------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Canvas 2D API                | `'2d'`                               | Draw directly; the canvas comes cleared and scaled to design pixels                       | Plain (`packages/player-web/src/skins/plain/`)                                              |
| PixiJS                       | `'webgl2'`                           | Create a Pixi renderer on the canvas in `setup`, build a scene graph, render it in `draw` | Synesthesia, Phantom, Lattice (`packages/player-web/src/skins/`, through `skins/pixi-kit/`) |
| three.js, raw WebGL / WebGPU | `'webgl'`, `'webgl2'`, or `'webgpu'` | Create the renderer or pipelines in `setup`, render in `draw`, release them in `teardown` | —                                                                                           |

Your skin bundles its own framework as a dependency. Plain is deliberately small and readable; copy it as a starting point.

## Quick start: a Canvas 2D skin

```ts
import { BE_MUSIC_SKIN_API_VERSION, defineBeMusicSkin, resolveLaneRuns } from '@be-music/skin-sdk';

export default defineBeMusicSkin({
  apiVersion: BE_MUSIC_SKIN_API_VERSION,
  id: 'my-skin',
  label: 'My Skin',
  version: '1.0.0',
  author: { name: 'Your Name', url: 'https://example.com' },
  fontLoads: ['700 12px "M PLUS 1p"'],
  context: '2d',
  gameplay: {
    draw({ context: ctx, width, height }, frame) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, height);
      // The BGA video plays behind the canvas: cut its rect out instead of painting over it.
      const bga = frame.layout.bga;
      if (bga && frame.runtime.hasBga) ctx.clearRect(bga.x, bga.y, bga.w, bga.h);
      for (const lane of frame.lanes) {
        ctx.fillStyle = lane.kind === 'scratch' ? '#311' : '#111';
        ctx.fillRect(lane.x, lane.top, lane.w, lane.bottom - lane.top);
      }
      ctx.fillStyle = '#fff';
      for (const note of frame.notes) ctx.fillRect(note.x, note.y - 6, note.w, 6);
      // One judgement line per play side, so it never crosses the double-play gap.
      ctx.fillStyle = '#f33';
      for (const run of resolveLaneRuns(frame.lanes)) {
        ctx.fillRect(run.left, frame.layout.playfield.judgementY, run.right - run.left, 2);
      }
    },
  },
  select: {
    layout: { listX: 322, listTop: 56, listBottomInset: 28, rowHeight: 28 },
    draw({ context: ctx, width, height }, frame) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, height);
      // Draw rows from frame.entries[frame.firstVisibleIndex …] and make buttons clickable:
      frame.hit(16, 400, 120, 32, frame.actions.play);
    },
  },
  result: {
    draw({ context: ctx, width, height }, frame) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, height);
    },
  },
});
```

## Using a framework

Create the framework's renderer on the surface's canvas in `setup`, and release it in `teardown`. The player calls `setup` once per surface, before the first draw, and waits for a returned promise. Each screen gets its own surface: one for gameplay, one per select screen, and one per result screen.

```ts
import { WebGLRenderer, Container } from 'pixi.js';
import { BE_MUSIC_SKIN_API_VERSION, defineBeMusicSkin } from '@be-music/skin-sdk';

const renderers = new WeakMap<HTMLCanvasElement, WebGLRenderer>();

export default defineBeMusicSkin({
  // …metadata…
  context: 'webgl2',
  // Masks need a stencil buffer; the canvas sits over the BGA, so it keeps alpha.
  contextAttributes: { alpha: true, premultipliedAlpha: true, stencil: true, preserveDrawingBuffer: true },
  async setup(surface) {
    const renderer = new WebGLRenderer();
    await renderer.init({
      canvas: surface.canvas,
      context: surface.context,
      width: surface.width,
      height: surface.height,
      resolution: surface.pixelRatio,
      backgroundAlpha: 0,
    });
    renderers.set(surface.canvas, renderer);
  },
  teardown(surface) {
    renderers.get(surface.canvas)?.destroy();
    renderers.delete(surface.canvas);
  },
  gameplay: {
    draw(surface, frame) {
      const renderer = renderers.get(surface.canvas)!;
      const stage = buildGameplayStage(frame); // your scene graph for this frame
      renderer.render({ container: stage, clear: true });
    },
  },
  // select, result …
});
```

The built-in Pixi skins do exactly this through `skins/pixi-kit/define-pixi-skin.ts`. That file is a worked example of replaying the player's frame data into a retained Pixi scene. It also shows how to keep a select scene and rebuild it only when `frame.revision` changes.

## Surfaces

- **When `draw` runs:**
  - Gameplay draws once per frame, right before the player renders.
  - Select and result draw every frame while they are shown.
- **`'2d'` surfaces** come cleared and scaled, so you draw in design pixels (854×480 on the default stage).
- **WebGL and WebGPU surfaces** are entirely yours. `surface.pixelRatio` gives the canvas pixels per design pixel; resize your renderer when it changes.
- **Dot by dot:** each canvas is sized to the device pixels the stage covers on screen (viewport scale × `devicePixelRatio`) and shown with nearest sampling. Your pixels map one to one onto the screen.
- **Transparency:** the canvas is composited over the BGA video. Leave the BGA rect transparent wherever the video should show.
- **`contextAttributes`:** passed through to `canvas.getContext`.

## Skin metadata

Every skin declares these fields. `defineBeMusicSkin` checks them and throws when they are malformed, so a broken skin fails where it is defined.

| Field                                    | Required | Rule                                                                                                                                  |
| ---------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `apiVersion`                             | yes      | `BE_MUSIC_SKIN_API_VERSION` from the SDK you build against. The player refuses skins written for an API revision it does not support. |
| `id`                                     | yes      | Lowercase letters, digits, and hyphens (`my-skin`). Hosts persist it, so keep it stable across releases.                              |
| `label`                                  | yes      | Name shown in pickers.                                                                                                                |
| `version`                                | yes      | Your skin's own release as a semantic version (`1.2.0`).                                                                              |
| `author`                                 | yes      | `{ name, url? }`. `url` must be http(s).                                                                                              |
| `description`                            | no       | One or two sentences for pickers.                                                                                                     |
| `homepage`                               | no       | http(s) URL of the project page or repository.                                                                                        |
| `license`                                | no       | SPDX identifier of the skin's code and assets (`MIT`).                                                                                |
| `fontLoads`                              | yes      | CSS font shorthands the skin draws with (`'400 24px "Anton"'`). It may be empty.                                                      |
| `context`                                | yes      | `'2d'`, `'webgl'`, `'webgl2'`, or `'webgpu'`.                                                                                         |
| `contextAttributes`, `setup`, `teardown` | no       | See [Surfaces](#surfaces) and [Using a framework](#using-a-framework).                                                                |
| `stage`                                  | no       | Design canvas; defaults to `wideStage`. See [Stage and layout](#stage-and-layout).                                                    |
| `gameplay`, `select`, `result`           | yes      | Each screen's `draw` function; see [Screens](#screens).                                                                               |

`validateBeMusicSkin(skin)` returns the same problems as a list of messages without throwing.

## Stage and layout

- **Stage:** the stage is the design canvas a skin draws on. `wideStage` is the 16:9 stage the built-in skins use (854×480), and the default.
- **BGA placement:** `BeMusicStage.resolveBgaRect(playfieldRight)` decides where the gameplay BGA goes. The player composites the video there, and your skin frames the same rect. `wideStage` grows the BGA beside a single-play field and shrinks it next to wide double-play or keyboard fields.
- **Layout per frame:** each gameplay frame comes with `layout` (`BeMusicGameplayLayout`), resolved by the host:
  - `stage`: width and height.
  - `lanes`: every lane, with its channel, kind (`white` / `black` / `scratch`), side, x, and width. The full layout of the chart's play variant (5 / 7 / 9 / 10 / 14 / 24 / 48 KEY) is always present, even for lanes the chart never uses.
  - `playfield`: `left`, `right`, `centerX`, `top`, `judgementY`, and `sides` (the horizontal extent of 1P and, in double play, 2P).
  - `bga`: the BGA rect, or `undefined` when the playfield leaves no room.
- **Placing chrome:** place your chrome from these values instead of hard-coding geometry. Host-side layout changes (double play, keyboard modes, new aspect ratios) then reach your skin for free.
- **Double-play gap:** the 1P and 2P banks stand 60 px apart. `resolveLaneRuns(lanes)` returns one `{ left, right }` run per contiguous bank. Draw the judgement line and lane grid per run so nothing crosses the gap.
- **Lane widths:** lane widths are fixed by the player. Skins colour lanes, but never resize or move them.

## Screens

### Gameplay

`gameplay.draw(surface, frame)` receives a `BeMusicGameplayFrame`:

- `layout`: see [Stage and layout](#stage-and-layout).
- `lanes`: each lane's rect (`x`, `w`, `top`, `bottom` at the judgement line), `kind`, and `beam`, the key-beam intensity (1 while held, then decaying).
- `notes`: tap notes as `{ kind, x, w, y }`, where `y` is the note's bottom edge.
- `longNotes`: long notes as `{ kind, x, w, top, bottom }`. `top` is the tail; `bottom` is the head, clamped to the judgement line while held.
- `bombs`: live hit effects with `elapsedMs` and a stable `seed`.
- `runtime`: the HUD values (below).
- `beatPhase`, `nowMs`, `effects`, and `audio`.

`gameplay.bombDurationMs` (default 300) sets how long a hit effect lives.

`runtime` (`BeMusicGameplayRuntime`) carries:

- **Song and score:**
  - `songTitle`, `songArtist`, `bpm`, `hiSpeed`
  - `score`, `exScore`, `exScoreMax`, `combo`, `maxCombo`
  - judgement counts (`perfect` … `poor`, `fast`, `slow`)
  - `rank`, `totalNotes`
- **Gauge:** `gauge`, `clearThreshold`, `gaugeLabel`, `gaugeSurvival`
- **Judgements:** `lastJudge` and `judgeSides` (the latest judgement and combo per side)
- **Play state:** `autoplay`, `hasBga`, `loading` (show NOW LOADING while audio decodes or a BGA transcodes), `progressRatio`, `chartMs`, `beatPhase`, `nowMs`
- **Event timestamps:** `judgeAtMs`, `impulseAtMs`, `impulseKind` (the last judgement and key press, for punch and impulse effects)
- **Comfort and sound:** `effects`, `audio`

### Select

- **`select.layout`:** `listX`, `listTop`, `listBottomInset`, and `rowHeight`. The scene hit-tests rows with these numbers, so the rows you draw must match them.
- **`select.outroMs`:** length of the launch outro. After a chart is picked, the screen keeps drawing with `frame.launchAt` set until it ends, and ignores input meanwhile.
- **`select.draw(surface, frame)`** receives a `BeMusicSelectFrame`:
  - `entries`, `selectedIndex`, `firstVisibleIndex`, `visibleRows`, `focusedSong`
  - `folderLabel`, `searchQuery`, `totalCharts`
  - `actions` (`play`, `autoPlay`, `activateSearch`)
  - `revision`, which increases whenever the select state changes (cursor, folder, search, list contents). A retained scene graph can be rebuilt only when it moves.
  - `sceneStartedAt` and `cursorChangedAt` for entrance and focus transitions
  - `nowMs`, `effects`, `launchAt`, and `audio`
  - `hit(x, y, w, h, action, cursor?)`: makes a rect clickable for this frame. Declare your hit areas on every draw.

### Result

`result.draw(surface, frame)` receives a `BeMusicResultFrame`:

- `result` (`BeMusicResultData`): scores, judgement counts, gauge and score history, and the play log.
- `rankLabel` (IIDX DJ level) and `ratePercent`.
- `elapsedMs` since the scene mounted, or `Infinity` once the player skipped the entrance.
- `nowMs` and `effects`.

`resolveResultLamp` and `resolveResultTrackRows` give the clear lamp and track rows the built-in skins show.

## SDK helpers

| Area       | Helpers                                                                                                                                                                    |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stage      | `wideStage`, `resolveStageBgaRect`, `STAGE_WIDTH`, `STAGE_HEIGHT`, `STAGE_MARGIN`, `STAGE_SIDE_COLUMN`, `STAGE_BGA_BAND`                                                   |
| Layout     | `resolveGameplayLayout`, `resolveLaneRuns`, `resolveMilestoneArea`                                                                                                         |
| Judgements | `judgeDisplayWord` (a PERFECT prints as GREAT), `isFlashingGreat`, `flashingGreatColor`                                                                                    |
| Moments    | `trackMoments` / `updateMoments` (count-in, every 100 combo, clear line, full combo, combo break), `comboTier`, `momentProgress`, `impulse`, `punchScale`, `effectProfile` |
| Loading    | `LOADING_WORD`, `loadingDots(nowMs)`                                                                                                                                       |
| Sound      | `audioDrive`, `bandAt`, `bandLevel`; see [Reacting to the music](#reacting-to-the-music)                                                                                   |
| Result     | `resolveResultLamp`, `resolveResultTrackRows`                                                                                                                              |
| Song facts | `resolveSongRowFacts`, `resolveSongStats`, `resolveSongTags`, `formatSongLength`, `formatBpmRange`, `formatPlayVariantLabel`                                               |
| Text       | `DEFAULT_TEXT_FONT`, `layoutTabularRun` (tabular figures)                                                                                                                  |
| Motion     | `easeOutCubic`, `easeOutBack`, `stageProgress`, `rollUpValue`, `hash01` (deterministic jitter)                                                                             |

## Reacting to the music

Every screen receives `audio` (`BeMusicAudioFrame`), a live analysis sampled once per frame. Gameplay analyses the whole mix; select analyses the BGM and the chart preview. It is `undefined` when the host has no Web Audio.

- **Loudness:** `level`, `peak` (0..1), and `db` (dBFS).
- **Energy:** `bass`, `mid`, and `high`.
- **Spectrum:** `bands`, 16 log-spaced bands from about 30 Hz to 14 kHz.
- **Onsets:** `onset`, which jumps to 1 on each transient and decays over about 150 ms; `onsetAtMs` is the time of the last one.

The bands and the bass / mid / high energies are placed within the range they covered over the last few seconds. As a result, they swing between hits even in a loud, compressed mix instead of resting at the top.

Pass the frame through `audioDrive(audio, effects)` before using it. It scales every value by the effects level (half at `'reduced'`, silent at `'off'`), so your reactions respect the player's comfort setting automatically. `bandLevel(drive.bands, index, count)` resamples the bands to your bar count, ready for a spectrum.

Make reactions large enough to read: a pulse of a few percent is invisible at 60 fps. The built-in skins scale shapes by roughly 0.8 to 1.6 with the bass.

## Effects level

`effects` (`'full'` / `'reduced'` / `'off'`) is the player's comfort setting:

- `'full'`: everything.
- `'reduced'`: no screen shake or full-screen flashes, and lighter particle counts.
- `'off'`: static chrome and a plain hit flash only.

`effectProfile(level)` turns it into the amounts the built-in skins use. Respect it: some players need it.

## Fonts

List every face you draw with in `fontLoads`. The host loads them with `document.fonts.load` before mounting, so the first frame does not rasterize with a fallback face. Make sure the host can obtain the face itself, either from a font service or bundled with your skin.

## Packaging and loading

- **Imports:** a skin module imports `@be-music/skin-sdk`, the rendering framework it chooses, and its own files. The built-in skins are held to this rule by a test, so anything they use from the player is available to you.
- **Export:** export the skin as the module's default export.
- **Hosts:** a host registers skins in a registry:

  ```ts
  import { BUILT_IN_BE_MUSIC_SKINS, DefaultPixiGameplayView } from '@be-music/player-web/scenes';
  import { createBeMusicSkinRegistry } from '@be-music/player-web/skin';
  import mySkin from 'my-be-music-skin';

  const skins = createBeMusicSkinRegistry(BUILT_IN_BE_MUSIC_SKINS);
  const problems = skins.add(mySkin); // [] when added; otherwise why it was refused
  const skin = skins.resolve('my-skin'); // falls back to the first skin for unknown ids
  // Pass it to the default-family views: new DefaultPixiGameplayView({ …, beMusicSkin: skin })
  ```

  - `add` validates the skin. A skin with an id that is already registered replaces the old one, which is handy while developing.
  - `subscribe(listener)` reports additions so a picker can refresh.
  - Skins that fail validation, for example because of an unsupported `apiVersion`, are left out instead of breaking the host.

- **Built-in skins:** `BUILT_IN_BE_MUSIC_SKINS` contains Synesthesia (the default), Phantom, and Plain. Lattice ships as `latticeSkin` for hosts to add.
- **Demo:** the demo's Debug Menu can add a skin from a module URL (_Add skin_ → _Skin module URL_). A skin runs with the page's full access, so the demo asks for confirmation first. Only load skins you trust.

## Versioning

- **When to bump `version`:** whenever you release the skin. Follow semantic versioning from the player's point of view: a new look is a minor version, a fix is a patch.
- **`apiVersion`:** set it to the SDK constant you built against. When the skin API changes incompatibly, the player raises `BE_MUSIC_SKIN_API_VERSION`. Skins written for an older revision are then refused until they are rebuilt against the new SDK.
- **Keep `id` stable:** hosts persist the selected skin by its `id`.

## Checklist

- [ ] Metadata passes `validateBeMusicSkin`.
- [ ] Framework resources created in `setup` are released in `teardown`.
- [ ] Chrome is placed from `layout`, and the judgement line is drawn per lane run.
- [ ] The BGA rect is left transparent when `runtime.hasBga`.
- [ ] NOW LOADING is shown while `runtime.loading`.
- [ ] Select rows line up with `select.layout`, and buttons are declared with `frame.hit` on every draw.
- [ ] Audio reactions go through `audioDrive`, and `effects` is respected.
- [ ] Every face is listed in `fontLoads`.
- [ ] Checked in single play, double play, 5 / 7 / 9 / 10 / 14 / 24 / 48 KEY, and with and without a BGA.
