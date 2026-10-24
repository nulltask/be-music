/**
 * The LR2 family's play screen: an LR2 play skin (`play_<variant>.lr2skin`) drawn around the shared playfield
 * (`view/shared/playfield`) in the skin's authored coordinate space, letterboxed into the window. It draws the play session's frames:
 *
 * - the skin's ops, numbers, texts, sliders and bar graphs through the frame's LR2 state (`resolveLR2PlayState` over the
 *   frame's `PlayState` and the play's score);
 * - its timers from the play's moments in the frame (`resolveLR2PlayTimers`, kept by {@link LR2PlayTimers});
 * - the shared playfield through a {@link PlayfieldSkin}: the skin's lane rects, note cells, measure lines, BGA rects,
 *   and the bomb and key-beam spans of its timers. The skin draws the lane backgrounds, key beams and bombs itself.
 *
 * The LR2 lane index and timer ids stay in this view and its modules: the playfield asks by channel. The session times
 * the play from the skin's timing ({@link resolveLR2PlayTiming}) and handles its input.
 */

import type { LR2Skin, LR2SpecialGraphic } from '@be-music/skin-lr2';
import { LR2_SPECIAL_GRAPHIC, isLR2SpecialGraphic } from '@be-music/skin-lr2';
import {
  resolveLR2NonstopStage,
  resolveLR2PlayState,
  type LR2PlaySetup,
  type LR2PlayState,
} from '@be-music/skin-lr2/state';
import type { GaugeType } from '@be-music/player-engine/ruleset';
import type { CourseView } from '@be-music/player-scene-model';
import type { GameplayLayoutMode } from '@be-music/player-skin-sdk';
import type { Application, Texture } from 'pixi.js';
import { loadAssetBytes, resolveChartImageAsset } from '../../collection/collection.ts';
import type { BrowserAssetSource } from '../../collection/types.ts';
import type { LR2PlayKit } from '../../host/family-kit.ts';
import { logger } from '../../logger.ts';
import type { PlaySessionOptions } from '../../session/play/play-options.ts';
import { DESIGN_HEIGHT, PIXELS_PER_BEAT } from '../../stage/design.ts';
import { resolveLR2LaneIndex } from '@be-music/player-engine/lanes';
import type { PixiSceneHost } from '../../host/scene-host.ts';
import { releaseTexturesOnHost } from '../../stage/pixi-utils.ts';
import { LR2TextureRetainer } from './texture-retainer.ts';
import { loadSkinBitmapFonts } from '../../skin/lr2/font-loader.ts';
import { loadSkinAssetTexture, loadTextureFromBytes } from '../../skin/lr2/textures.ts';
import { build, render, type PlayFrameContext } from '../shared/play-frame.ts';
import { PlayLayers } from '../shared/play-layers.ts';
import type { PlayChrome, PlayfieldRuntime } from '../shared/playfield/context.ts';
import { uploadTextures } from '../shared/texture-upload.ts';
import type {
  IntentSink,
  PlayFrame,
  PlayIntent,
  PlayView,
  PlayViewEvent,
  PlayViewTiming,
  PlayfieldSkin,
} from '../types.ts';
import {
  collectLR2BGATargets,
  drawLR2FallbackJudge,
  drawLR2PlaySkin,
  LR2PlayText,
  resolveLR2LaneRect,
  resolveLR2MeasureLines,
  resolveLR2NoteCell,
  type LR2PlayElementsContext,
} from './play-elements.ts';
import { LR2PlayTimers } from './play-timers.ts';
import { playfieldTouchLanes, TouchLaneInput } from '../shared/touch-lane-input.ts';
import { LR2Turntable } from './play-turntable.ts';

const log = logger('gameplay');

/** Design px above a lane's top through which notes keep drawing as they scroll in from off the stage. */
const NOTE_OVERSCAN = 48;

/**
 * The play skin's timing (`docs/LR2SkinHelp.md`): loading ends `#LOADSTART + #LOADEND` after the scene starts (READY,
 * timer 40), and the chart starts `#PLAYSTART` after that (timer 41), so `#PLAYSTART` is the gap between READY and the
 * chart, not the whole intro (the LR2 default 7-keys skin: about 3 s before the notes, as its title fades). `#FADEOUT`
 * and `#CLOSE` time the ending: the fade-out, then the hold before the next screen.
 */
