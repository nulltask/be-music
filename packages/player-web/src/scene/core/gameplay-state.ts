/**
 * The layers of a play on the built-in and LR2 gameplay scenes: the scene graph and its pools, the theme's textures,
 * the be-music skin binding and the playfield's per-frame caches, over the play session's state
 * (`PlaySessionState`). `CoreGameplayView` extends it. The modules the scene's parts live in (`session/play/*`,
 * `view/*`) take the scene as their context and read and write this state through their own interfaces, so it is
 * public; it is not part of the scene's API.
 */
import { Container, Graphics, Text, TextStyle, Texture } from 'pixi.js';
import type { ChartPlayVariant } from '@be-music/player/core/lane-layout';
import type { TimedLandmineNote } from '@be-music/player/playable-notes';
import { GoneDrawObjects } from './note-draw-window.ts';
import type { SideLaneRun } from '../../view/shared/playfield/measure-line-runs.ts';
import { PerfTracker } from '../perf.ts';
import { ChildPool } from '../pixi-utils.ts';
import type { AudioFeatures } from '../../runtime/audio-analysis.ts';
import { CORE_TEXT_FONT } from './fonts.ts';
import type { BeMusicGameplayLayout, BeMusicStage } from '../../skin/be-music/types.ts';
import { resolveGameplayLaneGeometry } from '@be-music/skin-sdk';
import { BeMusicGameplayBinding } from '../../skin/be-music/binding.ts';
import { SongImageCache } from '../../skin/be-music/song-images.ts';
import type { RuntimeNote } from '../../view/shared/playfield/context.ts';
import type { GameplayBgaTarget } from './gameplay-theme.ts';
import { PlaySession } from '../../session/play/play-session.ts';

