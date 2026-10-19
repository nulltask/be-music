import { Sprite, Texture, type Container } from 'pixi.js';
import {
  centerToAnchor,
  evaluateBeatorajaLuaNumber,
  imageFrameAt,
  imageFrameRect,
  imageRefFrame,
  type BeatorajaDestinationGroup,
  type BeatorajaImageElement,
  type BeatorajaImageId,
  type BeatorajaImagesetElement,
  type BeatorajaLuaRuntimeContext,
  type BeatorajaPmCharaElement,
} from '@be-music/beatoraja-skin';
import {
  applyBeatorajaStretchRect,
  createCroppedBeatorajaTexture,
  type BeatorajaRenderContext,
  type destinationToSpriteProps,
} from '../../../skin/beatoraja/render.ts';
import type { BeatorajaTextureCache } from '../../../skin/beatoraja/textures.ts';
import { applyTextureFilterMode, destroyTextureView, updateDynamicCropTexture } from './common.ts';
import type { BeatorajaSkinLuaContext } from './lua-context.ts';
import type { BeatorajaPlaySkinViewOptions } from './options.ts';

export interface SpriteEntry {
  kind: 'image';
  group: BeatorajaDestinationGroup;
  image: BeatorajaImageElement;
  /** Base texture (whole source). Sprite's texture is a cropped view of this. */
  baseTexture: ReturnType<BeatorajaTextureCache['get']>;
  sprite: Sprite;
  /** Frame index currently uploaded to `sprite.texture`. -1 means "no texture set yet". */
  currentFrame: number;
  /**
   * Last visible-height ratio painted by the disapearLine clip path. Hidden-cover entries (with
   * `image.disapearLine >= 0`) shrink the source crop and the sprite height proportionally as
   * the lift slider moves; this caches the last applied ratio so the per-frame crop only
   * rebuilds when the value actually changes. `1` (the default) is "no clip" — the full source
   * crop is used.
   */
  lastDisapearRatio: number;
  /** Reused for runtime-dependent crop rects so lift / hidden-cover animation does not grow the global crop cache. */
  dynamicCropTexture: Texture | undefined;
}

export interface ImagesetEntry {
  kind: 'imageset';
  group: BeatorajaDestinationGroup;
  element: BeatorajaImagesetElement;
  /**
   * Pre-resolved sub-image data, one entry per `images[]` slot. Each carries the matching
   * `BeatorajaImageElement` (so per-frame stepping still works inside a sub-image with
   * `divx` / `divy`) plus the cropped cell-0 texture for fast first-frame rendering. Slots
   * whose image lookup failed are `undefined`; the renderer falls back to the previous valid
   * slot (or hides the entry if none).
   */
  subImages: ReadonlyArray<
    | {
        image: BeatorajaImageElement;
        baseTexture: ReturnType<BeatorajaTextureCache['get']>;
      }
    | undefined
  >;
  sprite: Sprite;
  /** Last `images[]` index painted, used to skip the texture rebuild when the ref hasn't changed. */
  lastSubIndex: number;
  /** Last frame index uploaded to the sprite. -1 = never uploaded. */
  lastFrame: number;
}

/**
 * `pmchara[]` POMYU character entry. Popn-style 9K skins author dancing-character displays
 * keyed off a `source[]` slot's full texture (no sub-rect crop). The renderer paints the
 * source's whole image at the destination rect — frame-cycled animation driven by chart cues
 * is a follow-up patch; until then this entry behaves like a static fullscreen image. Source
 * resolution gracefully hides the sprite when the slot has no texture (typical case: the
 * `def: "Off"` filepath default is set, so no character pack loads).
 */
export interface PmCharaEntry {
  kind: 'pmchara';
  group: BeatorajaDestinationGroup;
  element: BeatorajaPmCharaElement;
  /** Full source texture (whole `source[].path` image) — `undefined` when no character pack loaded. */
  baseTexture: ReturnType<BeatorajaTextureCache['get']>;
  sprite: Sprite;
}