export function resolveLR2PlayTiming(skin: Pick<LR2Skin, 'timing'>): PlayViewTiming {
  const timing = skin.timing;
  const loadEndOffsetMs = Math.max(0, timing.loadStart ?? 0) + Math.max(0, timing.loadEnd ?? 0);
  return {
    loadEndOffsetMs,
    playStartOffsetMs: loadEndOffsetMs + Math.max(0, timing.playStart ?? 0),
    fadeOutMs: Math.max(0, timing.fadeOut ?? 0),
    closeMs: Math.max(0, timing.close ?? 0),
  };
}

/** What the LR2 play view draws with besides its kit: the options of the play that change what is drawn. */
export type LR2PlayViewOptions = Pick<
  PlaySessionOptions,
  | 'bga'
  | 'bgaSize'
  | 'autoPlay'
  | 'autoScratch1P'
  | 'autoScratch2P'
  | 'scoreGraph'
  | 'nonstop'
  | 'showInvisibleNotes'
  | 'judgedNoteDisplay'
> & {
  /** The gauge the play runs on (a replay's recorded one); GROOVE without one. */
  readonly gauge?: GaugeType;
  /** The play is a course stage, on the course's gauge. */
  readonly courseGauge?: boolean;
  /** The course the play is a stage of (or the NONSTOP course it stitches), with the stage being played. */
  readonly course?: CourseView;
  /** Where the chart's files are, for its `#STAGEFILE`, `#BACKBMP` and `#BANNER`. */
  readonly source?: BrowserAssetSource;
};

/** The LR2 play view. See the module comment. */
export class LR2PlayView extends PlayLayers implements PlayView, PlayFrameContext, LR2PlayElementsContext {
  public readonly family = 'lr2' as const;
  public readonly timing: PlayViewTiming;
  /** The play options the view draws with; the setters change them during the play. */
  public readonly options: LR2PlayViewOptions;
  public readonly skin: LR2Skin;
  public readonly invisibleNoteSkin: LR2Skin | undefined;
  /** How the LR2 skin answers the shared playfield. */
  public readonly playfieldSkin: PlayfieldSkin;
  /** The LR2 skin's drawing around the shared playfield. */
  public readonly chrome: PlayChrome;
  public readonly timers: LR2PlayTimers;
  /** The fingers on the lanes, sent to the session as `lane` intents while attached. */
  private readonly touchLanes: TouchLaneInput = new TouchLaneInput(playfieldTouchLanes(this));
  public readonly turntable: LR2Turntable = new LR2Turntable();
  public readonly text: LR2PlayText = new LR2PlayText();
  /** The skin's images by path, and the chart's images under LR2's special paths; destroyed with the view. */
  public readonly textures: Map<string, Texture> = new Map();
  /** Where this view's textures go when the play switches family, so the same bytes are not decoded again. */
  private textureRetainer: LR2TextureRetainer | undefined;
  /** The frame's LR2 state (`resolveLR2PlayState`). */
  public lr2State: LR2PlayState | undefined;
  /** What stays the same for the play: the LR2 state's setup. */
  private lr2Setup: LR2PlaySetup | undefined;
  /** Whether the chart has loaded (LR2 op 81; op 80 before): off from the scene start until READY. */
  private loaded = true;
  /** The stage a stitched NONSTOP play shows. */
  private nonstopStage = 0;
  /** The frame rate over a sliding one-second window, for the skin's frame-rate readout (number 20). */
  private fps = 0;
  private fpsFrameCount = 0;
  private fpsWindowStart = 0;
  private disposed = false;

  public constructor(kit: LR2PlayKit, play: PlayfieldRuntime, options: LR2PlayViewOptions = {}) {
    super(play);
    this.skin = kit.skin;
    this.invisibleNoteSkin = kit.invisibleNoteSkin;
    this.options = { ...options };
    this.timing = resolveLR2PlayTiming(kit.skin);
    this.timers = new LR2PlayTimers(play);
    const skin = kit.skin;
    this.overlay.scale.set(skin.height / DESIGN_HEIGHT);
    this.playfieldSkin = {
      stage: { width: skin.width, height: skin.height },
      pixelsPerBeat: PIXELS_PER_BEAT * (skin.height / DESIGN_HEIGHT),
      ownsLanes: true,
      laneRect: (channel, stage) => resolveLR2LaneRect(skin, this.laneIndex(channel), stage),
      noteCell: (kind, channel) => resolveLR2NoteCell(this, kind, this.laneIndex(channel)),
      measureLines: () => resolveLR2MeasureLines(this),
      bgaTargets: (out) => collectLR2BGATargets(this, out),
      bombCell: () => undefined,
      bombDurationMs: (channel) => this.timers.bombDurationMs(channel),
      keyOnFadeMs: (channel) => this.timers.keyOnFadeMs(channel),
    };
    this.chrome = {
      attachLayers: () => this.skinLayer.addChild(this.text.layer),
      draw: (width, height) => drawLR2PlaySkin(this, width, height),
      drawText: (seconds) => {
        // After the bombs, as LR2's FC graphic retires once played out, then the judge as text if the skin has none.
        this.timers.retireFullCombo();
        drawLR2FallbackJudge(this, seconds);
      },
      bombRetired: (channel) => this.timers.bombRetired(channel),
    };
  }

