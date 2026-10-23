/**
 * One beatoraja play skin on the stage: the skin's elements (`BeatorajaPlaySkinView`) with the play's layers spliced in
 * where the skin authored them — the lane markers under the notes at the skin's note anchor, and the BGA at its `bga`
 * destination — on a black backdrop, the skin's canvas fitted into the window. The play view keeps one per skin and
 * builds another when the player's skin options change mid-play; the play and its bridge carry over.
 */

import {
  normalizeBeatorajaImages,
  normalizeBeatorajaNote,
  type BeatorajaImageElement,
  type BeatorajaImageId,
} from '@be-music/skin-beatoraja';
import type { TempoReversalPoint, ChartPlayVariant } from '@be-music/chart-model';
import type { ScrollDistanceMapperLike } from '@be-music/player-engine/display';
import type { Container, Texture } from 'pixi.js';
import type { BeatorajaSceneKit } from '../../skin/beatoraja/scene-kit.ts';
import type { BGACue, NonstopBGAStage, NonstopStageBGATimeline } from '../../chart/bga-timeline.ts';
import { BeatorajaPlaySkinView, type BeatorajaPlaySkinViewOptions } from './skin-view.ts';
import type { PixiSceneHost } from '../../host/scene-host.ts';
import type { BeatorajaRenderContext } from '../../skin/beatoraja/render.ts';
import { BeatorajaBGALayer } from './play/bga.ts';
import type { BeatorajaMarkerBeats } from '../../chart/beatoraja/markers.ts';
import { BeatorajaMarkerLayer } from './play/markers.ts';
import {
  BeatorajaNoteLayer,
  beatorajaDisplayScrollBeat,
  beatorajaPixelsPerBeat,
  type BeatorajaNoteClock,
} from './play/notes.ts';
import { resolveBeatorajaScrollPlacement } from './play/scroll-placement.ts';
import { computeAuthoredLaneBottomYPixi } from './play/skin-metrics.ts';
import { BeatorajaSkinStage } from './scene-frame.ts';

/** What the chart gives every skin the play is drawn with: its lanes, scroll, markers. */
export interface BeatorajaPlayChartLayout {
  readonly variant: ChartPlayVariant;
  readonly scrollMapper: ScrollDistanceMapperLike | undefined;
  readonly timelineBeats: ArrayLike<number> | undefined;
  readonly beatToSeconds: ((beat: number) => number) | undefined;
  readonly reversal: TempoReversalPoint | undefined;
  readonly markers: BeatorajaMarkerBeats;
  readonly autoPlay: boolean;
}

/**
 * The chart's BGA as the BGA layer draws it: its textures and videos by `#BMPxx` key and its cues, and a stitched NONSTOP
 * chart's stages with each stage's own cues.
 */
export interface BeatorajaPlayBGA {
  /** Base and POOR track textures (black kept). */
  readonly textures: ReadonlyMap<string, Texture>;
  /** Layer track textures (black keyed out for a BMS chart). */
  readonly layerTextures: ReadonlyMap<string, Texture>;
  readonly videos: ReadonlyMap<string, HTMLVideoElement>;
  readonly cues: { base: readonly BGACue[]; layer: readonly BGACue[]; poor: readonly BGACue[] };
  readonly nonstop?: {
    readonly stages: readonly NonstopBGAStage[];
    readonly timelines: readonly NonstopStageBGATimeline[];
  };
}

/** Where the engine is, as the layers scroll: its notes, chart time and beat. */
export type BeatorajaPlayLayerClock = BeatorajaNoteClock & { readonly reversalSeconds?: number };

/** One beatoraja play skin on the stage. See the module comment. */
export class BeatorajaPlayStage {
  private readonly stage: BeatorajaSkinStage;
  private readonly noteLayer: BeatorajaNoteLayer;
  private readonly markerLayer: BeatorajaMarkerLayer;
  private bgaLayer: BeatorajaBGALayer | undefined;
  private readonly kit: BeatorajaSceneKit;
  private readonly skinConfigOps: ReadonlySet<number>;
  private readonly layout: BeatorajaPlayChartLayout;

  public constructor(
    kit: BeatorajaSceneKit,
    skinConfigOps: ReadonlySet<number>,
    layout: BeatorajaPlayChartLayout,
    resolvers: Omit<BeatorajaPlaySkinViewOptions, 'skin' | 'textures' | 'skinConfigOps'>,
  ) {
    this.kit = kit;
    this.skinConfigOps = skinConfigOps;
    this.layout = layout;
    const view = new BeatorajaPlaySkinView({ skin: kit.skin, textures: kit.textures, skinConfigOps, ...resolvers });
    this.stage = new BeatorajaSkinStage(view);
    // The note layer crops each lane's note images out of the skin's `image[]` entries.
    const images = new Map<BeatorajaImageId, BeatorajaImageElement>();
    for (const image of normalizeBeatorajaImages(kit.skin.image)) images.set(image.id, image);
    const noteSection = normalizeBeatorajaNote(kit.skin.note);
    this.noteLayer = new BeatorajaNoteLayer({
      noteSection,
      variant: layout.variant,
      images,
      textures: kit.textures,
      canvasHeight: view.height,
      scrollMapper: layout.scrollMapper,
      timelineBeats: layout.timelineBeats,
      autoplay: layout.autoPlay,
      reversal: layout.reversal,
    });
    // Bar lines sit their authored distance above the lane bottom (`LaneRenderer.java:373`'s `y - hl`), so ModernChic's,
    // authored 12 px up, cross the note heads through their middle.
    this.markerLayer = new BeatorajaMarkerLayer({
      group: noteSection.group,
      bpm: noteSection.bpm,
      stop: noteSection.stop,
      time: noteSection.time,
      images,
      textures: kit.textures,
      canvasHeight: view.height,
      laneAuthoredBottomY: computeAuthoredLaneBottomYPixi(noteSection.dst[0]?.rects ?? [], view.height),
    });
    // At the skin's note anchor, markers under the notes: elements authored after the anchor (the lane cover, the
    // HIDDEN cover, readouts) draw over the falling notes, as beatoraja's z-order has it. `addChildAt` twice at the same
    // index puts the markers first and the notes after them.
    const index = view.noteLayerInsertIndex;
    view.container.addChildAt(this.markerLayer.container, index);
    view.container.addChildAt(this.noteLayer.container, index + 1);
  }

