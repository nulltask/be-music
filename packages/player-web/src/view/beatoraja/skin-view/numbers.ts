import { Sprite, Texture, type Container } from 'pixi.js';
import {
  beatorajaFloatValueSlotCount,
  centerToAnchor,
  composeBeatorajaFloatValueCells,
  composeBeatorajaFloatValueShift,
  composeBeatorajaValueCells,
  composeBeatorajaValueShift,
  floatValueFrameAt,
  valueFrameAt,
  type BeatorajaDestinationGroup,
  type BeatorajaFloatValueElement,
  type BeatorajaLuaRuntimeContext,
  type BeatorajaValueElement,
} from '@be-music/beatoraja-skin';
import {
  createCroppedBeatorajaTexture,
  type BeatorajaRenderContext,
  type destinationToSpriteProps,
} from '../../../skin/beatoraja/render.ts';
import type { BeatorajaTextureCache } from '../../../skin/beatoraja/textures.ts';
import type { BeatorajaSkinLuaContext } from './lua-context.ts';
import type { BeatorajaPlaySkinViewOptions } from './options.ts';

export interface FloatValueEntry {
  kind: 'floatvalue';
  group: BeatorajaDestinationGroup;
  value: BeatorajaFloatValueElement;
  /** Source strip texture (uncropped). Each digit / dot sprite crops a sub-rect from this. */
  baseTexture: ReturnType<BeatorajaTextureCache['get']>;
  /**
   * One sprite per slot. Slot count is `iketa + (fketa > 0 ? 1 : 0) + fketa`. Each frame the
   * composer hands back per-slot cell descriptors; the matching sprite gets a cropped
   * sub-texture and laid out side-by-side along the dst rect.
   */
  slotSprites: Sprite[];
  /** Last resolved float value — used to skip re-cropping when nothing changed. */
  lastValue: number;
  /**
   * Last animation frame index applied to the slot textures. Mirrors {@link ValueEntry}'s
   * `lastFrameIndex` — re-crop runs whenever the strip's `cycle/divy` advances or the value
   * changes. `-1` is the initial sentinel.
   */
  lastFrameIndex: number;
}

export interface ValueEntry {
  kind: 'value';
  group: BeatorajaDestinationGroup;
  value: BeatorajaValueElement;
  baseTexture: ReturnType<BeatorajaTextureCache['get']>;
  /** One sprite per digit position. Created upfront sized to `value.digit`. */
  digitSprites: Sprite[];
  /** Last numeric value rendered, used to skip cell-texture rebuilds when the number hasn't changed. */
  lastValue: number;
  /**
   * Last animation frame index applied to the digit textures. When the value's `cycle > 0` and
   * the frame index advances, the per-digit textures are re-cropped from the matching strip row.
   * `-1` is the initial sentinel — first update always re-crops. Mirrors upstream's
   * `SkinSourceImageSet.getImageIndex` flow which re-evaluates per draw call.
   */
  lastFrameIndex: number;
}

/** Builds and updates the `value[]` and `floatvalue[]` entries of a {@link BeatorajaPlaySkinView}. */
export class BeatorajaNumberRenderer {
  private readonly container: Container;
  private readonly resolveNumberValue: (refOp: number) => number | undefined;
  private readonly resolveIntegerProperty: BeatorajaSkinLuaContext['resolveIntegerProperty'];

  constructor(
    container: Container,
    options: BeatorajaPlaySkinViewOptions,
    resolveIntegerProperty: BeatorajaSkinLuaContext['resolveIntegerProperty'],
  ) {
    this.container = container;
    this.resolveNumberValue = options.resolveNumberValue ?? (() => undefined);
    this.resolveIntegerProperty = resolveIntegerProperty;
  }

