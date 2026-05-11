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
import { createCroppedBeatorajaTexture, flipRectToPixi } from '../../skin/beatoraja/render.ts';
import type { BeatorajaTextureCache } from '../../skin/beatoraja/textures.ts';

/**
 * Beats per standard 4/4 measure. Mirrors `getMeasureBeats(1.0) === 4` from
 * `@be-music/chart`'s beat resolver, which the engine uses to convert a measure into the
 * per-beat scroll math below. We pin the constant here (rather than importing the chart
 * helper) because the lane renderer doesn't otherwise need to know about chart structure;
 * the value is fixed by BMS spec.
 */
const BEATS_PER_STANDARD_MEASURE = 4;

/**
 * Compute the per-beat scroll distance in skin-pixel space. Mirrors upstream
 * `LaneRenderer.java:271-276`'s `rxhs = (hu - hl) * hispeed`:
 *
 *   - `(hu - hl)` is the lane's authored height (skin coords, libGDX Y-UP — equivalent to
 *     the Pixi-flipped `laneBottomY - laneTopY` we pass in here).
 *   - `rxhs` is the y-delta per UNIT MEASURE; one measure (= 4 beats) of music traverses
 *     exactly one lane height when `hispeed === 1`.
 *
 * Re-derived per beat: `pixelsPerBeat = laneHeight / 4 * hispeed`. ModernChic authors a
 * 841-px lane → 1 beat = 210 px at hispeed 1, matching upstream beatoraja's "4 beats
 * visible on the lane" baseline. The previous fixed-72 constant scrolled ~2.9× slower
 * than upstream on the same skin (and also slower than the LR2 path on tighter authored
 * lanes), which the user reported as the beatoraja note scroll falling visibly slower
 * than the LR2 path at the same hispeed.
 *
 * `laneHeight <= 0` falls back to `0` (no scroll), matching the upstream `nscroll > 0`
 * guard. Callers are expected to pass `Math.max(0, judgementY - laneTopY)`; defensive
 * `<= 0` handling here is just to keep the renderer from dividing by garbage if the
 * caller forgets.
 */
