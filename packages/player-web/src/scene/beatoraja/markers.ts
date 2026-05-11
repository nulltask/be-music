// Lane markers rendered alongside notes on the gameplay scene.
//
// Beatoraja's `note.group` / `note.bpm` / `note.stop` / `note.time` arrays describe how to draw
// per-event chart-time markers — section lines at every measure boundary, BPM-change indicator
// bars, STOP markers, and timed grid lines. Each entry is a destination-shaped record (`id`,
// `dst[]`, optional `op` / `r` / `g` / `b`) referencing an `image[]` for the visual.
//
// The renderer paints one sprite per (marker kind × event) at the matching beat, scrolled to the
// judgement line by the same hispeed math the note layer uses. Markers outside the visible lane
// area are culled.

import { Container, Sprite, type Texture } from 'pixi.js';
import {
  normalizeBeatorajaDestinations,
  type BeatorajaImageElement,
  type BeatorajaImageId,
} from '@be-music/beatoraja-skin';
import { createCroppedBeatorajaTexture, flipRectToPixi } from '../../skin/beatoraja/render.ts';
import type { BeatorajaTextureCache } from '../../skin/beatoraja/textures.ts';

/** Beat positions per marker kind. Caller computes these from the chart once per play. */
export interface BeatorajaMarkerBeats {
  /** Section-line beats — one per measure boundary. */
  group: ReadonlyArray<number>;
  /** BPM-change event beats. */
  bpm: ReadonlyArray<number>;
  /** STOP event beats. */
  stop: ReadonlyArray<number>;
  /** Time-tick beats — typically every 1 / 4 / 8 measures depending on the skin's authored style. */
  time: ReadonlyArray<number>;
}

interface MarkerKindData {
  /** Image element resolved from the destination's id. */
  image: BeatorajaImageElement | undefined;
  /** Texture cropped to the image's source-rect, ready for sprite assignment. */
  texture: Texture | undefined;
  /** Authored display rect — `dst[0]` of the destination. Position is replaced per-marker. */
  rect: { x: number; y: number; w: number; h: number };
  /** Authored tint / alpha (from `dst[0]`) — applied to every painted instance. */
  tint: number;
  alpha: number;
  /**
   * Pixi-Y offset between the marker's authored BOTTOM and the lane's authored BOTTOM, both
   * computed in Pixi-Y-DOWN screen coordinates. Mirrors upstream's `line.draw(sprite, time,
   * main, 0, (int) (y - hl))` pattern (`LaneRenderer.java:373, 387, 400, 414`):
   *
   *   - upstream `y` is the libGDX-Y-UP scroll position of the timeline.
   *   - `hl` is the lane's authored Y-UP bottom (= judge-line position).
   *   - the offset added to the line's authored Y-UP position is `y - hl`.
   *   - so the rendered line Y-UP bottom = `authored_line_y + (y - hl)`.
   *
   * Re-derived in Pixi: `rendered_pixi_bottom = scroll_pixi + (M_authored - L_authored)`,
   * where `M_authored` / `L_authored` are the Pixi-Y bottoms of the marker / lane in their
   * authored positions. This `bottomOffsetFromLaneBottomPixi` field stores
   * `M_authored - L_authored` so the per-frame update can add it to `y` directly.
   *
   * For ModernChic the barline is authored at `y = NOTES_JUDGE_Y, h = 3` while the lane is
   * authored at `y = NOTES_JUDGE_Y - 12, h = LANE_LENGTH - 12`. After Y-flip the offset
   * resolves to `-12` (the barline sits 12 px above the lane bottom in Pixi). Without
   * honoring this, every barline painted at the lane's bottom edge instead of crossing
   * through the note head's middle, which is exactly the user-reported symptom of section
   * lines visually misaligning with note heads.
   */
  bottomOffsetFromLaneBottomPixi: number;
}

