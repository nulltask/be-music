/**
 * The built-in family's play screen: a be-music skin's chrome around the shared playfield (`view/shared/playfield`),
 * letterboxed into the window. It draws the play session's frames; its skin answers the shared playfield through a
 * {@link PlayfieldSkin} (a be-music skin draws the lanes, notes and bombs as data on its own canvas, so the playfield's
 * own layout and drawing apply). The session times the play and handles its keys; the view follows the fingers on the
 * touch lanes and sends them as `lane` intents.
 */

import { resolveStageOrientation, type GameplayLayoutMode } from '@be-music/player-skin-sdk';
import type { Application, Texture } from 'pixi.js';
import type { BrowserAssetSource } from '../../collection/types.ts';
import type { BuiltInKit } from '../../host/family-kit.ts';
import { logger } from '../../logger.ts';
import type { PlaySessionOptions } from '../../session/play/play-options.ts';
import { KEY_ON_FADE_OUT_MS } from '../../stage/design.ts';
import type { PixiSceneHost } from '../../host/scene-host.ts';
import { BeMusicGameplayBinding, resolveBeMusicSkinStage } from '../../skin/be-music/binding.ts';
import { ChartImageCache } from '../../skin/be-music/chart-images.ts';
import type { BeMusicStage } from '../../skin/be-music/types.ts';
import { PHANTOM_BOMB_DURATION_MS } from '../../skins/phantom/playfield.ts';
import { build, render, type PlayFrameContext } from '../shared/play-frame.ts';
import { PlayLayers } from '../shared/play-layers.ts';
import type { PlayChrome, PlayfieldRuntime } from '../shared/playfield/context.ts';
import { uploadTextures } from '../shared/texture-upload.ts';
import { playfieldTouchLanes, TouchLaneInput } from '../shared/touch-lane-input.ts';
import type { IntentSink, PlayFrame, PlayIntent, PlayView, PlayViewTiming, PlayfieldSkin } from '../types.ts';
import {
  collectBGATargets,
  LEGACY_STAGE_SIZE,
  renderBuiltInChrome,
  type BGATargetsContext,
  type BuiltInChromeContext,
} from './play-chrome.ts';

const log = logger('gameplay');

/** Design px above a lane's top through which notes keep drawing as they scroll in (standard layout). */
const NOTE_OVERSCAN = 48;

/**
 * A be-music skin's timing on the play screen: no load or play-start offsets of its own (the play's fallback intro
 * applies), and a 450 ms fade back to black, with the audio, before the result or select screen takes over.
 */
export const BUILT_IN_PLAY_TIMING: PlayViewTiming = {
  loadEndOffsetMs: 0,
  playStartOffsetMs: 0,
  fadeOutMs: 450,
  closeMs: 0,
};

/** What the built-in play view draws with besides its kit: the options of the play that change what is drawn. */
export type BuiltInPlayViewOptions = Pick<
  PlaySessionOptions,
  'bga' | 'autoPlay' | 'nonstop' | 'showInvisibleNotes' | 'judgedNoteDisplay' | 'layoutMode'
> & {
  /** Where the chart's files are, for the skin's song images. */
  readonly source?: BrowserAssetSource;
};

