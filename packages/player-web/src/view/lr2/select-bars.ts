/**
 * The bar list of an LR2 select skin, drawn for one frame: each `#DST_BAR_BODY_OFF` / `_ON` slot around `#BAR_CENTER`
 * with its `#SRC_BAR_BODY`, title (`#SRC_BAR_TITLE`, or a system-font fallback), level (`#SRC_BAR_LEVEL`), lamp
 * (`#SRC_BAR_LAMP`) and, on the focused bar, `#SRC_BAR_FLASH`.
 *
 * The functions read the view through {@link LR2SelectBarsContext}; the LR2 select view passes its members.
 */

import type {
  LR2BarFlashElement,
  LR2BarLampSource,
  LR2BarLevelSource,
  LR2BarTitleElement,
  LR2DestinationRect,
  LR2ImageRect,
  LR2NumberElement,
  LR2Skin,
  LR2TextElement,
} from '@be-music/lr2-skin';
import { pickLR2BarBody, resolveLR2BarLamp, resolveLR2BarLevel } from '@be-music/lr2-skin/state';
import type { LibraryChart, LibraryEntry } from '@be-music/scene-model';
import { Color, Sprite, Text, TextStyle, type Container, type Texture } from 'pixi.js';
import type { LR2LoadedFont } from '../../skin/lr2/bitmap-text.ts';
import {
  applyDestinationToSprite,
  containerSpriteSink,
  createCroppedTexture,
  evaluateKeyframes,
  normalizeRect,
  pickAnimatedCell,
  renderNumberElement,
} from '../../skin/lr2/render.ts';
import { clampFontSize, isDestinationVisible, makeLR2TextSprite } from '../../skin/lr2/scene-render.ts';
import type { LR2SkinTextureStore } from '../../skin/lr2/scene-textures.ts';
import { LR2_TEXT_FALLBACK_FONT } from '../shared/fonts.ts';
import type { SelectFrame } from '../types.ts';

const TEXT = new Color('#f6f2e8');

/** What the bars read and draw into: the LR2 select view's members of these names. */
export interface LR2SelectBarsContext {
  /** The layer the bars are drawn into. */
  readonly listLayer: Container;
  readonly skinTextures: LR2SkinTextureStore;
  /** The skin's `#LR2FONT` fonts by index, once loaded. */
  readonly bitmapFonts: ReadonlyMap<number, LR2LoadedFont>;
  readonly entries: readonly LibraryEntry[];
  readonly cursor: number;
  /** The last frame drawn, for the player's records. */
  readonly frame: SelectFrame | undefined;
  /** How long ago `timer` started, in ms. */
  elapsedSinceTimer(timer: number): number;
  /** The DST of an element at this moment. */
  evaluateElementDst(element: { destination: LR2DestinationRect; keyframes: LR2DestinationRect[] }): LR2DestinationRect;
  /** Whether `timer` runs, so the elements anchored to it draw. An arrow, so it can be handed on unbound. */
  readonly timerActive: (timer: number) => boolean;
  /** A sprite of `source`'s current cell at `dst`. */
  makeSlicedSprite(source: LR2ImageRect, dst: LR2DestinationRect, label?: string): Sprite | undefined;
}

/**
 * Populates the skin's `#DST_BAR_BODY_OFF` / `_ON` slots with songs from the current collection, with the
 * `selectedIndex` song landing at the `BAR_CENTER` slot. Slots outside `BAR_AVAILABLE` still render (LR2 spec: they
 * decorate the scroll edges) but no song is mapped to them.
 */