export interface BeatorajaMarkerLayerOptions {
  group: ReadonlyArray<Readonly<Record<string, unknown>>>;
  bpm: ReadonlyArray<Readonly<Record<string, unknown>>>;
  stop: ReadonlyArray<Readonly<Record<string, unknown>>>;
  time: ReadonlyArray<Readonly<Record<string, unknown>>>;
  /** `image[]` lookup for resolving destination ids → image elements. */
  images: ReadonlyMap<BeatorajaImageId, BeatorajaImageElement>;
  textures: BeatorajaTextureCache;
  /**
   * Skin canvas height in skin-pixel units. Used to flip the prototype rect's Y from libGDX
   * Y-UP into Pixi Y-DOWN, matching the note layer's lane rects and the play view's chrome.
   */
  canvasHeight: number;
  /**
   * Authored Pixi-Y of the lane's bottom edge (= upstream's `hl` after Y-flip into Pixi).
   * Computed once from `noteSection.dst[0]`'s flipped lane rects: `max(rect.y + rect.h)`.
   *
   * Used to compute each marker's bottom-offset-from-lane-bottom in Pixi space. Mirrors
   * upstream's barline draw pattern (`line.draw(sprite, ..., 0, y - hl)` in
   * `LaneRenderer.java:373`) where the line is offset relative to the lane bottom — markers
   * whose authored Y differs from the lane's bottom paint with that constant pixel gap so
   * they cross the lane at the authored offset (e.g., ModernChic's barlines cross through
   * the note head's MIDDLE rather than the note's bottom edge).
   *
   * `undefined` falls back to "treat marker bottom = scroll position", which is the previous
   * behaviour that misaligned ModernChic barlines by 12 px.
   */
  laneAuthoredBottomY?: number;
}

// `BEATORAJA_MARKER_PIXELS_PER_BEAT` (a fixed 72) used to live here for parity with the
// note layer's old constant. It was removed alongside the upstream-faithful scroll switch
// in `scene/beatoraja/notes.ts` — the scroll distance per beat is now `laneHeight / 4 *
// hispeed` per upstream `LaneRenderer.java:271-276`. The gameplay caller computes the
// matching value via `beatorajaPixelsPerBeat()` and passes it through `update.args` so the
// marker layer stays in lock-step with the note layer.

export class BeatorajaMarkerLayer {
  readonly container: Container = new Container();
  /** Resolved per-kind prototype data. `[]` means the skin didn't author markers of that kind. */
  private readonly kindData: {
    group: MarkerKindData[];
    bpm: MarkerKindData[];
    stop: MarkerKindData[];
    time: MarkerKindData[];
  };
  /** Sprite pool — one entry per visible marker, reused across frames. */
  private readonly spritePool: Sprite[] = [];
  private firstFrameLogged = false;

  constructor(options: BeatorajaMarkerLayerOptions) {
    const laneBottom = options.laneAuthoredBottomY;
    this.kindData = {
      group: this.resolveKind(options.group, options.images, options.textures, options.canvasHeight, laneBottom),
      bpm: this.resolveKind(options.bpm, options.images, options.textures, options.canvasHeight, laneBottom),
      stop: this.resolveKind(options.stop, options.images, options.textures, options.canvasHeight, laneBottom),
      time: this.resolveKind(options.time, options.images, options.textures, options.canvasHeight, laneBottom),
    };
  }

  /**
   * Paint markers for the current frame. `judgementY` and `pixelsPerBeat` are passed in so the
   * marker layer stays in lockstep with the note layer's scroll math (avoids visual drift when
   * the host tweaks judgement line or hispeed mid-play).
   */
  update(args: {
    currentBeat: number;
    judgementY: number;
    laneTopY: number;
    pixelsPerBeat: number;
    markers: BeatorajaMarkerBeats;
  }): void {
    let used = 0;
    const ranges: ReadonlyArray<{ kind: MarkerKindData[]; beats: ReadonlyArray<number> }> = [
      { kind: this.kindData.group, beats: args.markers.group },
      { kind: this.kindData.bpm, beats: args.markers.bpm },
      { kind: this.kindData.stop, beats: args.markers.stop },
      { kind: this.kindData.time, beats: args.markers.time },
    ];
    for (const { kind, beats } of ranges) {
      if (kind.length === 0 || beats.length === 0) continue;
      // Pick the first prototype with a resolved texture — most skins author at most one
      // destination per marker kind. Multi-destination kinds (e.g., color-coded BPM markers)
      // would need richer logic; treat them as "use the first" for now.
      const proto = kind.find((k) => k.texture !== undefined);
      if (proto === undefined) continue;
      for (const beat of beats) {
        const scrollY = args.judgementY - (beat - args.currentBeat) * args.pixelsPerBeat;
        // Apply the authored bottom offset relative to the lane's authored bottom — mirrors
        // upstream's `line.draw(..., 0, y - hl)` (`LaneRenderer.java:373`). Without this the
        // barline lands at the lane's BOTTOM EDGE instead of the authored bar position
        // (which for ModernChic is 12 px above the lane bottom, crossing through the note
        // head's middle).
        const y = scrollY + proto.bottomOffsetFromLaneBottomPixi;
        // Cull markers outside the lane area. Test against the OFFSET y so a marker that sits
        // well above the lane bottom (e.g., a hypothetical "ceiling marker") doesn't get
        // culled prematurely. 24-pixel slack matches the note layer's culling so markers
        // don't pop in/out at the edge.
        if (y < args.laneTopY - 24 || y > args.judgementY + 24) continue;
        const sprite = this.acquireSprite(used);
        sprite.texture = proto.texture!;
        // Anchor at the rect's BOTTOM-LEFT so the marker's bottom edge sits exactly on `y`.
        // Combined with the offset above, this puts the marker bottom at `scrollY + offset`
        // — i.e., the offset relative to where the timeline's scroll position is at this
        // beat, exactly mirroring upstream's `authored_marker_y + (scroll_y - lane_bottom_y)`.
        sprite.anchor.set(0, 1);
        sprite.x = proto.rect.x;
        sprite.y = y;
        sprite.width = proto.rect.w;
        sprite.height = Math.max(1, proto.rect.h);
        sprite.tint = proto.tint;
        sprite.alpha = proto.alpha;
        used += 1;
      }
    }
    this.shrinkPoolTo(used);
    if (!this.firstFrameLogged && used > 0) {
      this.firstFrameLogged = true;
      // eslint-disable-next-line no-console
      console.log(
        '[beatoraja-markers] first frame painted',
        JSON.stringify({
          group: args.markers.group.length,
          bpm: args.markers.bpm.length,
          stop: args.markers.stop.length,
          time: args.markers.time.length,
          painted: used,
        }),
      );
    }
  }