  /** The host's `Application`; the view draws only once attached (or built for a host ahead of its first frame). */
  get app(): Application {
    if (!this.host) throw new Error('LR2PlayView: app accessed before attach');
    return this.host.app;
  }

  /** The course's kind, for the combo an expert or grade course shows. */
  get courseKind(): CourseView['kind'] | undefined {
    return this.options.course?.kind;
  }

  /** An LR2 skin paints its own chrome: no be-music entrance fade. */
  get paintsThroughBeMusicSkin(): boolean {
    return false;
  }

  /** No be-music stage: the lanes the skin does not place fall back to the built-in layout on LR2's canvas. */
  get beMusicStage(): undefined {
    return undefined;
  }

  get layoutMode(): GameplayLayoutMode {
    return 'standard';
  }

  /** The lanes start at the stage's top edge, so notes scroll in from off the stage. */
  get noteOverscan(): number {
    return NOTE_OVERSCAN * (this.skin.height / DESIGN_HEIGHT);
  }

  /** No be-music skin: the playfield draws nothing of its own as data. */
  get skinBinding(): undefined {
    return undefined;
  }

  /** Parks textures with `retainer` instead of destroying them when this view is replaced mid-play. */
  public useTextureRetainer(retainer: LR2TextureRetainer): void {
    this.textureRetainer = retainer;
  }

  /**
   * Starts the skin's scene, ready and play timers from the clock when this view joins a play already running.
   * Those moments were delivered to the view it replaces.
   */
  public joinRunningPlay(): void {
    if (this.play.hasSceneStarted?.() !== true) return;
    const now = this.play.playClock();
    const startInput = this.skin.timing.startInput;
    if (this.play.isIntroPlaying()) {
      this.loaded = false;
      this.timers.handle({ kind: 'scene-start', atMs: now }, startInput);
      return;
    }
    const at = now - Math.max(0, this.play.currentSeconds()) * 1000;
    this.loaded = true;
    this.timers.handle({ kind: 'scene-start', atMs: at }, startInput);
    this.timers.handle({ kind: 'load-end', atMs: at }, startInput);
    this.timers.handle({ kind: 'play-start', atMs: at }, startInput);
  }

  /** Builds the layers on `host` ahead of the first frame (a play loading off stage), so its textures can upload. */
  public prepareOn(host: PixiSceneHost): void {
    build(this, host);
  }

  /**
   * Loads the skin for the play once its chart is prepared and before its samples decode (the play session's
   * `prepareView`): the LR2 state's setup, the skin's images and the chart's `#STAGEFILE` / `#BACKBMP` / `#BANNER`,
   * its bitmap fonts (in the background) and its timer spans, then uploads the images to the GPU so the intro's first
   * frames do not stall on them.
   */
  public async prepare(): Promise<void> {
    // Each chart starts the disc at angle 0, spinning at the baseline (an F5 mid-spin would otherwise carry it over).
    this.turntable.reset();
    this.initializeSetup();
    await this.loadSkin();
    if (this.isGone()) return;
    await this.uploadTextures(this.textures.values(), () => this.isGone());
  }

  public attach(host: PixiSceneHost, emit: IntentSink<PlayIntent>): void {
    build(this, host);
    this.touchLanes.attach(host, emit);
  }