export function renderLR2SelectBars(ctx: LR2SelectBarsContext, skin: LR2Skin, ops: ReadonlySet<number>): void {
  const layout = skin.barLayout;
  if (layout.slots.length === 0) {
    return;
  }
  const slotCount = layout.slots.length;
  const center = clampSlot(layout.center, slotCount);
  // Choose the OFF/ON state per slot — only the center slot uses ON.
  const entries = ctx.entries;
  for (const slot of layout.slots) {
    const offset = slot.index - center;
    // Wrap so off-edge slots show entries from the opposite end. E.g. with 3 entries and a slot below the cursor's
    // "current+3" position, the slot displays `entries[0]` again — matching LR2's circular rail rendering.
    const targetIndex = wrapIndex(ctx.cursor + offset, entries.length);
    const entry = targetIndex !== undefined ? entries[targetIndex] : undefined;
    const isCenter = slot.index === center;
    // Interpolate the slot's keyframe chain instead of pinning to the final keyframe. The skin typically anchors
    // `#DST_BAR_BODY` animations to timer 11 (song change), which we re-stamp on every cursor move via
    // `noteCursorChange`, so the bars slide into their new positions over the keyframe duration.
    const keyframes = isCenter && slot.onKeyframes.length > 0 ? slot.onKeyframes : slot.offKeyframes;
    const fallbackDst = isCenter && slot.on ? slot.on : (slot.off ?? slot.on);
    if (!fallbackDst) continue;
    const dst =
      keyframes.length > 1 ? evaluateKeyframes(keyframes, ctx.elapsedSinceTimer(fallbackDst.timer)) : fallbackDst;
    if (!isDestinationVisible(dst, ops, ctx.timerActive)) {
      continue;
    }
    const body = pickLR2BarBody(layout.bodies, entry);
    if (body) {
      const texture = ctx.skinTextures.get(body.source.imagePath);
      if (texture) {
        const label = `bar-body[slot=${slot.index},kind=${body.kind}${isCenter ? ',center' : ''}]`;
        const sprite = makeBarBodySprite(ctx, texture, body.source, dst, label);
        if (sprite) {
          ctx.listLayer.addChild(sprite);
        }
      }
    }
    if (entry) {
      // BAR_TITLE DST x/y are RELATIVE to the bar's top-left (`bar.txt`: DST coordinates are specified relative to the bar's xy origin).
      drawBarTitleText(ctx, entry, dst, layout.title, skin);
    }
    // BAR_LEVEL: per-bar level number for SONG entries only. Folder entries don't carry a level so they leave the
    // slot blank.
    if (entry?.kind === 'chart' && layout.levels.length > 0 && layout.levelDestination) {
      drawBarLevel(ctx, entry.chart, dst, layout.levels, layout.levelDestination);
    }
    // BAR_FLASH: focused-bar overlay. DST is relative to the bar (like BAR_TITLE), so we add the bar's xy onto the
    // flash DST before drawing.
    if (isCenter && layout.flash) {
      drawBarFlash(ctx, layout.flash, dst);
    }
    // BAR_LAMP: a song or course bar's best lamp from the player's records, placed relative to the bar like
    // BAR_TITLE. BAR_RANK is not drawn yet.
    if (entry !== undefined && layout.lamps.length > 0 && layout.lampDestination !== undefined) {
      drawBarLamp(ctx, entry, dst, layout.lamps, layout.lampDestination);
    }
  }
}

/**
 * Draws the `#SRC_BAR_LAMP` of a song or course bar for its best lamp (LR2 draws NO PLAY too, as its own lamp). A skin
 * without that lamp's art draws nothing; folder bars have no lamp here.
 */
function drawBarLamp(
  ctx: LR2SelectBarsContext,
  entry: LibraryEntry,
  bar: LR2DestinationRect,
  lamps: ReadonlyArray<LR2BarLampSource>,
  lampDst: LR2DestinationRect,
): void {
  if (entry.kind === 'folder') return;
  const record =
    entry.kind === 'chart' ? ctx.frame?.records.chart(entry.chart) : ctx.frame?.records.course(entry.course);
  const kind = resolveLR2BarLamp(record?.lamp);
  const lamp = lamps.find((source) => source.kind === kind);
  if (lamp === undefined) return;
  const absoluteDst: LR2DestinationRect = { ...lampDst, x: bar.x + lampDst.x, y: bar.y + lampDst.y };
  const sprite = ctx.makeSlicedSprite(lamp.source, absoluteDst, `bar-lamp[${kind}]`);
  if (sprite) ctx.listLayer.addChild(sprite);
}

/**
 * Renders the `#SRC_BAR_FLASH` overlay on the focused bar. The DST coordinates in the flash element are **relative**
 * to the focused bar's `BAR_BODY_ON` rect, mirroring how BAR_TITLE / BAR_LEVEL place themselves. We compose the
 * absolute DST and then delegate to `makeSlicedSprite` so any animation cycle / cell cycling is honored.
 */
function drawBarFlash(ctx: LR2SelectBarsContext, flash: LR2BarFlashElement, bar: LR2DestinationRect): void {
  const flashDst = ctx.evaluateElementDst(flash);
  const absoluteDst: LR2DestinationRect = {
    ...flashDst,
    x: bar.x + flashDst.x,
    y: bar.y + flashDst.y,
  };
  const sprite = ctx.makeSlicedSprite(flash.source, absoluteDst, 'bar-flash');
  if (sprite) {
    ctx.listLayer.addChild(sprite);
  }
}