  dispose(): void {
    if (!this.container.destroyed) this.container.destroy({ children: true });
    this.spritePool.length = 0;
  }

  // ─── Internals ────────────────────────────────────────────────────────────────────────────────

  /**
   * Resolve a marker-kind's authored destinations to a paintable prototype list. Each input
   * record is normalized through the standard destination pipeline (so `if[]` / `op[]` gates,
   * dst keyframes, etc. flow through), but only `dst[0]` is consumed — the marker's authored
   * appearance is the static rect; the renderer overrides Y per-beat anyway.
   */
  private resolveKind(
    inputs: ReadonlyArray<Readonly<Record<string, unknown>>>,
    images: ReadonlyMap<BeatorajaImageId, BeatorajaImageElement>,
    textures: BeatorajaTextureCache,
    canvasHeight: number,
    laneAuthoredBottomY: number | undefined,
  ): MarkerKindData[] {
    if (inputs.length === 0) return [];
    const groups = normalizeBeatorajaDestinations(inputs);
    const out: MarkerKindData[] = [];
    for (const group of groups) {
      const image = images.get(group.id);
      const baseTexture = image !== undefined ? textures.get(image.src) : undefined;
      const texture =
        image !== undefined && baseTexture !== undefined
          ? createCroppedBeatorajaTexture(baseTexture, { x: image.x, y: image.y, w: image.w, h: image.h })
          : undefined;
      const dst0 = group.dst[0];
      // beatoraja's `dst[]` is libGDX Y-UP; flip into Pixi Y-DOWN to match the rest of the
      // pipeline. The flipped rect's `y + h` is the marker's authored Pixi BOTTOM, which we
      // diff against the lane's authored Pixi bottom to mirror upstream's `(y - hl)` offset
      // (`LaneRenderer.java:373`).
      const rect =
        dst0 !== undefined
          ? flipRectToPixi({ x: dst0.x, y: dst0.y, w: dst0.w, h: dst0.h }, canvasHeight)
          : { x: 0, y: 0, w: 0, h: 0 };
      const tint = dst0 !== undefined ? ((dst0.r & 0xff) << 16) | ((dst0.g & 0xff) << 8) | (dst0.b & 0xff) : 0xffffff;
      const alpha = dst0 !== undefined ? Math.max(0, Math.min(1, dst0.a / 255)) : 1;
      // Compute the constant Pixi-Y delta between the marker's authored bottom and the lane's
      // authored bottom. Falls back to 0 when the caller didn't supply a lane bottom — that
      // preserves the previous "marker bottom = scroll position" behaviour for tests / hosts
      // that haven't wired the new arg yet.
      const markerAuthoredBottomPixi = rect.y + rect.h;
      const bottomOffsetFromLaneBottomPixi =
        laneAuthoredBottomY !== undefined ? markerAuthoredBottomPixi - laneAuthoredBottomY : 0;
      out.push({ image, texture, rect, tint, alpha, bottomOffsetFromLaneBottomPixi });
    }
    return out;
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

  private shrinkPoolTo(used: number): void {
    for (let i = used; i < this.spritePool.length; i += 1) {
      this.spritePool[i]!.visible = false;
    }
  }
}
