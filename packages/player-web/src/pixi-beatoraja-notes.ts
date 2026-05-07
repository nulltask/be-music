// Note rendering layer for a beatoraja play skin.
//
// Drives a per-channel sprite stack from the engine's `frame.notes[]`. The skin's `note` block holds the
// per-lane geometry (`pickBeatorajaNoteRects`) and a per-lane image ID list — for the MVP we render notes
// as solid-colored Pixi `Graphics` rectangles inside each lane's authored rect; swapping to skin-authored
// note sprites is a follow-up that resolves each per-lane `image[].id` through the texture cache. The
// rectangle path is enough to validate end-to-end engine wiring (notes scroll on time, judge on beat,
// disappear on hit).
//
// Design choices:
//
//   - Stateless re-render every Pixi tick. A single `Graphics` pool is rebuilt on every `update()` —
//     simple to reason about, fast enough for a few hundred on-screen notes. The LR2 renderer's
//     finer-grained sprite pool can come later if profiling shows a hotspot.
//   - Hispeed comes from the engine's `PlayerStateSignals.highSpeed` — the host threads it in on each
//     update; the layer doesn't consult signals directly to keep the dependency tree shallow.
//   - Lane index resolution mirrors `resolveSideKeySlot` (so scratch / 8 / 9 collapse correctly), then
//     applies a side-relative offset for double-play layouts (`14` / `10`).

import { Container, Graphics } from 'pixi.js';
import type { ChartPlayVariant } from '@be-music/player/core/lane-layout';
import { resolveSideKeySlot } from '@be-music/player/core/lane-layout';
import type { PlayerUiFrameNote, PlayerUiFramePayload } from '@be-music/player/core/ui-signal-bus';
import { pickBeatorajaNoteRects, type BeatorajaNoteRect, type BeatorajaNoteSection } from '@be-music/beatoraja-skin';

/** Pixels per chart-beat at hispeed = 1.0. Mirrors the LR2 path's constant so the two layers scroll consistently. */
export const BEATORAJA_PIXELS_PER_BEAT = 72;

/**
 * Per-channel color for the rectangle fallback path. White / blue alternating mirrors the typical 7-key
 * skin palette (white = key 1/3/5/7, blue = key 2/4/6, red = scratch). The actual hex values match
 * beatoraja's default `note-w` / `note-b` / `note-s` palette eyeball-matched from the reference theme.
 */
const FALLBACK_COLOR_BY_KEY: Record<string, number> = {
  white: 0xf5f5f5,
  blue: 0x4ea8ff,
  red: 0xff5050,
};

/**
 * Pop'n / single-side key 1..7 / scratch keying convention used to pick a fallback rectangle color when
 * the skin doesn't provide a per-lane note sprite. Pop'n (variant `9`) uses its own coloring convention.
 */
const SEVEN_KEY_PALETTE = ['red', 'white', 'blue', 'white', 'blue', 'white', 'blue', 'white'] as const;
const POP_KEY_PALETTE = ['white', 'yellow', 'green', 'blue', 'red', 'blue', 'green', 'yellow', 'white'] as const;

const PALETTE_COLOR: Record<string, number> = {
  white: FALLBACK_COLOR_BY_KEY.white!,
  blue: FALLBACK_COLOR_BY_KEY.blue!,
  red: FALLBACK_COLOR_BY_KEY.red!,
  // Two extras for 9-key — picked from the LR2 default Pop'n skin's palette.
  yellow: 0xf2cf3a,
  green: 0x59c863,
};

export interface BeatorajaNoteLayerOptions {
  noteSection: BeatorajaNoteSection;
  /** Play variant — informs lane-index resolution (`9` is single-side, others split into 1P / 2P). */
  variant: ChartPlayVariant;
  /**
   * Y-coordinate of the judgement line in skin-canvas space. Notes spawn above the playfield and scroll
   * down to this line. Pulled from the active `pickBeatorajaNoteRects` block's `y + h` (rect bottom)
   * when omitted; rare custom skins that override this can pass an explicit value.
   */
  judgementY?: number;
}

export class BeatorajaNoteLayer {
  readonly container = new Container();
  private readonly noteSection: BeatorajaNoteSection;
  private readonly variant: ChartPlayVariant;
  private readonly graphicsPool: Graphics[] = [];
  private readonly judgementYOverride?: number;
  /** Cached lane rects from the most recent `pickBeatorajaNoteRects` lookup. Re-resolved when ops change. */
  private cachedActiveOps: ReadonlySet<number> | undefined;
  private cachedRects: ReadonlyArray<BeatorajaNoteRect> = [];

  constructor(options: BeatorajaNoteLayerOptions) {
    this.noteSection = options.noteSection;
    this.variant = options.variant;
    this.judgementYOverride = options.judgementY;
  }

