// Note rendering layer for a beatoraja play skin.
//
// Drives a per-channel sprite stack from the engine's `frame.notes[]`. The skin's `note` block holds
// per-lane image IDs (`note[]`, `lnstart[]`, `lnbody[]`, `lnend[]`, `mine[]`) — each is an
// `image[].id` that points at a source-bitmap rect — and per-lane geometry (`note.dst[]`). The
// renderer:
//
//   1. Resolves the active lane geometry against the runtime op set (`pickBeatorajaNoteRects`).
//   2. For each in-flight engine note, picks the matching per-lane image id, looks up the image[]
//      entry, crops the source texture to the image's `(x, y, w, h)`, and paints it as a Pixi sprite.
//   3. Long notes (with `endBeat`) compose three sprites — start cap, tiled body, end cap — using
//      the `lnstart[]` / `lnbody[]` / `lnend[]` ids respectively.
//   4. Falls back to a colored Graphics rectangle when an image id can't be resolved (skin omitted
//      the per-lane sprite, image[] entry missing, or texture decode failed). Keeps something visible
//      so a partial-asset theme still plays — better than silent blanks.

import { Container, Graphics, Sprite, type Texture, TilingSprite } from 'pixi.js';
import type { ChartPlayVariant } from '@be-music/player/core/lane-layout';
import { resolveSideKeySlot } from '@be-music/player/core/lane-layout';
import type { PlayerUiFrameNote, PlayerUiFramePayload } from '@be-music/player/core/ui-signal-bus';
import {
  pickBeatorajaNoteRects,
  type BeatorajaImageElement,
  type BeatorajaImageId,
  type BeatorajaNoteRect,
  type BeatorajaNoteSection,
} from '@be-music/beatoraja-skin';
import { createCroppedBeatorajaTexture, flipRectToPixi } from './beatoraja-render.ts';
import type { BeatorajaTextureCache } from './beatoraja-textures.ts';

/** Pixels per chart-beat at hispeed = 1.0. Mirrors the LR2 path's constant so the two layers scroll consistently. */
export const BEATORAJA_PIXELS_PER_BEAT = 72;

/** Fallback palette when the skin omits a per-lane sprite or texture decode fails. */
const FALLBACK_COLOR_BY_KEY: Record<string, number> = {
  white: 0xf5f5f5,
  blue: 0x4ea8ff,
  red: 0xff5050,
};
const SEVEN_KEY_PALETTE = ['red', 'white', 'blue', 'white', 'blue', 'white', 'blue', 'white'] as const;
const POP_KEY_PALETTE = ['white', 'yellow', 'green', 'blue', 'red', 'blue', 'green', 'yellow', 'white'] as const;
const PALETTE_COLOR: Record<string, number> = {
  white: FALLBACK_COLOR_BY_KEY.white!,
  blue: FALLBACK_COLOR_BY_KEY.blue!,
  red: FALLBACK_COLOR_BY_KEY.red!,
  yellow: 0xf2cf3a,
  green: 0x59c863,
};

export interface BeatorajaNoteLayerOptions {
  noteSection: BeatorajaNoteSection;
  variant: ChartPlayVariant;
  /**
   * `image[]` map keyed by id (string OR number). The renderer resolves per-lane image ids
   * (`note-w`, `lns-b`, etc.) through this to find the source rect to crop. Pass an empty Map to
   * disable sprite rendering and force the fallback rectangle path.
   */
  images: ReadonlyMap<BeatorajaImageId, BeatorajaImageElement>;
  /** Texture cache the resolved image entries crop against. */
  textures: BeatorajaTextureCache;
  /**
   * Skin canvas height in skin-pixel units. Used to flip the note section's libGDX Y-UP lane
   * rects (origin at canvas bottom-left) into Pixi Y-DOWN screen rects, so the rest of the
   * layer can treat lane rects as ordinary screen-space rectangles.
   */
  canvasHeight: number;
  /** Optional override for the judgement-line Y. Defaults to the active lane rect's bottom edge. */
  judgementY?: number;
}