export class CoreGameplayState extends PlaySession {
  /**
   * Top-level Container the scene host attaches to its `app.stage` while gameplay is active. All visible nodes
   * (`viewportBackground` + `designRoot`) live as children of this root, so the host can attach / detach the whole
   * gameplay subtree as one operation.
   */
  public readonly root: Container = new Container();
  readonly designRoot: Container = new Container();
  /**
   * Clip mask for the design rect — sits as a child of `designRoot` so the same `position` / `scale` transform applies
   * to it as the sprites it clips. Pixi uses the mask's world-space bounds to decide what's visible; with the mask
   * drawn at `(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT)` in design space, the post-transform bounds match the on-screen
   * design rectangle exactly, and any sprite that animates in from off-canvas (LR2 default's `#DST_IMAGE,...,758,0,...`
   * slide-ins, etc.) gets clipped at the design edge instead of bleeding into the pillarbox / letterbox of a screen with
   * a different aspect ratio.
   */
  readonly designClipMask: Graphics = new Graphics();
  /** Layout last handed to the be-music chrome, keyed by the lane set it was built for. */
  beMusicLayout:
    | {
        channels: readonly string[];
        variant: ChartPlayVariant | undefined;
        stage: BeMusicStage;
        layout: BeMusicGameplayLayout;
      }
    | undefined;
  /** Design size the clip mask and design background were last drawn at (the stage can change with the screen). */
  stampedDesignWidth = -1;
  stampedDesignHeight = -1;
  /** BGA target for the be-music stage, rebuilt only when the rect moves (see {@link collectBgaTargets}). */
  stageBgaTarget: GameplayBgaTarget | undefined;
  /**
   * Cached screen / design dimensions baked into the static graphics (`viewportBackground`, `background`,
   * `designClipMask`). Compared against the per-frame values so we only call `.clear().rect().fill()` when the size
   * actually changes — Pixi v8 rebuilds the GraphicsContext on every chain, and redrawing identical rects every rAF
   * tick was a noticeable contributor to gameplay frame time on dense charts.
   */
  cachedScreenWidth = -1;
  cachedScreenHeight = -1;
  readonly viewportBackground: Graphics = new Graphics();
  readonly background: Graphics = new Graphics();
  /**
   * BGA composite layer. Sits below `skinLayer` so the skin's "BGA frame" decoration draws on top, and above
   * `background` so the BGA is visible inside the play screen. One `Sprite` per layer (base / layer1+2 / POOR override)
   * is reused frame-to-frame to avoid Pixi child churn.
   */
  readonly bgaLayer: Container = new Container();
  readonly skinLayer: Container = new Container();
  readonly laneLayer: Graphics = new Graphics();
  readonly noteLayer: Container = new Container();
  /**
   * Shutter mask layer. Sits above `noteLayer` so the dark rectangles drawn here cover the scrolling notes underneath
   * but stay below the judgement-line / HUD overlays. Cleared and redrawn every frame from `playOptions.hiddenSudden` +
   * `playOptions.shutter`.
   */
  readonly shutterLayer: Graphics = new Graphics();
  readonly bombLayer: Container = new Container();
  /**
   * Sits above `noteLayer` / `bombLayer` and below `textLayer`. Holds the chrome that should visually punch through the
   * note stream: the judgement plate, NOWCOMBO digits, and the AUTOPLAY indicator.
   */
  readonly overlayLayer: Container = new Container();
  readonly textLayer: Container = new Container();
  /**
   * Per-frame `Sprite` / `Graphics` / `Text` recyclers — one per layer that previously paid for
   * `disposeChildren(layer)` + fresh allocations on every render tick. The pool reuses parented children across
   * frames (toggling `visible` and overwriting properties), eliminating the allocation churn that historically
   * dominated GC pauses during dense charts.
   *
   * Each render pass calls `pool.begin()`, `pool.acquireSprite|Graphics|Text()` for every child it draws, then
   * `pool.end()` to hide whatever the pass didn't use. `dispose()` calls `pool.destroy()` to free the underlying
   * children when the view tears down.
   */
  readonly noteLayerPool: ChildPool = new ChildPool(this.noteLayer);
  skinLayerPool: ChildPool = new ChildPool(this.skinLayer);
  overlayLayerPool: ChildPool = new ChildPool(this.overlayLayer);
  readonly textLayerPool: ChildPool = new ChildPool(this.textLayer);
  readonly bombLayerPool: ChildPool = new ChildPool(this.bombLayer);
  readonly bgaLayerPool: ChildPool = new ChildPool(this.bgaLayer);
  readonly overlay: Text = new Text({
    text: '',
    style: new TextStyle({
      fill: 0xf8fafc,
      fontSize: 22,
      fontWeight: '700',
      align: 'center',
      fontFamily: CORE_TEXT_FONT,
    }),
  });
  /**
   * LR2's `draw_count` for {@link notes} and {@link mineNotes} under LR2's drawing rules: the first of each not gone yet
   * ({@link advanceDrawCursor}), kept between frames. Rebuilt when the arrays change or the playhead's chart time moves
   * back (not when an LR2 negative-BPM reversal mirrors the scroll: LR2's `draw_count` never moves back).
   */
  drawCursor:
    | {
        notes: readonly RuntimeNote[];
        mines: readonly TimedLandmineNote[];
        seconds: number;
        note: number;
        mine: number;
      }
    | undefined;
  /** Notes and mines gone under LR2's rules, so the mirrored scroll past a negative-BPM reversal does not redraw them. */
  readonly goneDrawObjects: GoneDrawObjects = new GoneDrawObjects();
  /**
   * Theme texture cache, keyed by the theme's own asset ids. The core scene never reads it; theme families fill it in
   * {@link prepareTheme} and the core destroys every entry on {@link dispose}.
   */
  textures: Map<string, Texture> = new Map();
  /** Whether {@link exit} stopped a running render loop, for the next {@link enter} to resume. */
  resumeAnimationOnEnter = false;
  /** This frame's audio features (sampled once per render, on the play clock). */
  audioFrame: AudioFeatures | undefined;
  /**
   * Lane runs measure lines cross for a skin that draws them (`drawsMeasureLines`), with the lane geometry they were
   * worked out from; rebuilt only when the lanes move.
   */
  measureLineRuns: { signature: number; runs: SideLaneRun[] } | undefined;
  /**
   * Whether the gameplay tick is currently registered on the host's `app.ticker`. Previously this scene drove its own
   * `requestAnimationFrame` chain at the bottom of `tick`, running in parallel with PixiJS's auto-render ticker — two
   * RAFs were scheduled per frame, doubling per-frame event-loop overhead. The ticker now fires `tick` inline with the
   * renderer's frame.
   */
  tickerAttached = false;
  readonly bgaTargetsScratch: GameplayBgaTarget[] = [];
  /**
   * Frame-rate sampling state. We accumulate frames over a one-second window and publish the rate for theme read-outs
   * (the LR2 RATE NUMBER panel).
   */
  fpsFrameCount = 0;
  fpsWindowStart = 0;
  fps = 0;
  /**
   * Per-frame section timing tracker. Logs a console summary every second when enabled (via `?perf` URL flag or
   * `globalThis.__BE_MUSIC_PERF__ = true`). When disabled the wrapper adds no measurable overhead.
   */
  readonly perf: PerfTracker = new PerfTracker('gameplay');
  /** The player's stored values for the be-music skin's settings (`beMusicSkinSettings`, then the setter). */
  beMusicSkinSettings: Readonly<Record<string, unknown>> | undefined;
  /** `performance.now()` of the first rendered frame, for the be-music entrance fade. */
  enteredAt: number | undefined;
  laneGeometryCache:
    | {
        laneChannels: readonly string[];
        laneCount: number;
        playVariant: unknown;
        layoutMode: unknown;
        stage: BeMusicStage | undefined;
        geometry: ReturnType<typeof resolveGameplayLaneGeometry>;
      }
    | undefined;
  skinBindingInstance: BeMusicGameplayBinding | undefined;
  /** Song images handed to the be-music skin (`frame.songImage`), from the playing song's asset source. */
  songImages: SongImageCache | undefined;
  /**
   * Cropped copies of the `#BGAxx` sub-region textures, for a skin that composites the BGA itself (a canvas image can't
   * carry the crop the way a Pixi sub-texture does). `null` while the crop is being made.
   */
  readonly skinBgaCrops: Map<Texture, ImageBitmap | null> = new Map<Texture, ImageBitmap | null>();
  /**
   * Cached cumulative beats at each measure boundary, keyed by song identity. Computed on first access so we don't walk
   * the measure list every frame. Each entry is the beat count at the *start* of the measure with that index (measure 0
   * starts at beat 0).
   */
  measureBeatCache: { songId: string | undefined; beats: number[] } = { songId: undefined, beats: [] };
}