/**
 * Updates the `image[]` entries of a {@link BeatorajaPlaySkinView}, and builds and updates its `imageset[]` and
 * `pmchara[]` entries.
 */
export class BeatorajaImageRenderer {
  private readonly container: Container;
  private readonly height: number;
  private readonly resolveRefValue: (refOp: number) => number;
  private readonly onButtonAction:
    | ((act: number, modifiers?: { shift: boolean; ctrl: boolean; alt: boolean }) => void)
    | undefined;
  private readonly resolveIntegerProperty: BeatorajaSkinLuaContext['resolveIntegerProperty'];

  constructor(
    container: Container,
    height: number,
    options: BeatorajaPlaySkinViewOptions,
    resolveIntegerProperty: BeatorajaSkinLuaContext['resolveIntegerProperty'],
  ) {
    this.container = container;
    this.height = height;
    this.resolveRefValue = options.resolveRefValue ?? (() => 0);
    this.onButtonAction = options.onButtonAction;
    this.resolveIntegerProperty = resolveIntegerProperty;
  }

  /**
   * Build an imageset entry. Pre-resolves each `images[]` slot to its `image[]` element + base
   * texture so the per-frame update only swaps the cropped texture without re-walking the
   * imageById map. Returns `undefined` when none of the sub-images resolved (skin omitted them
   * all — better to skip than render an always-hidden sprite).
   */
  buildImagesetEntry(
    group: BeatorajaDestinationGroup,
    element: BeatorajaImagesetElement,
    imageById: ReadonlyMap<BeatorajaImageId, BeatorajaImageElement>,
    textures: BeatorajaTextureCache,
  ): ImagesetEntry | undefined {
    const subImages: ImagesetEntry['subImages'] = element.images.map((subId) => {
      const image = imageById.get(subId);
      if (image === undefined) return undefined;
      const baseTexture = textures.get(image.src);
      if (baseTexture === undefined) return undefined;
      return { image, baseTexture };
    });
    if (subImages.every((s) => s === undefined)) return undefined;
    // Pre-bind the first non-undefined sub-image's cell-0 texture so the first render pass has
    // something to paint (same WebGPU bind-group warm-up reasoning as the image / graph paths).
    let initialTexture: Texture | undefined;
    for (const sub of subImages) {
      if (sub === undefined) continue;
      const cell = imageFrameRect(sub.image, 0);
      const cropped = createCroppedBeatorajaTexture(sub.baseTexture, cell);
      if (cropped !== undefined) {
        initialTexture = cropped;
        break;
      }
    }
    const sprite = new Sprite({ texture: initialTexture, alpha: 0 });
    this.container.addChild(sprite);
    // Apply filter mode to the first resolvable sub-image's source. Sub-images typically share
    // a source (it's the same atlas), so this propagates to siblings.
    for (const sub of subImages) {
      if (sub !== undefined) {
        applyTextureFilterMode(sub.baseTexture, group.filter);
        break;
      }
    }
    // Click dispatch (audit 2.5). `imageset[].act` was previously dropped at the parser layer,
    // so default's `modeset` (act:11 cycles keymode filter) and similar imageset-driven cycle
    // buttons in GdbG / ModernChic didn't react to clicks. Mirror the `image[]` interactive
    // wiring — when `act > 0` and the host wires `onButtonAction`, hook a `pointertap`
    // handler that forwards the action code.
    if (element.act > 0 && this.onButtonAction !== undefined) {
      sprite.eventMode = 'static';
      sprite.cursor = 'pointer';
      const handler = this.onButtonAction;
      const actCode = element.act;
      sprite.on('pointertap', (event) => {
        const orig = event as unknown as { shiftKey?: boolean; ctrlKey?: boolean; altKey?: boolean };
        handler(actCode, {
          shift: orig.shiftKey === true,
          ctrl: orig.ctrlKey === true,
          alt: orig.altKey === true,
        });
      });
    }
    return { kind: 'imageset', group, element, subImages, sprite, lastSubIndex: -1, lastFrame: -1 };
  }