interface CroppedSprite {
  sprite: Sprite;
  /** Width of the cell, used to scale the sprite to the lane width while preserving aspect ratio. */
  cellW: number;
  cellH: number;
}

export class BeatorajaNoteLayer {
  readonly container = new Container();
  private readonly noteSection: BeatorajaNoteSection;
  private readonly variant: ChartPlayVariant;
  private readonly images: ReadonlyMap<BeatorajaImageId, BeatorajaImageElement>;
  private readonly textures: BeatorajaTextureCache;
  private readonly canvasHeight: number;
  private readonly judgementYOverride?: number;
  /** Pool of generic Graphics nodes for the fallback path. Reused across frames. */
  private readonly graphicsPool: Graphics[] = [];
  /** Pool of skin-sprite nodes (tap notes / mines / LN caps). One sprite per slot — texture swapped per use. */
  private readonly spritePool: Sprite[] = [];
  /** Pool of LN body tiling sprites. Separate because TilingSprite has its own size / position semantics. */
  private readonly tilingPool: TilingSprite[] = [];
  private cachedActiveOps: ReadonlySet<number> | undefined;
  private cachedRects: ReadonlyArray<BeatorajaNoteRect> = [];
  /**
   * Per-`(imageId)` cropped texture cache, populated lazily on first access. Each entry persists for
   * the lifetime of the layer; same-skin notes always share the same cropped sub-texture.
   */
  private readonly croppedTextureCache = new Map<BeatorajaImageId, CroppedSprite | undefined>();
  private firstFrameLogged = false;

  constructor(options: BeatorajaNoteLayerOptions) {
    this.noteSection = options.noteSection;
    this.variant = options.variant;
    this.images = options.images;
    this.textures = options.textures;
    this.canvasHeight = options.canvasHeight;
    this.judgementYOverride = options.judgementY;
  }

  update(frame: PlayerUiFramePayload, hiSpeed: number, activeOps: ReadonlySet<number>): void {
    const rects = this.resolveLaneRects(activeOps);
    if (rects.length === 0) {
      this.releaseAll();
      if (!this.firstFrameLogged && frame.notes.length > 0) {
        this.firstFrameLogged = true;
        // eslint-disable-next-line no-console
        console.log(
          '[beatoraja-notes] no lane rects matched activeOps',
          JSON.stringify({
            variant: this.variant,
            dstBlocks: this.noteSection.dst.length,
            activeOpsCount: activeOps.size,
          }),
        );
      }
      return;
    }
    const judgementY = this.resolveJudgementY(rects);
    const pixelsPerBeat = BEATORAJA_PIXELS_PER_BEAT * hiSpeed;
    let usedG = 0;
    let usedS = 0;
    let usedT = 0;
    if (!this.firstFrameLogged) {
      this.firstFrameLogged = true;
      // eslint-disable-next-line no-console
      console.log(
        '[beatoraja-notes] first frame',
        JSON.stringify({
          variant: this.variant,
          rects: rects.length,
          judgementY,
          pixelsPerBeat,
          notes: frame.notes.length,
          spriteImages: this.images.size,
        }),
      );
    }

    for (const note of frame.notes) {
      if (note.judged) continue;
      const lane = this.resolveLane(note);
      if (lane === undefined) continue;
      const rect = rects[lane];
      if (rect === undefined) continue;

      const y = judgementY - (note.beat - frame.currentBeat) * pixelsPerBeat;
      // Tight bottom cull at the judgement line — notes whose visual bottom has crossed the
      // line are no longer judgable (the engine fires auto-POOR shortly after) and rendering
      // them past the line looked like the note was "flying through" the chart's bottom edge.
      // Top cull keeps a small lead-in margin so notes pop into view smoothly as they approach
      // from above.
      if (y < rect.y - 24 || y > judgementY) continue;

      if (note.endBeat !== undefined) {
        const yEnd = judgementY - (note.endBeat - frame.currentBeat) * pixelsPerBeat;
        if (yEnd > judgementY) continue;
        // Clip the LN's start cap (player-facing head) to the judgement line so the body
        // doesn't visually extend past the chart's bottom edge while the player is holding.
        // The engine still drives the LN's actual judging window from `note.beat` /
        // `note.endBeat`; this is purely a visual cap so the body stops growing once it has
        // reached the line.
        const yStartClipped = Math.min(y, judgementY);
        const r = this.paintLongNote(usedG, usedS, usedT, rect, lane, yEnd, yStartClipped);
        usedG = r.g;
        usedS = r.s;
        usedT = r.t;
        continue;
      }

      const r = this.paintTapNote(usedG, usedS, rect, lane, note, y);
      usedG = r.g;
      usedS = r.s;
    }

    this.shrinkPoolsTo(usedG, usedS, usedT);
  }

