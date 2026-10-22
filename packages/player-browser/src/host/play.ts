/**
 * The host API for the play screen: `createPlayScene(kit, options)` pairs a play session with the view of the kit's
 * family and returns the scene to load with `prepare`, show with `PixiSceneHost.setScene` and begin with `start`.
 */

import type { ResolvedPlayChart } from '@be-music/player-engine';
import type { BeMusicReplay, ReplayCourseStage } from '@be-music/player-engine/replay';
import {
  DEFAULT_PLAY_OPTIONS,
  type CourseView,
  type LibraryChart,
  type PlayOptions,
  type PlayResult,
} from '@be-music/player-scene-model';
import type { Texture } from 'pixi.js';
import type { BrowserAssetSource } from '../collection/types.ts';
import type { GameplayRecorderResult } from '../recording/gameplay-recorder.ts';
import type { RecordingFormat } from '../recording/recording-format.ts';
import type { AudioBusChannel, CompressorParams, CompressorStage, TunableCompressor } from '../runtime/audio-bus.ts';
import type { AudioOwner, AudioService } from '../runtime/audio-service.ts';
import type { PlayDisposeOptions, PlaySessionOptions } from '../session/play/play-options.ts';
import type { PixiSceneHost } from './scene-host.ts';
import { PlaySceneSession } from '../session/play/play-scene-session.ts';
import { PlaySession } from '../session/play/play-session.ts';
import type { PlayReplayViewScale, PlaySessionTheme } from '../session/play/play-session-theme.ts';
import { SessionScene, type SessionSceneOptions } from '../session/session-scene.ts';
import { logger } from '../logger.ts';
import { BeatorajaPlayView } from '../view/beatoraja/play-view.ts';
import { BuiltInPlayView } from '../view/built-in/play-view.ts';
import { LR2PlayView } from '../view/lr2/play-view.ts';
import type { PlayFrame, PlayIntent, PlayView, PlayfieldSkin } from '../view/types.ts';
import type { BeatorajaKit, BuiltInKit, LR2PlayKit } from './family-kit.ts';

const log = logger('gameplay');

/**
 * The kits the play scene takes: a be-music skin, an LR2 play skin (with the 9-keys skin for invisible notes), or a
 * beatoraja theme's play entry.
 */
export type PlaySceneKit = BuiltInKit | LR2PlayKit | BeatorajaKit;

/**
 * How a play runs, apart from its chart, its skin and where it leads: the play options it judges and scrolls with
 * (`autoPlay`, the gauge, the lane options, the hi-speed and HS-FIX, the covers), the tempo, the audio mix, the BGA and
 * the debug drawing options.
 */
export type PlaySceneSettings = Omit<
  PlaySessionOptions,
  | 'beMusicEffects'
  | 'onExit'
  | 'onRestart'
  | 'onChartFinished'
  | 'onHiSpeedChange'
  | 'onTempoChange'
  | 'replay'
  | 'preResolved'
  | 'audio'
  | 'course'
  | 'courseInfo'
>;

/** The course a play is a stage of: the stage's rules and carried-in state, and the course as a skin shows it. */
export interface PlaySceneCourse {
  /** The stage's rules for the engine (`ReplayCourseStage`), with what the previous stage carried in. */
  readonly stage: ReplayCourseStage;
  /** The course and the stage being played, for the skin. */
  readonly view?: CourseView;
}

/** Where a play leads. */
export interface PlaySceneEvents {
  /** The chart was played to its end (the ending has run): the result, and the replay the engine recorded. */
  finish(result: PlayResult, replay: BeMusicReplay | undefined): void;
  /** The player left the play (Escape, the Backspace hold, `requestExit`); its replay follows (`waitForReplay`). */
  exit(): void;
  /** The player asked to play the chart again (F5). */
  restart(): void;
  /** The player stepped the hi-speed; on the player's own scale, to remember for the next play. */
  hiSpeed?(hiSpeed: number): void;
  /** The play's tempo changed (a live change, or a replay following its log). */
  tempo?(tempo: number): void;
}