  /**
   * Build a `pmchara[]` entry — POMYU character display. The source's full texture is used as
   * the sprite (no sub-rect crop, no cell-strip animation). Hidden cleanly when the source
   * has no resolved texture (e.g. the user picked `def: "Off"` for the character filepath, or
   * the wildcard's `|TAG|` syntax didn't match any file in the pack — both are graceful
   * degradation paths for the common "no character pack dropped" case).
   */
  buildPmCharaEntry(
    group: BeatorajaDestinationGroup,
    element: BeatorajaPmCharaElement,
    textures: BeatorajaTextureCache,
  ): PmCharaEntry {
    const baseTexture = textures.get(element.src);
    const sprite = new Sprite({ texture: baseTexture, alpha: 0 });
    this.container.addChild(sprite);
    applyTextureFilterMode(baseTexture, group.filter);
    return { kind: 'pmchara', group, element, baseTexture, sprite };
  }

  updateImageEntry(
    entry: SpriteEntry,
    context: BeatorajaRenderContext,
    props: ReturnType<typeof destinationToSpriteProps>,
  ): void {
    const sprite = entry.sprite;

    // No base texture (or `Texture.EMPTY`, source-less) → must not enter the renderer's batch; WebGPU's
    // `_createBindGroup` deref's a null source.
    const baseTexture = entry.baseTexture;
    if (baseTexture === undefined || baseTexture === Texture.EMPTY) {
      sprite.visible = false;
      return;
    }

    sprite.visible = props.visible;
    if (!props.visible) return;

    // `ref` (op-driven frame) takes precedence over `cycle` animation — that's how lamp / judge-icon textures
    // swap between cells.
    const frameIndex =
      entry.image.ref !== 0
        ? imageRefFrame(entry.image, this.resolveRefValue(entry.image.ref))
        : imageFrameAt(entry.image, computeAnimationElapsed(entry, context));

    // `disapearLine` clip — hidden-cover sprites trim the BOTTOM portion of the rect (skin Y-UP
    // semantics: only `y > disapearLineAddedLift` is shown). In Pixi Y-DOWN that means the
    // sprite's TOP edge stays at `props.y` and the bottom edge gets pulled up to a Pixi y of
    // `canvasH - disapearLineAddedLift`. Without this, hidden-cover entries paint as plain
    // sprites at their full rect — which is why the reference theme's hidden-cover used to
    // appear at the bottom of the screen even when the lift slider was at home. The lift offset
    // resolution depends on `OFFSET_LIFT` going through `context.resolveOffset`; until that's
    // wired, lift defaults to 0 and the hidden-cover collapses to invisible (matching beatoraja's
    // "lift hides the cover by default" behavior — the player has to drag to reveal it).
    const disapearRatio = computeDisapearVisibleRatio(entry.image, props, this.height, context.resolveOffset);
    if (disapearRatio === 0) {
      // Whole rect is below the disappear line → nothing to paint.
      sprite.visible = false;
      return;
    }
    const visibleHeight = props.height * disapearRatio;

    if (frameIndex !== entry.currentFrame || disapearRatio !== entry.lastDisapearRatio) {
      const cell = imageFrameRect(entry.image, frameIndex);
      // ModernChic `Play/lua/sp/bomb.lua` (and similar Lua-driven skins) author `image[]`
      // entries with `w = -1, h = -1` — beatoraja's loader interprets that as "use the
      // texture's natural size, no crop" rather than as a flip flag (audit 3.17). Without
      // honoring the sentinel our impl returned `undefined` from the cropper and the bomb
      // sprites were silently hidden. Detect the sentinel here and pass the base texture
      // through unscaled — `disapearRatio < 1` cases still use the cropper for their partial
      // re-crop, but those are mutually exclusive with the "full texture" sentinel.
      const useFullTexture = entry.image.w <= 0 || entry.image.h <= 0;
      let cropped: Texture | undefined;
      if (useFullTexture) {
        entry.dynamicCropTexture = destroyTextureView(entry.dynamicCropTexture);
        cropped = entry.baseTexture;
      } else {
        const rect = {
          x: cell.x,
          y: cell.y,
          w: cell.w,
          h: cell.h * disapearRatio,
        };
        if (disapearRatio === 1) {
          entry.dynamicCropTexture = destroyTextureView(entry.dynamicCropTexture);
          cropped = createCroppedBeatorajaTexture(entry.baseTexture, rect);
        } else {
          entry.dynamicCropTexture = updateDynamicCropTexture(entry.dynamicCropTexture, entry.baseTexture, rect);
          cropped = entry.dynamicCropTexture;
        }
      }
      if (cropped === undefined) {
        // Cell width/height collapsed to 0 — hiding avoids the same null-source bind-group crash above.
        sprite.visible = false;
        return;
      }
      sprite.texture = cropped;
      entry.currentFrame = frameIndex;
      entry.lastDisapearRatio = disapearRatio;
    }

    // Apply the destination's `stretch` mode (audit 2.12). `stretch=0` (default = STRETCH)
    // is a no-op; FIT_INNER / FIT_OUTER / FIT_WIDTH / FIT_HEIGHT / NO_RESIZE / NO_EXPANDING
    // all preserve the source sprite's natural aspect ratio in some way. Without this the
    // dst rect always wins, so banner / jacket / stagefile elements that author `stretch:1`
    // got squashed to the dst rect's aspect (most visible: ModernChic Result mainmenu's
    // stagefile thumbnail authored `stretch = MAIN.STRETCH.FIT_OUTER_TRIMMED`).
    //
    // `stretchSource` reflects the source sprite's natural cell size from the texture; for
    // multi-cell `divx/divy` strips this is the cell size, not the entire atlas dimensions.
    const cellRectAtFrame = imageFrameRect(entry.image, entry.currentFrame);
    const stretched = applyBeatorajaStretchRect(
      { x: props.x, y: props.y, width: props.width, height: visibleHeight },
      { width: cellRectAtFrame.w, height: cellRectAtFrame.h },
      entry.group.stretch,
    );
    const center = centerToAnchor(entry.group.center);
    sprite.anchor.set(center.x, center.y);
    sprite.x = stretched.x + center.x * stretched.width;
    // Top edge is fixed at the stretched y; clip-trimmed bottom uses `visibleHeight`-scaled
    // height (already absorbed into `stretched.height` via the dst rect we passed in).
    sprite.y = stretched.y + center.y * stretched.height;
    sprite.width = stretched.width;
    sprite.height = stretched.height;
    // Honor the destination's authored mirror flag (negative `w` / `h` in beatoraja's skin).
    // `props.width` is already non-negative; we apply the mirror via `scale` so the texture
    // flips horizontally without disturbing the positioning math above.
    if (props.mirrorX) sprite.scale.x = -Math.abs(sprite.scale.x);
    if (props.mirrorY) sprite.scale.y = -Math.abs(sprite.scale.y);
    sprite.alpha = props.alpha;
    sprite.tint = props.tint;
    sprite.angle = props.angle;
    sprite.blendMode = props.blendMode;
    // Note: `dst.filter` (= `SkinObject.java:536-538`) is applied at BUILD time via
    // `applyTextureFilterMode(baseTexture, group.filter)` higher up in this file. Pixi's
    // `scaleMode` lives on the texture source (not the sprite), so a single application
    // when the entry is first mounted is sufficient — the mode persists across update
    // ticks regardless of which sprite is sampling the texture.
  }

