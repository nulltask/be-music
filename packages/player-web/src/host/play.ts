/**
 * The host API for the play screen: `createPlayScene(kit, options)` pairs a play session with the view of the kit's
 * family and returns the scene to load with `prepare`, show with `PixiSceneHost.setScene` and begin with `start`.
 */

import type { ResolvedPlayChart } from '@be-music/player/core/engine';
import type { BeMusicPlaylog, PlaylogCourseStage } from '@be-music/player/playlog';
import { DEFAULT_PLAY_OPTIONS, type CourseView, type PlayOptions, type PlayResult } from '@be-music/scene-model';
import type { BrowserSongAssetSource, BrowserSongEntry } from '../collection/types.ts';
import type { GameplayRecorderResult } from '../recording/gameplay-recorder.ts';
import type { RecordingFormat } from '../recording/recording-format.ts';
import type { AudioBusChannel, CompressorParams, CompressorStage, TunableCompressor } from '../runtime/audio-bus.ts';
import type { AudioService } from '../runtime/audio-service.ts';
import type { CoreGameplayDisposeOptions, CoreGameplayViewOptions } from '../scene/core/gameplay-options.ts';
import { KEY_ON_FADE_OUT_MS } from '../scene/gameplay-constants.ts';
import type { PixiSceneHost } from '../scene/host.ts';
import { PlaySceneSession } from '../session/play/play-scene-session.ts';
import { PlaySession } from '../session/play/play-session.ts';
import type { PlaySessionTheme } from '../session/play/play-session-theme.ts';
import { SessionScene, type SessionSceneOptions } from '../session/session-scene.ts';
import { LEGACY_STAGE_SIZE } from '../view/built-in/play-chrome.ts';
import { BUILT_IN_PLAY_TIMING, BuiltInPlayView } from '../view/built-in/play-view.ts';
import type { PlayFrame, PlayIntent } from '../view/types.ts';
import type { BuiltInKit } from './family-kit.ts';

/** The kits the play scene takes. The LR2 and beatoraja play screens are still `PixiGameplayView` and `PixiBeatorajaGameplayView`. */
export type PlaySceneKit = BuiltInKit;

/**
 * How a play runs, apart from its chart, its skin and where it leads: the play options it judges and scrolls with
 * (`autoPlay`, the gauge, the lane options, the hi-speed and HS-FIX, the covers), the tempo, the audio mix, the BGA and
 * the debug drawing options.
 */
export type PlaySceneSettings = Omit<
  CoreGameplayViewOptions,
  | 'skinlessChromeRenderer'
  | 'beMusicSkin'
  | 'beMusicEffects'
  | 'beMusicSkinSettings'
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
  /** The stage's rules for the engine (`PlaylogCourseStage`), with what the previous stage carried in. */
  readonly stage: PlaylogCourseStage;
  /** The course and the stage being played, for the skin. */
  readonly view?: CourseView;
}

/** Where a play leads. */
export interface PlaySceneEvents {
  /** The chart was played to its end (the ending has run): the result, and the play log the engine recorded. */
  finish(result: PlayResult, playlog: BeMusicPlaylog | undefined): void;
  /** The player left the play (Escape, the Backspace hold, `requestExit`); its play log follows (`waitForPlaylog`). */
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
  readonly chart: BrowserSongEntry;
  /** Where the chart's files are: its samples, BGA and images. */
  readonly source?: BrowserSongAssetSource;
  readonly settings: PlaySceneSettings;
  /** The course stage this play is, if any. */
  readonly course?: PlaySceneCourse;
  /** A play log to play back instead of the player's input: its recorded setup, arrangement, tempo and view. */
  readonly replay?: BeMusicPlaylog;
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
  /** The play log once the engine has recorded it, also after Escape; `undefined` after `timeoutMs` without one. */
  waitForPlaylog(timeoutMs?: number): Promise<BeMusicPlaylog | undefined>;
  /** Takes the player's new settings for the kit's skin; the next frame draws with them. */
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
  dispose(options?: CoreGameplayDisposeOptions): void;
}