export interface PlaySceneOptions extends SessionSceneOptions {
  /** The chart to play. */
  readonly chart: LibraryChart;
  /** Where the chart's files are: its samples, BGA and images. */
  readonly source?: BrowserAssetSource;
  readonly settings: PlaySceneSettings;
  /** The course stage this play is, if any. */
  readonly course?: PlaySceneCourse;
  /** A replay to play back instead of the player's input: its recorded setup, arrangement, tempo and view. */
  readonly replay?: BeMusicReplay;
  /**
   * The chart's `#RANDOM` / `#SWITCH` branches as the decide screen drew them (`DecideScene.resolved`), so the play
   * plays the branches the screen showed. Without it the play draws its own; a replay plays its log's.
   */
  readonly preResolved?: ResolvedPlayChart;
  /** The host's audio service: the play opens its own context and bus through it. */
  readonly audio: AudioService;
  /** The play options as the select screen set them, for the frames a view reads. Defaults to `DEFAULT_PLAY_OPTIONS`. */
  readonly playOptions?: PlayOptions;
  /**
   * The host the scene will show on. With it the scene builds its layers as it loads, so the BGA uploads to the GPU
   * behind a decide screen instead of on its first cue.
   */
  readonly host?: PixiSceneHost;
  readonly on: PlaySceneEvents;
}

/** A play's recording of its canvas and mix, as the host's recorder drives it. */
export interface PlaySceneRecording {
  startRecording(options?: { format?: RecordingFormat }): void;
  stopRecording(): Promise<GameplayRecorderResult | undefined>;
  isRecording(): boolean;
}

/** The play screen as a scene. */
export interface PlayScene extends SessionScene<PlayFrame, PlayIntent> {
  /**
   * Loads the play: the chart, its samples (decoded, stretched for a keep-pitch tempo) and the BGA, which goes on
   * loading in the background. Touches nothing on the stage, so a decide screen can show meanwhile; run while the
   * scene is shown, the playfield draws in its loading state. Reports 0..1 as it goes.
   */
  prepare(onProgress?: (progress: number) => void): Promise<void>;
  /** Begins the play once it is prepared and shown: the intro, then the chart. Later calls do nothing. */
  start(): void;
  /** Leaves the play as Escape does: the fade-out, then `on.exit`. */
  requestExit(): void;
  /** Pauses or resumes the play, as Space does. */
  requestTogglePause(): void;
  isPaused(): boolean;
  /**
   * Moves an AUTO play or replay to chart second `seconds` (clamped to the chart) and plays on from there, as a preview's seek bar
   * does; a paused play stays paused there. The running play seeks — it is not started again — and the promise resolves
   * once the play shows the second sought (its frames are of the new seek generation). A manual play
   * ignores it (`PlayFrame.seekable`).
   */
  seek(seconds: number): Promise<void>;
  /** Changes the play's tempo (pitch mode, not in a replay); whether it was taken. */
  setTempo(tempo: number): boolean;
  getTempo(): number;
  /** Sets the player's hi-speed (HS-FIX applies on top). */
  setHiSpeed(hiSpeed: number): void;
  getHiSpeed(): number;
  /** The play's recording. */
  readonly recording: PlaySceneRecording;
  /** The play as a result so far (the test hook reads it); `undefined` before the chart is loaded. */
  progress(): PlayResult | undefined;
  /**
   * The chart as the play plays it — its `#RANDOM` / `#SWITCH` branches drawn, with the draws — once it is loaded and
   * until the scene is disposed: what a result's graphs plot.
   */
  readonly resolved: ResolvedPlayChart | undefined;
  /** The replay once the engine has recorded it, also after Escape; `undefined` after `timeoutMs` without one. */
  waitForReplay(timeoutMs?: number): Promise<BeMusicReplay | undefined>;
  /**
   * Takes the player's new settings for the kit's skin; the next frame draws with them. The scene keeps its family: a
   * kit of another family is ignored. A built-in or LR2 scene keeps its skin too, while a beatoraja scene takes another
   * entry's skin (the demo's play-skin picker) and rebuilds its stage.
   */
  updateKit(kit: PlaySceneKit): void;
  setAudioVolume(channel: AudioBusChannel, volume: number): void;
  setAudioCompressor(enabled: boolean): void;
  setAudioCompressorMode(mode: 'split' | 'legacy'): void;
  setAudioCompressorStageEnabled(stage: CompressorStage, enabled: boolean): void;
  setAudioCompressorParams(compressor: TunableCompressor, params: Partial<CompressorParams>): void;
  setAutoPauseOnBlur(enabled: boolean): void;
  setJudgedNoteDisplay(mode: 'KEEP_SCROLLING' | 'HIDE'): void;
  setShowInvisibleNotes(enabled: boolean): void;
  /** Ends the scene; `preserveAudioTail` lets a play that ended ring out before its audio closes. */
  dispose(options?: PlayDisposeOptions): void;
}