  /**
   * Update an imageset entry. Resolves the runtime ref op to a sub-image index (clamped to the
   * `images[]` range), then paints the matching sub-image's cell-0 texture into the sprite. The
   * sub-image's own `divx` / `divy` / `timer` / `cycle` settings still apply — multi-frame
   * sub-images animate the same way regular `image[]` entries do, with the extra wrinkle that
   * the active sub-image switches based on `ref`.
   *
   * Hidden when:
   *   - The destination's standard `props` say so
   *   - The resolved sub-image is `undefined` (skin omitted that slot)
   *   - The sub-image's frame crop fails (degenerate `divx` / `divy` / source-rect)
   */
  updateImagesetEntry(
    entry: ImagesetEntry,
    context: BeatorajaRenderContext,
    props: ReturnType<typeof destinationToSpriteProps>,
    luaContext: BeatorajaLuaRuntimeContext,
  ): void {
    const sprite = entry.sprite;
    sprite.visible = props.visible;
    if (!props.visible) return;
    // Resolve the sub-image index from the ref op. `ref = 0` means "no ref" → always slot 0.
    // Out-of-range values clamp to the available images so a runtime that pushes a 1 into a
    // 1-slot imageset doesn't blank the sprite.
    let subIndex = 0;
    if (entry.element.valueProperty !== undefined || entry.element.ref !== 0) {
      const raw =
        entry.element.valueProperty !== undefined
          ? this.resolveIntegerProperty(entry.element.valueProperty, luaContext)
          : this.resolveRefValue(entry.element.ref);
      if (Number.isFinite(raw) && raw >= 0) {
        subIndex = Math.min(entry.element.images.length - 1, Math.floor(raw));
      }
    }
    const sub = entry.subImages[subIndex];
    if (sub === undefined) {
      // Fall back to the first valid slot — better than blanking when the skin authored a sub-id
      // that didn't resolve to a known image.
      let fallback: (typeof entry.subImages)[number];
      for (const s of entry.subImages) {
        if (s !== undefined) {
          fallback = s;
          break;
        }
      }
      if (fallback === undefined) {
        sprite.visible = false;
        return;
      }
      this.paintImagesetSprite(sprite, fallback, entry, context, props);
      return;
    }
    // Track the last index so we can short-circuit the texture rebuild when the ref didn't change.
    if (entry.lastSubIndex !== subIndex) {
      entry.lastSubIndex = subIndex;
      // Force a frame rebuild on the next branch so the sprite picks up the new sub-image.
      entry.lastFrame = -1;
    }
    this.paintImagesetSprite(sprite, sub, entry, context, props);
  }