  public draw(frame: PlayFrame): void {
    this.play = frame.playfield;
    for (const event of frame.events) this.handleEvent(event);
    this.root.visible = frame.shown;
    if (!frame.shown || this.disposed) return;
    this.perf.beginTick();
    this.perf.time('updateFPS', () => this.updateFPS());
    this.perf.time('updateScores', () => {
      this.updateNonstopStage();
      this.refreshState(frame);
      // The disc's angle this frame, before it draws.
      this.turntable.update(this.play.playClock(), {
        introPlaying: this.play.isIntroPlaying(),
        paused: this.play.paused,
      });
    });
    this.perf.time('render', () =>
      render(this, frame.seconds, frame.playfield.audioAnalyzer !== undefined ? frame.audio : undefined),
    );
    const report = this.perf.endFrame(() => ({
      stage: this.app.stage.children.length,
      skin: this.skinLayer.children.length,
      overlay: this.overlayLayer.children.length,
      bga: this.bgaLayer.children.length,
      note: this.noteLayer.children.length,
      bomb: this.bombLayer.children.length,
      text: this.textLayer.children.length,
      notesTotal: this.play.notes.length,
    }));
    if (report) log.debug('perf', report);
  }

  public detach(): void {
    this.touchLanes.detach();
  }

  /** Uploads `textures` to the GPU through the host's renderer, when the view has a host. */
  public uploadTextures(textures: Iterable<Texture | undefined>, isCancelled: () => boolean): Promise<void> {
    return uploadTextures(this.host?.app.renderer, textures, isCancelled);
  }

  /** An LR2 kit carries nothing but its skins, which the view keeps: another skin needs another play. */
  public updateKit(kit: LR2PlayKit): void {
    if (kit.skin !== this.skin) log.warn('a play view keeps its skin; ignoring a kit of another skin');
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.timers.dispose();
    this.text.clear();
    this.lr2Setup = undefined;
    this.lr2State = undefined;
    // Drop every per-frame child pool before the scene graph so each pooled child is freed through its own `destroy()`.
    try {
      this.noteLayerPool.destroy();
      this.skinLayerPool.destroy();
      this.overlayLayerPool.destroy();
      this.textLayerPool.destroy();
      this.bombLayerPool.destroy();
      this.bgaLayerPool.destroy();
    } catch (error) {
      log.warn('child pool teardown threw', error);
    }
    if (this.root.parent) this.root.parent.removeChild(this.root);
    try {
      this.root.destroy({ children: true, context: true });
    } catch (error) {
      log.warn('root.destroy threw', error);
    }
    // A play that may show this skin again keeps the textures. Destroying them and decoding the same bytes crashes
    // PixiJS v8. The play destroys the retainer when it ends.
    this.handTexturesBack();
    try {
      releaseTexturesOnHost(this.host, [...this.textures.values()]);
    } catch (error) {
      log.warn('texture cleanup threw', error);
    }
    this.textures.clear();
    this.bgaTargetsScratch.length = 0;
  }

  /** The LR2 lane index of `channel` (`#SRC_NOTE` / `#DST_NOTE` index: 1P 0-9, 2P 10-19). */
  private laneIndex(channel: string): number {
    return resolveLR2LaneIndex(channel, this.play.chartPlayVariant);
  }

  /** The view or its play is gone: loading stops. */
  private isGone(): boolean {
    return this.disposed || this.play.disposed;
  }

  /** Starts and stops what a moment of the play changes: the skin's timers, the load ops and the turntable. */
  private handleEvent(event: PlayViewEvent): void {
    this.timers.handle(event, this.skin.timing.startInput);
    switch (event.kind) {
      case 'scene-start':
        // LR2 ops 80 / 81 (loading / loaded) gate the stock skin's centred title, genre and artist; 81 lights with
        // READY (timer 40).
        this.loaded = false;
        return;
      case 'load-end':
        this.loaded = true;
        return;
      case 'lane':
        // A scratch press (a key, AUTO, or the auto scratch) kicks the turntable.
        if (event.action !== 'release') this.turntable.impulse(event.channel, this.play.playClock());
        return;
      default:
        return;
    }
  }