/** A family's play view, and what the scene and the play session ask of it. */
interface FamilyPlayView {
  readonly view: PlayView;
  /** How the view's skin answers the shared playfield: its key-beam fade. */
  readonly playfieldSkin: PlayfieldSkin;
  /** Builds the view's layers on `host` ahead of its first frame, so what the play loads can upload to the GPU. */
  prepareOn(host: PixiSceneHost): void;
  /** Loads the view's own assets once the chart is prepared (the session theme's `prepareView`). */
  prepareView?(): Promise<void>;
  /** The scale the view's hi-speed reads on in the replay, when it has its own (the session theme's `replayView`). */
  replayView?(): PlayReplayViewScale | undefined;
  /** The view draws the LIFT (the session theme's `drawsLift`). */
  readonly drawsLift?: boolean;
  uploadTextures(textures: Iterable<Texture | undefined>, isCancelled: () => boolean): Promise<void>;
  setJudgedNoteDisplay(mode: 'KEEP_SCROLLING' | 'HIDE'): void;
  setShowInvisibleNotes(enabled: boolean): void;
  updateKit(kit: PlaySceneKit): void;
}

/**
 * The play view of `kit`'s family, drawing `play`. A beatoraja skin's Lua sounds play through the audio service as
 * `soundOwner`'s, so they stop as the scene leaves the stage.
 */
function createPlayView(
  kit: PlaySceneKit,
  play: PlaySession,
  options: Pick<PlaySceneOptions, 'settings' | 'course' | 'source' | 'audio'>,
  soundOwner: AudioOwner,
): FamilyPlayView {
  const { settings, course, source } = options;
  if (kit.family === 'beatoraja') {
    const view = new BeatorajaPlayView(kit, play, {
      ...(settings.autoPlay !== undefined ? { autoPlay: settings.autoPlay } : {}),
      ...(settings.dpFlip !== undefined ? { dpFlip: settings.dpFlip } : {}),
      ...(course?.view !== undefined ? { course: course.view } : {}),
      ...(settings.nonstop !== undefined ? { nonstop: settings.nonstop } : {}),
      ...(source !== undefined ? { source } : {}),
      // The skin's Lua sounds play through the audio service, owned by the scene's session (not the play, which owns its
      // audio graph: a play that ended keeps ringing out after the scene leaves).
      skinSounds: options.audio.skinSounds.owned(soundOwner),
    });
    return {
      view,
      playfieldSkin: view.playfieldSkin,
      prepareOn: (host) => view.prepareOn(host),
      prepareView: () => view.prepare(),
      replayView: () => view.replayView(),
      drawsLift: true,
      uploadTextures: (textures, isCancelled) => view.uploadTextures(textures, isCancelled),
      // A beatoraja skin draws its own notes: neither drawing option applies.
      setJudgedNoteDisplay: () => {},
      setShowInvisibleNotes: () => {},
      updateKit: (next) => (next.family === 'beatoraja' ? view.updateKit(next) : ignoreKit(next, 'beatoraja')),
    };
  }
  const drawing = {
    ...(settings.bga !== undefined ? { bga: settings.bga } : {}),
    ...(settings.autoPlay !== undefined ? { autoPlay: settings.autoPlay } : {}),
    ...(settings.nonstop !== undefined ? { nonstop: settings.nonstop } : {}),
    ...(settings.showInvisibleNotes !== undefined ? { showInvisibleNotes: settings.showInvisibleNotes } : {}),
    ...(settings.judgedNoteDisplay !== undefined ? { judgedNoteDisplay: settings.judgedNoteDisplay } : {}),
    ...(source !== undefined ? { source } : {}),
  };
  if (kit.family === 'lr2') {
    const view = new LR2PlayView(kit, play, {
      ...drawing,
      ...(settings.bgaSize !== undefined ? { bgaSize: settings.bgaSize } : {}),
      ...(settings.autoScratch1P !== undefined ? { autoScratch1P: settings.autoScratch1P } : {}),
      ...(settings.autoScratch2P !== undefined ? { autoScratch2P: settings.autoScratch2P } : {}),
      ...(settings.scoreGraph !== undefined ? { scoreGraph: settings.scoreGraph } : {}),
      gauge: play.resolveSelectedGauge(),
      courseGauge: course !== undefined,
      ...(course?.view !== undefined ? { course: course.view } : {}),
    });
    return {
      view,
      playfieldSkin: view.playfieldSkin,
      prepareOn: (host) => view.prepareOn(host),
      prepareView: () => view.prepare(),
      uploadTextures: (textures, isCancelled) => view.uploadTextures(textures, isCancelled),
      setJudgedNoteDisplay: (mode) => {
        view.options.judgedNoteDisplay = mode;
      },
      setShowInvisibleNotes: (enabled) => {
        view.options.showInvisibleNotes = enabled;
      },
      updateKit: (next) => (next.family === 'lr2' ? view.updateKit(next) : ignoreKit(next, 'lr2')),
    };
  }
  const view = new BuiltInPlayView(kit, play, {
    ...drawing,
    ...(settings.layoutMode !== undefined ? { layoutMode: settings.layoutMode } : {}),
  });
  return {
    view,
    playfieldSkin: view.playfieldSkin,
    prepareOn: (host) => view.prepareOn(host),
    uploadTextures: (textures, isCancelled) => view.uploadTextures(textures, isCancelled),
    setJudgedNoteDisplay: (mode) => {
      view.options.judgedNoteDisplay = mode;
    },
    setShowInvisibleNotes: (enabled) => {
      view.options.showInvisibleNotes = enabled;
    },
    updateKit: (next) => (next.family === 'built-in' ? view.updateKit(next) : ignoreKit(next, 'built-in')),
  };
}

