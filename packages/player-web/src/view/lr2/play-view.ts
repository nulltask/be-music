/**
 * The LR2 family's play screen: an LR2 play skin (`play_<variant>.lr2skin`) drawn around the shared playfield
 * (`view/shared/playfield`) on LR2's 640x480 canvas, letterboxed into the window. It draws the play session's frames:
 *
 * - the skin's ops, numbers, texts, sliders and bar graphs through the frame's LR2 state (`resolveLr2PlayState` over the
 *   frame's `PlayState` and the play's score);
 * - its timers from the play's moments in the frame (`resolveLr2PlayTimers`, kept by {@link Lr2PlayTimers});
 * - the shared playfield through a {@link PlayfieldSkin}: the skin's lane rects, note cells, measure lines, BGA rects,
 *   and the bomb and key-beam spans of its timers. The skin draws the lane backgrounds, key beams and bombs itself.
 *
 * The LR2 lane index and timer ids stay in this view and its modules: the playfield asks by channel. The session times
 * the play from the skin's timing ({@link resolveLr2PlayTiming}) and handles its input.
 */

import type { Lr2Skin, Lr2SpecialGraphic } from '@be-music/lr2-skin';
import { LR2_SPECIAL_GRAPHIC, isLr2SpecialGraphic } from '@be-music/lr2-skin';
import {
  resolveLr2NonstopStage,
  resolveLr2PlayState,
  type Lr2PlaySetup,
  type Lr2PlayState,
} from '@be-music/lr2-skin/state';
import type { GaugeType } from '@be-music/player/ruleset';
import type { CourseView } from '@be-music/scene-model';
import type { GameplayLayoutMode } from '@be-music/skin-sdk';
import type { Application, Texture } from 'pixi.js';
import { loadAssetBytes, resolveChartImageAsset } from '../../collection/collection.ts';
import type { BrowserSongAssetSource } from '../../collection/types.ts';
import type { Lr2PlayKit } from '../../host/family-kit.ts';
import { logger } from '../../logger.ts';
import type { PlaySessionOptions } from '../../session/play/play-options.ts';
import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../../stage/design.ts';
import { resolveLr2LaneIndex } from '../../scene/gameplay-lanes.ts';
import type { PixiSceneHost } from '../../host/scene-host.ts';
import { releaseTexturesOnHost } from '../../stage/pixi-utils.ts';
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
  PlayfieldStage,
} from '../types.ts';
import {
  collectLr2BgaTargets,
  drawLr2FallbackJudge,
  drawLr2PlaySkin,
  Lr2PlayText,
  resolveLr2LaneRect,
  resolveLr2MeasureLines,
  resolveLr2NoteCell,
  type Lr2PlayElementsContext,
} from './play-elements.ts';
import { Lr2PlayTimers } from './play-timers.ts';
import { Lr2Turntable } from './play-turntable.ts';

const log = logger('gameplay');

/** The canvas an LR2 play skin is drawn on: LR2's 640x480, the skin scaled to fit it. */
const LR2_PLAY_STAGE: PlayfieldStage = { width: DESIGN_WIDTH, height: DESIGN_HEIGHT };

/** Design px above a lane's top through which notes keep drawing as they scroll in from off the stage. */
const NOTE_OVERSCAN = 48;

/**
 * The play skin's timing (`docs/LR2SkinHelp.md`): loading ends `#LOADSTART + #LOADEND` after the scene starts (READY,
 * timer 40), and the chart starts `#PLAYSTART` after that (timer 41), so `#PLAYSTART` is the gap between READY and the
 * chart, not the whole intro (the LR2 default 7-keys skin: about 3 s before the notes, as its title fades). `#FADEOUT`
 * and `#CLOSE` time the ending: the fade-out, then the hold before the next screen.
 */
export function resolveLr2PlayTiming(skin: Pick<Lr2Skin, 'timing'>): PlayViewTiming {
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
export type Lr2PlayViewOptions = Pick<
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
  readonly source?: BrowserSongAssetSource;
};