  /**
   * The LR2 state's setup for the play: the skin's `#CUSTOMOPTION` defaults, the options, the gauge, the course, the
   * key mode of the lanes in use (a 5-key chart gets the stock skin's DISABLE LANE overlay on keys 6 and 7) and the
   * chart's long notes, BPM changes and BGA.
   */
  private initializeSetup(): void {
    const options = this.options;
    const play = this.play;
    this.loaded = true;
    this.nonstopStage = 0;
    this.lr2Setup = {
      ...(play.chart !== undefined ? { chart: play.chart } : {}),
      lanes: { playVariant: play.chartPlayVariant, channels: play.laneChannels },
      features: {
        longNote: play.notes.some((note) => note.endBeat !== undefined),
        bpmChange: (play.timingResolver?.tempoPoints.length ?? 0) > 1,
        bga: play.hasBGA,
      },
      options: {
        autoPlay: options.autoPlay === true,
        autoScratch1P: options.autoScratch1P === true,
        autoScratch2P: options.autoScratch2P === true,
        scoreGraph: options.scoreGraph === true,
        bga: options.bga ?? 'ON',
        bgaSize: options.bgaSize ?? 'NORMAL',
      },
      gauge: options.gauge ?? 'GROOVE',
      courseGauge: options.courseGauge === true,
      ...(options.course !== undefined ? { course: options.course } : {}),
      customOps: this.skin.customOptions.map((option) => option.defaultOp),
    };
    this.refreshState();
  }

  /**
   * The frame's LR2 state: the setup's ops and values with the running play (the frame's `PlayState`), the score, the
   * time and the frame rate. NOWBPM freezes at an LR2 negative-BPM reversal and shows a stitched NONSTOP play's stage
   * BPM (`displayBPM`).
   */
  private refreshState(frame?: PlayFrame): void {
    const setup = this.lr2Setup;
    if (setup === undefined) return;
    const play = this.play;
    const seconds = play.currentSeconds();
    const bpm = play.displayBPM(seconds);
    this.lr2State = resolveLR2PlayState(setup, {
      play: frame?.state ?? play.playState,
      score: play.score,
      seconds,
      loaded: this.loaded,
      ...(this.options.nonstop !== undefined ? { nonstopStage: this.nonstopStage } : {}),
      displayedScore: play.displayedScore,
      ...(bpm !== undefined ? { bpm } : {}),
      fps: this.fps,
      judgments: {
        '1P': play.judgeSideState['1P'].judge || 'EMPTY_POOR',
        '2P': play.judgeSideState['2P'].judge || 'EMPTY_POOR',
      },
    });
  }

  /**
   * The stage a stitched NONSTOP play shows: the one LR2 last announced, after a BLANK connection
   * (`resolveLR2NonstopStage`). It moves the stage ops (280-289) and the title; the skin stays as parsed for the first
   * stage, as LR2 reads it once for the whole play.
   */
  private updateNonstopStage(): void {
    const nonstop = this.options.nonstop;
    if (nonstop === undefined || this.options.course === undefined) return;
    this.nonstopStage = resolveLR2NonstopStage(nonstop.stages, this.play.currentSeconds());
  }

  /** Samples the frame rate over a sliding one-second window. */
  private updateFPS(): void {
    const now = performance.now();
    if (this.fpsWindowStart === 0) {
      this.fpsWindowStart = now;
      this.fpsFrameCount = 0;
      return;
    }
    this.fpsFrameCount += 1;
    const elapsed = now - this.fpsWindowStart;
    if (elapsed >= 1000) {
      this.fps = (this.fpsFrameCount * 1000) / elapsed;
      this.fpsWindowStart = now;
      this.fpsFrameCount = 0;
    }
  }

  /**
   * The skin's bitmap fonts (in the background: a text draws in a system font until its font is in), its timer spans,
   * its images (LR2's special graphics `gr=100..111` aside), the 9-keys skin's invisible note, and the chart's images.
   */
  /** Gives this view's textures back to the play's retainer. Destroying them is the retainer's, when the play ends. */
  private handTexturesBack(): void {
    const retainer = this.textureRetainer;
    if (retainer === undefined || this.textures.size === 0) return;
    const dropped = retainer.keep(this.skin, this.textures);
    this.textures.clear();
    for (const texture of dropped.values()) texture.destroy(true);
  }

  /** A texture loaded after this view was replaced stays with the retainer. Otherwise it is destroyed. */
  private releaseUnownedTexture(path: string, texture: Texture): void {
    const retainer = this.textureRetainer;
    if (retainer === undefined) {
      texture.destroy(true);
      return;
    }
    for (const dropped of retainer.keep(this.skin, new Map([[path, texture]])).values()) dropped.destroy(true);
  }