  dispose(): void {
    if (!this.container.destroyed) {
      this.container.destroy({ children: true });
    }
    this.graphicsPool.length = 0;
    this.spritePool.length = 0;
    this.tilingPool.length = 0;
    this.croppedTextureCache.clear();
  }

  /**
   * Bounds of the lane area for the current frame's active op set, surfaced for sibling layers
   * (marker layer, key-bomb layer, etc.) that need to scroll-align with notes. Returns
   * `undefined` when no lane block matched — the caller should fall back to skin-canvas defaults.
   */
  getLaneBounds(activeOps: ReadonlySet<number>): { topY: number; bottomY: number } | undefined {
    const rects = this.resolveLaneRects(activeOps);
    if (rects.length === 0) return undefined;
    let top = Number.POSITIVE_INFINITY;
    let bottom = 0;
    for (const rect of rects) {
      if (rect.y < top) top = rect.y;
      if (rect.y + rect.h > bottom) bottom = rect.y + rect.h;
    }
    if (!Number.isFinite(top)) return undefined;
    return { topY: top, bottomY: this.judgementYOverride ?? bottom };
  }

  // ─── Internals ────────────────────────────────────────────────────────────────────────────────

  private resolveLaneRects(activeOps: ReadonlySet<number>): ReadonlyArray<BeatorajaNoteRect> {
    if (this.cachedActiveOps === activeOps) return this.cachedRects;
    // beatoraja's `note.dst[]` rects are in libGDX Y-UP coordinates (origin at canvas bottom-
    // left). Flip each rect once on resolve so the rest of the layer (judgement-Y, getLaneBounds,
    // per-frame scroll math) can treat lane rects as ordinary Pixi Y-DOWN screen rects.
    const raw = pickBeatorajaNoteRects(this.noteSection, activeOps);
    this.cachedRects = raw.map((rect) => flipRectToPixi(rect, this.canvasHeight));
    this.cachedActiveOps = activeOps;
    return this.cachedRects;
  }

  private resolveJudgementY(rects: ReadonlyArray<BeatorajaNoteRect>): number {
    if (this.judgementYOverride !== undefined) return this.judgementYOverride;
    let bottom = 0;
    for (const rect of rects) bottom = Math.max(bottom, rect.y + rect.h);
    return bottom;
  }

  private resolveLane(note: PlayerUiFrameNote): number | undefined {
    const slot = resolveSideKeySlot(note.channel, this.variant);
    if (slot < 0) return undefined;
    if (this.variant === '9') return slot - 1;
    const numKeys = this.variant === '5' || this.variant === '10' ? 5 : 7;
    const baseLane = slot === 0 ? numKeys : slot - 1;
    if (this.variant === '10' || this.variant === '14') {
      const isPlayer2 = note.channel.startsWith('2');
      const sideLanes = numKeys + 1;
      return isPlayer2 ? sideLanes + baseLane : baseLane;
    }
    return baseLane;
  }