/** The built-in play view. See the module comment. */
export class BuiltInPlayView
  extends PlayLayers
  implements PlayView, PlayFrameContext, BuiltInChromeContext, BGATargetsContext
{
  public readonly family = 'built-in' as const;
  public readonly timing: PlayViewTiming = BUILT_IN_PLAY_TIMING;
  /** The play options the view draws with; the setters change them during the play. */
  public readonly options: BuiltInPlayViewOptions & { beMusicEffects?: BuiltInKit['effects'] };
  /** How the be-music skin answers the shared playfield. */
  public readonly playfieldSkin: PlayfieldSkin;
  /** The be-music skin's chrome around the shared playfield. */
  public readonly chrome: PlayChrome;
  /** The fingers on the lanes, sent to the session as `lane` intents while attached. */
  private readonly touchLanes: TouchLaneInput = new TouchLaneInput(playfieldTouchLanes(this));
  private kit: BuiltInKit;

  public constructor(kit: BuiltInKit, play: PlayfieldRuntime, options: BuiltInPlayViewOptions = {}) {
    super(play);
    this.kit = kit;
    this.options = { ...options, ...(kit.effects !== undefined ? { beMusicEffects: kit.effects } : {}) };
    this.playfieldSkin = createBuiltInPlayfieldSkin(this);
    // A be-music skin draws notes from data: no text of its own after the bombs, and nothing for a retired bomb.
    this.chrome = { draw: () => renderBuiltInChrome(this, undefined) };
  }

  /** The host's `Application`; the view draws only once attached (or built for a host ahead of its first frame). */
  get app(): Application {
    if (!this.host) throw new Error('BuiltInPlayView: app accessed before attach');
    return this.host.app;
  }

  /** A be-music skin always paints the chrome: the screen fades up from black as it appears. */
  get paintsThroughBeMusicSkin(): boolean {
    return true;
  }

  /**
   * The skin's stage: its portrait stage while the screen is upright and the chart fits a portrait playfield, its
   * landscape stage otherwise. Read every frame, so a rotation mid-play re-lays the screen out on the next frame.
   */
  get beMusicStage(): BeMusicStage | undefined {
    const screen = this.host?.app.screen;
    return resolveBeMusicSkinStage(
      this.kit.skin,
      screen && screen.width > 0 && screen.height > 0 ? screen : undefined,
      {
        laneChannels: this.play.laneChannels,
        playVariant: this.play.chartPlayVariant,
      },
    );
  }

  /** `'touch'` when the play asks for it; the play mode may still fall back to standard (`resolveLaneGeometry`). */
  get layoutMode(): GameplayLayoutMode {
    return this.options.layoutMode === 'touch' ? 'touch' : 'standard';
  }

  /**
   * How far above a lane's top notes still draw while they scroll in: the standard lanes start at the stage's top edge,
   * so notes enter from off-stage; the touch and portrait lanes start below the skin's header band.
   */
  get noteOverscan(): number {
    return this.layoutMode === 'touch' || resolveStageOrientation(this.playfieldSkin.stage) === 'portrait'
      ? 0
      : NOTE_OVERSCAN;
  }

  /** The be-music skin's gameplay binding: lanes, notes and hit effects go to it as data and it draws them. */
  get skinBinding(): BeMusicGameplayBinding {
    if (!this.skinBindingInstance) {
      const source = this.options.source;
      this.chartImages = new ChartImageCache({
        resolveSource: (chartEntry) => (source !== undefined && chartEntry.sourceId === source.id ? source : undefined),
      });
      this.skinBindingInstance = new BeMusicGameplayBinding(this.kit.skin, {
        chartImage: this.chartImages.lookup,
        settings: this.kit.settings,
        renderer: this.host?.app.renderer,
      });
    }
    return this.skinBindingInstance;
  }

  /** Builds the layers on `host` ahead of the first frame (a play loading off stage), so its textures can upload. */
  public prepareOn(host: PixiSceneHost): void {
    build(this, host);
  }

  public attach(host: PixiSceneHost, emit: IntentSink<PlayIntent>): void {
    build(this, host);
    this.touchLanes.attach(host, emit);
  }

  public draw(frame: PlayFrame): void {
    this.play = frame.playfield;
    this.root.visible = frame.shown;
    if (!frame.shown) return;
    render(this, frame.seconds, frame.playfield.audioAnalyzer !== undefined ? frame.audio : undefined);
    // A skin drawing through the player's renderer draws the frame just collected now, before Pixi renders.
    this.skinBindingInstance?.flush();
  }

  public detach(): void {
    this.touchLanes.detach();
  }

  /** Uploads `textures` to the GPU through the host's renderer (the BGA the play loads), when the view has a host. */
  public uploadTextures(textures: Iterable<Texture | undefined>, isCancelled: () => boolean): Promise<void> {
    return uploadTextures(this.host?.app.renderer, textures, isCancelled);
  }

  /** Takes the player's new kit (skin settings, effects); the next frame draws with them. */
  public updateKit(kit: BuiltInKit): void {
    this.kit = kit;
    if (kit.effects !== undefined) this.options.beMusicEffects = kit.effects;
    this.skinBindingInstance?.setSettings(kit.settings);
  }

  public dispose(): void {
    // Drop every per-frame child pool before the scene graph so each pooled child is freed through its own `destroy()`.
    try {
      this.skinBindingInstance?.dispose();
      this.skinBindingInstance = undefined;
      this.chartImages?.dispose();
      this.chartImages = undefined;
      for (const crop of this.skinBGACrops.values()) crop?.close();
      this.skinBGACrops.clear();
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
    this.bgaTargetsScratch.length = 0;
  }
}

/**
 * How a be-music skin answers the shared playfield: its stage (the LR2-compatible 640x480 without one); the
 * playfield's own lane layout, notes, measure lines and bombs (the skin draws them as data); the built-in BGA rect;
 * the skin's bomb length and the default key-beam fade.
 */
function createBuiltInPlayfieldSkin(view: BuiltInPlayView): PlayfieldSkin {
  return {
    get stage() {
      return view.beMusicStage ?? LEGACY_STAGE_SIZE;
    },
    ownsLanes: false,
    laneRect: () => undefined,
    noteCell: () => undefined,
    measureLines: () => undefined,
    bgaTargets: (out) => collectBGATargets(view, out),
    bombCell: () => undefined,
    bombDurationMs: () => view.skinBinding.bombDurationMs ?? PHANTOM_BOMB_DURATION_MS,
    keyOnFadeMs: () => KEY_ON_FADE_OUT_MS,
  };
}