  buildValueEntry(
    group: BeatorajaDestinationGroup,
    element: BeatorajaValueElement,
    textures: BeatorajaTextureCache,
  ): ValueEntry | undefined {
    const baseTexture = textures.get(element.src);
    const digits = Math.max(1, Math.trunc(element.digit));
    const digitSprites: Sprite[] = [];
    // Pre-build one sprite per digit slot. Mount with `alpha: 0` to dodge the same first-pass
    // bind-group race the image entries handle. The actual textures get cropped on first `update()`
    // when we know the resolved numeric value — until then each slot uses cell 0 as a placeholder so
    // PixiJS sees a non-EMPTY texture from frame 0.
    const baseIsBindable = baseTexture !== undefined && baseTexture !== Texture.EMPTY;
    for (let i = 0; i < digits; i += 1) {
      let initialTexture: Texture | undefined;
      if (baseIsBindable) {
        const placeholderCells = composeBeatorajaValueCells(element, 0);
        const cell = placeholderCells[i] ?? placeholderCells[0]!;
        const cropped = createCroppedBeatorajaTexture(baseTexture, cell);
        if (cropped !== undefined) initialTexture = cropped;
      }
      const sprite = new Sprite({ texture: initialTexture, alpha: 0 });
      this.container.addChild(sprite);
      digitSprites.push(sprite);
    }
    return { kind: 'value', group, value: element, baseTexture, digitSprites, lastValue: 0, lastFrameIndex: -1 };
  }

  /**
   * Build a `floatvalue[]` entry. Pre-allocates one sprite per slot — the slot count is fixed
   * by `iketa` + (`fketa > 0 ? 1 : 0`) + `fketa` regardless of value magnitude, so we mount
   * the row once at construction. Each slot's texture gets cropped on first `update()` from
   * the source strip via {@link composeBeatorajaFloatValueCells}.
   */
  buildFloatValueEntry(
    group: BeatorajaDestinationGroup,
    element: BeatorajaFloatValueElement,
    textures: BeatorajaTextureCache,
  ): FloatValueEntry | undefined {
    const baseTexture = textures.get(element.src);
    const slotCount = beatorajaFloatValueSlotCount(element);
    const slotSprites: Sprite[] = [];
    const baseIsBindable = baseTexture !== undefined && baseTexture !== Texture.EMPTY;
    for (let i = 0; i < slotCount; i += 1) {
      let initialTexture: Texture | undefined;
      if (baseIsBindable) {
        const placeholderCells = composeBeatorajaFloatValueCells(element, 0);
        const cell = placeholderCells[i] ?? placeholderCells[0]!;
        const cropped = createCroppedBeatorajaTexture(baseTexture, cell);
        if (cropped !== undefined) initialTexture = cropped;
      }
      const sprite = new Sprite({ texture: initialTexture, alpha: 0 });
      this.container.addChild(sprite);
      slotSprites.push(sprite);
    }
    return { kind: 'floatvalue', group, value: element, baseTexture, slotSprites, lastValue: 0, lastFrameIndex: -1 };
  }