/**
 * Renders the per-bar level number sprite for `song`. Picks the `#SRC_BAR_LEVEL` entry whose kind matches the chart's
 * `#DIFFICULTY` field (1=BEGINNER..5=INSANE), falling back to the "undefined" kind when no specific entry is
 * available. The DST offset is added on top of the bar's own xy because LR2 scopes BAR_LEVEL coordinates to the bar's
 * top-left.
 */
function drawBarLevel(
  ctx: LR2SelectBarsContext,
  chartEntry: LibraryChart,
  bar: LR2DestinationRect,
  levels: ReadonlyArray<LR2BarLevelSource>,
  levelDst: LR2DestinationRect,
): void {
  const barLevel = resolveLR2BarLevel(chartEntry);
  if (barLevel === undefined) {
    return;
  }
  const playLevel = barLevel.level;
  const level =
    levels.find((entry) => entry.kind === barLevel.kind) ??
    levels.find((entry) => entry.kind === 'undefined') ??
    levels[0];
  if (!level) {
    return;
  }
  // Translate the relative DST into absolute coordinates on the bar.
  const absoluteDst: LR2DestinationRect = {
    ...levelDst,
    x: bar.x + levelDst.x,
    y: bar.y + levelDst.y,
  };
  const fakeNumberElement: LR2NumberElement = {
    source: level.source,
    destination: absoluteDst,
    keyframes: [absoluteDst],
    // Synthetic element built per-frame for digit rendering; never enters the pre/post-bar layer routing, so a `-1`
    // sentinel is fine here. The renderer pumps it directly through `renderNumberElement` rather than the chrome
    // dispatcher.
    declarationOrder: -1,
  };
  // Suppress leading zeros — `keta` on BAR_LEVEL means "max number of digits" (slot reservation for centering math),
  // NOT "force pad to that width". Without this flag a level of 7 would render as "07" inside a 2-digit field,
  // pushing the visible "7" half a field-width to the right and leaving a stray "0" at the left edge of the bar —
  // visibly offset from where the LR2 default skin places it. Centering math still uses the full field width so
  // single-digit numbers sit at the field's middle.
  renderNumberElement(
    containerSpriteSink(ctx.listLayer),
    fakeNumberElement,
    playLevel,
    ctx.skinTextures.asReadonlyMap(),
    absoluteDst,
    { suppressLeadingZeros: true },
  );
}

function makeBarBodySprite(
  ctx: LR2SelectBarsContext,
  texture: Texture,
  source: LR2ImageRect,
  destination: LR2DestinationRect,
  label?: string,
): Sprite | undefined {
  const rect = normalizeRect(destination);
  if (rect.w <= 0 || rect.h <= 0) {
    return undefined;
  }
  // BAR_BODY may animate (glow rotation, focus pulse) via the source's `cycle` ms over its `divx * divy` cells. We
  // resolve the active cell here so the bar sprite changes frame over time when the skin defines an animation.
  const elapsed = ctx.elapsedSinceTimer(source.timer);
  const cell = pickAnimatedCell(source, elapsed, destination.loop);
  const cropped = createCroppedTexture(texture, cell) ?? texture;
  const sprite = new Sprite(cropped);
  sprite.label = label ?? 'bar-body';
  sprite.position.set(rect.x, rect.y);
  sprite.width = rect.w;
  sprite.height = rect.h;
  applyDestinationToSprite(sprite, destination);
  return sprite;
}

/**
 * Draws the song title at the `BAR_TITLE` destination (xy relative to the bar's top-left).
 *
 * When the skin defines `#SRC_BAR_TITLE` and the matching `#LR2FONT` payload has decoded, we route through
 * `makeLR2TextSprite` so the title renders with the skin's authored bitmap font (the LR2 default's 14 px pixel-art
 * face for the bar list, glyph-tinted per `#DST_BAR_TITLE`'s RGBA). Otherwise we fall back to a system-font `Text` —
 * either while fonts are still loading, or for skins that omit `#SRC_BAR_TITLE` entirely.
 *
 * No artist sub-line: LR2's bar list shows just the title (or folder name). Per-song artist / genre live in the
 * dedicated info panel populated by the skin's `#SRC_TEXT` slots — not the bar list itself.
 */