  /** The stage's root: the backdrop and the skin's canvas. */
  public get root(): Container {
    return this.stage.root;
  }

  /** The skin's canvas size in skin pixels. */
  public get width(): number {
    return this.stage.view.width;
  }

  public get height(): number {
    return this.stage.view.height;
  }

  /** Whether the BGA layer is in. */
  public get hasBGA(): boolean {
    return this.bgaLayer !== undefined;
  }

  /**
   * Puts the BGA layer in, at the skin's `bga` destination (`bgaLayerInsertIndex`): later elements draw over it, so the
   * default skin's full-canvas background does not cover it.
   */
  public addBGA(bga: BeatorajaPlayBGA): void {
    if (this.bgaLayer !== undefined) return;
    const view = this.stage.view;
    this.bgaLayer = new BeatorajaBGALayer({
      skin: this.kit.skin,
      textures: bga.textures,
      layerTextures: bga.layerTextures,
      videoElements: bga.videos,
      cues: bga.cues,
      nonstop: bga.nonstop,
      skinConfigOps: this.skinConfigOps,
    });
    view.container.addChildAt(this.bgaLayer.container, view.bgaLayerInsertIndex);
  }

  /** Plays the BGA's current video again after a pause (the play paused every video). */
  public resumeBGA(): void {
    this.bgaLayer?.resume();
  }

  public fitTo(host: PixiSceneHost): void {
    this.stage.fitTo(host);
  }

  public getStageInfo(): { container: Container; width: number; height: number } {
    return this.stage.getStageInfo();
  }

  /** The skin's canvas, which a failed play's fade dims. */
  public get canvas(): Container {
    return this.stage.view.container;
  }

  /**
   * Draws one frame: the skin's elements at `context`, then — with the engine's `clock` — the notes and markers at
   * `hiSpeed` and the BGA.
   */
  public draw(
    context: BeatorajaRenderContext,
    clock: BeatorajaPlayLayerClock | undefined,
    hiSpeed: number,
    lanes: { isLaneLNHeld(channel: string): boolean; isPoorBGAActive(seconds: number): boolean },
    playback: { tempo?: number; paused?: boolean; started?: boolean; showInvisibleNotes?: boolean } = {},
  ): void {
    const view = this.stage.view;
    view.update(context);
    if (clock === undefined) return;
    const activeOps = context.activeOps;
    this.noteLayer.update(
      clock,
      hiSpeed,
      activeOps,
      (channel) => lanes.isLaneLNHeld(channel),
      playback.showInvisibleNotes,
    );
    // The markers scroll with the notes' per-beat distance (`rxhs / 4 * hispeed`, `LaneRenderer.java:271-276`) on the
    // lane the active dst block resolves; skin-canvas defaults when no lane matched.
    const laneBounds = this.noteLayer.getLaneBounds(activeOps) ?? { topY: 0, bottomY: view.height };
    const laneHeight = Math.max(0, laneBounds.bottomY - laneBounds.topY);
    // Past an LR2 negative-BPM reversal both layers scroll from the mirrored display beat.
    const currentBeat = beatorajaDisplayScrollBeat(clock);
    const pixelsPerBeat = beatorajaPixelsPerBeat(laneHeight, hiSpeed);
    const layout = this.layout;
    // On a chart that scrolls, bar lines follow the notes' `LaneRenderer` window as well as their distance.
    const placement = resolveBeatorajaScrollPlacement({
      currentBeat,
      nowSeconds: clock.currentSeconds,
      reversal: layout.reversal,
      mapper: layout.scrollMapper,
      laneBeats: pixelsPerBeat > 0 ? laneHeight / pixelsPerBeat : 0,
      timelineBeats: layout.timelineBeats,
      stageBottomY: view.height,
    });
    this.markerLayer.update({
      currentBeat,
      distance: layout.scrollMapper ? placement.distance : undefined,
      judgementY: laneBounds.bottomY,
      laneTopY: laneBounds.topY,
      pixelsPerBeat,
      markers: layout.markers,
      window: placement.window,
      secondsAt: layout.beatToSeconds,
    });
    // The BGA freezes on what showed at a reversal (clamped, not mirrored), as LR2 stops its cues there.
    this.bgaLayer?.update(
      Math.min(clock.currentSeconds, clock.reversalSeconds ?? Number.POSITIVE_INFINITY),
      context,
      lanes.isPoorBGAActive(clock.currentSeconds),
      { ...playback, seconds: clock.currentSeconds },
    );
  }

  public dispose(): void {
    this.bgaLayer?.dispose();
    this.bgaLayer = undefined;
    this.noteLayer.dispose();
    this.markerLayer.dispose();
    this.stage.dispose();
  }
}