  /**
   * Helper for `updateImagesetEntry`. Computes the active frame index for the picked sub-image
   * (using its own `divx` / `divy` / `timer` / `cycle`), crops the matching cell, and writes
   * sprite props. Extracted because the resolver-fallback path needs the same logic.
   */
  private paintImagesetSprite(
    sprite: Sprite,
    sub: NonNullable<ImagesetEntry['subImages'][number]>,
    entry: ImagesetEntry,
    context: BeatorajaRenderContext,
    props: ReturnType<typeof destinationToSpriteProps>,
  ): void {
    const baseTexture = sub.baseTexture;
    if (baseTexture === undefined || baseTexture === Texture.EMPTY) {
      sprite.visible = false;
      return;
    }
    // Frame selection mirrors `updateImageEntry` — when the sub-image carries its own `ref` op,
    // sample that and let `imageRefFrame` map the op value to a frame index; otherwise advance
    // by timer / cycle. (Distinct from the OUTER `element.ref` which selects WHICH sub-image is
    // active — that one already happened in `updateImagesetEntry`.)
    const refFrame = sub.image.ref !== 0 ? imageRefFrame(sub.image, this.resolveRefValue(sub.image.ref)) : -1;
    const frame = refFrame >= 0 ? refFrame : imageFrameAt(sub.image, computeImagesetTimerElapsed(sub.image, context));
    if (frame !== entry.lastFrame) {
      entry.lastFrame = frame;
      const cell = imageFrameRect(sub.image, frame);
      const cropped = createCroppedBeatorajaTexture(baseTexture, cell);
      if (cropped === undefined) {
        sprite.visible = false;
        return;
      }
      sprite.texture = cropped;
    }
    const center = centerToAnchor(entry.group.center);
    sprite.anchor.set(center.x, center.y);
    sprite.x = props.x + center.x * props.width;
    sprite.y = props.y + center.y * props.height;
    sprite.width = props.width;
    sprite.height = props.height;
    sprite.alpha = props.alpha;
    sprite.tint = props.tint;
    sprite.angle = props.angle;
    sprite.blendMode = props.blendMode;
  }