function drawBarTitleText(
  ctx: LR2SelectBarsContext,
  entry: LibraryEntry,
  bar: LR2DestinationRect,
  titleElement: LR2BarTitleElement | undefined,
  skin: LR2Skin,
): void {
  const titleRect = titleElement?.destination ?? { x: 12, y: 8, w: bar.w - 24, h: 20 };
  const x = bar.x + titleRect.x;
  const y = bar.y + titleRect.y;
  const w = Math.max(1, titleRect.w);
  const h = Math.max(1, titleRect.h);
  const primaryText =
    entry.kind === 'chart'
      ? entry.chart.title
      : entry.kind === 'course'
        ? entry.course.definition.name
        : entry.folder.label;
  if (titleElement) {
    // Build a synthetic `LR2TextElement` carrying just the fields `makeLR2TextSprite` reads — font index, alignment
    // (BAR_TITLE has no LR2-spec alignment field, so left-anchor is the conventional rendering), and the absolute
    // `destination` on the bar's coordinate frame. Going through `makeLR2TextSprite` means the bitmap-font path
    // automatically engages once `#LR2FONT` payloads finish decoding, mirroring how the chrome-text path works.
    const synthetic: LR2TextElement = {
      font: titleElement.font,
      // 0 = freeform string. The bar list never queries `st` for text resolution since we pass the value directly,
      // and `makeLR2BitmapTextSprite` only uses it for a debug label — any non-clashing value is fine.
      st: 0,
      alignment: 'left',
      edit: 0,
      panel: 0,
      destination: { ...titleElement.destination, x, y, w, h },
      keyframes: [],
      declarationOrder: 0,
    };
    const sprite = makeLR2TextSprite(primaryText, synthetic, synthetic.destination, {
      bitmapFonts: ctx.bitmapFonts,
      systemFontSizes: skin.systemFontSizes,
    });
    sprite.label = `bar-title[${entry.kind}=${primaryText}]`;
    ctx.listLayer.addChild(sprite);
    return;
  }
  // No `#SRC_BAR_TITLE` — fall back to a basic font-backed `Text`. LR2 default skins use pixel-art fonts (typically
  // 12 px tall) for BAR_TITLE; Pixi `Text` is taller pixel-for-pixel, so cap the font size
  // at 14 px and leave 2 px breathing room below `h`.
  const titleFontSize = clampFontSize(h - 2, 8, 14);
  // No `wordWrap` — LR2 spec auto-shrinks long titles horizontally rather than wrapping (`docs/LR2SkinHelp.md` line
  // 1343). The squeeze below mirrors that.
  const titleText = new Text({
    text: primaryText,
    style: new TextStyle({
      fill: TEXT,
      fontSize: titleFontSize,
      // A regular weight reads cleaner at small sizes than the heavy title face.
      fontWeight: '500',
      fontFamily: LR2_TEXT_FALLBACK_FONT,
      // Outlined text — LR2 reference skins bake a 1–2 px black outline into their bar-title bitmaps so titles
      // read cleanly against the colored BAR_BODY artwork. Match that by stroking the fallback.
      stroke: { color: 0x000000, width: 2, alignment: 0.5, join: 'round' },
    }),
  });
  titleText.label = `bar-title[${entry.kind}=${primaryText}]`;
  titleText.position.set(x, y);
  if (w > 0 && titleText.width > w) {
    titleText.scale.x = w / titleText.width;
  }
  ctx.listLayer.addChild(titleText);
}

/** `value` as a slot index of a bar layout with `slotCount` slots: truncated and clamped, 0 when there are none. */
export function clampSlot(value: number, slotCount: number): number {
  if (slotCount <= 0) return 0;
  return Math.min(slotCount - 1, Math.max(0, Math.trunc(value)));
}

/**
 * Maps any integer (including negatives or values past the end) into `[0, count)` by modular arithmetic. Returns
 * `undefined` when the list is empty so the caller can decide what to draw (or skip).
 *
 * Used by both the cursor → slot mapping and click hit-tests so the bar list behaves like a circular rail — scrolling
 * past the end wraps to the start, and slots above / below the cursor that would normally land in negative-index
 * territory show entries from the opposite end of the list instead of being blank.
 */
export function wrapIndex(target: number, count: number): number | undefined {
  if (count <= 0) return undefined;
  return ((target % count) + count) % count;
}