function ignoreKit(kit: PlaySceneKit, family: PlaySceneKit['family']): void {
  log.warn(`a ${family} play scene keeps its family; ignoring a ${kit.family} kit`);
}

class FamilyPlayScene extends SessionScene<PlayFrame, PlayIntent> implements PlayScene {
  public readonly recording: PlaySceneRecording;
  private readonly playSession: PlaySceneSession;
  private readonly familyView: FamilyPlayView;
  private readonly chart: LibraryChart;
  private readonly source: BrowserAssetSource | undefined;
  private readonly prepareHost: PixiSceneHost | undefined;

  public constructor(
    session: PlaySceneSession,
    familyView: FamilyPlayView,
    facts: { chart: LibraryChart; source?: BrowserAssetSource; host?: PixiSceneHost },
    options: SessionSceneOptions,
  ) {
    super(session, familyView.view, options);
    this.playSession = session;
    this.familyView = familyView;
    this.chart = facts.chart;
    this.source = facts.source;
    this.prepareHost = facts.host;
    const play = session.play;
    this.recording = {
      startRecording: (recordingOptions) => play.startRecording(recordingOptions),
      stopRecording: () => play.stopRecording(),
      isRecording: () => play.isRecording(),
    };
  }

  private get play(): PlaySession {
    return this.playSession.play;
  }

  public override async enter(host: PixiSceneHost): Promise<void> {
    // The play's own input listens on the host's canvas from the scene's entry on (`PlaySceneSession.enter`).
    this.play.host ??= host;
    await super.enter(host);
  }

  public async prepare(onProgress?: (progress: number) => void): Promise<void> {
    if (this.prepareHost !== undefined) {
      this.play.host ??= this.prepareHost;
      this.familyView.prepareOn(this.prepareHost);
    }
    const report = (progress: number): void => {
      this.playSession.loadProgress = progress;
      onProgress?.(progress);
    };
    report(0);
    await this.play.load(this.chart, this.source);
    report(1);
  }

  public start(): void {
    this.play.start();
  }

  public requestExit(): void {
    this.play.requestExit();
  }

  public requestTogglePause(): void {
    this.play.requestTogglePause();
  }

  public isPaused(): boolean {
    return this.play.isPaused();
  }

  public seek(seconds: number): Promise<void> {
    return this.play.seek(seconds);
  }

  public setTempo(tempo: number): boolean {
    return this.play.setTempo(tempo);
  }

  public getTempo(): number {
    return this.play.getTempo();
  }

  public setHiSpeed(hiSpeed: number): void {
    this.play.setHiSpeed(hiSpeed);
  }

  public getHiSpeed(): number {
    return this.play.getHiSpeed();
  }

  public progress(): PlayResult | undefined {
    return this.play.getResultData();
  }

  public get resolved(): ResolvedPlayChart | undefined {
    const { resolvedChart, randomDraws } = this.play;
    return resolvedChart !== undefined && randomDraws !== undefined ? { chart: resolvedChart, randomDraws } : undefined;
  }

  public waitForReplay(timeoutMs?: number): Promise<BeMusicReplay | undefined> {
    return this.play.waitForReplay(timeoutMs);
  }

  public updateKit(kit: PlaySceneKit): void {
    this.familyView.updateKit(kit);
  }

  public setAudioVolume(channel: AudioBusChannel, volume: number): void {
    this.play.setAudioVolume(channel, volume);
  }

  public setAudioCompressor(enabled: boolean): void {
    this.play.setAudioCompressor(enabled);
  }