  /**
   * Re-render the note layer for the current frame. Call once per Pixi tick from the gameplay view's
   * tick handler — `update()` clears any previously-acquired graphics that aren't needed this frame and
   * mints / repaints the rest in declaration order.
   */
  update(frame: PlayerUiFramePayload, hiSpeed: number, activeOps: ReadonlySet<number>): void {
    const rects = this.resolveLaneRects(activeOps);
    if (rects.length === 0) {
      this.releaseAll();
      return;
    }
    const judgementY = this.resolveJudgementY(rects);
    const pixelsPerBeat = BEATORAJA_PIXELS_PER_BEAT * hiSpeed;
    let used = 0;

    for (const note of frame.notes) {
      // The engine emits notes that are still in flight. Filter judged / off-screen entries here so the
      // graphics pool doesn't waste a slot on a note that wouldn't paint anyway.
      if (note.judged) continue;
      const lane = this.resolveLane(note);
      if (lane === undefined) continue;
      const rect = rects[lane];
      if (rect === undefined) continue;

      const y = judgementY - (note.beat - frame.currentBeat) * pixelsPerBeat;
      if (y < rect.y - 24 || y > judgementY + 24) continue;

      // LN body + caps when `endBeat` is set. Skip past LN bodies whose tail has already crossed the line
      // (everything below it already painted, no need to redraw).
      if (note.endBeat !== undefined) {
        const yEnd = judgementY - (note.endBeat - frame.currentBeat) * pixelsPerBeat;
        if (yEnd > judgementY) continue;
        used = this.paintLongNote(used, rect, lane, yEnd, y);
        continue;
      }

      used = this.paintTapNote(used, rect, lane, note, y);
    }

    this.shrinkPoolTo(used);
  }

  /** Tear down. Pixi destroys child graphics through the container's own destroy. */
  dispose(): void {
    if (!this.container.destroyed) {
      this.container.destroy({ children: true });
    }
    this.graphicsPool.length = 0;
  }

  // ─── Internals ────────────────────────────────────────────────────────────────────────────────

  private resolveLaneRects(activeOps: ReadonlySet<number>): ReadonlyArray<BeatorajaNoteRect> {
    if (this.cachedActiveOps === activeOps) return this.cachedRects;
    this.cachedRects = pickBeatorajaNoteRects(this.noteSection, activeOps);
    this.cachedActiveOps = activeOps;
    return this.cachedRects;
  }

  private resolveJudgementY(rects: ReadonlyArray<BeatorajaNoteRect>): number {
    if (this.judgementYOverride !== undefined) return this.judgementYOverride;
    let bottom = 0;
    for (const rect of rects) {
      bottom = Math.max(bottom, rect.y + rect.h);
    }
    return bottom;
  }

  private resolveLane(note: PlayerUiFrameNote): number | undefined {
    const slot = resolveSideKeySlot(note.channel, this.variant);
    if (slot < 0) return undefined;
    if (this.variant === '9') {
      // PMS / 9-key: lanes 0..8 (slot returned by `resolveSideKeySlot` is 1..9, since `9` strips the
      // `0=scratch` convention). beatoraja's per-lane rect array is 0-indexed, so subtract 1.
      return slot - 1;
    }
    // 7K / 5K: scratch (slot 0) lives at lane index 7 in beatoraja's rect order (`note-w / note-b / .../ note-s`).
    // Keys 1..7 → lane 0..6; scratch (slot 0) → lane 7. Map the LR2 channel layout onto the beatoraja
    // ordering so the rect index lines up with the per-lane sprite ID list.
    const baseLane = slot === 0 ? 7 : slot - 1;
    if (this.variant === '10' || this.variant === '14') {
      // Double-play: 1P side uses lanes 0..7, 2P side uses lanes 8..15. The skin's rect list is authored
      // in this exact order in the reference 14key skin (`{x = 1P side, ...}, ..., {x = 2P side, ...}`).
      const isPlayer2 = note.channel.startsWith('2');
      return isPlayer2 ? 8 + baseLane : baseLane;
    }
    return baseLane;
  }

  private paintTapNote(
    used: number,
    rect: BeatorajaNoteRect,
    lane: number,
    note: PlayerUiFrameNote,
    y: number,
  ): number {
    const color = note.mine ? FALLBACK_COLOR_BY_KEY.red! : this.fallbackColorForLane(lane);
    const g = this.acquire(used);
    g.clear();
    g.rect(rect.x, y - 6, rect.w, 12).fill({ color });
    return used + 1;
  }

  private paintLongNote(used: number, rect: BeatorajaNoteRect, lane: number, yEnd: number, yStart: number): number {
    const color = this.fallbackColorForLane(lane);
    const g = this.acquire(used);
    g.clear();
    // Body
    g.rect(rect.x + 4, yEnd, rect.w - 8, yStart - yEnd).fill({ color, alpha: 0.6 });
    // Cap at the start (head — at the bottom in screen space) + cap at the end (tail — at the top).
    g.rect(rect.x, yStart - 6, rect.w, 12).fill({ color });
    g.rect(rect.x, yEnd - 6, rect.w, 12).fill({ color });
    return used + 1;
  }

  private fallbackColorForLane(lane: number): number {
    const palette = this.variant === '9' ? POP_KEY_PALETTE : SEVEN_KEY_PALETTE;
    const sided = this.variant === '10' || this.variant === '14' ? lane % 8 : lane;
    const key = palette[sided] ?? 'white';
    return PALETTE_COLOR[key] ?? PALETTE_COLOR.white!;
  }

  private acquire(index: number): Graphics {
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

  private shrinkPoolTo(used: number): void {
    for (let i = used; i < this.graphicsPool.length; i += 1) {
      this.graphicsPool[i]!.visible = false;
    }
  }

  private releaseAll(): void {
    for (const g of this.graphicsPool) g.visible = false;
  }
}