  /**
   * Update a `pmchara` entry — popn-style 9K POMYU character. Paints the source's full texture
   * at the destination rect (no sub-rect crop, no animation cycling). Hidden when:
   *
   *   - The destination's standard `props.visible` says so
   *   - The source has no texture (no character pack loaded, the wildcard's `|TAG|` syntax
   *     didn't match anything, or the `def: "Off"` filepath default is in effect)
   *
   * Frame-cycling animation driven by chart cues is a follow-up patch — most users running
   * 9K charts won't have a character pack dropped anyway, so the static rendering is graceful
   * out of the box.
   */
  updatePmCharaEntry(entry: PmCharaEntry, props: ReturnType<typeof destinationToSpriteProps>): void {
    const sprite = entry.sprite;
    if (!props.visible || entry.baseTexture === undefined || entry.baseTexture === Texture.EMPTY) {
      sprite.visible = false;
      return;
    }
    sprite.visible = true;
    sprite.texture = entry.baseTexture;
    const center = centerToAnchor(entry.group.center);
    sprite.anchor.set(center.x, center.y);
    sprite.x = props.x + center.x * props.width;
    sprite.y = props.y + center.y * props.height;
    sprite.width = props.width;
    sprite.height = props.height;
    sprite.alpha = props.alpha;
    sprite.tint = props.tint;
    sprite.angle = props.angle;
    sprite.blendMode = props.blendMode;
  }
}

/**
 * Per-sub-image animation clock — same lookup as `computeAnimationElapsed` but typed against the
 * sub-image's own `BeatorajaImageElement` instead of the SpriteEntry wrapper. Imageset sub-images
 * animate independently of one another even though they share an enclosing destination.
 */
function computeImagesetTimerElapsed(image: BeatorajaImageElement, context: BeatorajaRenderContext): number {
  const start = imageTimerStart(image, context);
  if (start === undefined) return 0;
  return Math.max(0, context.nowMs - start);
}

function computeAnimationElapsed(entry: SpriteEntry, context: BeatorajaRenderContext): number {
  // Animation timer defaults to "scene start" when the image's `timer` is 0. Otherwise wait for the named timer to
  // fire before advancing the cycle (mirrors beatoraja's behavior — a key-bomb animation only animates after the
  // matching key-bomb timer started).
  const start = imageTimerStart(entry.image, context);
  if (start === undefined) return 0;
  return Math.max(0, context.nowMs - start);
}

function imageTimerStart(image: BeatorajaImageElement, context: BeatorajaRenderContext): number | undefined {
  if (image.timerFunction !== undefined) {
    const value = evaluateBeatorajaLuaNumber(image.timerFunction, context.lua);
    if (value === undefined || value < 0) return undefined;
    return value / 1000;
  }
  if (image.timer === 0) return 0;
  return context.getTimerStart(image.timer);
}

/**
 * Compute the visible-height ratio for a sprite carrying a `disapearLine` clip (= the hidden-
 * cover behavior). Returns `1` when no clip is active (no disapearLine on the image OR the
 * line sits above the rect's top edge), `0` when the rect is entirely below the line (totally
 * hidden), and a fractional `[0, 1]` when the rect straddles the line. Mirrors `SkinHidden.java`'s
 * draw-time logic: only `y_skin > disapearLineAddedLift` shows.
 */