  /**
   * Resolve a per-lane image id (`note-w`, `lns-b`, `lne-s`, `mine-w`, …) into a Pixi-ready sprite
   * texture + cell dimensions, lazily caching the cropped result. Returns `undefined` when the skin
   * doesn't declare a sprite for the slot or the image's source texture isn't bindable.
   */
  private resolveLaneSprite(imageId: BeatorajaImageId | undefined): CroppedSprite | undefined {
    if (imageId === undefined || imageId === '') return undefined;
    if (this.croppedTextureCache.has(imageId)) return this.croppedTextureCache.get(imageId);
    const image = this.images.get(imageId);
    if (image === undefined) {
      this.croppedTextureCache.set(imageId, undefined);
      return undefined;
    }
    const baseTexture = this.textures.get(image.src);
    if (baseTexture === undefined) {
      this.croppedTextureCache.set(imageId, undefined);
      return undefined;
    }
    const cropped = createCroppedBeatorajaTexture(baseTexture, {
      x: image.x,
      y: image.y,
      w: image.w,
      h: image.h,
    });
    if (cropped === undefined) {
      this.croppedTextureCache.set(imageId, undefined);
      return undefined;
    }
    // Wrap in a singleton sprite to act as a "factory" — we re-use the texture across many sprite
    // instances pulled from `spritePool`, so the cache only needs to keep the texture handle. We
    // still allocate a placeholder Sprite for `cellW` / `cellH` bookkeeping.
    const placeholder = new Sprite(cropped);
    const result: CroppedSprite = { sprite: placeholder, cellW: image.w, cellH: image.h };
    this.croppedTextureCache.set(imageId, result);
    return result;
  }

  private paintTapNote(
    usedG: number,
    usedS: number,
    rect: BeatorajaNoteRect,
    lane: number,
    note: PlayerUiFrameNote,
    y: number,
  ): { g: number; s: number } {
    const imageId = note.mine ? this.noteSection.mine[lane] : this.noteSection.note[lane];
    const cropped = this.resolveLaneSprite(imageId);
    if (cropped !== undefined) {
      const sprite = this.acquireSprite(usedS);
      sprite.texture = cropped.sprite.texture;
      // Scale to fit the lane width; preserve the source aspect ratio. The sprite is pinned to the
      // judgement line: top edge at `y - cellHScaledToLane` keeps the note's bottom flush with `y`.
      const scaleX = rect.w / Math.max(1, cropped.cellW);
      const drawH = cropped.cellH * scaleX;
      sprite.x = rect.x;
      sprite.y = y - drawH;
      sprite.width = rect.w;
      sprite.height = drawH;
      sprite.tint = note.mine ? FALLBACK_COLOR_BY_KEY.red! : 0xffffff;
      sprite.alpha = 1;
      return { g: usedG, s: usedS + 1 };
    }
    // Fallback Graphics — the skin didn't ship a per-lane sprite for this slot or the cell-crop
    // failed. Better than silent blanks.
    const color = note.mine ? FALLBACK_COLOR_BY_KEY.red! : this.fallbackColorForLane(lane);
    const g = this.acquireGraphics(usedG);
    g.clear();
    g.rect(rect.x, y - 6, rect.w, 12).fill({ color });
    return { g: usedG + 1, s: usedS };
  }