/** The LR2 play view. See the module comment. */
export class Lr2PlayView extends PlayLayers implements PlayView, PlayFrameContext, Lr2PlayElementsContext {
  public readonly family = 'lr2' as const;
  public readonly timing: PlayViewTiming;
  /** The play options the view draws with; the setters change them during the play. */
  public readonly options: Lr2PlayViewOptions;
  public readonly skin: Lr2Skin;
  public readonly invisibleNoteSkin: Lr2Skin | undefined;
  /** How the LR2 skin answers the shared playfield. */
  public readonly playfieldSkin: PlayfieldSkin;
  /** The LR2 skin's drawing around the shared playfield. */
  public readonly chrome: PlayChrome;
  public readonly timers: Lr2PlayTimers;
  public readonly turntable: Lr2Turntable = new Lr2Turntable();
  public readonly text: Lr2PlayText = new Lr2PlayText();
  /** The skin's images by path, and the chart's images under LR2's special paths; destroyed with the view. */
  public readonly textures: Map<string, Texture> = new Map();
  /** The frame's LR2 state (`resolveLr2PlayState`). */
  public lr2State: Lr2PlayState | undefined;
  /** What stays the same for the play: the LR2 state's setup. */
  private lr2Setup: Lr2PlaySetup | undefined;
  /** Whether the chart has loaded (LR2 op 81; op 80 before): off from the scene start until READY. */
  private loaded = true;
  /** The stage a stitched NONSTOP play shows. */
  private nonstopStage = 0;
  /** The frame rate over a sliding one-second window, for the skin's frame-rate readout (number 20). */
  private fps = 0;
  private fpsFrameCount = 0;
  private fpsWindowStart = 0;
  private disposed = false;

  public constructor(kit: Lr2PlayKit, play: PlayfieldRuntime, options: Lr2PlayViewOptions = {}) {
    super(play);
    this.skin = kit.skin;
    this.invisibleNoteSkin = kit.invisibleNoteSkin;
    this.options = { ...options };
    this.timing = resolveLr2PlayTiming(kit.skin);
    this.timers = new Lr2PlayTimers(play);
    const skin = kit.skin;
    this.playfieldSkin = {
      stage: LR2_PLAY_STAGE,
      ownsLanes: true,
      laneRect: (channel, stage) => resolveLr2LaneRect(skin, this.laneIndex(channel), stage),
      noteCell: (kind, channel) => resolveLr2NoteCell(this, kind, this.laneIndex(channel)),
      measureLines: () => resolveLr2MeasureLines(this),
      bgaTargets: (out) => collectLr2BgaTargets(this, out),
      bombCell: () => undefined,
      bombDurationMs: (channel) => this.timers.bombDurationMs(channel),
      keyOnFadeMs: (channel) => this.timers.keyOnFadeMs(channel),
    };
    this.chrome = {
      attachLayers: () => this.skinLayer.addChild(this.text.layer),
      draw: (width, height) => drawLr2PlaySkin(this, width, height),
      drawText: (seconds) => {
        // After the bombs, as LR2's FC graphic retires once played out, then the judge as text if the skin has none.
        this.timers.retireFullCombo();
        drawLr2FallbackJudge(this, seconds);
      },
      bombRetired: (channel) => this.timers.bombRetired(channel),
    };
  }

  /** The host's `Application`; the view draws only once attached (or built for a host ahead of its first frame). */
  get app(): Application {
    if (!this.host) throw new Error('Lr2PlayView: app accessed before attach');
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
    return NOTE_OVERSCAN;
  }