  /**
   * Convert one digit slot's libGDX-space rect (after per-digit offset) into Pixi-space sprite
   * props honoring the parent's `center` anchor. Shared between `updateValueEntry` and
   * `updateFloatValueEntry` so the two paths can't drift.
   *
   * Mirrors upstream `SkinNumber.draw()` (`SkinNumber.java:189-199`):
   *
   *     draw(sprite, currentImages[j],
   *          region.x + (region.width + space) * j - shift + offsets[j].x,
   *          region.y + offsets[j].y,
   *          region.width + offsets[j].w,
   *          region.height + offsets[j].h);
   *
   * Two upstream-faithfulness points:
   *
   *   1. **Y sign.** `offsets[j].y > 0` shifts the slot UP in libGDX (Y-UP) — i.e., its libGDX
   *      bottom-edge moves to a HIGHER y. After the Pixi Y-flip
   *      (`pixiTop = canvasH - libgdxBottom - libgdxHeight`), the slot's Pixi top must DECREASE
   *      by `offsets[j].y` AND by `offsets[j].h` (because libGDX height grew upward).
   *      The previous impl added `+ offsets[j].y` directly to `sprite.y`, flipping the sign.
   *
   *   2. **Center anchor on post-offset rect.** The rotation pivot in libGDX is at
   *      `(slot.x + centerx*slot.w, slot.y + centery*slot.h)` — using the FULL post-offset
   *      width/height, NOT the base slotWidth. The previous impl multiplied centerx by the
   *      base `slotWidth`, leaving the pivot off-center whenever `offsets[j].w/h ≠ 0`.
   *
   * The `relative` flag from the parent destination does NOT apply here. SkinObject's
   * `region.x += off.x - off.w/2` center-shift is applied at the destination level (already
   * baked into `parent.x/y`); per-digit offsets in `SkinNumber.draw()` are added without
   * center-shift regardless of `relative`.
   */
  private static perDigitSlotPixiProps(args: {
    /** Pixi-space parent destination rect (already Y-flipped). */
    parent: { x: number; y: number; height: number };
    /** `(slotWidth + space) * j`, the per-slot horizontal step before alignment shift. */
    slotIndexX: number;
    /** Un-offset slot width (= the per-digit `region.width`). */
    slotBaseWidth: number;
    /** Alignment shift (subtracted from x — see `composeBeatorajaValueShift`). */
    alignShift: number;
    /** Per-digit offset in libGDX semantics (or all-zeros when no offset id is set). */
    off: { x: number; y: number; w: number; h: number };
    /** Pixi anchor for the parent destination's `center` field (already Y-flipped). */
    centerPixi: { x: number; y: number };
  }): { x: number; y: number; width: number; height: number } {
    const { parent, slotIndexX, slotBaseWidth, alignShift, off, centerPixi } = args;
    // Slot's libGDX bottom-left, after per-digit offset. (Bottom-left is the natural anchor
    // because libGDX `SpriteBatch.draw(image, x, y, w, h)` interprets x/y as bottom-left in
    // Y-UP, mirrored by our parent.x = libGDX bottom-left x.)
    const slotPixiLeft = parent.x + slotIndexX - alignShift + off.x;
    // Pixi top = parent's Pixi top, MINUS off.y (slot moves up = Pixi-y decreases) and
    // MINUS off.h (height grew upward in libGDX → Pixi top moves up by full off.h).
    const slotPixiTop = parent.y - off.y - off.h;
    const slotWidth = slotBaseWidth + off.w;
    const slotHeight = parent.height + off.h;
    return {
      x: slotPixiLeft + slotWidth * centerPixi.x,
      y: slotPixiTop + slotHeight * centerPixi.y,
      width: slotWidth,
      height: slotHeight,
    };
  }

  /**
   * Resolve a per-digit offset id (or `undefined` when the slot has no offset). Returns the
   * zero offset when the resolver isn't wired or the id maps to nothing — keeps the caller's
   * arithmetic uniform regardless of authoring.
   */
  private static readonly ZERO_PER_DIGIT_OFFSET = Object.freeze({ x: 0, y: 0, w: 0, h: 0 });
  private resolvePerDigitOffsetOrZero(
    offsetId: number | undefined,
    resolveOffset: BeatorajaRenderContext['resolveOffset'],
  ): { x: number; y: number; w: number; h: number } {
    if (offsetId === undefined || resolveOffset === undefined) {
      return BeatorajaNumberRenderer.ZERO_PER_DIGIT_OFFSET;
    }
    const off = resolveOffset(offsetId);
    return off ?? BeatorajaNumberRenderer.ZERO_PER_DIGIT_OFFSET;
  }

