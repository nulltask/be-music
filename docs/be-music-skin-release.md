[Japanese version](./be-music-skin-release.ja.md)

# Be-Music Skin performance and distribution

[Skin authoring guide](./be-music-skin.md)

<details>
<summary>Table of contents</summary>

- [Performance](#performance)
  - [General techniques](#general-techniques)
  - [Canvas 2D](#canvas-2d)
  - [WebGL / WebGL 2](#webgl--webgl-2)
  - [WebGPU](#webgpu)
  - [With a framework](#with-a-framework)
- [Fonts](#fonts)
- [Packaging and loading](#packaging-and-loading)
- [Versioning](#versioning)
- [Checklist](#checklist)

</details>

## Performance

At 120 Hz, the browser has about 8 ms for each frame. That budget includes the player’s judgment, audio scheduling and BGA decoding. On a mid-range laptop, aim for less than 4 ms in `draw`.

### General techniques

- **Measure first.** Record a play in the browser's Performance panel, or wrap your `draw` in `performance.now()` calls. Use a dense chart, the highest available refresh rate, a high `devicePixelRatio`, and `effects: 'full'`.
- **Draw only what changed.**
  - Static layers can be rendered once and reused: backgrounds, frames, labels, lane beds, and anything else that depends only on the layout. Keep them in an offscreen canvas or texture.
  - Rebuild them only when their inputs change: `layout` changes with the chart's lanes, and select state changes with `frame.revision`.
- **Don't allocate in the hot path.** New arrays, objects, closures, and strings every frame feed the garbage collector, and its pauses show up as hitches. Instead:
  - Reuse buffers and pools.
  - Precompute colour strings and lookup tables.
  - Keep per-hit randomness deterministic with `hash01` and a seed instead of storing particle objects.
- **Batch by state.** Group everything that shares a colour, texture, blend mode, or shader, and draw each group in one go. Changing state between every note is usually the biggest cost.
- **Treat text as an image.** Rasterizing text is expensive.
  - Render a label once and redraw it only when its value changes.
  - Build numbers from a digit atlas. `layoutTabularRun` gives you the glyph positions.
- **Budget effects.**
  - Cap particle counts, and share one budget across overlapping hits instead of giving each hit its own.
  - Scale with `effectProfile(effects)`.
  - Drop the decorative layers first under `'reduced'` and `'off'`.
- **Mind the fill rate.** The surface is dot by dot, so at `devicePixelRatio` 3 there are nine times as many pixels as at 1. Full-screen gradients, large translucent overlays, and blurs all scale with that. Render costly soft layers at a lower resolution and scale them up, or replace them with pre-rendered sprites.
- **Never read pixels back.** `getImageData`, `readPixels`, and buffer `mapAsync` stall the pipeline.
- **Prepare in `setup`.**
  - Decode images (`createImageBitmap`, `await image.decode()`), build atlases, and compile shaders there, never in the first draw.
  - List your fonts in `fontLoads`.

### Canvas 2D

- **Group by fill.** Set `fillStyle` once per colour group rather than once per shape; sort notes by kind if that helps.
- **Batch paths.**
  - Use `fillRect` for rectangles.
  - For many shapes of one style, call `beginPath()` once, add every `rect()` / `arc()`, and `fill()` once.
- **Avoid `shadowBlur` and `filter`.** Both are very slow per draw call. Fake glows with a pre-rendered glow sprite drawn with `drawImage`, using `globalCompositeOperation = 'lighter'` for additive light.
- **Stamp repeated shapes.** Draw a note, bomb frame, or glyph once into an `OffscreenCanvas` and stamp it with `drawImage`. That is far cheaper than rebuilding the path.
- **Snap to whole pixels.** Rounding coordinates (`Math.round`) avoids anti-aliasing work and keeps edges crisp on the dot-by-dot surface.
- **Avoid needless state changes.** Changing `font`, `globalAlpha`, or the composite mode costs; cache `measureText` results.
- **Don't clear twice.** The surface comes cleared every frame.

### WebGL / WebGL 2

- **Cut draw calls.**
  - Draw all notes (or all particles) in one call with instancing: `drawArraysInstanced` in WebGL 2, or `ANGLE_instanced_arrays` in WebGL 1.
  - Pack images into texture atlases.
  - Use vertex array objects to skip per-draw attribute setup.
- **Keep GPU resources alive.**
  - Allocate buffers and textures in `setup`.
  - Update them each frame with `bufferSubData` into a preallocated `DYNAMIC_DRAW` buffer; never create or delete them per frame.
- **Avoid synchronous calls.**
  - Look up uniform and attribute locations once.
  - Keep `getError`, `getParameter`, and `readPixels` out of the hot path; each forces the CPU to wait for the GPU.
- **Sort by state.** Order draws by program, then texture, then blend mode.
- **Composite correctly.** The canvas is composited over the BGA, so output premultiplied colour and blend with `blendFunc(ONE, ONE_MINUS_SRC_ALPHA)`. Request `{ alpha: true, premultipliedAlpha: true }` in `contextAttributes`.
- **Weigh anti-aliasing.** MSAA (`antialias: true`) multiplies fill cost at high density. Pixel-precise skins can turn it off.
- **Handle context loss.** Listen for `webglcontextlost` / `webglcontextrestored` on the canvas and rebuild your resources.

### WebGPU

- **Build everything up front.** Create pipelines (`createRenderPipelineAsync`), bind group layouts, bind groups, and buffers in `setup`; cache bind groups instead of recreating them per frame.
- **Configure for the BGA.** Configure the context once with `format: navigator.gpu.getPreferredCanvasFormat()` and `alphaMode: 'premultiplied'`, so the BGA shows through transparent pixels.
- **Encode lean frames.**
  - Use one command encoder and as few render passes as possible.
  - Upload per-frame data with `queue.writeBuffer` into persistent buffers.
  - Draw notes and particles instanced.
- **No readback.** Avoid `mapAsync` in the frame loop.
- **Handle device loss.** Watch `device.lost` and recreate the device and resources.

### With a framework

- **Retain the scene graph.**
  - Rebuild the select scene only when `frame.revision` changes.
  - Pool per-frame display objects instead of creating and destroying them. `skins/pixi-kit` shows both, with `ChildPool` and `definePixiSkin`.
- **PixiJS specifics:**
  - Reuse `Text` objects and `TextStyle` instances so texts keep their textures.
  - Use `ParticleContainer` for thousands of sprites.
  - Set `eventMode = 'none'`; the player handles input.
- **three.js specifics:**
  - Use `InstancedMesh` for notes and particles, and merge static geometry.
  - Reuse materials.
  - `dispose()` everything in `teardown`.

## Fonts

List every face you draw with in `fontLoads`. The host loads them with `document.fonts.load` (the web player waits for its registered skins' faces at start-up and loads an added skin's in the background), so the first frame does not rasterize with a fallback face. Make sure the host can obtain the face itself, either from a font service or bundled with your skin.

A skin that draws with the system's faces needs no web fonts: `DEFAULT_TEXT_FONT` is the system sans-serif, which covers Japanese, and `fontLoads` stays empty. The built-in skins show both approaches:

| Skin        | Latin labels and figures | Japanese and other text | `fontLoads`            |
| ----------- | ------------------------ | ----------------------- | ---------------------- |
| Synesthesia | Orbitron                 | M PLUS 1p               | Orbitron and M PLUS 1p |
| Plain       | System sans-serif        | System sans-serif       | Empty                  |
| Native      | System sans-serif        | System sans-serif       | Empty                  |

A face without Japanese (such as Orbitron) is followed in its stack by one that has it, so titles and artists still show.

## Packaging and loading

- **Install:** add `@be-music/player-skin-sdk` as a dependency of your skin (`npm install @be-music/player-skin-sdk`), along with the rendering framework you use. You don't need `@be-music/player-browser`.
- **Imports:** a skin module imports `@be-music/player-skin-sdk`, the rendering framework it chooses, and its own files. The built-in skins are held to this rule by a test, so anything they use from the player is available to you.
- **Export:** export the skin as the module's default export.
- **Hosts:** a host registers skins in a registry:

  ```ts
  import { createPlayScene } from '@be-music/player-browser/host';
  import { BUILT_IN_BE_MUSIC_SKINS, createBeMusicSkinRegistry } from '@be-music/player-browser/skin';
  import mySkin from 'my-be-music-skin';

  const skins = createBeMusicSkinRegistry(BUILT_IN_BE_MUSIC_SKINS);
  const problems = skins.add(mySkin); // [] when added; otherwise why it was refused
  const skin = skins.resolve('my-skin'); // falls back to the first skin for unknown ids
  // Pass it to the built-in scenes in their kit: createPlayScene({ family: 'built-in', skin, settings }, { … })
  ```

  - `add` validates the skin. A skin with an id that is already registered replaces the old one, which is handy while developing.
  - `subscribe(listener)` reports additions so a picker can refresh.
  - Skins that fail validation, for example because of an unsupported `apiVersion`, are left out instead of breaking the host.

- **Built-in skins:** `BUILT_IN_BE_MUSIC_SKINS` contains Synesthesia (the default), Plain, and Native. Synesthesia and Native have a decide screen; Plain goes straight to the play.
- **Player:** the player's Options dialog can add a skin from a module URL (_Skin & display_ → _Add skin_ → _Skin module URL_). A skin runs with the page's full access, so the player asks for confirmation first. Only load skins you trust. The player currently hides _Add skin_ while `ADD_SKIN_ENABLED` is off (`services/built-in-skins.ts`).

## Versioning

- **When to bump `version`:** whenever you release the skin. Follow semantic versioning from the player's point of view: a new look is a minor version, a fix is a patch.
- **`apiVersion`:** set it to the SDK constant you built against. The skin API is still being defined: its revision is `0`, and it may change incompatibly without the number moving, so rebuild your skin against each new SDK. The first stable revision will be `1`; from then on, an incompatible change raises `BE_MUSIC_SKIN_API_VERSION`, and skins written for an older revision are refused until they are rebuilt. Skins that declared `1` before the API was marked unstable still run.
- **Keep `id` stable:** hosts persist the selected skin by its `id`.

## Checklist

- [ ] Metadata passes `validateBeMusicSkin`.
- [ ] Framework resources created in `setup` are released in `teardown`.
- [ ] Chrome is placed from `layout`, and the judgement line is drawn per lane run.
- [ ] The BGA rect is left transparent when `runtime.hasBGA`.
- [ ] NOW LOADING is shown while `runtime.loading`.
- [ ] Select rows line up with `select.layout`, and buttons are declared with `frame.hit` on every draw.
- [ ] Every `draws*` flag you set is matched by drawing that element yourself.
- [ ] Optional runtime fields and `chartImage` lookups that come back `undefined` have a fallback.
- [ ] Timing displays treat positive `deltaMs` as late (SLOW) and negative as early (FAST).
- [ ] `settings` ids are unique and every default is valid.
- [ ] Audio reactions go through `audioDrive`, and `effects` is respected.
- [ ] Every face is listed in `fontLoads`.
- [ ] `draw` stays well under half a frame on a dense chart at high density, with no per-frame allocations or pixel readback.
- [ ] Checked in single play, double play, 5 / 7 / 9 / 10 / 14 / 24 / 48 KEY, and with and without a BGA.
- [ ] With a `portraitStage`: checked held upright on a phone and a tablet, and rotated mid-play.