  /** No be-music skin: the playfield draws nothing of its own as data. */
  get skinBinding(): undefined {
    return undefined;
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

  public attach(host: PixiSceneHost, _emit: IntentSink<PlayIntent>): void {
    build(this, host);
  }

  public draw(frame: PlayFrame): void {
    this.play = frame.playfield;
    for (const event of frame.events) this.handleEvent(event);
    this.root.visible = frame.shown;
    if (!frame.shown || this.disposed) return;
    this.perf.beginTick();
    this.perf.time('updateFps', () => this.updateFps());
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

  public detach(): void {}

  /** Uploads `textures` to the GPU through the host's renderer, when the view has a host. */
  public uploadTextures(textures: Iterable<Texture | undefined>, isCancelled: () => boolean): Promise<void> {
    return uploadTextures(this.host?.app.renderer, textures, isCancelled);
  }

  /** An LR2 kit carries nothing but its skins, which the view keeps: another skin needs another play. */
  public updateKit(kit: Lr2PlayKit): void {
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
    // The skin's images go a few per frame, so the next screen's first frames do not stall on the sweep.
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
    return resolveLr2LaneIndex(channel, this.play.chartPlayVariant);
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
      ...(play.song !== undefined ? { chart: play.song } : {}),
      lanes: { playVariant: play.chartPlayVariant, channels: play.laneChannels },
      features: {
        longNote: play.notes.some((note) => note.endBeat !== undefined),
        bpmChange: (play.timingResolver?.tempoPoints.length ?? 0) > 1,
        bga: play.hasBga,
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
   * BPM (`displayBpm`).
   */
  private refreshState(frame?: PlayFrame): void {
    const setup = this.lr2Setup;
    if (setup === undefined) return;
    const play = this.play;
    const seconds = play.currentSeconds();
    const bpm = play.displayBpm(seconds);
    this.lr2State = resolveLr2PlayState(setup, {
      play: frame?.state ?? play.playState,
      score: play.score,
      seconds,
      loaded: this.loaded,
      ...(this.options.nonstop !== undefined ? { nonstopStage: this.nonstopStage } : {}),
      displayedScore: play.displayedScore,
      ...(bpm !== undefined ? { bpm } : {}),
      fps: this.fps,
    });
  }

  /**
   * The stage a stitched NONSTOP play shows: the one LR2 last announced, after a BLANK connection
   * (`resolveLr2NonstopStage`). It moves the stage ops (280-289) and the title; the skin stays as parsed for the first
   * stage, as LR2 reads it once for the whole play.
   */
  private updateNonstopStage(): void {
    const nonstop = this.options.nonstop;
    if (nonstop === undefined || this.options.course === undefined) return;
    this.nonstopStage = resolveLr2NonstopStage(nonstop.stages, this.play.currentSeconds());
  }

  /** Samples the frame rate over a sliding one-second window. */
  private updateFps(): void {
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
  private async loadSkin(): Promise<void> {
    const skin = this.skin;
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
    await Promise.all(
      [...imagePaths].map(async (path) => {
        if (this.isGone() || isLr2SpecialGraphic(path)) return;
        const texture = await loadSkinAssetTexture(skin, path);
        if (!texture) return;
        if (this.isGone()) {
          texture.destroy(true);
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
        texture?.destroy(true);
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
    const song = this.play.song;
    const source = this.options.source;
    if (!song || !source) return;
    const meta = song.chart.metadata;
    const candidates: Array<{ key: Lr2SpecialGraphic; assetPath: string }> = [];
    if (meta.stageFile) candidates.push({ key: LR2_SPECIAL_GRAPHIC.STAGEFILE, assetPath: meta.stageFile });
    if (meta.backBmp) candidates.push({ key: LR2_SPECIAL_GRAPHIC.BACKBMP, assetPath: meta.backBmp });
    if (meta.banner) candidates.push({ key: LR2_SPECIAL_GRAPHIC.BANNER, assetPath: meta.banner });
    await Promise.all(
      candidates.map(async ({ key, assetPath }) => {
        // The chart's files are read on demand; the image-aware lookup finds a `.bmp` declared but bundled as `.png`.
        const bytes = await loadAssetBytes(resolveChartImageAsset(source, song.chartPath, assetPath));
        if (!bytes) return;
        try {
          const texture = await loadTextureFromBytes(assetPath, bytes);
          if (!texture) return;
          if (this.isGone()) {
            texture.destroy(true);
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
