[Japanese version](./be-music-skin.ja.md)

# Writing a be-music skin

This guide is for people who want to make a skin for the browser player's built-in (default) family. Skins are written against the `@be-music/player-web/skin-sdk` subpath. The built-in skins use exactly this subpath: Synesthesia, Phantom, Plain, and Lattice import nothing else from the player. Anything they do, your skin can do too.

A be-music skin is code, not a data file. LR2 and beatoraja themes are interpreted by a scene; a be-music skin instead supplies a set of drawing functions. The player keeps ownership of everything else:

- input, timing, audio, and judging;
- the lane layout and note positions;
- select-list hit-testing.

Your skin decides how every frame looks.

## Two ways to draw

|                | Canvas skin (`defineCanvasSkin`)                                               | Pixi skin (`defineBeMusicSkin`)                                                              |
| -------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Drawing API    | A plain `<canvas>` with a `'2d'`, `'webgl'`, `'webgl2'`, or `'webgpu'` context | PixiJS v8 display objects                                                                    |
| What you write | One `draw` function per screen                                                 | Separate renderers for the chrome, lanes, notes, long notes, hit effects, select, and result |
| Pixi knowledge | None                                                                           | Required                                                                                     |
| Example        | Plain (`packages/player-web/src/skins/plain/`)                                 | Synesthesia, Phantom, Lattice (`packages/player-web/src/skins/`)                             |

Start with a canvas skin unless you need Pixi features such as filters, blend modes, or GPU particles across many layers. Plain is deliberately small and readable; copy it as a starting point.

## Quick start: a canvas skin