function computeDisapearVisibleRatio(
  image: BeatorajaImageElement,
  props: { y: number; height: number },
  canvasHeight: number,
  resolveOffset: BeatorajaRenderContext['resolveOffset'],
): number {
  if (!(image.disapearLine >= 0)) return 1;
  if (props.height <= 0) return 0;
  // OFFSET_LIFT.y is the player's lift slider in skin-pixel Y-UP units. `OFFSET_LIFT` is
  // property id `3` in beatoraja's `SkinProperty` constants. Without a wired resolver (or with
  // the lift slider at home) the value is 0 and the cover stays fully tucked away — matching
  // the reference theme's "lift hides the cover by default" behavior.
  const liftY = image.isDisapearLineLinkLift && resolveOffset !== undefined ? (resolveOffset(3)?.y ?? 0) : 0;
  const lineSkin = image.disapearLine + liftY;
  // Convert the skin-Y-UP line to a Pixi Y-DOWN coordinate so we can compare against the
  // sprite's screen-space rect. `props.y` is the sprite's top in Pixi (smaller y = higher up);
  // `props.y + props.height` is the bottom.
  const linePixi = canvasHeight - lineSkin;
  if (linePixi <= props.y) return 0; // Entire rect below the line — nothing visible.
  if (linePixi >= props.y + props.height) return 1; // Line above the rect's bottom — full draw.
  return (linePixi - props.y) / props.height;
}

/**
 * Synthetic image id `-110` BLACK — beatoraja's renderer recognises it as a virtual solid-black
 * panel. Skin authors reference it directly in `destination[]` for transition overlays / panel
 * backings without bundling a black PNG.
 */
export const SYNTHETIC_IMAGE_BLACK_ID = -110;
/** `-100` STAGEFILE — the chart's `#STAGEFILE` bitmap (loading-screen art). */
export const SYNTHETIC_IMAGE_STAGEFILE_ID = -100;
/** `-101` BACKBMP — the chart's `#BACKBMP` bitmap (select-scene preview). */
export const SYNTHETIC_IMAGE_BACKBMP_ID = -101;
/** `-102` BANNER — the chart's `#BANNER` bitmap (small song-bar banner). */
export const SYNTHETIC_IMAGE_BANNER_ID = -102;

/**
 * Build a synthetic `BeatorajaImageElement` for one of the chart-image sentinel ids. `w / h` are
 * sourced from the texture's natural pixel size so the destination's cell-cropping math
 * produces the right source rect — the dst rect handles the on-screen scaling separately.
 */
export function makeSyntheticChartImage(id: number, w: number, h: number): BeatorajaImageElement {
  return {
    id,
    src: 0,
    x: 0,
    y: 0,
    w,
    h,
    divx: 1,
    divy: 1,
    timer: 0,
    cycle: 0,
    ref: 0,
    len: 0,
    act: 0,
    click: 0,
    disapearLine: -1,
    isDisapearLineLinkLift: false,
    ifCodes: [],
  };
}

/**
 * `BeatorajaImageElement` shape for the synthetic black panel. The `src` is irrelevant since we
 * supply the texture directly (1×1 black canvas via `ensureBlackTexture`); the `w / h` need to
 * be `1 × 1` so the destination's cell-cropping math leaves the texture intact.
 */
export const SYNTHETIC_BLACK_IMAGE: BeatorajaImageElement = {
  id: SYNTHETIC_IMAGE_BLACK_ID,
  src: 0,
  x: 0,
  y: 0,
  w: 1,
  h: 1,
  divx: 1,
  divy: 1,
  timer: 0,
  cycle: 0,
  ref: 0,
  len: 0,
  act: 0,
  click: 0,
  disapearLine: -1,
  isDisapearLineLinkLift: false,
  ifCodes: [],
};

/**
 * Module-singleton 1×1 black texture. Built lazily on first use so headless test environments
 * (no `document`) can construct `BeatorajaPlaySkinView` without crashing — they fall back to
 * `Texture.EMPTY` (renders as transparent, which still keeps the rest of the scene functional).
 */
let blackTextureCache: Texture | undefined;
export function ensureBlackTexture(): Texture {
  if (blackTextureCache !== undefined) return blackTextureCache;
  if (typeof document === 'undefined') {
    blackTextureCache = Texture.EMPTY;
    return blackTextureCache;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    blackTextureCache = Texture.EMPTY;
    return blackTextureCache;
  }
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, 1, 1);
  blackTextureCache = Texture.from(canvas);
  return blackTextureCache;
}