  updateValueEntry(
    entry: ValueEntry,
    props: ReturnType<typeof destinationToSpriteProps>,
    luaContext: BeatorajaLuaRuntimeContext,
    resolveOffset: BeatorajaRenderContext['resolveOffset'],
    nowMs: number,
  ): void {
    const baseTexture = entry.baseTexture;
    if (baseTexture === undefined || baseTexture === Texture.EMPTY) {
      for (const sprite of entry.digitSprites) sprite.visible = false;
      return;
    }
    if (!props.visible) {
      for (const sprite of entry.digitSprites) sprite.visible = false;
      return;
    }

    // Resolve the dynamic numeric value through the host's `prop.lua num` adapter. The host
    // returns `undefined` when the ref doesn't apply to the current scene state (e.g.
    // `folder_totalsongs = 300` returns `MIN_VALUE` upstream while the cursor is on a song
    // bar — our adapter's equivalent is `undefined`). Mirrors upstream `SkinNumber.prepare`
    // (`SkinNumber.java:133-136`) which sets `draw = false` and skips rendering when the
    // resolved value is `Integer.MIN_VALUE`. Hide every digit sprite in that case.
    //
    // Refs returning a real number (including `0`) keep rendering — many score / combo
    // readouts legitimately read 0 in the idle state. The skin-side `valueProperty` (Lua
    // function) path always returns a finite number from `resolveIntegerProperty`, so it
    // skips the hide branch (matches upstream where Lua-driven values can't return MIN_VALUE).
    const resolved =
      entry.value.valueProperty !== undefined
        ? this.resolveIntegerProperty(entry.value.valueProperty, luaContext)
        : entry.value.ref !== 0
          ? this.resolveNumberValue(entry.value.ref)
          : 0;
    if (resolved === undefined) {
      for (const sprite of entry.digitSprites) sprite.visible = false;
      return;
    }
    const value = resolved;

    // Animation frame for `cycle`-driven strips — picks the current `divy` row. Mirrors
    // upstream `SkinSourceImageSet.getImageIndex(time, state)` (with `timer == null`, since
    // our value-element schema doesn't expose the source-level `timer` field yet — most skins
    // including ModernChic / default authors omit it). Re-crop runs whenever the frame index
    // changes OR the value changes.
    const frameIndex = valueFrameAt(entry.value, nowMs);

    // Re-compose digit-cell textures when the value OR animation frame changes. The composer
    // hands back one source-rect per digit slot (with the row's y-offset baked in); we crop a
    // sub-texture per slot and assign it to the matching sprite.
    let cells: ReturnType<typeof composeBeatorajaValueCells> | undefined;
    const valueChanged = value !== entry.lastValue;
    const frameChanged = frameIndex !== entry.lastFrameIndex;
    if (valueChanged || frameChanged) {
      entry.lastValue = value;
      entry.lastFrameIndex = frameIndex;
      cells = composeBeatorajaValueCells(entry.value, value, frameIndex);
      for (let i = 0; i < entry.digitSprites.length; i += 1) {
        const cell = cells[i];
        if (cell === undefined || cell.hidden) continue;
        const cropped = createCroppedBeatorajaTexture(baseTexture, cell);
        if (cropped !== undefined) {
          entry.digitSprites[i]!.texture = cropped;
        }
      }
    }
    // Always recompute hidden flags — visibility depends on the latest value even when textures
    // weren't refreshed (the composer might emit `hidden: true` for slots that don't paint).
    if (cells === undefined) cells = composeBeatorajaValueCells(entry.value, value, frameIndex);

    // Lay the digit row across the destination rect. Per beatoraja's convention, `dst.w` is the
    // PER-DIGIT slot width (NOT the total strip width) — the reference theme writes things like
    // `{w = 18, h = 18}` with `digit = 4` for BPM readouts and expects each digit to render as an
    // 18×18 square (total strip = 72px wide). Treating `dst.w` as the total instead made every
    // digit collapse to `dst.w / digit` pixels wide, which is what produced the "potsubureteru"
    // (squashed-text) reports. Height stays at `dst.h`.
    const slotWidth = props.width;
    // Inter-digit gap from beatoraja's `value.space`. Most authoring uses 0; some banner-style
    // digit fonts use small positive values (1-3 px) to recover natural letter spacing. Per
    // beatoraja, each subsequent slot is offset by `slotWidth + space`, NOT just `slotWidth`.
    const space = Number.isFinite(entry.value.space) ? entry.value.space : 0;
    const slotStep = slotWidth + space;
    // Honor `value.align` (0 = right / no shift, 1 = left, 2 = center) — see
    // `composeBeatorajaValueShift` for the formula. Without this, every authored `align: 1`
    // (left-flush) and `align: 2` (centered) rendered identically to `align: 0`, which is what
    // ModernChic's Result mainmenu (40+ sites) was hitting — score / miss / FAST / SLOW digits
    // showed natural-right-aligned with leading blanks instead of flush-left.
    const alignShift = composeBeatorajaValueShift(entry.value, value, slotWidth);
    // Apply the destination's center anchor across the whole digit strip — each digit slot
    // shares the same pivot proportions, computed against the strip's full width (not the per-
    // digit width) so rotation pivots around the strip's authored center, not each digit's
    // local middle. The +i*slotWidth offset stays as before.
    const center = centerToAnchor(entry.group.center);
    // Per-digit offsets — `value[].offset = [id0, id1, ...]` (parallel array, one offset
    // id per slot). Mirrors upstream `SkinNumber.draw()`'s `+ offsets[j].x / .y / .w / .h`
    // terms. Empty (= the default) keeps every slot at the un-offset position. Per-digit
    // offsets operate on a single sprite and DO NOT inherit the parent's `relative` flag —
    // SkinObject's center-shift is already baked into the parent's region; SkinNumber.draw
    // adds offsets[j].* without center-shift regardless of `relative`.
    const perDigitOffsets = entry.value.offsets;
    for (let i = 0; i < entry.digitSprites.length; i += 1) {
      const sprite = entry.digitSprites[i]!;
      const cell = cells[i];
      if (cell !== undefined && cell.hidden) {
        sprite.visible = false;
        continue;
      }
      sprite.visible = true;
      sprite.anchor.set(center.x, center.y);
      const off = this.resolvePerDigitOffsetOrZero(perDigitOffsets[i], resolveOffset);
      const slot = BeatorajaNumberRenderer.perDigitSlotPixiProps({
        parent: { x: props.x, y: props.y, height: props.height },
        slotIndexX: i * slotStep,
        slotBaseWidth: slotWidth,
        alignShift,
        off,
        centerPixi: center,
      });
      sprite.x = slot.x;
      sprite.y = slot.y;
      sprite.width = slot.width;
      sprite.height = slot.height;
      sprite.alpha = props.alpha;
      sprite.tint = props.tint;
      sprite.angle = props.angle;
      sprite.blendMode = props.blendMode;
    }
  }