```ts
import { BE_MUSIC_SKIN_API_VERSION, defineCanvasSkin, resolveLaneRuns } from '@be-music/player-web/skin-sdk';

export default defineCanvasSkin({
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

### How canvas skins draw

- **When `draw` runs:** the player calls it once per frame, right before rendering. With `'2d'`, the canvas is already cleared and scaled, so you draw in design pixels (854×480 on the default stage).
- **Other contexts:** with `'webgl'`, `'webgl2'`, or `'webgpu'`, you own the whole canvas. `surface.pixelRatio` gives the canvas pixels per design pixel.
- **`setup(surface)`:** runs once for each new surface before its first draw. Use it to compile shaders or request a GPU device. Drawing waits for a returned promise.
- **`contextAttributes`:** passed through to `canvas.getContext`.
- **Dot by dot:** each canvas is sized to the device pixels the stage covers on screen (viewport scale × `devicePixelRatio`) and shown with nearest sampling. Your pixels map one to one onto the screen.
- **Gameplay frame (`CanvasGameplayFrame`):**
  - `layout`
  - `lanes` (each with a key-beam intensity)
  - `notes` and `longNotes`
  - `bombs` (live hit effects with their age)
  - `runtime` (HUD values)
  - `beatPhase`, `effects`, and `audio`
- **Select frame (`CanvasSelectFrame`):** the [select frame](#select-bemusicselectskin) plus `hit(x, y, w, h, action)`, which makes a rect clickable. Return `true` from `select.draw` while something is still animating.
- **Optional settings:**
  - `gameplay.bombDurationMs` (default 300)
  - `select.outroMs` (default 0)
  - `stage` (default `wideStage`)

## Skin metadata

Every skin declares these fields. `defineBeMusicSkin` and `defineCanvasSkin` check them and throw when they are malformed, so a broken skin fails where it is defined.

| Field         | Required | Rule                                                                                                                                  |
| ------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `apiVersion`  | yes      | `BE_MUSIC_SKIN_API_VERSION` from the SDK you build against. The player refuses skins written for an API revision it does not support. |
| `id`          | yes      | Lowercase letters, digits, and hyphens (`my-skin`). Hosts persist it, so keep it stable across releases.                              |
| `label`       | yes      | Name shown in pickers.                                                                                                                |
| `version`     | yes      | Your skin's own release as a semantic version (`1.2.0`).                                                                              |
| `author`      | yes      | `{ name, url? }`. `url` must be http(s).                                                                                              |
| `description` | no       | One or two sentences for pickers.                                                                                                     |
| `homepage`    | no       | http(s) URL of the project page or repository.                                                                                        |
| `license`     | no       | SPDX identifier of the skin's code and assets (`MIT`).                                                                                |
| `fontLoads`   | yes      | CSS font shorthands the skin draws with (`'400 24px "Anton"'`). It may be empty.                                                      |
| `stage`       | no       | Design canvas; see [Stage and layout](#stage-and-layout).                                                                             |

`validateBeMusicSkin(skin)` returns the same problems as a list of messages without throwing.

## Stage and layout

- **Stage:** the stage is the design canvas a skin draws on. `wideStage` is the 16:9 stage the built-in skins use (854×480). A skin that declares no `stage` gets the LR2-compatible 640×480 canvas.
- **BGA placement:** `BeMusicStage.resolveBgaRect(playfieldRight)` decides where the gameplay BGA goes. The player composites the video there, and your skin frames the same rect. `wideStage` grows the BGA beside a single-play field and shrinks it next to wide double-play or keyboard fields.
- **Layout per frame:** each gameplay frame comes with `layout` (`BeMusicGameplayLayout`), resolved by the host:
  - `stage`: width and height.
  - `lanes`: every lane, with its channel, kind (`white` / `black` / `scratch`), side, x, and width. The full layout of the chart's play variant (5 / 7 / 9 / 10 / 14 / 24 / 48 KEY) is always present, even for lanes the chart never uses.
  - `playfield`: `left`, `right`, `centerX`, `top`, `judgementY`, and `sides` (the horizontal extent of 1P and, in double play, 2P).
  - `bga`: the BGA rect, or `undefined` when the playfield leaves no room.
- **Placing chrome:** place your chrome from these values instead of hard-coding geometry. Host-side layout changes (double play, keyboard modes, new aspect ratios) then reach your skin for free.
- **Double-play gap:** the 1P and 2P banks stand 60 px apart. `resolveLaneRuns(lanes)` returns one `{ left, right }` run per contiguous bank. Draw the judgement line and lane grid per run so nothing crosses the gap.
- **Lane widths:** lane widths are fixed by the player. Skins colour lanes, but never resize or move them.

## Pixi skins

`defineBeMusicSkin` takes the same metadata plus three screens. Draw with `pixi.js`, a peer dependency of the player.

### Gameplay (`BeMusicGameplaySkin`)

| Member                    | Called with                                                                        | Draws                                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `renderChrome(context)`   | `layer`, `overlayLayer`, their `ChildPool`s, `runtime`, `layout`                   | Everything around the playfield: header, gauge, score, BGA frame, judgement / combo, moments |
| `renderLanes(context)`    | one cleared `Graphics`, `lanes`, `beatPhase`, `nowMs`, `combo`, `effects`, `audio` | Lane beds, key beams, the judgement line                                                     |
| `renderNote(context)`     | a fresh pooled `Graphics`, lane `kind`, `x`, `w`, `y` (the note's bottom edge)     | One tap note                                                                                 |
| `renderLongNote(context)` | a fresh pooled `Graphics`, `kind`, `x`, `w`, `top` (tail), `bottom` (head)         | One long note                                                                                |
| `renderBombs(context)`    | a `ChildPool`, `bombs`, `nowMs`, `combo`, `effects`, `audio`                       | Every live hit effect                                                                        |
| `bombDurationMs`          | —                                                                                  | How long a hit effect lives                                                                  |

Acquire display objects from the pools you are given (`layerPool.acquireGraphics()`, `acquireText()`, …) instead of creating them per frame. The pools reuse last frame's objects, which keeps frame time flat.

### Values in `runtime`

`runtime` (`SkinlessGameplayChromeRuntime`) carries the HUD values:

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

### Select (`BeMusicSelectSkin`)

- **`layout`:** `listX`, `listTop`, `listBottomInset`, and `rowHeight`. The scene hit-tests rows with these numbers, so the rows you draw must match them.
- **`createRenderer()`:** called once per select scene. It returns a `BeMusicSelectRenderer` with:
  - `backLayer` and `frontLayer`: persistent layers behind and in front of the rebuilt frame.
  - `render(frame)`: rebuilds the input-driven chrome into `frame.layer`. Return `true` while a transition is still running.
  - `tick(nowMs, focusedSong, launchAt, audio)`: per-frame, transform-only animation of the persistent layers.
  - `outroMs`: length of the launch outro. The scene keeps rendering with `frame.launchAt` set until it ends, and ignores input meanwhile.
  - `dispose()`
- **Frame (`BeMusicSelectFrame`):**
  - `entries`, `selectedIndex`, `firstVisibleIndex`, `visibleRows`, `focusedSong`
  - `folderLabel`, `searchQuery`, `totalCharts`
  - `actions` (`play`, `autoPlay`, `activateSearch`)
  - timestamps for entrance and focus transitions
  - `effects`, `launchAt`
- **Clickable areas:** use `addHitArea` to make Pixi chrome clickable.

### Result (`BeMusicResultSkin`)

- **`render(frame)`:** rebuilds `frame.layer` every frame.
- **Frame contents:**
  - `result` (scores, judgement counts, gauge history, …)
  - `rankLabel` (IIDX DJ level) and `ratePercent`
  - `elapsedMs` since the scene mounted, or `Infinity` once the player skipped the entrance
  - `effects`
- **Helpers:** `resolveResultLamp` and `resolveResultTrackRows` give the clear lamp and track rows the built-in skins show.

## SDK helpers

| Area             | Helpers                                                                                                                                                                    |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stage            | `wideStage`, `resolveStageBgaRect`, `STAGE_WIDTH`, `STAGE_HEIGHT`, `STAGE_MARGIN`, `STAGE_SIDE_COLUMN`, `STAGE_BGA_BAND`                                                   |
| Layout           | `resolveGameplayLayout`, `resolveLaneRuns`, `resolveMilestoneArea`                                                                                                         |
| Text (Pixi)      | `addHudText`, `addHudNumber` (pooled, tinted, cap-height aligned), `addSkinText`, `addHitArea`, `formatPlayVariantLabel`, `DEFAULT_TEXT_FONT`                              |
| Particles (Pixi) | `pointLayerFor(graphics)`: GPU point particles that ride along with a pooled `Graphics`                                                                                    |
| Key beams (Pixi) | `keyBeamGradient(color)`, `KEY_BEAM_STOPS`                                                                                                                                 |
| Judgements       | `judgeDisplayWord` (a PERFECT prints as GREAT), `isFlashingGreat`, `flashingGreatColor`                                                                                    |
| Moments          | `trackMoments` / `updateMoments` (count-in, every 100 combo, clear line, full combo, combo break), `comboTier`, `momentProgress`, `impulse`, `punchScale`, `effectProfile` |
| Loading          | `LOADING_WORD`, `loadingDots(nowMs)`                                                                                                                                       |
| Sound            | `audioDrive`, `bandAt`, `bandLevel`; see [Reacting to the music](#reacting-to-the-music)                                                                                   |
| Result           | `resolveResultLamp`, `resolveResultTrackRows`                                                                                                                              |
| Song facts       | `resolveSongRowFacts`, `resolveSongStats`, `resolveSongTags`, `formatSongLength`, `formatBpmRange`                                                                         |
| Motion           | `easeOutCubic`, `easeOutBack`, `stageProgress`, `rollUpValue`, `hash01` (deterministic jitter)                                                                             |

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

- **Imports:** a skin module imports only `@be-music/player-web/skin-sdk`, `pixi.js` (Pixi skins), and its own files. The built-in skins are held to this rule by a test, so anything they use is available to you.
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
- [ ] Chrome is placed from `layout`, and the judgement line is drawn per lane run.
- [ ] The BGA rect is left visible (canvas skins: `clearRect` it when `runtime.hasBga`).
- [ ] NOW LOADING is shown while `runtime.loading`.
- [ ] Select rows line up with `select.layout`, and buttons are clickable.
- [ ] Audio reactions go through `audioDrive`, and `effects` is respected.
- [ ] Every face is listed in `fontLoads`.
- [ ] Checked in single play, double play, 5 / 7 / 9 / 10 / 14 / 24 / 48 KEY, and with and without a BGA.