  private async loadSkin(): Promise<void> {
    const skin = this.skin;
    const adopted = this.textureRetainer?.adopt(skin);
    if (adopted !== undefined) {
      for (const [path, texture] of adopted) this.textures.set(path, texture);
    }
    void loadSkinBitmapFonts(skin.lr2FontPaths, skin.files).then((loaded) => {
      if (this.isGone()) return;
      this.text.setFonts(loaded);
    });
    this.timers.setSpans(skin);
    const imagePaths = new Set<string>();
    skin.images.forEach((image) => imagePaths.add(image.source.imagePath));
    Object.values(skin.notes).forEach((group) => group?.forEach((note) => imagePaths.add(note.imagePath)));
    Object.values(skin.judges).forEach((group) => group?.forEach((judge) => imagePaths.add(judge.source.imagePath)));
    Object.values(skin.judges2P).forEach((group) => group?.forEach((judge) => imagePaths.add(judge.source.imagePath)));
    skin.numbers.forEach((number) => imagePaths.add(number.source.imagePath));
    skin.grooveGauges.forEach((gauge) => imagePaths.add(gauge.source.imagePath));
    skin.nowCombos.forEach((combo) => imagePaths.add(combo.source.imagePath));
    skin.judgeLines.forEach((line) => imagePaths.add(line.source.imagePath));
    skin.measureLines.forEach((line) => imagePaths.add(line.source.imagePath));
    skin.bargraphs.forEach((graph) => imagePaths.add(graph.source.imagePath));
    skin.sliders.forEach((slider) => imagePaths.add(slider.source.imagePath));
    await Promise.all(
      [...imagePaths].map(async (path) => {
        if (this.isGone() || isLR2SpecialGraphic(path) || this.textures.has(path)) return;
        const texture = await loadSkinAssetTexture(skin, path);
        if (!texture) return;
        if (this.isGone()) {
          this.releaseUnownedTexture(path, texture);
          return;
        }
        this.textures.set(path, texture);
      }),
    );
    if (this.isGone()) return;
    // The invisible-note overlay: `notes.note[3]` of the 9-keys play skin, from that skin's files (the stock theme's
    // shared `frame.tga`, so usually already loaded under the same path).
    const invisibleNoteSkin = this.invisibleNoteSkin;
    const invisibleNoteSrc = invisibleNoteSkin?.notes.note?.[3];
    if (
      invisibleNoteSkin !== undefined &&
      invisibleNoteSrc?.imagePath &&
      !this.textures.has(invisibleNoteSrc.imagePath)
    ) {
      const texture = await loadSkinAssetTexture(invisibleNoteSkin, invisibleNoteSrc.imagePath);
      if (this.isGone()) {
        if (texture) this.releaseUnownedTexture(invisibleNoteSrc.imagePath, texture);
        return;
      }
      if (texture) this.textures.set(invisibleNoteSrc.imagePath, texture);
    }
    if (this.isGone()) return;
    await this.loadChartGraphics();
  }

  /**
   * The chart's `#STAGEFILE` / `#BACKBMP` / `#BANNER` under LR2's special paths, for skin elements on `gr=100/101/102`.
   * A chart without one (or one that fails to decode) leaves the skin's "absent" branch (ops 190 / 192 / 194) to draw.
   */
  private async loadChartGraphics(): Promise<void> {
    const chartEntry = this.play.chart;
    const source = this.options.source;
    if (!chartEntry || !source) return;
    const meta = chartEntry.chart.metadata;
    const candidates: Array<{ key: LR2SpecialGraphic; assetPath: string }> = [];
    if (meta.stageFile) candidates.push({ key: LR2_SPECIAL_GRAPHIC.STAGEFILE, assetPath: meta.stageFile });
    if (meta.backBMP) candidates.push({ key: LR2_SPECIAL_GRAPHIC.BACKBMP, assetPath: meta.backBMP });
    if (meta.banner) candidates.push({ key: LR2_SPECIAL_GRAPHIC.BANNER, assetPath: meta.banner });
    await Promise.all(
      candidates.map(async ({ key, assetPath }) => {
        // The chart's files are read on demand; the image-aware lookup finds a `.bmp` declared but bundled as `.png`.
        const bytes = await loadAssetBytes(resolveChartImageAsset(source, chartEntry.chartPath, assetPath));
        if (!bytes) return;
        try {
          const texture = await loadTextureFromBytes(assetPath, bytes);
          if (!texture) return;
          if (this.isGone()) {
            this.releaseUnownedTexture(key, texture);
            return;
          }
          this.textures.set(key, texture);
        } catch {
          // A decode failure leaves the skin's "asset absent" branch to draw.
        }
      }),
    );
  }
}