  /**
   * Update a `floatvalue[]` entry. Resolves the live value via the host's `resolveNumberValue`
   * (or `valueProperty` when authored), formats it as `<integer>.<fractional>` with the
   * declared `iketa` / `fketa` widths and `gain` multiplier, then crops one cell per slot from
   * the source strip and lays the row across the dst rect — same alignment / spacing logic as
   * the integer value path. Skips the re-crop pass when the value hasn't changed.
   */
  updateFloatValueEntry(
    entry: FloatValueEntry,
    props: ReturnType<typeof destinationToSpriteProps>,
    luaContext: BeatorajaLuaRuntimeContext,
    resolveOffset: BeatorajaRenderContext['resolveOffset'],
    nowMs: number,
  ): void {
    const baseTexture = entry.baseTexture;
    if (baseTexture === undefined || baseTexture === Texture.EMPTY) {
      for (const sprite of entry.slotSprites) sprite.visible = false;
      return;
    }
    if (!props.visible) {
      for (const sprite of entry.slotSprites) sprite.visible = false;
      return;
    }

    // Resolve the dynamic value through `valueProperty` (Lua function) when authored, else
    // fall through to the host's `resolveNumberValue(ref)`. `undefined` from the ref path
    // mirrors upstream `MIN_VALUE` (= "ref doesn't apply now") — same hide-everything
    // behaviour as the integer-value path above. See that block's comment for the
    // upstream-faithfulness rationale.
    const resolved =
      entry.value.valueProperty !== undefined
        ? this.resolveIntegerProperty(entry.value.valueProperty, luaContext)
        : entry.value.ref !== 0
          ? this.resolveNumberValue(entry.value.ref)
          : 0;
    if (resolved === undefined) {
      for (const sprite of entry.slotSprites) sprite.visible = false;
      return;
    }
    const value = resolved;

    // Animation frame for `cycle`-driven strips — selects which `divy` row the slot textures
    // crop from. Mirrors `SkinSourceImageSet.getImageIndex(time, state)` (with `timer == null`).
    const frameIndex = floatValueFrameAt(entry.value, nowMs);

    let cells: ReturnType<typeof composeBeatorajaFloatValueCells> | undefined;
    const valueChanged = value !== entry.lastValue;
    const frameChanged = frameIndex !== entry.lastFrameIndex;
    if (valueChanged || frameChanged) {
      entry.lastValue = value;
      entry.lastFrameIndex = frameIndex;
      cells = composeBeatorajaFloatValueCells(entry.value, value, frameIndex);
      for (let i = 0; i < entry.slotSprites.length; i += 1) {
        const cell = cells[i];
        if (cell === undefined || cell.hidden) continue;
        const cropped = createCroppedBeatorajaTexture(baseTexture, cell);
        if (cropped !== undefined) {
          entry.slotSprites[i]!.texture = cropped;
        }
      }
    }
    if (cells === undefined) cells = composeBeatorajaFloatValueCells(entry.value, value, frameIndex);

    // Lay the slot row across the dst rect — same convention as `value[]`: `dst.w` is per-slot
    // width, `space` adds inter-slot gap.
    const slotWidth = props.width;
    const space = Number.isFinite(entry.value.space) ? entry.value.space : 0;
    const slotStep = slotWidth + space;
    // Honor `value.align` — same formula as the integer `value[]` path. For float, leading
    // hidden slots are the leading-blank pads on the integer half (when the value's int part
    // has fewer digits than `iketa`). align=1 (LEFT) shifts the row left so significant
    // digits flush with the dst's left edge; align=2 (CENTER) shifts half. Without this,
    // ModernChic / GdbG result-screen `floatvalue` displays (BPM avg, accuracy %, ms delta)
    // with explicit `align` rendered with leading blanks on the wrong side.
    // Compute shift, then NEGATE — `SkinFloat.java:193` ADDS the shift to slot.x while our
    // `perDigitSlotPixiProps` helper SUBTRACTS the `alignShift` parameter (modeled after
    // `SkinNumber.draw()`'s `- shift`). Negating preserves a single helper for both element
    // types: `slot.x = parent.x + j*slotStep - alignShift` with `alignShift = -upstreamShift`
    // is equivalent to upstream's `slot.x = parent.x + j*slotStep + upstreamShift`.
    const alignShift = -composeBeatorajaFloatValueShift(entry.value, value, slotWidth);
    const center = centerToAnchor(entry.group.center);
    // Per-digit offsets — same semantics as `value[]`. See `perDigitSlotPixiProps` for the
    // upstream-faithful x/y/w/h derivation (mirrors `SkinFloat.java:189-199`).
    const perDigitOffsets = entry.value.offsets;
    for (let i = 0; i < entry.slotSprites.length; i += 1) {
      const sprite = entry.slotSprites[i]!;
      const cell = cells[i];
      if (cell !== undefined && cell.hidden) {
        sprite.visible = false;
        continue;
      }
      sprite.visible = true;
      sprite.anchor.set(center.x, center.y);
      const off = this.resolvePerDigitOffsetOrZero(perDigitOffsets[i], resolveOffset);
      const slot = BeatorajaNumberRenderer.perDigitSlotPixiProps({
        parent: { x: props.x, y: props.y, height: props.height },
        slotIndexX: i * slotStep,
        slotBaseWidth: slotWidth,
        alignShift,
        off,
        centerPixi: center,
      });
      sprite.x = slot.x;
      sprite.y = slot.y;
      sprite.width = slot.width;
      sprite.height = slot.height;
      sprite.alpha = props.alpha;
      sprite.tint = props.tint;
      sprite.angle = props.angle;
      sprite.blendMode = props.blendMode;
    }
  }
}