class BuiltInPlayScene extends SessionScene<PlayFrame, PlayIntent> implements PlayScene {
  public readonly recording: PlaySceneRecording;
  private readonly playSession: PlaySceneSession;
  private readonly playView: BuiltInPlayView;
  private readonly chart: BrowserSongEntry;
  private readonly source: BrowserSongAssetSource | undefined;
  private readonly prepareHost: PixiSceneHost | undefined;

  public constructor(
    session: PlaySceneSession,
    view: BuiltInPlayView,
    facts: { chart: BrowserSongEntry; source?: BrowserSongAssetSource; host?: PixiSceneHost },
    options: SessionSceneOptions,
  ) {
    super(session, view, options);
    this.playSession = session;
    this.playView = view;
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
      this.playView.prepareOn(this.prepareHost);
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

  public waitForPlaylog(timeoutMs?: number): Promise<BeMusicPlaylog | undefined> {
    return this.play.waitForPlaylog(timeoutMs);
  }

  public updateKit(kit: PlaySceneKit): void {
    this.playView.updateKit(kit);
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
    this.playView.options.judgedNoteDisplay = mode;
  }

  public setShowInvisibleNotes(enabled: boolean): void {
    this.playView.options.showInvisibleNotes = enabled;
  }

  public override dispose(options: CoreGameplayDisposeOptions = {}): void {
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
  let view: BuiltInPlayView | undefined;
  const theme: PlaySessionTheme = {
    timing: () => BUILT_IN_PLAY_TIMING,
    moment: (moment) => sceneSession?.queueEvent(moment),
    keyOnFadeMs: () => KEY_ON_FADE_OUT_MS,
    stage: () => view?.playfieldSkin.stage ?? LEGACY_STAGE_SIZE,
    uploadTextures: (textures) => view?.uploadTextures(textures, () => play.disposed) ?? Promise.resolve(),
  };
  const play = new PlaySession(
    {
      ...settings,
      ...(course !== undefined
        ? { course: course.stage, ...(course.view !== undefined ? { courseInfo: course.view } : {}) }
        : {}),
      ...(options.replay !== undefined ? { replay: options.replay } : {}),
      ...(options.preResolved !== undefined ? { preResolved: options.preResolved } : {}),
      audio: options.audio,
      onExit: () => on.exit(),
      onRestart: () => on.restart(),
      onChartFinished: (result) => on.finish(result, result.playlog),
      ...(on.hiSpeed !== undefined ? { onHiSpeedChange: (hiSpeed: number) => on.hiSpeed?.(hiSpeed) } : {}),
      ...(on.tempo !== undefined ? { onTempoChange: (tempo: number) => on.tempo?.(tempo) } : {}),
    },
    theme,
  );
  view = new BuiltInPlayView(kit, play, {
    ...(settings.bga !== undefined ? { bga: settings.bga } : {}),
    ...(settings.autoPlay !== undefined ? { autoPlay: settings.autoPlay } : {}),
    ...(settings.nonstop !== undefined ? { nonstop: settings.nonstop } : {}),
    ...(settings.showInvisibleNotes !== undefined ? { showInvisibleNotes: settings.showInvisibleNotes } : {}),
    ...(settings.judgedNoteDisplay !== undefined ? { judgedNoteDisplay: settings.judgedNoteDisplay } : {}),
    ...(settings.layoutMode !== undefined ? { layoutMode: settings.layoutMode } : {}),
    ...(options.source !== undefined ? { source: options.source } : {}),
  });
  sceneSession = new PlaySceneSession(play, {
    chart: options.chart,
    ...(course?.view !== undefined ? { course: course.view } : {}),
    playOptions: options.playOptions ?? DEFAULT_PLAY_OPTIONS,
  });
  return new BuiltInPlayScene(
    sceneSession,
    view,
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