export function beatorajaPixelsPerBeat(laneHeight: number, hispeed: number): number {
  if (!Number.isFinite(laneHeight) || laneHeight <= 0) return 0;
  if (!Number.isFinite(hispeed) || hispeed <= 0) return 0;
  return (laneHeight / BEATS_PER_STANDARD_MEASURE) * hispeed;
}

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
  readonly container: Container = new Container();
  /**
   * Two-tier layering so LN bodies always sit BEHIND head/tail caps and tap notes,
   * regardless of pool-reuse order across frames.
   *
   * `paintLongNote` acquires three sprites in sequence (body → start cap → end cap) and
   * the previous implementation added them all to a single root container, relying on
   * Pixi's `addChild` order to determine Z. That order, however, is captured the FIRST
   * time a slot is allocated and persists through reuse — so a frame that mounts a
   * tap-note via `acquireSprite(0)` before any LN exists captures `spritePool[0]` at
   * Z position 0. A later frame that drops the tap-note and uses pool index 0 for an LN
   * START CAP draws the head behind every subsequently-mounted body sprite (which were
   * added LATER and thus sit on top). User-reported symptom: the LN head sprite
   * appeared BEHIND the body instead of in front of it.
   *
   * Splitting bodies and caps into their own containers fixes the Z order at the
   * CONTAINER level, which doesn't depend on pool slot ordering. The body container
   * is added first (= back); caps + tap-notes are added second (= front). Inside each
   * tier the addChild order between pool slots still doesn't matter — every LN body
   * draws behind every cap/tap regardless of which pool index landed where.
   */
  private readonly bodyLayer = new Container();
  private readonly noteLayer = new Container();
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
    // bodyLayer first (= back), noteLayer second (= front). See field doc for rationale.
    this.container.addChild(this.bodyLayer);
    this.container.addChild(this.noteLayer);
  }

  update(
    frame: PlayerUiFramePayload,
    hiSpeed: number,
    activeOps: ReadonlySet<number>,
    /**
     * Live "is the player currently holding the LN on this lane?" lookup. Returns the runtime
     * adapter's `isLaneLnHeld(channel)` so the LN body sprite can flip between the held /
     * unheld variants beatoraja's modern-mode skins author. When omitted the layer always
     * paints the held variant — matches the legacy-mode skin behavior where `lnBodyHeld`
     * resolves to the same sprite as `lnBodyUnheld`.
     */
    isLaneLnHeld?: (channel: string) => boolean,
  ): void {
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
    // Per upstream `LaneRenderer.java:271-276` the scroll distance is proportional to the
    // lane's authored height: `rxhs = (hu - hl) * hispeed`, so 1 measure (= 4 beats) of
    // music covers exactly 1 lane at hispeed=1. `laneTopY` is read from the same flipped
    // Pixi rects `judgementY` was derived from, so the two stay in lock-step on layout
    // changes (lift / `if`-gated alt blocks).
    const laneTopY = this.resolveLaneTopY(rects);
    const pixelsPerBeat = beatorajaPixelsPerBeat(judgementY - laneTopY, hiSpeed);
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
      const isLongNote = note.endBeat !== undefined && Number.isFinite(note.endBeat);
      // Tap-note `judged` gate. LN notes need a DIFFERENT visibility rule: upstream
      // beatoraja's `LaneRenderer` keeps drawing the LN body / tail until the tail crosses
      // the judgement line — even after the head's verdict has been recorded — so the
      // player sees the sustain glow / `lnactive` frame while holding the key. Our engine
      // flags `note.judged = true` at LN head time (manual `markScorableJudged` at
      // `engine.ts:3077` / autoplay's `note.judged = true` at `engine.ts:2139`), so a naive
      // `if (note.judged) continue` here would clip the entire LN — body, tail, and all —
      // the moment the head was hit. User-reported symptom: LN notes disappeared
      // as soon as the head's judge fired. The LN branch below handles its own tail-past culling via the
      // `yEnd` check.
      if (!isLongNote && note.judged) continue;
      const lane = this.resolveLane(note);
      if (lane === undefined) continue;
      const rect = rects[lane];
      if (rect === undefined) continue;

      const y = judgementY - (note.beat - frame.currentBeat) * pixelsPerBeat;

      if (isLongNote) {
        const yEnd = judgementY - (note.endBeat! - frame.currentBeat) * pixelsPerBeat;
        // Cull when the tail hasn't yet reached the judgement line. (LN body extends DOWN
        // from the tail to the head, so this checks if the tail is still scrolling in.)
        if (yEnd > judgementY) continue;
        // Cull when the entire LN has scrolled past the top of the lane. Both head AND
        // tail must be off the top edge — if the tail is still on-screen but the head
        // has just slipped past, we want to keep drawing the part that's still visible.
        if (y < rect.y - 24 && yEnd < rect.y - 24) continue;
        // Clip the LN's start cap (player-facing head) to the judgement line so the body
        // doesn't visually extend past the chart's bottom edge while the player is holding.
        // The engine still drives the LN's actual judging window from `note.beat` /
        // `note.endBeat`; this is purely a visual cap so the body stops growing once it has
        // reached the line.
        const yStartClipped = Math.min(y, judgementY);
        // "Held" = THIS specific LN is the one currently being judged on its lane.
        // `isLaneLnHeld(channel)` is a channel-level flag (true while ANY LN on the lane is in
        // its active judgement window), so a future, not-yet-judged LN on the same lane
        // would also satisfy it.  Pair it with `note.judged` — engine flips this to `true`
        // ONLY for the LN whose head has been judged (mirrors upstream's `state.processing`
        // pointer in `JudgeManager`, which holds the specific `LongNote` pair currently
        // resolving).  Result: only the judged LN gets the held / glow sprite; unrelated
        // LNs further down the lane render their unheld variant. User-reported symptom:
        // un-judged LNs on the same lane glowed alongside the currently-judged one.
        const isThisNoteBeingJudged = note.judged;
        const heldChannel = isLaneLnHeld !== undefined ? isLaneLnHeld(note.channel) : true;
        const held = isThisNoteBeingJudged && heldChannel;
        const r = this.paintLongNote(usedG, usedS, usedT, rect, lane, yEnd, yStartClipped, held, note.longNoteMode);
        usedG = r.g;
        usedS = r.s;
        usedT = r.t;
        continue;
      }

      // Tap-note bottom + top cull at the judgement line — notes whose visual bottom has
      // crossed the line are no longer judgable (the engine fires auto-POOR shortly after)
      // and rendering them past the line looked like the note was "flying through" the
      // chart's bottom edge. Top cull keeps a small lead-in margin so notes pop into view
      // smoothly as they approach from above.
      if (y < rect.y - 24 || y > judgementY) continue;
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

  /**
   * Lane top edge in Pixi-Y coords across the active rect set. Mirrors upstream's
   * `hu = lanes[0].region.y + lanes[0].region.height` (`LaneRenderer.java:274`) — the
   * spawn line — but expressed in Pixi terms (smallest `rect.y` = topmost edge after the
   * Y-flip). Used together with `resolveJudgementY` to derive the per-beat scroll distance
   * via {@link beatorajaPixelsPerBeat} (= upstream's `rxhs / 4`).
   */
  private resolveLaneTopY(rects: ReadonlyArray<BeatorajaNoteRect>): number {
    let top = Number.POSITIVE_INFINITY;
    for (const rect of rects) top = Math.min(top, rect.y);
    return Number.isFinite(top) ? top : 0;
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
      // Width stretches to the lane rect; HEIGHT stays at the source `cellH` (no aspect
      // scaling). Beatoraja's reference renderer paints notes at their authored cell
      // height regardless of lane width — default skin's note images are 12 px tall but
      // 21 / 27 / 46 px wide depending on key flavour, while lane widths are 40 / 50 / 70
      // px. Scaling H by `lane.w / cellW` (the obvious "preserve aspect ratio" choice)
      // produced 22-23 px tall notes — the user reported the notes were visibly taller
      // than in upstream beatoraja. The pinned bottom edge stays at the judgement line via `y - drawH`.
      const drawH = cropped.cellH;
      // Apply the skin's `note.expansionrate` (default `[100, 100]` = no scaling). 9K's
      // `play9.json` authors `[115, 112]` (1.15× wider, 1.12× taller) for chunkier popn-style
      // notes. The expansion is applied around the rect's centre so notes stay aligned to the
      // lane while bleeding evenly into the gaps.
      const exX = this.noteSection.expansionRate.x / 100;
      const exY = this.noteSection.expansionRate.y / 100;
      const drawW = rect.w * exX;
      const drawHExpanded = drawH * exY;
      sprite.x = rect.x - (drawW - rect.w) / 2;
      sprite.y = y - drawHExpanded;
      sprite.width = drawW;
      sprite.height = drawHExpanded;
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
    /**
     * `true` when the player is actively holding this LN's lane (the runtime adapter's
     * `isLaneLnHeld` returned true for the note's channel). Drives held-vs-unheld body
     * sprite switching:
     *
     *   - `lnBodyHeld`   → painted while the player is holding (matches beatoraja's
     *     `lns[2]` slot). Modern-mode authoring uses this for the "active" variant.
     *   - `lnBodyUnheld` → painted while the player is NOT holding (matches `lns[3]`).
     *     Modern-mode "neutral" body shown before / after the press window.
     *
     * Legacy-mode skins resolve both slots to the same sprite, so the held flag has no
     * visible effect there — preserves the prior behavior on the 3 reference skins.
     */
    held: boolean,
    /**
     * LN authoring mode (`1` = LN, `2` = CN, `3` = HCN). Drives top-cap presence per
     * upstream `LaneRenderer.drawLongNote` (`LaneRenderer.java:671-697`):
     *
     *   - mode 2 (CN) / mode 3 (HCN): top cap uses `lnend[lane]` — upstream's
     *     `longImage[0]` slot (= `lne-*` on `play5.json`, the LN's future-side cap).
     *   - mode 1 (LN): upstream's LN branch (lines 691-697) deliberately skips
     *     `longImage[0]`; LN body simply terminates at its top edge without an end cap.
     *     The head's tap-note painting happens through the regular `note[]` path on
     *     the engine side (the BMS LN's head ChannelNote is treated as a normal tap
     *     for the purpose of head visualization).
     *   - `undefined`: defensive default — treat like mode 2/3 so any host that hasn't
     *     wired `longNoteMode` through the frame keeps the both-caps layout.
     */
    longNoteMode: 1 | 2 | 3 | undefined,
  ): { g: number; s: number; t: number } {
    // **upstream skin-spec convention** (`JsonPlaySkinObjectLoader.java:48-49` is the
    // ground truth):
    //
    //     lns[0] = getNoteTexture(sk.note.lnend, p);    // longImage[0] = lnend
    //     lns[1] = getNoteTexture(sk.note.lnstart, p);  // longImage[1] = lnstart
    //
    // And `LaneRenderer.drawLongNote` (Y-UP) does:
    //
    //     sprite.draw(longImage[0], x, y, width, scale);             // lnend at LN TOP
    //     sprite.draw(longImage[1], x, y - height, width, scale);    // lnstart at LN BOTTOM
    //
    // Translated to Pixi Y-DOWN, where `yStart` is the judgement-line side (screen
    // bottom = head time = LN bottom in Y-UP) and `yEnd` is the future side (screen
    // top = tail time = LN top in Y-UP):
    //
    //   - **`yStart` (screen bottom, head time)** ← `lnstart[lane]` (always drawn)
    //   - **`yEnd`   (screen top, tail time)**    ← `lnend[lane]` (CN/HCN only; LN
    //                                                  mode skips this cap, matching
    //                                                  upstream's `LaneRenderer.java:691-697`
    //                                                  which omits `longImage[0]`)
    //
    // The skin-author naming aligns with the LN's TIME order:
    //   - `lnstart` = LN's time-FIRST end (the side that hits the judgement line first)
    //   - `lnend`   = LN's time-LAST end (the side the player releases last)
    //
    // Full `longImage[]` slot layout (`JsonPlaySkinObjectLoader.java:48-69`):
    //
    //     lns[0] = lnend / lns[1] = lnstart    // CN/LN caps
    //     lns[2] / lns[3] = LN body (held / unheld)
    //     lns[4] = hcnend / lns[5] = hcnstart  // HCN-specific caps
    //     lns[6] / lns[7] = HCN body (held / unheld)
    //     lns[8..9] = HCN gain/drain body
    //
    // And `LaneRenderer.drawLongNote` branches by mode:
    //   - LN  (line 691-697): body + lnstart at LN bottom; NO top cap.
    //   - CN  (line 684-690): body + lnend at LN top + lnstart at LN bottom.
    //   - HCN (line 673-683): HCN body + hcnend at LN top + hcnstart at LN bottom.
    //
    // Pre-fix the renderer used `lnstart` / `lnend` / `lnBodyHeld` / `lnBodyUnheld` for
    // ALL three modes including HCN, ignoring the dedicated `hcnstart` / `hcnend` /
    // `hcnBody*` slots. ModernChic / GdbG / play9.json all author distinct `hcn*`
    // sprites for HCN charts, so HCN LNs rendered with the wrong art. Routing mode 3
    // to the `hcn*` field set restores the upstream-faithful visual.
    const isHcn = longNoteMode === 3;
    const bottomCapId = isHcn ? this.noteSection.hcnstart[lane] : this.noteSection.lnstart[lane];
    const topCapId =
      longNoteMode === 1 ? undefined : isHcn ? this.noteSection.hcnend[lane] : this.noteSection.lnend[lane];
    const bottomCrop = this.resolveLaneSprite(bottomCapId);
    const topCrop = topCapId !== undefined ? this.resolveLaneSprite(topCapId) : undefined;
    // Pick the held / unheld body slot based on the live press state. HCN uses its
    // dedicated `hcnBodyHeld` / `hcnBodyUnheld` (upstream `lns[6]` / `lns[7]`); LN/CN
    // share the regular `lnBodyHeld` / `lnBodyUnheld` slots (`lns[2]` / `lns[3]`).
    // Falls back to the OTHER slot when the chosen one is empty — legacy-mode skins
    // populate only one half so we'd rather paint the wrong-mood body than nothing.
    const heldBodyField = isHcn ? this.noteSection.hcnBodyHeld : this.noteSection.lnBodyHeld;
    const unheldBodyField = isHcn ? this.noteSection.hcnBodyUnheld : this.noteSection.lnBodyUnheld;
    const primaryBodyId = held ? heldBodyField[lane] : unheldBodyField[lane];
    const fallbackBodyId = held ? unheldBodyField[lane] : heldBodyField[lane];
    const bodyId = primaryBodyId !== undefined && primaryBodyId.length > 0 ? primaryBodyId : fallbackBodyId;
    const bodyCrop = bodyId !== undefined ? this.resolveLaneSprite(bodyId) : undefined;
    if (bottomCrop === undefined || bodyCrop === undefined) {
      // Fall back to colored rectangles when the bottom cap or body sprite is missing.
      // (Top cap is allowed to be missing — that's the legitimate LN-mode case where
      // upstream itself doesn't draw a top cap.)
      const color = this.fallbackColorForLane(lane);
      const g = this.acquireGraphics(usedG);
      g.clear();
      g.rect(rect.x + 4, yEnd, rect.w - 8, yStart - yEnd).fill({ color, alpha: 0.6 });
      g.rect(rect.x, yStart - 6, rect.w, 12).fill({ color });
      g.rect(rect.x, yEnd - 6, rect.w, 12).fill({ color });
      return { g: usedG + 1, s: usedS, t: usedT };
    }
    // Apply `note.expansionrate` to LN width and cap heights — same convention as tap notes.
    const exX = this.noteSection.expansionRate.x / 100;
    const exY = this.noteSection.expansionRate.y / 100;
    const drawW = rect.w * exX;
    const drawX = rect.x - (drawW - rect.w) / 2;
    const bottomHExpanded = bottomCrop.cellH * exY;
    const topHExpanded = topCrop !== undefined ? topCrop.cellH * exY : 0;

    // Body — repeats the `lnbody` cell vertically across the LN's main span. Upstream body
    // range (Y-UP, `LaneRenderer.java:687-688, 694-695`) is `[y - height + scale, y]`,
    // i.e. tail-top to head-bottom — `scale` (one cap's worth) trimmed off the LN's bottom
    // for the `lnstart` cap (= `longImage[1]`, the judgement-line side). The TOP cap
    // (`lnend` = `longImage[0]`, CN/HCN only) is drawn ABOVE the body's top edge
    // (Y-UP `+ scale`); body itself doesn't shrink to make room for it. Translated to
    // Pixi Y-DOWN: body bottom = yStart - bottomHExpanded (lnstart cap's top); body top =
    // yEnd unconditionally — the lnend cap then sits ABOVE the body at y = yEnd - topHExpanded.
    const body = this.acquireTiling(usedT, bodyCrop.sprite.texture);
    const bodyTopY = yEnd;
    const bodyBottomY = yStart - bottomHExpanded;
    body.x = drawX;
    body.width = drawW;
    body.y = bodyTopY;
    body.height = Math.max(0, bodyBottomY - bodyTopY);
    body.tilePosition.set(0, 0);
    body.tileScale.set(drawW / Math.max(1, bodyCrop.cellW), 1);
    body.alpha = 1;

    // **Cap draw order mirrors upstream `LaneRenderer.drawLongNote`** (Y-UP, lines
    // 673-697). Upstream's call sequence is `body → topCap (lnend/hcnend) → bottomCap
    // (lnstart/hcnstart)`, putting the bottom cap (judgement-line side) at the FRONT of
    // the Z stack. This matters when the LN's visible span is shorter than one cap's
    // height — typical mid-judge clipping at the bottom edge — and the top/bottom caps
    // overlap: upstream paints the bottom cap on top because the player's eye anchors on
    // the judgement-line side. Pixi's `addChild` order encodes Z, and `acquireSprite`
    // commits the order at first allocation, so we acquire `topCap` BEFORE `bottomCap`
    // so future-side cap lands behind judgement-side cap.

    // Top cap (`lnend` for CN, `hcnend` for HCN — `longImage[0]` / `[4]`). Pinned at
    // `yEnd` with the cap overhanging UPWARD (Y-UP `+ scale`, Y-DOWN `y - topHExpanded`).
    // LN mode skips this entirely — `LaneRenderer.java:691-697`'s LN branch deliberately
    // omits `longImage[0]`, so the body's flat top edge serves as the LN's silhouette
    // end.
    let spritesUsed = 0;
    if (topCrop !== undefined) {
      const topCap = this.acquireSprite(usedS + spritesUsed);
      topCap.texture = topCrop.sprite.texture;
      topCap.x = drawX;
      topCap.y = yEnd - topHExpanded;
      topCap.width = drawW;
      topCap.height = topHExpanded;
      topCap.tint = 0xffffff;
      topCap.alpha = 1;
      spritesUsed += 1;
    }

    // Bottom cap (`lnstart` for LN/CN, `hcnstart` for HCN — `longImage[1]` / `[5]`).
    // Pinned at `yStart` with the cap's bottom edge meeting the judgement line; top
    // edge at `yStart - bottomHExpanded` borders the body's bottom. Always rendered.
    const bottomCap = this.acquireSprite(usedS + spritesUsed);
    bottomCap.texture = bottomCrop.sprite.texture;
    bottomCap.x = drawX;
    bottomCap.y = yStart - bottomHExpanded;
    bottomCap.width = drawW;
    bottomCap.height = bottomHExpanded;
    bottomCap.tint = 0xffffff;
    bottomCap.alpha = 1;
    spritesUsed += 1;

    return { g: usedG, s: usedS + spritesUsed, t: usedT + 1 };
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
      // Graphics nodes are used as note-shape fallbacks (e.g. LN body fill when a sprite
      // is missing AND for tap notes). Mount to `noteLayer` so they share the front-tier
      // with tap-note sprites; LN body tilings live behind on `bodyLayer`.
      this.noteLayer.addChild(g);
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
      // Tap notes, LN start caps, and LN end caps all share this pool — mount to the
      // front-tier `noteLayer` so they sit on top of LN bodies.
      this.noteLayer.addChild(s);
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
      // LN body tilings live on the back-tier `bodyLayer`, so caps + tap notes (mounted to
      // `noteLayer`) always render on top regardless of frame-to-frame pool-index churn.
      this.bodyLayer.addChild(t);
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