  public setAudioCompressorMode(mode: 'split' | 'legacy'): void {
    this.play.setAudioCompressorMode(mode);
  }

  public setAudioCompressorStageEnabled(stage: CompressorStage, enabled: boolean): void {
    this.play.setAudioCompressorStageEnabled(stage, enabled);
  }

  public setAudioCompressorParams(compressor: TunableCompressor, params: Partial<CompressorParams>): void {
    this.play.setAudioCompressorParams(compressor, params);
  }

  public setAutoPauseOnBlur(enabled: boolean): void {
    this.play.setAutoPauseOnBlur(enabled);
  }

  public setJudgedNoteDisplay(mode: 'KEEP_SCROLLING' | 'HIDE'): void {
    this.familyView.setJudgedNoteDisplay(mode);
  }

  public setShowInvisibleNotes(enabled: boolean): void {
    this.familyView.setShowInvisibleNotes(enabled);
  }

  public override dispose(options: PlayDisposeOptions = {}): void {
    this.playSession.disposeOptions = options;
    super.dispose();
  }
}

/**
 * The play screen for `kit`: a play session (the chart, media, engine, input, view settings and ending around one
 * `PlayState`) drawn by the kit's family view. Load it with `prepare`, show it with `PixiSceneHost.setScene`, begin it
 * with `start`, and dispose it once it is gone (with `preserveAudioTail` after it finished, so its last samples ring
 * out).
 */
export function createPlayScene(kit: PlaySceneKit, options: PlaySceneOptions): PlayScene {
  const { settings, course, on } = options;
  let sceneSession: PlaySceneSession | undefined;
  let family: FamilyPlayView | undefined;
  // The view is made for the play below; the play asks its theme nothing before both exist.
  const theme: PlaySessionTheme = {
    timing: () => family!.view.timing,
    pixelsPerBeat: () => family?.playfieldSkin.pixelsPerBeat,
    moment: (moment) => sceneSession?.queueEvent(moment),
    keyOnFadeMs: (channel) => family!.playfieldSkin.keyOnFadeMs(channel),
    prepareView: () => family?.prepareView?.() ?? Promise.resolve(),
    uploadTextures: (textures) => family?.uploadTextures(textures, () => play.disposed) ?? Promise.resolve(),
    replayView: () => family?.replayView?.(),
    drawsLift: () => family?.drawsLift === true,
  };
  const play = new PlaySession(
    {
      ...settings,
      ...(kit.family === 'beatoraja' ? BEATORAJA_PLAY_SETTINGS : {}),
      ...(course !== undefined
        ? { course: course.stage, ...(course.view !== undefined ? { courseInfo: course.view } : {}) }
        : {}),
      ...(options.replay !== undefined ? { replay: options.replay } : {}),
      ...(options.preResolved !== undefined ? { preResolved: options.preResolved } : {}),
      audio: options.audio,
      onExit: () => on.exit(),
      onRestart: () => on.restart(),
      onChartFinished: (result) => on.finish(result, result.replay),
      ...(on.hiSpeed !== undefined ? { onHiSpeedChange: (hiSpeed: number) => on.hiSpeed?.(hiSpeed) } : {}),
      ...(on.tempo !== undefined ? { onTempoChange: (tempo: number) => on.tempo?.(tempo) } : {}),
    },
    theme,
  );
  sceneSession = new PlaySceneSession(play, {
    chart: options.chart,
    ...(course?.view !== undefined ? { course: course.view } : {}),
    playOptions: options.playOptions ?? DEFAULT_PLAY_OPTIONS,
    audio: options.audio,
  });
  family = createPlayView(kit, play, options, sceneSession);
  return new FamilyPlayScene(
    sceneSession,
    family,
    {
      chart: options.chart,
      ...(options.source !== undefined ? { source: options.source } : {}),
      ...(options.host !== undefined ? { host: options.host } : {}),
    },
    {
      // The play listens for its own keys (`play-input.ts`), so the scene listens for none.
      keyTarget: options.keyTarget ?? NO_KEYS,
      ...(options.now !== undefined ? { now: options.now } : {}),
    },
  );
}

const NO_KEYS = { addEventListener: (): void => {}, removeEventListener: (): void => {} };

/**
 * What a beatoraja play runs with over the host's settings: beatoraja's cover keys. The lane options (RANDOM, MIRROR,
 * S-RANDOM, SCATTER), HS-FIX and the lane covers it starts with are the host's, as on every family.
 */
const BEATORAJA_PLAY_SETTINGS: Pick<PlaySessionOptions, 'coverKeys'> = {
  coverKeys: true,
};