  private paintLongNote(
    usedG: number,
    usedS: number,
    usedT: number,
    rect: BeatorajaNoteRect,
    lane: number,
    yEnd: number,
    yStart: number,
  ): { g: number; s: number; t: number } {
    const startCrop = this.resolveLaneSprite(this.noteSection.lnstart[lane]);
    const endCrop = this.resolveLaneSprite(this.noteSection.lnend[lane]);
    const bodyCrop = this.resolveLaneSprite(this.noteSection.lnbody[lane]);
    if (startCrop === undefined || endCrop === undefined || bodyCrop === undefined) {
      // Fall back to colored rectangles when any of the LN sprite slots is missing.
      const color = this.fallbackColorForLane(lane);
      const g = this.acquireGraphics(usedG);
      g.clear();
      g.rect(rect.x + 4, yEnd, rect.w - 8, yStart - yEnd).fill({ color, alpha: 0.6 });
      g.rect(rect.x, yStart - 6, rect.w, 12).fill({ color });
      g.rect(rect.x, yEnd - 6, rect.w, 12).fill({ color });
      return { g: usedG + 1, s: usedS, t: usedT };
    }
    // Body — repeats the `lnbody` cell vertically across the LN duration. `TilingSprite`
    // automatically wraps the texture to fit our requested width / height.
    const body = this.acquireTiling(usedT, bodyCrop.sprite.texture);
    const startScaleX = rect.w / Math.max(1, startCrop.cellW);
    const endScaleX = rect.w / Math.max(1, endCrop.cellW);
    const startH = startCrop.cellH * startScaleX;
    const endH = endCrop.cellH * endScaleX;
    body.x = rect.x;
    body.width = rect.w;
    // Body sits between the bottom of the start cap (yStart) and the top of the end cap (yEnd).
    body.y = yEnd;
    body.height = Math.max(0, yStart - yEnd);
    body.tilePosition.set(0, 0);
    body.tileScale.set(rect.w / Math.max(1, bodyCrop.cellW), 1);
    body.alpha = 1;

    // Start cap (visually closer to the judgement line — pinned at `yStart`).
    const start = this.acquireSprite(usedS);
    start.texture = startCrop.sprite.texture;
    start.x = rect.x;
    start.y = yStart - startH;
    start.width = rect.w;
    start.height = startH;
    start.tint = 0xffffff;
    start.alpha = 1;

    // End cap (further from the judgement line — pinned at `yEnd`).
    const end = this.acquireSprite(usedS + 1);
    end.texture = endCrop.sprite.texture;
    end.x = rect.x;
    end.y = yEnd - endH;
    end.width = rect.w;
    end.height = endH;
    end.tint = 0xffffff;
    end.alpha = 1;

    return { g: usedG, s: usedS + 2, t: usedT + 1 };
  }

  private fallbackColorForLane(lane: number): number {
    const palette = this.variant === '9' ? POP_KEY_PALETTE : SEVEN_KEY_PALETTE;
    const sided = this.variant === '10' || this.variant === '14' ? lane % 8 : lane;
    const key = palette[sided] ?? 'white';
    return PALETTE_COLOR[key] ?? PALETTE_COLOR.white!;
  }

  private acquireGraphics(index: number): Graphics {
    let g = this.graphicsPool[index];
    if (g === undefined) {
      g = new Graphics();
      this.graphicsPool.push(g);
      this.container.addChild(g);
    } else {
      g.visible = true;
    }
    return g;
  }

  private acquireSprite(index: number): Sprite {
    let s = this.spritePool[index];
    if (s === undefined) {
      s = new Sprite();
      this.spritePool.push(s);
      this.container.addChild(s);
    } else {
      s.visible = true;
    }
    return s;
  }

  private acquireTiling(index: number, texture: Texture): TilingSprite {
    let t = this.tilingPool[index];
    if (t === undefined) {
      t = new TilingSprite({ texture, width: 0, height: 0 });
      this.tilingPool.push(t);
      this.container.addChild(t);
    } else {
      t.visible = true;
      t.texture = texture;
    }
    return t;
  }

  private shrinkPoolsTo(usedG: number, usedS: number, usedT: number): void {
    for (let i = usedG; i < this.graphicsPool.length; i += 1) this.graphicsPool[i]!.visible = false;
    for (let i = usedS; i < this.spritePool.length; i += 1) this.spritePool[i]!.visible = false;
    for (let i = usedT; i < this.tilingPool.length; i += 1) this.tilingPool[i]!.visible = false;
  }

  private releaseAll(): void {
    for (const g of this.graphicsPool) g.visible = false;
    for (const s of this.spritePool) s.visible = false;
    for (const t of this.tilingPool) t.visible = false;
  }
}
