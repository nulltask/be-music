import { Application, Container, Graphics, Text, TextStyle, Texture, VideoSource } from 'pixi.js';
// Side-effect import: registers Pixi's `PrepareSystem` on the renderer so {@link CoreGameplayView.preparePixiUpload}
// can drive eager GPU uploads. Pixi v8 deliberately ships the prepare module out of the default bundle (it's a
// large optional system that not every app needs); the import has to land before any `Application.init` runs that
// expects `renderer.prepare` to exist.
import 'pixi.js/prepare';
import {
  mirrorBeatAtTempoReversal,
  type TimedSampleTrigger,
  type TimingResolver,
} from '@be-music/audio-renderer/triggers';
import { createScoreTracker, type ScoreTracker } from '@be-music/player/core/scoring';
import {
  createTempoClock,
  PlayerInterruptedError,
  type PreparedPlaybackChartData,
  type PlayerSummary,
  type PlayerTempoChange,
  type TempoClock,
} from '@be-music/player/core/engine';
import { resolveLr2LaneTimer } from '@be-music/lr2-skin/state';
import {
  createEmptyScore,
  resolveClearLamp,
  resolveDisplayedPoor,
  type GaugeType,
  type JudgeKind,
  type PlaylogRulesetId,
  type ScoreSummary,
} from '@be-music/player/ruleset';
import type { LongNoteStyle, PlayerRulesetInfo } from '@be-music/player/core/engine';
import type { ChartPlayVariant } from '@be-music/player/core/lane-layout';
import type { PlayerInputSignalBus } from '@be-music/player/core/input-signal-bus';
import type { PlayerJudgeComboSignalState, PlayerStateSignals } from '@be-music/player/state-signals';
import type {
  PlayerGaugeSummary,
  PlayerUiCommand,
  PlayerUiFramePayload,
  PlayerUiSignalBus,
} from '@be-music/player/core/ui-signal-bus';
import { DEFAULT_POOR_BGA_DISPLAY_SECONDS } from '@be-music/player/core/bga-timeline';
import type { ScrollDistanceMapperLike } from '@be-music/player/core/scroll-distance';
import { type TimedLandmineNote, type TimedPlayableNote } from '@be-music/player/playable-notes';
import {
  createPlaylogViewCoalescer,
  DEFAULT_PLAYLOG_VIEW_REPLAY,
  resolveReplayHiSpeed,
  resolveReplayView,
  roundPlaylogView,
  type BeMusicPlaylog,
  type PlaylogCourseStage,
  type PlaylogLaneCover,
  type PlaylogRecordingOptions,
  type PlaylogViewCoalescer,
  type PlaylogViewReplay,
  type PlaylogViewState,
} from '@be-music/player/playlog';
import { GoneDrawObjects } from './note-draw-window.ts';
import type { BrowserSongAssetSource, BrowserSongEntry } from '../../collection/types.ts';
import {
  type AudioBusChannel,
  type AudioBusHandle,
  type CompressorMode,
  type CompressorParams,
  type TunableCompressor,
  type CompressorStage,
  sanitizeBusVolume,
} from '../../runtime/audio-bus.ts';
import { GameplayRecorder, type GameplayRecorderResult } from '../../recording/gameplay-recorder.ts';
import type { RecordingFormat } from '../../recording/recording-format.ts';
import type { ChartBpmRange } from './gameplay-bpm-range.ts';
import { JudgeTimingLog } from './judge-timing-log.ts';
import { toBeMusicJudgeWindows } from './judge-windows.ts';
import { LongNoteTracker, resolveBeMusicLongNoteMode } from './long-note-tracker.ts';
import { advanceCourseCombo, type CourseComboState } from './course-combo.ts';
import { createPlaceholderGaugeState } from './placeholder-gauge.ts';
import type { SceneCourseInfo } from '../course-info.ts';
import { nonstopBpmAt, type NonstopStitchMap } from '@be-music/player/course';
import type { NonstopStageMixer } from '../../runtime/nonstop-audio.ts';
import { LiveTempo } from '../live-tempo.ts';
import {
  chartToElapsedSeconds,
  clampPlayTempo,
  resolveReplayTempo,
  setVideoPlaybackTempo,
  supportsLiveTempoChange,
  type ReplayTempo,
  type TempoPitchMode,
  type TimeStretchAlgorithm,
} from '../../runtime/play-tempo.ts';
import { fillLaneCover, resolveHiSpeedForVisibleMs, resolveNoteVisibleMs } from './lane-cover.ts';
import { BE_MUSIC_HI_SPEED_SCALE, PlaylogViewCursor } from '../playlog-view.ts';
import type { SideLaneRun } from '../../view/shared/playfield/measure-line-runs.ts';
import { PerfTracker } from '../perf.ts';
import type { PixiScene, PixiSceneHost } from '../host.ts';
import type { SceneIdentity } from '../../host/family-kit.ts';
import { ChildPool, staggerDestroyTextures } from '../pixi-utils.ts';
import { AudioAnalyzer, type AudioFeatures } from '../../runtime/audio-analysis.ts';
import { runEngineDriver } from '../../runtime/engine-driver.ts';
import type { WebAudioSession } from '../../runtime/web-audio-session.ts';
import { drainWebUiSignals, type WebUiRuntimeCallbacks } from '../../runtime/web-ui-runtime.ts';
import type { BeMusicEvent, BeMusicJson } from '@be-music/json';
import {
  pickSwitchingBgaFrame,
  resolveBmsBmpArgb,
  type BmsSwitchingBga,
  type RandomDraws,
  type ResolvedChart,
} from '@be-music/chart';
import {
  BG,
  BGA,
  DESIGN_HEIGHT,
  DESIGN_WIDTH,
  HISPEED_STEP,
  FALLBACK_INTRO_DELAY_MS,
  PIXELS_PER_BEAT,
} from '../gameplay-constants.ts';
import { HiSpeedTransition, snapHiSpeed, stepPlayerHiSpeed } from '../hi-speed.ts';
import {
  buildSkinBgaFrame,
  pickActiveBgaCue,
  pickActiveBgaKey,
  resolveBgaImageRect,
  resolveNonstopBgaAlpha,
  type BgaCue,
  type NonstopStageBgaTimeline,
} from './gameplay-bga.ts';
import { resolveLr2LaneIndex, resolveSideRelativeLaneIndex } from '../gameplay-lanes.ts';
import type { SkinlessGameplayChromeRenderer } from '../gameplay-chrome.ts';
import { resolveGameplayAudioTailCleanupDelayMs } from './gameplay-result-delay.ts';
import { resolvePlayEnding } from '../play-ending.ts';
import { CORE_TEXT_FONT } from './fonts.ts';
import type {
  BeMusicEffectLevel,
  BeMusicGameplayLayout,
  BeMusicImage,
  BeMusicJudge,
  BeMusicLaneCover,
  BeMusicSkin,
  BeMusicStage,
} from '../../skin/be-music/types.ts';
import { resolveBeMusicLaneKind } from '../../skin/be-music/registry.ts';
import {
  resolveGameplayLaneGeometry,
  resolveGameplayLayout,
  resolveStageOrientation,
  type BeMusicJudgeWindows,
  type BeMusicLaneKind,
  type BeMusicLongNote,
  type GameplayLayoutMode,
} from '@be-music/skin-sdk';
import { BeMusicGameplayBinding, resolveBeMusicSkinStage } from '../../skin/be-music/binding.ts';
import { SongImageCache } from '../../skin/be-music/song-images.ts';
import { PHANTOM_BOMB_DURATION_MS } from '../../skins/phantom/playfield.ts';
import {
  resolveDesignTextResolution,
  resolveScaledViewport,
  setDesignPixelRatio,
  setDesignTextResolution,
} from './viewport.ts';
import type { PixiGameplayResultData } from './result-data.ts';
import {
  TouchLaneTracker,
  canvasPointToDesign,
  hitTestTouchLane,
  isTouchPlayPointer,
  resolveTouchLaneZones,
  type TouchLaneChange,
} from './touch-lanes.ts';
import { logger } from '../../logger.ts';
import { QUIT_HOLD_KEY_CODE, QuitHoldController } from '../quit-hold.ts';
import { isChannelOnSide, prepareSong } from '../../session/play/play-chart.ts';
import {
  disposeGameplayAudioGraphAfterDelay,
  prepareAudio,
  prepareBga,
  samplePlaybackRate,
} from '../../session/play/play-media.ts';
import { resolveLaneGeometry, resolveSkinlessGameplayChromeRuntime } from '../../view/built-in/play-chrome.ts';
import { renderBombEffects, renderBombs } from '../../view/shared/playfield/bombs.ts';
import type { RuntimeMineNote, RuntimeNote } from '../../view/shared/playfield/context.ts';
import { renderLanes } from '../../view/shared/playfield/lanes.ts';
import { renderNotes } from '../../view/shared/playfield/notes.ts';
import { renderShutter } from '../../view/shared/playfield/shutter.ts';
import { renderText } from '../../view/shared/playfield/text.ts';
import type {
  GameplayBgaTarget,
  GameplayLaneRect,
  GameplayMeasureLineFrame,
  GameplayStageSize,
  GameplayThemeEvent,
  GameplayThemeHooks,
  GameplayThemeNoteCell,
  GameplayThemeNoteKind,
  GameplayThemeTiming,
} from './gameplay-theme.ts';

export type {
  GameplayBgaTarget,
  GameplayLaneRect,
  GameplayMeasureLineFrame,
  GameplayStageSize,
  GameplayThemeEvent,
  GameplayThemeNoteCell,
  GameplayThemeNoteKind,
  GameplayThemeTiming,
} from './gameplay-theme.ts';

const log = logger('gameplay');

const IDENTITY: SceneIdentity = { kind: 'play', family: 'built-in' };

/** Design px above a lane's top through which notes keep drawing as they scroll in (standard layout). */
const NOTE_OVERSCAN = 48;

/**
 * Fallback lane-laser release fade duration in ms. Themes can author a per-lane span through
 * {@link CoreGameplayView.resolveKeyOnFadeMs} (the LR2 family derives it from the skin's key-on keyframes); this
 * constant kicks in when a key-on slot has no themed span (skinless mode, or a slot the skin doesn't author). 120 ms
 * matches the LR2 default skin's typical key-on keyframe span and is a perceptually comfortable decay for auto-judge
 * feedback.
 */
export const KEY_ON_FADE_OUT_MS = 120;

/**
 * "Fully on" hold time before {@link CoreGameplayView.flashKeyOnTimer} hands the lane laser to the release-fade path.
 * Without this hold the sprite would only stay at peak alpha for the first frame (≈16 ms at 60 fps) before the fade
 * tween kicked in, which made auto-judged short-note flashes look like a single-frame blink. ~60 ms is enough to
 * register visually as a deliberate "tap" without lingering through the next note.
 */
const KEY_ON_FLASH_HOLD_MS = 60;

/** Default-family BGA rect: the fixed {@link BGA} square, drawn opaque and untinted. */
const DEFAULT_BGA_TARGET: GameplayBgaTarget = createDefaultBgaTarget(BGA);

function createDefaultBgaTarget(rect: { x: number; y: number; w: number; h: number }): GameplayBgaTarget {
  return {
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
    noBase: false,
    noLayer: false,
    noPoor: false,
    applyToSprite: (sprite) => {
      sprite.alpha = 1;
      sprite.tint = 0xffffff;
      sprite.blendMode = 'normal';
    },
  };
}

/** The LR2-compatible 640x480 canvas. */
const LEGACY_STAGE_SIZE: GameplayStageSize = { width: DESIGN_WIDTH, height: DESIGN_HEIGHT };
/** The 640x480 stage with the fixed default-family BGA square, for skins that declare no stage of their own. */
const LEGACY_STAGE: BeMusicStage = { ...LEGACY_STAGE_SIZE, resolveBgaRect: () => ({ ...BGA }) };

const DEFAULT_THEME_TIMING: GameplayThemeTiming = {
  loadEndOffsetMs: 0,
  playStartOffsetMs: 0,
  fadeOutMs: 0,
  closeMs: 0,
};

/**
 * Scene transitions for be-music skins: the play screen fades up from black as it appears (every select outro ends
 * dark) and fades back to black, with the audio, before the result or select screen takes over — instead of cutting
 * in and out mid-animation.
 */
const BE_MUSIC_ENTER_FADE_MS = 400;
const BE_MUSIC_THEME_TIMING: GameplayThemeTiming = { ...DEFAULT_THEME_TIMING, fadeOutMs: 450 };

/**
 * Constructor options shared by every gameplay family. Theme families (LR2, …) extend this with their own skin fields;
 * everything here reaches the same engine / audio / BGA pipeline regardless of which family paints the chrome.
 */
export interface CoreGameplayViewOptions {
  /**
   * Skinless chrome renderer supplied by another skin family. When omitted the scene falls back to the be-music skin's
   * own `gameplay.renderChrome`.
   */
  skinlessChromeRenderer?: SkinlessGameplayChromeRenderer;
  /**
   * be-music skin for everything the scene paints itself: lanes / notes / long notes / bombs whenever no theme
   * supplies them, and (when `skinlessChromeRenderer` is omitted) the skinless HUD chrome. Defaults to the built-in
   * Phantom skin.
   */
  beMusicSkin?: BeMusicSkin;
  /** Showmanship level for the be-music skin (count-ins, shakes, particles). Defaults to `'full'`. */
  beMusicEffects?: BeMusicEffectLevel;
  /**
   * Gameplay layout for the be-music skins. `'touch'` (for touch screens) spreads the lanes across most of the stage
   * with a low judgement line and (on a landscape stage) no BGA; the 24 / 48 KEY modes, themes, and a host
   * `skinlessChromeRenderer` keep the standard layout regardless. On a portrait screen a skin with a portrait stage
   * plays 5 / 7 / 9 KEY charts on it, in either mode. Defaults to `'standard'`.
   */
  layoutMode?: GameplayLayoutMode;
  /**
   * The player's stored values for the be-music skin's `settings`, keyed by setting id. They are checked against the
   * skin's schema (`resolveBeMusicSkinSettings`: unknown ids dropped, invalid values replaced by the default, numbers
   * clamped) and handed to the skin as `frame.settings`. Omit it to draw with the skin's defaults; change it live with
   * `setBeMusicSkinSettings`.
   */
  beMusicSkinSettings?: Readonly<Record<string, unknown>>;
  onExit?: () => void;
  /**
   * Restart hook. Fired when the player presses the restart hotkey (`R` by default) — host should dispose this view and
   * mount a fresh one with the same song. The view itself can't recreate its `Application` cleanly, so re-mount is the
   * host's job.
   */
  onRestart?: () => void;
  /**
   * Natural-end hook. Fires once when the chart has finished playing (every playable note judged + a small audio tail
   * buffer). The snapshot is the same payload {@link CoreGameplayView.getResultData} returns — passed eagerly so the
   * host doesn't have to reach back into the soon-to-be-disposed gameplay view to read it. When this hook is supplied,
   * `onExit` is **not** called for natural completion; `onExit` is reserved for the user-initiated escape (ESC). Hosts
   * that don't want a result screen can leave this unset and rely on `onExit` for both paths (legacy behavior).
   */
  onChartFinished?: (result: PixiGameplayResultData) => void;
  /** When true, every note is auto-judged as PERFECT at its scheduled time. */
  autoPlay?: boolean;
  /**
   * When true, the gameplay automatically pauses on tab visibility change (`document.hidden`) and window blur, and
   * auto-resumes on focus / `pageshow`. When false (the default), the play scene keeps running in the background —
   * convenient for capturing recordings while another window holds focus, and matches the "no surprise pauses"
   * behavior most rhythm-game hosts ship.
   */
  autoPauseOnBlur?: boolean;
  /**
   * Initial visual scroll-speed multiplier. Mirrors the live runtime hotkey (`ArrowUp` / `ArrowDown` adjusts this value
   * during play); the option lets the host seed it from the select-screen play-options panel so the user doesn't have
   * to re-dial their preferred HS at every song. Clamped to [`HISPEED_MIN`, `HISPEED_MAX`] internally; defaults to 1.5.
   */
  initialHiSpeed?: number;
  /**
   * Fires when the player changes the hi-speed during play (`ArrowUp` / `ArrowDown`), with the new value on the same
   * scale as {@link initialHiSpeed} — before any HS-FIX rescaling — so a host can remember it and seed the next play
   * with it. Not fired for {@link CoreGameplayView.setHiSpeed} writes, which come from the host.
   */
  onHiSpeedChange?: (hiSpeed: number) => void;
  /**
   * BGA display mode picked from the LR2 panel-1 BGA toggle (`#SRC_BUTTON,type=72`). Defaults to `'ON'` so charts that
   * ship a BGA render it by default. With `'OFF'` the BGA layer stays empty for the entire play; with `'AUTOPLAY_ONLY'`
   * the BGA only shows when {@link autoPlay} is also true.
   */
  bga?: 'OFF' | 'ON' | 'AUTOPLAY_ONLY';
  /**
   * BGA frame size picked from `#SRC_BUTTON,type=73`. NORMAL uses the skin's default `#DST_BGA` rect (op 30); EXTEND
   * chooses the larger variant (op 31). Defaults to NORMAL.
   */
  bgaSize?: 'NORMAL' | 'EXTEND';
  /**
   * Score-graph display flag picked from `#SRC_BUTTON,type=70`. Drives ops 38 (off) / 39 (on) on the gameplay runtime
   * so the skin's score-prediction line chrome (gated on op 39) shows when enabled. Defaults to `false` to mirror the
   * LR2 default.
   */
  scoreGraph?: boolean;
  /**
   * HS-FIX mode picked from `#SRC_BUTTON,type=55`. Applied as a one-time multiplier on `initialHiSpeed` at
   * chart-prepare time so the user's chosen HS feels consistent across BPM changes. `'CONSTANT'` falls back to
   * `'AVERAGE'` for now — true per-frame BPM-aware scrolling needs a render-pipeline change that hasn't landed yet.
   */
  hsFix?: 'OFF' | 'MAXBPM' | 'MINBPM' | 'AVERAGE' | 'CONSTANT';
  /**
   * HIDDEN / SUDDEN / HID+SUD effect picked from `#SRC_BUTTON,type=50/51`:
   *
   * - `OFF` — no mask
   * - `HIDDEN` — bottom of the playfield is masked (notes disappear before reaching the judge line)
   * - `SUDDEN` — top of the playfield is masked (notes appear suddenly partway down)
   * - `HID+SUD` — both
   *
   * Defaults to `'OFF'`.
   */
  hiddenSudden1P?: 'OFF' | 'HIDDEN' | 'SUDDEN' | 'HID+SUD';
  hiddenSudden2P?: 'OFF' | 'HIDDEN' | 'SUDDEN' | 'HID+SUD';
  /**
   * Shutter coverage (0..1) — how much of the playfield each active mask occupies. `0.25` covers the bottom 25 % for
   * HIDDEN, the top 25 % for SUDDEN, and 25 % at each end for HID+SUD. Drives slider `type=4 / 5` on the panel-1
   * shutter track. Defaults to `0.25`.
   */
  shutter?: number;
  /**
   * LANE COVER ON / OFF toggle (LR2 button_type 46). When true, the gameplay-side mask renders at `shutter`'s
   * configured height. When false, the mask is suppressed regardless of `shutter` — preserves the user's last height
   * across toggles so they don't have to redial it after re-enabling.
   */
  laneCover?: boolean;
  /**
   * 1P side auto-scratch flag — when true, the scratch lane (channel 16) auto-judges as PERFECT at every note's
   * scheduled time even when {@link autoPlay} is off. The player only has to play the keys.
   */
  autoScratch1P?: boolean;
  /** 2P side auto-scratch (channel 26). */
  autoScratch2P?: boolean;
  /**
   * DP FLIP — when true, swaps every note's 1P / 2P channel at chart-prepare time. Only DP charts have notes on both
   * sides so SP charts are unaffected. Mirrors LR2's `#SRC_BUTTON,type=54`.
   */
  dpFlip?: boolean;
  /**
   * Note-arrangement mode for the 1P keyboard lanes (`#SRC_BUTTON,type=42`). Applied at chart-prepare time so the
   * shuffle is consistent across the play session — pressing F5 (restart) reuses the same `random1P` value but draws a
   * fresh permutation.
   */
  random1P?: 'OFF' | 'MIRROR' | 'RANDOM' | 'S-RANDOM' | 'SCATTER';
  /** 2P side note arrangement (`#SRC_BUTTON,type=43`). */
  random2P?: 'OFF' | 'MIRROR' | 'RANDOM' | 'S-RANDOM' | 'SCATTER';
  /**
   * Replay playback: a recorded play-log to re-drive instead of live keyboard input. The chart prepare skips the
   * usual DP-flip / lane-shuffle passes and re-applies the RECORDED arrangement (`applyPlaylogArrangement`), the
   * engine consumes `playlog.inputs` deterministically (`PlayerOptions.replayInputs`), live lane input is ignored,
   * and no new play-log is recorded for the run. The chart's `#RANDOM` / `#SWITCH` lines take the log's
   * `play.randomDraws`, so the replay plays the recorded branches. `prepare` rejects when the loaded chart does not
   * match the log (draws that were not drawn for its control flow, a log without draws whose branches differ, or a
   * different chart file).
   */
  replay?: BeMusicPlaylog;
  /**
   * Which of the view a {@link replay} recorded (`play.view` / `play.viewChanges`) it shows over the viewer's own
   * settings: the hi-speed, SUDDEN+ / HIDDEN+, the lift (this scene has none to show) and the tempo. Defaults to all
   * (`DEFAULT_PLAYLOG_VIEW_REPLAY`).
   */
  replayView?: Readonly<PlaylogViewReplay>;
  /**
   * Judge-window ruleset for the shared engine (`PlayerOptions.judgeRuleset`): `'lr2'` (default) / `'beatoraja'`
   * / `'iidx'`. Recorded into the play-log; replays re-apply the log's own value instead.
   */
  judgeRuleset?: PlaylogRulesetId;
  /**
   * SHA-256 (lowercase hex) of the source chart file bytes, when the host computed one. Stamped into the recorded
   * play-log (`chart.sha256`) so a dropped log can be matched back to its chart by content.
   */
  chartSha256?: string;
  /** MD5 (lowercase hex) of the same bytes, stamped as `chart.md5` (the key LR2 and LR2IR use). */
  chartMd5?: string;
  /** Host application stamped into the recorded play-log's `recorder` (the engine adds its own version). */
  playlogRecorder?: PlaylogRecordingOptions['recorder'];
  /**
   * 1P gauge variant (`#SRC_BUTTON,type=40`). Selects the ruleset's gauge (the engine resolves the curve) and drives
   * the gauge-on-red-branch op flags (43 / 45). 2P-side gauge isn't yet separately wired — the engine
   * consumes the 1P value and applies it to the single shared gauge.
   */
  gauge?: GaugeType;
  /**
   * The play is one stage of a course (`PlayerOptions.course`): it runs on the ruleset's course gauge, from the state the
   * previous stage left. Recorded into the play log, which then replays on its own.
   */
  course?: PlaylogCourseStage;
  /**
   * The running course as the skin shows it — its kind, title, stage list and the stage being played (LR2 ops 280-293,
   * texts 150-170; beatoraja's course strings). Display only; the judging follows {@link course}.
   */
  courseInfo?: SceneCourseInfo;
  /**
   * The chart is a stitched NONSTOP course (`stitchNonstopCourse`'s map): each stage's samples play at its FIT rate
   * and its background sound fades at the stage seams.
   */
  nonstop?: NonstopStitchMap;
  /**
   * The play tempo, 0.5 to 1.5 (`clampPlayTempo`; default 1): the play clock, its audio, the scroll, the BGA and the
   * chart-time lead-out run `tempo` times as fast, while judging stays in chart time (the engine's `speed`). A replay
   * plays at the tempo its log recorded (`play.tempo`) instead. A NONSTOP FIT stage's rate multiplies with it. In `pitch`
   * mode it can change during the play ({@link CoreGameplayView.setTempo}).
   */
  tempo?: number;
  /** Fires when the play tempo changed during the play (`setTempo`, or a replay following its log), with the new one. */
  onTempoChange?: (tempo: number) => void;
  /**
   * How a tempo change sounds, for {@link tempo} and NONSTOP FIT stages alike: `pitch` (default, as LR2) plays the
   * samples faster or slower, `keep-pitch` stretches them to the new tempo when they load and keeps their pitch.
   */
  tempoPitchMode?: TempoPitchMode;
  /** The time stretcher keep pitch uses: `signalsmith` (default, Signalsmith Stretch) or `wsola`. */
  tempoStretchAlgorithm?: TimeStretchAlgorithm;
  /** The hi-speed cannot be changed during play (a course's `no_speed` constraint). */
  hiSpeedLocked?: boolean;
  /**
   * When true (default), the audio bus runs through dynamics compressors that soften clipping when many BMS samples
   * fire simultaneously (jacks, dense BGM stacks). Set to `false` to bypass every compressor and feed sample sources
   * directly to `audioContext.destination`.
   *
   * Equivalent to `audioCompressorMode === 'off'` when `false`. When `true` (or omitted), the active mode comes from
   * `audioCompressorMode` (defaults to `'split'`).
   */
  audioCompressor?: boolean;
  /**
   * Compressor architecture when `audioCompressor` is enabled.
   *
   * - `'split'` (default) — separate compressors on the key / BGM buses plus a master limiter; key bus tuned
   *   aggressively for transient peaks, BGM bus tuned for musical glue, master for clip protection. Prevents BGM
   *   ducking under dense input bursts (a known failure mode of the legacy single-bus compressor).
   * - `'legacy'` — original single-compressor topology, kept for A/B comparison via the demo's `?compressor=legacy` URL
   *   flag so behavior can be diff-tested directly.
   *
   * `'off'` is reachable via `audioCompressor: false` rather than being a valid value here — `audioCompressor` is the
   * user- facing toggle, this option only chooses **which** compressed topology to use when compression is on.
   */
  audioCompressorMode?: 'split' | 'legacy';
  /**
   * Initial per-stage on/off flags for the split-bus architecture. Defaults to all `true` (every stage engaged). Hosts
   * that surface a UI for per-stage bypass should pass the current UI state here so the bus comes up matching the
   * visible selection — otherwise the user's stage choices on the select screen would be silently reset every gameplay
   * re-mount.
   */
  audioCompressorStages?: { key?: boolean; bgm?: boolean; master?: boolean };
  /**
   * Initial user volume per source bus — `key` (player keysounds) and `bgm` (auto-triggered BGM) — as linear gains
   * (1 = unity, clamped to `0..2`). Hosts with volume sliders pass the current UI values so a re-mounted gameplay keeps
   * the user's balance; {@link CoreGameplayView.setAudioVolume} changes them live.
   */
  audioVolumes?: { key?: number; bgm?: number };
  /**
   * Parameter overrides per compressor (`key` / `bgm` / `master` in split mode, `legacy`), merged over the factory
   * tuning. {@link CoreGameplayView.setAudioCompressorParams} retunes them live.
   */
  audioCompressorParams?: Partial<Record<TunableCompressor, Partial<CompressorParams>>>;
  /**
   * When set to a positive integer, BGA videos that need the ffmpeg.wasm fallback (legacy `.mpg` / `.wmv` / `.avi` /
   * unsupported codecs) are downscaled during transcode so neither edge exceeds this many pixels. Aspect ratio is
   * preserved.
   *
   * Single-threaded libx264 cost scales linearly with pixel count, so capping at 720 / 480 / etc. is the biggest
   * single-threaded speed lever once `-preset ultrafast` is in effect. Visual parity holds well under nearest-filter
   * scaling because the BGA layer is rendered into a 256-px spec canvas.
   *
   * `undefined` / `0` / negative values disable the cap and the source resolution passes through unchanged (the default
   * behavior).
   */
  bgaTranscodeMaxLongEdgePx?: number;
  /**
   * When true, the BGA transcode fallback uses the browser's WebCodecs `VideoEncoder` API instead of libx264 in
   * ffmpeg.wasm. The decode step still goes through ffmpeg because WebCodecs' `VideoDecoder` doesn't speak the legacy
   * codecs (MPEG-1, VC-1, etc.) BMS BGA usually ships in.
   *
   * Hardware-accelerated where the browser exposes a platform encoder — typically a 5–20× encode-side speedup. Silently
   * falls back to the ffmpeg-only path when the browser doesn't support WebCodecs, the encoder rejects the configured
   * parameters, or the raw decoded frames would exceed the in-memory budget.
   */
  bgaTranscodeUseWebCodecs?: boolean;
  /**
   * Debug overlay — when true, the renderer paints a thin green bar at every invisible / keysound note's chart position
   * (BMS channels `3x` / `4x`, the chart author's hidden keysound layout). The bars never affect gameplay or judgement;
   * they're a chart-inspection aid for verifying which lane each `#WAV` sample is wired to. Defaults to `false` so the
   * regular play surface stays uncluttered.
   */
  showInvisibleNotes?: boolean;
  /**
   * Single-note visibility after judgement.
   *
   * - `'KEEP_SCROLLING'` (default) — a judged note stays on screen until its own time: one hit early keeps scrolling
   *   down to the judgement line and goes when it reaches it. This is what LR2 (`DrawNotes` draws a hit note until the
   *   playhead reaches it) and beatoraja (`LaneRenderer` draws a note while its time is ahead, judged or not) both do.
   * - `'HIDE'` — a judged note goes the moment it is judged, which neither player does; kept as a preference for a
   *   cleaner playfield in dense passages.
   *
   * Only tap notes are gated. Long notes stay until their end either way, so this option doesn't disturb them.
   */
  judgedNoteDisplay?: 'KEEP_SCROLLING' | 'HIDE';
}

export interface CoreGameplayDisposeOptions {
  /**
   * Natural chart end can transition visually to result while a long final sample still rings out. Keep the Web Audio
   * graph alive briefly in that path instead of closing the AudioContext as part of visual teardown.
   */
  preserveAudioTail?: boolean;
}

/**
 * Family-neutral gameplay scene: engine driver, input, judging, Web Audio, BGA compositing, lane geometry, note / LN /
 * bomb / lane drawing through the be-music skin, skinless chrome, pause / restart / exit, recording, and result data.
 *
 * Theme families (the LR2 family's `PixiGameplayView`) extend this class and override the `protected` theme hooks —
 * `prepareTheme`, `renderThemeLayer`, `collectBgaTargets`, `resolveThemeLaneRect`, `resolveThemeNoteCell`,
 * `renderThemeMeasureLines`, `renderThemeText`, `renderBombEffects`, `themeTiming`, `onThemeEvent`, … — each of which
 * defaults to the skinless behaviour, so the class paints a complete scene on its own.
 *
 * The play's parts live in their own modules (`session/play/*`, `view/shared/*`, `view/built-in/*`), which take the
 * scene as their context and read and write its state through their own interfaces (`PlayChartContext`,
 * `PlayfieldContext`, …). That state has no `private` / `protected` modifier so the scene satisfies those interfaces;
 * it is not part of the scene's API. The theme hooks stay `protected`; the modules call them through {@link theme}.
 */
export class CoreGameplayView<TOptions extends CoreGameplayViewOptions = CoreGameplayViewOptions> implements PixiScene {
  /**
   * The host that owns the underlying `Application`. Set by {@link prepare} or {@link enter}, whichever runs first;
   * before that, accessing `this.app` throws. See `PixiSceneHost` for the single-Application architecture rationale.
   */
  private host: PixiSceneHost | undefined;
  /**
   * Top-level Container the scene host attaches to its `app.stage` while gameplay is active. All visible nodes
   * (`viewportBackground` + `designRoot`) live as children of this root, so the host can attach / detach the whole
   * gameplay subtree as one operation.
   */
  public readonly root: Container = new Container();
  private readonly designRoot = new Container();
  /**
   * Clip mask for the design rect — sits as a child of `designRoot` so the same `position` / `scale` transform applies
   * to it as the sprites it clips. Pixi uses the mask's world-space bounds to decide what's visible; with the mask
   * drawn at `(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT)` in design space, the post-transform bounds match the on-screen
   * design rectangle exactly, and any sprite that animates in from off-canvas (LR2 default's `#DST_IMAGE,...,758,0,...`
   * slide-ins, etc.) gets clipped at the design edge instead of bleeding into the pillarbox / letterbox of a screen with
   * a different aspect ratio.
   */
  private readonly designClipMask = new Graphics();
  /** Layout last handed to the be-music chrome, keyed by the lane set it was built for. */
  private beMusicLayout:
    | {
        channels: readonly string[];
        variant: ChartPlayVariant | undefined;
        stage: BeMusicStage;
        layout: BeMusicGameplayLayout;
      }
    | undefined;
  /** Design size the clip mask and design background were last drawn at (the stage can change with the screen). */
  private stampedDesignWidth = -1;
  private stampedDesignHeight = -1;
  /** BGA target for the be-music stage, rebuilt only when the rect moves (see {@link collectBgaTargets}). */
  private stageBgaTarget: GameplayBgaTarget | undefined;
  /**
   * Cached screen / design dimensions baked into the static graphics (`viewportBackground`, `background`,
   * `designClipMask`). Compared against the per-frame values so we only call `.clear().rect().fill()` when the size
   * actually changes — Pixi v8 rebuilds the GraphicsContext on every chain, and redrawing identical rects every rAF
   * tick was a noticeable contributor to gameplay frame time on dense charts.
   */
  private cachedScreenWidth = -1;
  private cachedScreenHeight = -1;
  private readonly viewportBackground = new Graphics();
  private readonly background = new Graphics();
  /**
   * BGA composite layer. Sits below `skinLayer` so the skin's "BGA frame" decoration draws on top, and above
   * `background` so the BGA is visible inside the play screen. One `Sprite` per layer (base / layer1+2 / POOR override)
   * is reused frame-to-frame to avoid Pixi child churn.
   */
  protected readonly bgaLayer: Container = new Container();
  protected readonly skinLayer: Container = new Container();
  readonly laneLayer = new Graphics();
  private readonly noteLayer = new Container();
  /**
   * Shutter mask layer. Sits above `noteLayer` so the dark rectangles drawn here cover the scrolling notes underneath
   * but stay below the judgement-line / HUD overlays. Cleared and redrawn every frame from `playOptions.hiddenSudden` +
   * `playOptions.shutter`.
   */
  readonly shutterLayer = new Graphics();
  private readonly bombLayer = new Container();
  /**
   * Sits above `noteLayer` / `bombLayer` and below `textLayer`. Holds the chrome that should visually punch through the
   * note stream: the judgement plate, NOWCOMBO digits, and the AUTOPLAY indicator.
   */
  protected readonly overlayLayer: Container = new Container();
  private readonly textLayer = new Container();
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
  protected skinLayerPool: ChildPool = new ChildPool(this.skinLayer);
  protected overlayLayerPool: ChildPool = new ChildPool(this.overlayLayer);
  readonly textLayerPool: ChildPool = new ChildPool(this.textLayer);
  readonly bombLayerPool: ChildPool = new ChildPool(this.bombLayer);
  readonly bgaLayerPool = new ChildPool(this.bgaLayer);
  readonly overlay = new Text({
    text: '',
    style: new TextStyle({
      fill: 0xf8fafc,
      fontSize: 22,
      fontWeight: '700',
      align: 'center',
      fontFamily: CORE_TEXT_FONT,
    }),
  });
  song: BrowserSongEntry | undefined;
  source: BrowserSongAssetSource | undefined;
  /**
   * The chart's `#RANDOM` / `#IF` control flow resolved for THIS play session. `song.chart` is the raw parsed JSON
   * (kept for metadata stability), but every gameplay-time consumer — note extraction, timing resolver, sample
   * triggers, BGA timeline, measure walk — reads `resolvedChart` so the rolled random branches actually take effect.
   * Without this step BMS charts using `#RANDOM` / `#SETRANDOM` / `#SWITCH` either omit every conditional section or
   * include them all (depending on parser default), neither of which matches LR2 behavior.
   */
  resolvedChart: BeMusicJson | undefined;
  /**
   * The Resolved layer of {@link resolvedChart} (`resolveChart`): its notes, tempo map, triggers, SCROLL / SPEED
   * keyframes, bar lines and BGA cues are what this scene and the engine play.
   */
  resolvedPlayChart: ResolvedChart | undefined;
  /** The `#RANDOM` / `#SWITCH` draws {@link resolvedChart} was resolved with; handed to the engine with it. */
  randomDraws: RandomDraws | undefined;
  /**
   * `seconds → beat` resolver that properly accounts for `#STOP` windows. During a STOP, this returns the same beat
   * across the window's duration so the playfield freezes in place. Without it the previous hand-rolled `currentBeat`
   * extrapolation would scroll notes through STOP zones at the prevailing BPM, breaking many BMS arrangements that lean
   * on STOP for visual emphasis.
   */
  beatAtSeconds: ((seconds: number) => number) | undefined;
  /**
   * Distance integrator that consumes `#SCROLL` and `#SPEED` events. Note Y positions are computed as `lane.bottom -
   * distanceBetween(currentBeat, note.beat) * pixelsPerBeat` instead of `(note.beat - currentBeat) * pixelsPerBeat`,
   * so: - `#SCROLL,2` doubles the local scroll rate (notes pass twice as fast), - `#SCROLL,-1` reverses the scroll
   * direction (notes scroll backwards through the playfield), and - `#SPEED` lerps the visual speed between control
   * points. Falls back to plain beat-difference math when no scroll/speed events are present.
   */
  scrollMapper: ScrollDistanceMapperLike | undefined;
  /** Beats of the chart's lane timelines, for the last timeline beatoraja's rules draw past the lane top. */
  laneTimelineBeats: Float64Array = new Float64Array(0);
  /**
   * Engine's `preparePlaybackChartData` result, computed once during {@link prepareSong} and forwarded to the
   * shared engine via `engineOptions.preparedChart`. Holds the canonical `notes` / `landmineNotes` /
   * `invisibleNotes` arrays the renderer points at (`this.notes` / `this.mineNotes` / `this.invisibleNotes`
   * are the same instances), so any mutation the engine performs on a note's `judged` flag is automatically
   * visible to the renderer with no separate sync step. `undefined` until the song has been prepared.
   */
  preparedChart: PreparedPlaybackChartData | undefined;
  notes: RuntimeNote[] = [];
  /**
   * Landmine notes (channels D1-D9 / E1-E9). Sorted by `seconds` for the same binary-search-by-time access pattern the
   * playable-note judge loop uses. Hit-test runs in `judge()` BEFORE the playable-note check so a press that lands
   * inside the BAD window of both a mine and a regular note prefers the mine — matches LR2 behavior where the mine
   * explodes first.
   */
  mineNotes: RuntimeMineNote[] = [];
  /**
   * Invisible / keysound notes (BMS channels `3x` / `4x`). Held separately from {@link notes} because they don't
   * participate in scoring or judgement — they exist purely so a press on the matching lane fires the per-note `#WAV`
   * sample. The extractor already remaps `3x → 1x` / `4x → 2x` so each entry's `channel` lines up with the playable
   * lane it shares.
   *
   * Populated only when {@link CoreGameplayViewOptions.showInvisibleNotes} is on — this is a debug visualization, not
   * gameplay state. The renderer paints a thin green bar per entry so the chart author's hidden keysound layout is
   * legible alongside the regular note stream.
   */
  invisibleNotes: TimedPlayableNote[] = [];
  maxLongNoteBeatSpan = 0;
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
  readonly goneDrawObjects = new GoneDrawObjects();
  chartLastNoteEndSeconds = 0;
  songDurationSeconds = 0;
  laneChannels: string[] = [];
  /**
   * Cached `resolveChartPlayVariant` result for the loaded chart. Used to pick the right per-variant theme layout (LR2
   * `play_<variant>` skin, keymode op 160..164), and to switch lane-channel detection to the PMS layout (`17` is a lane
   * note, `22..25` are 1P-side lanes) instead of the default IIDX layout. Defaults to `'7'` before any chart is loaded so the existing
   * 7K-flavored fallbacks keep behaving as before for skinless / pre-prepare code paths.
   */
  chartPlayVariant: ChartPlayVariant = '7';
  laneX: Map<string, GameplayLaneRect> = new Map();
  /**
   * Theme texture cache, keyed by the theme's own asset ids. The core scene never reads it; theme families fill it in
   * {@link prepareTheme} and the core destroys every entry on {@link dispose}.
   */
  protected textures: Map<string, Texture> = new Map();
  /**
   * `playClock()` value captured at `start()`. Theme animations (LR2 timer 0/40/41 — scene-start / READY / play-start)
   * anchor here so the intro slide-ins, scratch turntable rotation, and similar visuals play from the
   * moment the gameplay view appears, not from the moment notes begin scrolling.
   */
  protected sceneStartTime = 0;
  /** Intro length scheduled by `start()` (theme `#PLAYSTART` or the fallback), for chrome count-ins. */
  private scheduledIntroMs = 0;
  /** Play-clock time of the last judgement / key impulse, for the be-music skin's reactive visuals. */
  lastJudgeAt: number | undefined;
  lastImpulseAt: number | undefined;
  lastImpulseKind: BeMusicLaneKind | undefined;
  private startTime = 0;
  /**
   * True while the chart's assets are still loading: from {@link prepare} until audio is decoded and the BGA preload
   * (which may be transcoding video) has settled. Skins show it as NOW LOADING on the lanes.
   */
  assetsLoading = false;
  /**
   * Between {@link enter} and {@link exit}: the input listeners are attached, and a {@link prepare} running meanwhile
   * shows the playfield (in its loading state) instead of loading off stage.
   */
  private entered = false;
  /** Whether {@link exit} stopped a running render loop, for the next {@link enter} to resume. */
  private resumeAnimationOnEnter = false;
  /**
   * `audioContext.currentTime` value that corresponds to chart-second 0. Used to schedule background samples with
   * sample-accurate Web Audio timing.
   */
  audioContextStartTime = 0;
  /** The stage fades and FIT rates of a stitched NONSTOP chart (`options.nonstop`). */
  nonstopMixer: NonstopStageMixer | undefined;
  /**
   * The play tempo in force ({@link CoreGameplayViewOptions.tempo}, or a replay's recorded one, then every live change):
   * chart seconds per clock second.
   */
  tempo: number;
  /** The tempo a replay plays at and the changes it follows (`resolveReplayTempo`). */
  private readonly replayTempo: ReplayTempo | undefined;
  /**
   * The play tempo over the view's clock (seconds since `audioContextStartTime`, in ms): re-anchored at the chart second
   * of every change the engine reports, so the view's chart time stays the engine's.
   */
  private tempoClock: TempoClock;
  /** The live tempo changes asked for ({@link setTempo}), pushed to the engine (held until its input bus is up). */
  private readonly liveTempo: LiveTempo;
  paused = false;
  private pauseTime = 0;
  private pauseTotal = 0;
  /**
   * Idempotency / re-entrancy guard for {@link dispose}. ESC → `onExit` → `showSelect` → `dispose` is fine on a single
   * press, but a quick double-tap (or a chart-end `setTimeout` racing the keypress) used to fire `dispose` twice and
   * crash on the second pass when `app` was already torn down. Now the second call short-circuits immediately.
   */
  disposed = false;
  audioContext: AudioContext | undefined;
  /**
   * Audio routing handle. Owns two stable mixers (`keyMixer` for player-input keysounds, `bgmMixer` for auto-triggered
   * BGM) plus the per-bus and master compressor stages. Sample sources connect to the appropriate mixer; the bus's
   * `setMode` method swaps the downstream wiring without disturbing those source- side connections.
   *
   * See `audio-bus.ts` for the architecture and per-mode topology.
   */
  audioBus: AudioBusHandle | undefined;
  /** Analyser tapped off the bus output; feeds audio-reactive be-music skins. */
  audioAnalyzer: AudioAnalyzer | undefined;
  /** This frame's audio features (sampled once per render, on the play clock). */
  audioFrame: AudioFeatures | undefined;
  /**
   * Most-recently-applied compressor mode. Distinct from the bus's `mode` getter so we can decide what to flip back to
   * when `setAudioCompressor(true)` re-enables compression after a temporary `'off'` (we restore whatever
   * `audioCompressorMode` the constructor / URL flag selected).
   */
  audioCompressorMode: CompressorMode = 'split';
  /** Compressor tuning overrides, seeded from the options and kept across audio-bus rebuilds. */
  audioCompressorParams: Partial<Record<TunableCompressor, Partial<CompressorParams>>> = {};
  /** User keysound / BGM bus volumes, seeded from the options and kept across audio-bus rebuilds. */
  audioVolumes: Record<AudioBusChannel, number> = { key: 1, bgm: 1 };
  /**
   * Active recorder (canvas video + audio bus tap → WebM blob) when the host has started a recording session via {@link
   * startRecording}. `undefined` while idle. We hold the instance across the play session so `stopRecording` /
   * `dispose` can finalize cleanly even if the chart ends mid- recording.
   */
  private recorder: GameplayRecorder | undefined;
  /**
   * Web Audio session built in {@link prepareAudio} once `decodedSamples` and `wavCmdVolumeMultipliers` are
   * populated. Owns every sample-playback path the view used to manage in-tree (player keysound triggers, BGM
   * scheduled triggers, landmine explosion, bmson `c=true` continuation, `#WAVCMD` per-slot gain, dynamic
   * `#xxx97` / `#xxx98` volume changes). The view simply forwards `event` payloads to it; the session decides
   * routing (`keyMixer` / `bgmMixer`), gain splicing, and lifecycle (`stopChannel` for engine-driven LN early
   * release in Phase 4b-ii). Stays `undefined` until `prepareAudio` finishes — every call site guards.
   */
  webAudioSession: WebAudioSession | undefined;
  /**
   * Promise returned by {@link runEngineDriver} once the shared-engine play loop is in flight. `undefined` while
   * the driver hasn't started yet (engine launches at the same chart-start moment the LR2 PLAYSTART gate fires)
   * and after `dispose` triggers a clean abort. Used here only as a "have we already launched" guard so a
   * re-entered `start()` (defensive) doesn't kick off a second engine in parallel.
   */
  private sharedEnginePromise: Promise<unknown> | undefined;
  /**
   * Forwarded into the engine via `PlayerOptions.signal`. Aborted from {@link dispose} so the engine's
   * `throwIfAborted` checks unwind cleanly instead of leaving the playback loop running on a torn-down audio bus.
   */
  private sharedEngineAbortController: AbortController | undefined;
  /**
   * Holds the engine's play open past the chart's end (`holdAfterChart`), so keys keep lighting the lanes through the
   * result delay and the fade-out; aborted when the outro is over, which lets the play end and hand over its summary.
   */
  private chartEndHold: AbortController | undefined;
  /** Set while the outro waits for the held play to end: receives its final summary. */
  private onHeldPlayEnded: ((summary: Readonly<PlayerSummary>) => void) | undefined;
  /**
   * Latch for the engine's `stateSignals.judgeComboTick`. {@link drainWebUiSignals} compares the current tick
   * value against this latch on every poll and only fires the host's `onJudgeCombo` callback when a fresh
   * judge / combo update has landed since the last drain.
   */
  private sharedEngineLastJudgeComboTick = 0;
  /** Bus references handed back from the engine via `onSignalsReady`. Drained per-frame from {@link tick}. */
  private sharedEngineSignals: { uiSignals: PlayerUiSignalBus; stateSignals?: PlayerStateSignals } | undefined;
  /**
   * Engine-side `inputSignals` bus captured during the input runtime's `onReady` hook. The view's own
   * \`togglePause\` (Space-key handler + visibility/blur auto-pause) pushes \`{ kind: 'toggle-pause' }\` here so
   * the engine's playback clock pauses in lock-step with the view's \`paused\` flag — without the propagation,
   * the engine would keep advancing chart-time during the pause and fast-forward a burst of judges the moment
   * the view resumed.
   */
  private sharedEngineInputSignals: PlayerInputSignalBus | undefined;
  /**
   * The interrupt the view sent the shared engine (ESC / F5 / teardown), once sent. The engine only reads its abort
   * signal at launch, so a play left mid-chart must be interrupted through its input bus: that ends the engine's loop
   * and, for ESC, records the play log as given up (`play.aborted`), which {@link waitForPlaylog} hands the host.
   */
  private sharedEngineInterrupt: 'escape' | 'restart' | undefined;
  /** True once the shared engine settled the chart (every note judged) and holds the play open for the outro. */
  private sharedEngineChartSettled = false;
  /** Which lane each finger on the canvas holds (touch play). */
  private readonly touchLanes = new TouchLaneTracker();
  /** Input token a touch on each lane channel presses, from the chart's lane bindings (built on the first touch). */
  touchTokenByChannel: Map<string, string> | undefined;
  /** The canvas `touch-action` before this scene set it to `none`, restored on dispose. */
  private previousCanvasTouchAction: string | undefined;
  /**
   * Latch flipped on the first non-zero `frame.currentSeconds` from the engine. The view's
   * `audioContextStartTime` is re-anchored at that moment so the renderer's chart-time matches what the engine
   * judges against — without this snap, the engine's `playbackClock` (which anchors at the moment it's
   * constructed inside `manualPlay`'s prepare phase) sits a few ms to a few hundred ms behind the view's
   * PLAYSTART anchor and notes pass the judgment line ahead of the engine's actual judge event.
   */
  private sharedEngineClockAnchored = false;
  decodedSamples = new Map<string, AudioBuffer>();
  /**
   * Per-`#WAVxx` slot volume multipliers from `#WAVCMD 01 xx vv` lines, expressed as 0..1 linear gain. Built once per
   * chart by {@link prepareSong} via the shared `collectChartVolumeMultipliers` helper, looked up on every
   * `playSample` / `playSampleByKey` so a slot with no `#WAVCMD` directive returns `undefined` and the fast path (no
   * extra GainNode) takes over.
   *
   * Pitch / loop bytes (`pp = 00` / `02`) are intentionally NOT collected here: they require sample-graph rewiring
   * (playbackRate, loopStart / loopEnd) which the current pipeline doesn't surface yet — see the spec audit. Volume is
   * the dominant in-the-wild use of `#WAVCMD`, so this already covers the common case.
   */
  wavCmdVolumeMultipliers = new Map<string, number>();
  /**
   * Parsed `#SWBGAxx` directives keyed by slot id. Built once per chart by {@link prepareSong}, looked up on every BGA
   * frame draw — `pickSwitchingBgaFrame(entry, elapsedMs)` resolves the currently-visible source `#BMPxx` key to swap
   * into the layer draw. Slots without a `#SWBGAxx` declaration stay absent so the fast path (single texture lookup)
   * takes over.
   */
  switchingBgas = new Map<string, BmsSwitchingBga>();
  /** `#BGAxx` sub-region slot → its authored `dx dy` on the 256x256 BGA canvas. */
  readonly bgaSubRegionOrigins = new Map<string, { x: number; y: number }>();
  /**
   * bmson per-event slice playback map. For bmson charts the audio-renderer's `createBmsonSamplePlaybackMap`
   * precomputes which portion of each `sound_channels[]` WAV a given note is supposed to play — `offsetSeconds` is the
   * seek-into-file position, `durationSeconds` (when set) caps how long the slice should run. Built once per chart in
   * `prepareSong`; `playSample` looks each note's event up here and calls `node.start(when, offset, duration)`
   * accordingly so the sliced-WAV authoring intent is preserved.
   *
   * Stays `undefined` for non-bmson charts (they have no slicing semantics — each note plays its entire WAV from t=0).
   */
  bmsonSlicePlayback:
    | Map<BeMusicEvent, { offsetSeconds: number; durationSeconds?: number; sliceId: string }>
    | undefined;
  autoSampleTriggers: TimedSampleTrigger[] = [];
  score: ScoreSummary = createEmptyScore(0);
  tracker: ScoreTracker = createScoreTracker();
  /**
   * Highest value of `tracker.combo` reached during the current play. `tracker.combo` resets to 0 on every BAD / POOR,
   * so we mirror it here whenever it exceeds the previous max. Used as the authoritative "MAX COMBO" readout for the
   * result screen — the old fallback (`score.perfect + score.great`) overcounted on broken-combo plays since it tallies
   * hit count rather than the longest unbroken streak.
   */
  maxCombo = 0;
  /**
   * The course-wide combo of a course stage, carried in from the previous stage (`options.course.carryIn`); undefined
   * outside a course. Skins that count the combo over the whole course read it (LR2 numbers 104 / 105 in an expert or
   * grade course).
   */
  courseCombo: CourseComboState | undefined;
  /**
   * Play-log assembled by the shared engine right before its play promise settles (`onPlaylogRecorded`). Snapshotted
   * into {@link getResultData} so the result host can offer it as a download.
   */
  private playlog: BeMusicPlaylog | undefined;
  /** Callers of {@link waitForPlaylog} waiting for the engine to record the play. */
  private readonly playlogWaiters: Array<(playlog: BeMusicPlaylog) => void> = [];
  /**
   * Per-play sampled history of `(progress, gauge%)` pairs. Recorded inside `publishJudge` (the single chokepoint for
   * every judge event) and seeded with a `(0, initialGauge)` entry on `prepareSong` so the polyline starts from the LR2
   * default starting gauge (20 %) instead of the first judge's value.
   *
   * `progress` is `seconds / totalSongSeconds` clamped to `[0, 1]`. Drives the result scene's gauge-chart polyline
   * (LR2 `Lr2GaugeChartElement` and friends).
   */
  gaugeHistory: Array<{ progress: number; value: number }> = [];
  /** Same shape as `gaugeHistory`, but tracking running EX score. */
  scoreHistory: Array<{ progress: number; exScore: number }> = [];
  /**
   * Timed judgements of the current play, fed from the engine's judge-combo bus. Its recent window reaches skins as
   * `runtime.judgeTimings`, the full list as the result data's `judgeTimings`.
   */
  readonly judgeTimings = new JudgeTimingLog();
  /** Long-note holds of the current play, fed from the engine's `long-note-start` / `long-note-end` commands. */
  readonly longNotes = new LongNoteTracker();
  /**
   * How the engine's ruleset plays long notes and its judge windows (ms), from `onRulesetResolved` at engine launch.
   * The windows are the ones in force when the chart starts: an LR2 mid-chart `#EXRANKxx` change narrows or widens
   * the engine's windows from then on, but is not reflected here.
   */
  private longNoteStyle: LongNoteStyle | undefined;
  judgeWindows: BeMusicJudgeWindows | undefined;
  /** The chart's BPM range, worked out once per {@link prepareSong}. */
  chartBpmRange: ChartBpmRange | undefined;
  /**
   * Scratch lanes the engine plays itself under auto-scratch (empty when it is off), resolved per {@link prepareSong}.
   * See {@link isAutoplayedChannel}.
   */
  autoScratchChannels: ReadonlySet<string> = new Set();
  /**
   * Play-clock ms of once-per-play moments (gauge failed, last note judged, chart end, gauge first risen above its
   * start / reaching its max), latched as they happen and cleared per {@link prepareSong}.
   */
  playMoments: {
    failedAtMs?: number;
    allNotesDoneAtMs?: number;
    outroAtMs?: number;
    gaugeRiseAtMs?: number;
    gaugeMaxAtMs?: number;
  } = {};
  /**
   * Lane covers handed to skins as `runtime.laneCovers`, one per play side with lanes. Rebuilt when the lane channels
   * change and refilled in place every frame, so the runtime allocates nothing for them.
   */
  private laneCovers: { channels: readonly string[]; covers: BeMusicLaneCover[] } | undefined;
  /** Folds the live view into the recorded play log's view changes ({@link updatePlaylogView}); unset in a replay. */
  private playlogViewCoalescer: PlaylogViewCoalescer | undefined;
  /** A replay's recorded view along the playhead ({@link updatePlaylogView}). */
  private replayViewCursor: PlaylogViewCursor | undefined;
  /** The SUDDEN+ / HIDDEN+ per side a replay shows over the viewer's own ({@link resolveLaneCovers}). */
  private replayCovers: readonly PlaylogLaneCover[] | undefined;
  /**
   * Lane runs measure lines cross for a skin that draws them (`drawsMeasureLines`), with the lane geometry they were
   * worked out from; rebuilt only when the lanes move.
   */
  measureLineRuns: { signature: number; runs: SideLaneRun[] } | undefined;
  /** Judgement that set off each lane's live bomb, by channel; absent for bombs without one (an autoplayed LN head). */
  readonly bombJudge = new Map<string, BeMusicJudge>();
  /** Play-clock ms of each lane's last key press / release (also autoplay hits), by channel. */
  readonly lanePressedAt = new Map<string, number>();
  readonly laneReleasedAt = new Map<string, number>();
  lastJudge = '';
  lastJudgeUntil = 0;
  /**
   * Per-side judge / combo snapshots. Each side captures the verdict text, the chart-time at which the plate should
   * disappear, and the running combo *at the moment that side's note was judged*. The DP renderer reads these directly
   * so the 1P assembly displays the combo at the latest 1P hit and the 2P assembly displays the combo at the latest 2P
   * hit — they only stay synchronized on charts where every press triggers identical-timing hits on both sides (a
   * coincidence, not the rule).
   *
   * SP charts only ever populate the `'1P'` slot, so the global `lastJudge` / `lastJudgeUntil` aliases above keep their
   * existing behavior for the fallback `renderText` path.
   */
  judgeSideState: Record<'1P' | '2P', { judge: JudgeKind | ''; until: number; combo: number; courseCombo?: number }> = {
    '1P': { judge: '', until: 0, combo: 0 },
    '2P': { judge: '', until: 0, combo: 0 },
  };
  /**
   * Whether the gameplay tick is currently registered on the host's `app.ticker`. Previously this scene drove its own
   * `requestAnimationFrame` chain at the bottom of `tick`, running in parallel with PixiJS's auto-render ticker — two
   * RAFs were scheduled per frame, doubling per-frame event-loop overhead. The ticker now fires `tick` inline with the
   * renderer's frame.
   */
  private tickerAttached = false;
  private chartEndTimeout: number | undefined;
  /**
   * `setTimeout` handles for the scene-exit sequence (fade-out → close, LR2 timers 2 / 3). Cleared on dispose so the
   * deferred host callback can't fire onto a torn-down view.
   */
  private exitFadeOutHandle: number | undefined;
  private exitCloseHandle: number | undefined;
  /** `playClock()` at which the exit fade-out began; drives {@link applyExitFadeAlpha}. */
  private exitFadeStartedAt: number | undefined;
  /** The fade-out the running exit sequence uses: the theme's, or longer for a failed play. */
  private exitFadeOutMs = 0;
  /**
   * Intro / scene-stage timers that gate the load-end / play-start stages (and theme stages such as LR2
   * `#STARTINPUT`). These are independent from
   * input flash timers and can otherwise retain a disposed gameplay scene until their delay elapses.
   */
  private readonly sceneStageTimeouts = new Set<number>();
  /**
   * True once {@link beginExitSequence} starts the FADEOUT → CLOSE → host-callback chain. Re-entry is suppressed so a
   * frantic second ESC press while the fade is animating doesn't leak a second callback or restart the timeline.
   */
  private exiting = false;
  protected readonly keyFlashTimeouts: Set<number> = new Set();
  readonly pressedChannels: Set<string> = new Set();
  /**
   * Per-key-on-timer (`100..117`) play-clock timestamp of an in-flight release fade. When set, the lane beam (and a
   * theme's key-on sprites) taper from 1 → 0 over {@link resolveKeyOnFadeMs} starting at the recorded value, so an LN
   * release decays instead of popping off. {@link releaseKeyOnTimer} populates this; {@link
   * startKeyOnTimer} clears it on a fresh press.
   */
  readonly keyOnFadeOutStart: Map<number, number> = new Map();
  readonly bombStartedAt: Map<string, number> = new Map();
  readonly bgaTargetsScratch: GameplayBgaTarget[] = [];
  /**
   * Mirror of the engine's gauge state, refreshed from every `summary.gauge` frame. The gauge model itself
   * (per-judge deltas, TOTAL scaling, guts softening, clear rule) lives entirely in the active ruleset — this view
   * only renders what the engine reports, so LR2 / beatoraja / IIDX differences need no change here. The placeholder
   * below is what renders between scene construction and the first frame.
   */
  gaugeState: PlayerGaugeSummary = createPlaceholderGaugeState();
  /**
   * FAST / SLOW counts. Incremented on every GREAT or GOOD judgement — PERFECT is "on time" so it doesn't count,
   * BAD/POOR break combo and aren't tracked here. Mirrors `applyFastSlowForJudge` in `packages/player`'s engine. Reset
   * per play in `prepareSong`.
   */
  fastCount = 0;
  slowCount = 0;
  /**
   * Set to `true` once the player has hit every chart note without a single BAD / POOR break. Latches on first
   * achievement so the `full-combo` theme event (LR2 FC timers 48 / 49) only fires once per play — replaying the chart resets this in
   * `prepareSong`. Note: AUTO mode reaches FC the moment the last note's auto-PERFECT lands, so the FC presentation
   * also plays during autoplay sessions (the player specifically asked for that behavior).
   */
  fullComboFired = false;
  /**
   * High-speed multiplier. 1.0 = base PIXELS_PER_BEAT. Adjustable at runtime via Arrow Up / Arrow Down (steps of 0.25,
   * clamped to [0.5, 6.0]). Mirrors LR2's "hi-speed" knob: only affects the visual scroll rate, never timing.
   *
   * Seeded to 2.0 to match the LR2 select scene's `DEFAULT_PLAY_OPTIONS.hiSpeed` — the select view always passes
   * `initialHiSpeed` along when transitioning to gameplay, so this is just the fallback when gameplay is mounted
   * directly without a preceding select scene (tests / direct-launch tooling). Note this diverges from upstream
   * beatoraja's `PlayConfig.java:16` (`hispeed = 1.0f`); see the rationale next to that default.
   */
  protected hiSpeed = 2.0;
  /**
   * The HS-FIX multiplier {@link applyHsFix} folded into {@link hiSpeed} (1 without HS-FIX), so a hi-speed reported to
   * or set by the host stays on the player's own scale.
   */
  private hsFixMultiplier = 1;
  /**
   * The hi-speed on the player's own scale: {@link hiSpeed} without the HS-FIX multiplier. It is what the player picked
   * (the select panel and the host show it), so the HUD's hi-speed readout shows it too, and the hotkey steps it.
   */
  playerHiSpeed = this.hiSpeed;
  /**
   * The scroll factor notes, bar lines and long notes are positioned with: it glides to each new {@link hiSpeed} over
   * `HISPEED_TRANSITION_MS` (wall clock) instead of jumping, while the HUD / readouts show the new target at once.
   * Visual only — judging never reads it.
   */
  readonly scrollHiSpeed = new HiSpeedTransition(this.hiSpeed);
  /**
   * Map of timer-id → `playClock()` timestamp at which the timer started, using the LR2 timer numbering from
   * `gameplay-constants.ts`. The core scene drives the key-on bank (100–119) for the lane beams; theme families stamp
   * their own timers (bombs, FC, judge, scene stages, …) into the same map. Removed when the timer "stops" (e.g. key
   * release for key-on).
   */
  readonly timerStartedAt: Map<number, number> = new Map();
  /**
   * BPM-aware seconds → beat resolver, prepared once per song. Used by `renderNotes` to position scrolling notes
   * correctly across `#BPM` change events; the previous hand-rolled `beatAtSeconds` only saw the initial BPM, which
   * made notes drift through tempo transitions.
   */
  timingResolver: TimingResolver | undefined;
  /**
   * Per-layer BGA cue lists, sorted by chart-time seconds. Each cue's `bmpKey` is the resource key our texture cache is
   * keyed by (BMS id like "01" for BMS charts, header.name like "base.png" for bmson). `bmpKey === undefined` is the
   * "clear / hide" command (BMS `00`).
   */
  /** A stitched NONSTOP chart's base / layer cues split by stage (`options.nonstop`). */
  nonstopBgaTimelines: NonstopStageBgaTimeline[] | undefined;
  bgaTimeline: { base: BgaCue[]; layer: BgaCue[]; poor: BgaCue[] } = {
    base: [],
    layer: [],
    poor: [],
  };
  /**
   * BMP-resource → decoded `Texture` cache for the **base** + **POOR** tracks. Loaded lazily during `prepareBga()` so
   * the playfield can start displaying samples while background images keep streaming in. Black pixels are preserved
   * (this is the bottommost BGA layer).
   */
  bgaTextures = new Map<string, Texture>();
  /**
   * BMP-resource → decoded `Texture` cache for the **layer** track (`#BMP` channels 07 and 0A). Decoded separately from
   * {@link bgaTextures} with a chroma-key that turns pure-black pixels transparent — mirrors the BMS BGA "layer"
   * convention used by `packages/player/src/bga.ts` so the foreground composites cleanly over the base track. Even when
   * the same BMP id appears on both tracks we keep two textures because `chroma-key` is destructive.
   */
  bgaLayerTextures = new Map<string, Texture>();
  /**
   * BMP-key → `<video>` element for video BGA cues (`.mp4` / `.webm` / etc.). `renderBga` seeks + plays these on cue
   * transitions; `dispose` revokes their object URLs.
   *
   * Stored separately from {@link bgaTextures} only because the sync logic needs the underlying media element — the
   * texture itself is also added to `bgaTextures` / `bgaLayerTextures` so the existing renderer paths pick it up
   * unchanged.
   */
  bgaVideos = new Map<string, { video: HTMLVideoElement; objectUrl: string }>();
  /**
   * Tracks which video is currently associated with each BGA layer and the chart-time it was seeded at. We use this to
   * detect cue transitions in `renderBga` (start the new cue's video, pause the previous one) and to compute the
   * `currentTime` offset relative to the cue's start seconds.
   */
  bgaActiveVideos: { base?: { key: string; cueSeconds: number }; layer?: { key: string; cueSeconds: number } } = {};
  /** `performance.now()` of the most recent POOR judgement, drives the POOR-BGA window. */
  lastPoorAt = 0;
  /**
   * BMS spec — when the chart omits `#POORBGA` and provides `#BMP00`, the BMP00 image acts as the implicit POOR
   * placeholder until an explicit `#xxx06` POOR cue takes over. Set during {@link prepareSong} so the renderer can
   * paint BMP00 on a miss before any authored POOR event fires; left `undefined` when the chart already authors a
   * proper POOR track or doesn't ship a BMP00 fallback. Mirrors the TUI BGA renderer's `poorFallbackKey` plumbing.
   */
  poorBgaFallbackKey: string | undefined;
  /**
   * Chart-time after which the BMP00 POOR fallback yields to the explicit POOR timeline. Equal to the first authored
   * POOR cue's `seconds` (or `Infinity` when no POOR cues exist). The renderer compares the chart playhead against this
   * so a chart that authors POOR mid-song falls back to BMP00 only during the pre-roll.
   */
  poorBgaFallbackUntilSeconds = Number.POSITIVE_INFINITY;
  /** Whether the chart actually carries any BGA events (drives LR2 op 170/171). */
  hasBga = false;
  /** Smoothed score for the count-up animation. Lerps toward `score.score`. */
  displayedScore = 0;
  /**
   * Frame-rate sampling state. We accumulate frames over a one-second window and publish the rate for theme read-outs
   * (the LR2 RATE NUMBER panel).
   */
  private fpsFrameCount = 0;
  private fpsWindowStart = 0;
  protected fps = 0;
  /**
   * Per-frame section timing tracker. Logs a console summary every second when enabled (via `?perf` URL flag or
   * `globalThis.__BE_MUSIC_PERF__ = true`). When disabled the wrapper adds no measurable overhead.
   */
  private readonly perf = new PerfTracker('gameplay');
  readonly options: TOptions;
  /** The player's stored values for the be-music skin's settings (`beMusicSkinSettings`, then the setter). */
  private beMusicSkinSettings: Readonly<Record<string, unknown>> | undefined;

  public constructor(options: TOptions = {} as TOptions) {
    this.options = options;
    this.beMusicSkinSettings = options.beMusicSkinSettings;
    // A replay plays back at the tempo it was played at, unless its viewer keeps their own (`replayView.tempo`).
    this.replayTempo =
      options.replay !== undefined
        ? resolveReplayTempo(options.replay.play, {
            ownTempo: options.tempo,
            pitchMode: options.tempoPitchMode ?? 'pitch',
            // The recorded tempo timeline only when the viewer's replay options reproduce the tempo (default on).
            reproduce: (options.replayView ?? DEFAULT_PLAYLOG_VIEW_REPLAY).tempo,
          })
        : undefined;
    this.tempo = this.replayTempo?.tempo ?? clampPlayTempo(options.tempo);
    this.tempoClock = createTempoClock(this.tempo);
    // Only in pitch mode (kept pitch stretched the samples to the tempo they loaded at), and not for a replay.
    this.liveTempo = new LiveTempo(
      this.tempo,
      options.replay === undefined && supportsLiveTempoChange(options.tempoPitchMode ?? 'pitch'),
    );
    if (options.initialHiSpeed !== undefined && Number.isFinite(options.initialHiSpeed)) {
      // Snap to the same 1/1000 grid `adjustHiSpeed` uses so a host-supplied `1.5000000000000002` (the obvious
      // float-drift failure mode of repeated +0.1 steps) lands on the canonical grid value the in-game adjust hotkey
      // would produce.
      this.hiSpeed = snapHiSpeed(options.initialHiSpeed) ?? this.hiSpeed;
      this.playerHiSpeed = this.hiSpeed;
      this.scrollHiSpeed.jump(this.hiSpeed);
    }
    this.autoPauseOnBlur = options.autoPauseOnBlur ?? false;
    this.audioVolumes = {
      key: sanitizeBusVolume(options.audioVolumes?.key ?? 1),
      bgm: sanitizeBusVolume(options.audioVolumes?.bgm ?? 1),
    };
    this.audioCompressorParams = { ...options.audioCompressorParams };
  }

  public get identity(): SceneIdentity {
    return IDENTITY;
  }

  /**
   * Convenience accessor for the host's `Application`. Throws if called before {@link prepare} / {@link enter}; this is
   * intentional — every code path that touches `this.app` runs after one of them.
   */
  private get app(): Application {
    if (!this.host) {
      throw new Error('CoreGameplayView: app accessed before prepare / enter');
    }
    return this.host.app;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Theme hooks. Each default is the skinless behaviour; theme families (the LR2 family's `PixiGameplayView`) override
  // the ones they need. They run on the scene's own schedule — see the call sites for the exact ordering.
  // ---------------------------------------------------------------------------------------------------------------

  /**
   * Adds theme-owned sub-layers (e.g. a bitmap-text container inside `skinLayer`) during {@link prepare}, before the
   * scene graph is assembled. Default: nothing.
   */
  protected attachThemeLayers(): void {}

  /**
   * Loads theme assets (textures, fonts, timing spans, …) right after the song is prepared and before audio decoding
   * starts. Implementations should bail out early once {@link disposed} flips. Default: nothing to load.
   */
  protected async prepareTheme(): Promise<void> {}

  /** Intro gates and exit fade / close lengths the scene should follow. Default: all zero (skinless timing). */
  protected get themeTiming(): GameplayThemeTiming {
    return this.paintsThroughBeMusicSkin ? BE_MUSIC_THEME_TIMING : DEFAULT_THEME_TIMING;
  }

  /** Whether the scene paints through a be-music skin (rather than a theme or a host chrome renderer). */
  private get paintsThroughBeMusicSkin(): boolean {
    return this.options.beMusicSkin !== undefined && this.options.skinlessChromeRenderer === undefined;
  }

  /** `performance.now()` of the first rendered frame, for the be-music entrance fade. */
  private enteredAt: number | undefined;

  /**
   * Notified at scene moments a theme animates against (scene stages, exit phases, judgements, full combo, gauge
   * changes, bombs, lane commands). Default: ignored.
   */
  protected onThemeEvent(_event: GameplayThemeEvent): void {}

  /** Per-frame theme bookkeeping that must run before {@link render} (e.g. LR2 ops / turntable). Default: nothing. */
  protected updateThemeState(): void {}

  /**
   * Pushes the rectangles the chart's BGA should be composited into this frame. Default: the fixed default-family BGA
   * rect. Pushing nothing hides the BGA for the frame.
   */
  protected collectBgaTargets(out: GameplayBgaTarget[]): void {
    const stage = this.beMusicStage;
    if (!stage) {
      out.push(DEFAULT_BGA_TARGET);
      return;
    }
    const geometry = resolveLaneGeometry.call(this);
    // The landscape touch layout gives the BGA's room to the lanes.
    if (geometry.mode === 'touch' && geometry.orientation === 'landscape') return;
    const rect = stage.resolveBgaRect(geometry.right);
    const cached = this.stageBgaTarget;
    if (cached && cached.x === rect.x && cached.y === rect.y && cached.w === rect.w && cached.h === rect.h) {
      out.push(cached);
      return;
    }
    this.stageBgaTarget = createDefaultBgaTarget(rect);
    out.push(this.stageBgaTarget);
  }

  /**
   * Design canvas the scene renders into. The be-music path uses its skin's {@link BeMusicSkin.stage} (16:9 for the
   * built-in skins); a host-supplied `skinlessChromeRenderer` and themes keep the LR2-compatible 640x480.
   */
  protected get stageSize(): GameplayStageSize {
    return this.beMusicStage ?? LEGACY_STAGE_SIZE;
  }

  /**
   * The layout mode in effect: `'touch'` only when asked for and the be-music skin's own stage is painted (a host chrome
   * renderer or theme brings its own geometry). The play mode may still fall back to standard — see
   * {@link resolveLaneGeometry}.
   */
  get layoutMode(): GameplayLayoutMode {
    return this.options.layoutMode === 'touch' && this.beMusicStage !== undefined ? 'touch' : 'standard';
  }

  /**
   * How far above a lane's top notes still draw while they scroll in. The standard lanes start at the stage's top edge,
   * so notes enter from off-stage; the touch and portrait lanes start below the skin's header band (or the BGA and HUD
   * above them), so notes there appear at the lane top instead of drawing over the chrome.
   */
  get noteOverscan(): number {
    return this.layoutMode === 'touch' || resolveStageOrientation(this.stageSize) === 'portrait' ? 0 : NOTE_OVERSCAN;
  }

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

  /**
   * The be-music skin's stage while the scene paints through it, otherwise `undefined`: its portrait stage while the
   * screen is upright and the chart fits a portrait playfield, its landscape stage otherwise. Read every frame, so a
   * rotation mid-play re-lays the screen out on the next frame.
   */
  get beMusicStage(): BeMusicStage | undefined {
    if (this.options.skinlessChromeRenderer) return undefined;
    const skin = this.options.beMusicSkin;
    if (!skin) return undefined;
    const screen = this.host?.app.screen;
    return resolveBeMusicSkinStage(skin, screen && screen.width > 0 && screen.height > 0 ? screen : undefined, {
      laneChannels: this.laneChannels,
      playVariant: this.chartPlayVariant,
    });
  }

  /**
   * When true the theme draws the lane backgrounds / beams and the bombs itself, so the scene skips its be-music-skin
   * versions (lane geometry is still computed for notes and shutters). Default: false.
   */
  protected get themeOwnsPlayfield(): boolean {
    return false;
  }

  /**
   * Theme-authored rect for `channel`'s lane in design pixels (`width` / `height` are the design canvas), or
   * `undefined` to use the default-family layout for that channel. Default: `undefined`.
   */
  protected resolveThemeLaneRect(_channel: string, _width: number, _height: number): GameplayLaneRect | undefined {
    return undefined;
  }

  /**
   * Theme sprite cell for one note part on the given LR2-spec lane index, or `undefined` when the theme doesn't author
   * the slot (the scene then draws its own). See {@link GameplayThemeNoteCell} for the `texture: undefined` case.
   * Default: `undefined`.
   */
  protected resolveThemeNoteCell(_kind: GameplayThemeNoteKind, _laneIndex: number): GameplayThemeNoteCell | undefined {
    return undefined;
  }

  /**
   * Draws the measure lines for this frame into `noteLayerPool` and returns true, or returns false to let the scene
   * draw its fallback bar. Default: false.
   */
  protected renderThemeMeasureLines(_frame: GameplayMeasureLineFrame): boolean {
    return false;
  }

  /**
   * Late-frame theme pass, run after the bombs and inside the `textLayerPool` begin / end bracket (e.g. a fallback
   * judge string). Default: nothing.
   */
  protected renderThemeText(_seconds: number): void {}

  /** How long the bomb on `channel` stays alive, in ms. Default: the be-music skin's own effect length. */
  protected resolveBombDurationMs(_channel: string): number {
    return this.skinBinding?.bombDurationMs ?? PHANTOM_BOMB_DURATION_MS;
  }

  /** Release-fade span in ms for key-on timer `timerId` (100..119). Default: {@link KEY_ON_FADE_OUT_MS}. */
  protected resolveKeyOnFadeMs(_timerId: number): number {
    return KEY_ON_FADE_OUT_MS;
  }

  /**
   * Releases theme-owned per-view state during {@link dispose}. Returned textures are destroyed together with the
   * scene's own (after {@link textures} and the BGA textures). Default: nothing to release.
   */
  protected disposeTheme(): Iterable<Texture | undefined> {
    return [];
  }

  /**
   * The theme hooks above, for the modules the scene's parts live in (`view/shared/playfield/*`, …): the hooks stay
   * `protected` for the theme families that override them, so the modules call them through this object.
   */
  readonly theme: GameplayThemeHooks = {
    themeOwnsPlayfield: () => this.themeOwnsPlayfield,
    resolveThemeLaneRect: (channel, width, height) => this.resolveThemeLaneRect(channel, width, height),
    resolveThemeNoteCell: (kind, laneIndex) => this.resolveThemeNoteCell(kind, laneIndex),
    renderThemeMeasureLines: (frame) => this.renderThemeMeasureLines(frame),
    renderThemeText: (seconds) => this.renderThemeText(seconds),
    renderBombEffects: () => this.renderBombEffects(),
    resolveBombDurationMs: (channel) => this.resolveBombDurationMs(channel),
    resolveKeyOnFadeMs: (timerId) => this.resolveKeyOnFadeMs(timerId),
    collectBgaTargets: (out) => this.collectBgaTargets(out),
    onThemeEvent: (event) => this.onThemeEvent(event),
  };

  /**
   * Loads the play: parses the chart, and decodes every audio sample the chart references — the slow part of going from
   * "song picked" to "gameplay can begin". It attaches nothing to the stage and no listeners, so a Decide splash can
   * show while it runs; the host then shows the scene ({@link enter}) and calls {@link start}. Run while the scene is
   * already showing (a play with no splash), it draws the playfield in its loading state as assets decode instead.
   *
   * Returns once chart audio is decoded (timer / chart-start scheduling is deferred to {@link start}). BGA preload runs
   * concurrently and is allowed to land mid-play; the playfield is up by the time `start()` fires regardless.
   */
  public async prepare(host: PixiSceneHost, song: BrowserSongEntry, source?: BrowserSongAssetSource): Promise<void> {
    this.build(host);
    this.song = song;
    this.source = source;
    // Hidden until {@link start} fires, so a scene shown before the play begins draws nothing of it yet.
    this.root.visible = false;
    this.assetsLoading = true;
    prepareSong(this, song);
    if (this.entered) {
      // No splash covers the load window: hold the chart clock before its start (see `start()`) and draw the loading
      // playfield while assets decode, instead of a blank stage.
      this.startTime = Number.POSITIVE_INFINITY;
      this.root.visible = true;
      this.startAnimationLoop();
    }
    await this.prepareTheme();
    if (this.disposed) return;
    await prepareAudio(this);
    if (this.disposed) return;
    // BGA preload runs IN THE BACKGROUND — `prepare()` resolves here even if `prepareBga()` is still decoding videos.
    // The ffmpeg.wasm fallback for unsupported codecs (e.g. legacy `.mpg`) can take ~tens of seconds, and the user
    // wants the PLAY scene to transition in immediately and play its LR2 LOADING animation during that wait rather than
    // freezing the Decide splash. {@link start} gates the actual chart start (LR2 timer 40 → 41 / op 80 → 81) on
    // `bgaReadyPromise`, so notes still don't begin until the BGA is in place.
    this.bgaReadyPromise = prepareBga(this).catch((error) => {
      log.warn('BGA preload failed; continuing without it', error);
    });
    void this.bgaReadyPromise.then(() => {
      this.assetsLoading = false;
    });
  }

  /**
   * Shows the play (see {@link PixiScene.enter}): wires its keys (ESC / F5 / Space / arrows, the Backspace hold),
   * touch lanes, canvas focus and the auto-pause on losing focus, and resumes drawing if {@link exit} stopped it. The
   * play itself starts with {@link start}.
   */
  public enter(host: PixiSceneHost): void {
    if (this.disposed || this.entered) return;
    this.build(host);
    this.entered = true;
    // ESC / F5 / Space / ArrowUp / ArrowDown stay on the view so the LR2 `#FADEOUT` exit animation runs to
    // completion BEFORE the engine's interrupt flow disposes the audio session, and so HiSpeed adjustment
    // affects the visual scroll speed (which the engine doesn't own). The WebInputRuntime's `shouldSkipKey`
    // filter mirrors this list so it doesn't also push duplicate `interrupt` / `toggle-pause` commands. Lane
    // input goes through the WebInputRuntime's own `keydown` listener to the engine's input bus.
    window.addEventListener('keydown', this.handleSharedEngineExitKey);
    // Holding Backspace quits like Escape (`QuitHoldController`); the keyup / blur listeners end the hold.
    window.addEventListener('keyup', this.handleQuitHoldKeyUp);
    window.addEventListener('blur', this.cancelQuitHold);
    host.app.canvas.addEventListener('pointerdown', this.focus);
    // Touch play: fingers on the lanes press them. `touch-action: none` keeps the page from scrolling or zooming under
    // the fingers while the play is up.
    this.previousCanvasTouchAction = host.app.canvas.style.touchAction;
    host.app.canvas.style.touchAction = 'none';
    host.app.canvas.addEventListener('pointerdown', this.handleTouchPointer);
    host.app.canvas.addEventListener('pointermove', this.handleTouchPointer);
    host.app.canvas.addEventListener('pointerup', this.handleTouchPointerUp);
    host.app.canvas.addEventListener('pointercancel', this.handleTouchPointerUp);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    // `visibilitychange` covers tab switching but not always app switching (Cmd-Tab / Alt-Tab) — fall back to window
    // blur/focus so the gameplay also pauses when the user moves to another OS app entirely. Use the capture phase so
    // we still see the events even if PixiJS or another listener decides to stop propagation along the bubbling path.
    window.addEventListener('blur', this.handleWindowBlur, true);
    window.addEventListener('focus', this.handleWindowFocus, true);
    window.addEventListener('pagehide', this.handleWindowBlur);
    window.addEventListener('pageshow', this.handleWindowFocus);
    // Polling safety net. Some embedded environments / OS-window managers suppress the `visibilitychange` and `blur`
    // events entirely (notably when the dev-tools panel takes focus on the same window). A 250 ms poll on
    // `document.hidden` and `document.hasFocus()` catches those cases without measurable cost.
    this.lastHidden = document.hidden;
    this.lastFocus = typeof document.hasFocus === 'function' ? document.hasFocus() : true;
    this.visibilityPollHandle = window.setInterval(() => {
      const hiddenNow = document.hidden;
      const focusNow = typeof document.hasFocus === 'function' ? document.hasFocus() : true;
      if (hiddenNow !== this.lastHidden) {
        this.lastHidden = hiddenNow;
        log.info('poll detected hidden change', { hidden: hiddenNow });
        if (hiddenNow) {
          this.handleWindowBlur();
        } else {
          this.handleWindowFocus();
        }
      } else if (focusNow !== this.lastFocus) {
        this.lastFocus = focusNow;
        log.info('poll detected focus change', { focus: focusNow });
        if (!focusNow) {
          this.handleWindowBlur();
        } else {
          this.handleWindowFocus();
        }
      }
    }, 250);
    log.info('listeners attached', {
      visibilityState: document.visibilityState,
      hidden: document.hidden,
      hasFocus: typeof document.hasFocus === 'function' ? document.hasFocus() : 'n/a',
    });
    if (this.resumeAnimationOnEnter) this.startAnimationLoop();
  }

  /**
   * Stops drawing and taking input (see {@link PixiScene.exit}). The play's engine and sound run on — a play that has
   * ended keeps its audio tail until {@link dispose}.
   */
  public exit(): void {
    if (!this.entered) return;
    this.entered = false;
    this.resumeAnimationOnEnter = this.tickerAttached;
    this.stopAnimationLoop();
    // Detach window-level event listeners so a stray keypress doesn't hit a view that is off stage.
    window.removeEventListener('keydown', this.handleSharedEngineExitKey);
    window.removeEventListener('keyup', this.handleQuitHoldKeyUp);
    window.removeEventListener('blur', this.cancelQuitHold);
    this.quitHold.cancel();
    if (this.host) {
      this.host.app.canvas.removeEventListener('pointerdown', this.focus);
      const canvas = this.host.app.canvas;
      canvas.removeEventListener('pointerdown', this.handleTouchPointer);
      canvas.removeEventListener('pointermove', this.handleTouchPointer);
      canvas.removeEventListener('pointerup', this.handleTouchPointerUp);
      canvas.removeEventListener('pointercancel', this.handleTouchPointerUp);
      if (this.previousCanvasTouchAction !== undefined) canvas.style.touchAction = this.previousCanvasTouchAction;
      this.touchLanes.upAll();
    }
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    window.removeEventListener('blur', this.handleWindowBlur, true);
    window.removeEventListener('focus', this.handleWindowFocus, true);
    window.removeEventListener('pagehide', this.handleWindowBlur);
    window.removeEventListener('pageshow', this.handleWindowFocus);
    if (this.visibilityPollHandle !== undefined) {
      window.clearInterval(this.visibilityPollHandle);
      this.visibilityPollHandle = undefined;
    }
  }

  /** Builds the scene graph under {@link root} on the first {@link prepare} or {@link enter}; later calls no-op. */
  private build(host: PixiSceneHost): void {
    if (this.host !== undefined) return;
    this.host = host;
    // Label every top-level node so the PixiJS Devtools "Scene Graph" panel reads as `gameplay > {bga,skin,lane,…}`
    // instead of a wall of `Container` rows. Layer ordering matches `addChild` below.
    this.root.label = 'gameplay/scene';
    this.designRoot.label = 'gameplay/root';
    this.viewportBackground.label = 'gameplay/viewport-bg';
    this.background.label = 'gameplay/background';
    this.bgaLayer.label = 'gameplay/bga';
    this.skinLayer.label = 'gameplay/skin';
    this.laneLayer.label = 'gameplay/lanes';
    this.noteLayer.label = 'gameplay/notes';
    this.bombLayer.label = 'gameplay/bombs';
    this.overlayLayer.label = 'gameplay/overlay';
    this.textLayer.label = 'gameplay/text';
    this.overlay.label = 'gameplay/pause-overlay';
    this.designClipMask.label = 'gameplay/design-clip';
    // The mask and design background only change shape with the stage (a rotation can switch a skin between its
    // landscape and portrait stages), so they are stamped here and restamped by `render` only when the stage changes,
    // skipping the per-frame rebuild that was contributing to the rAF handler's runtime.
    this.stampDesignRect(this.stageSize);
    // The gameplay scene owns its own pointerdown listener on the canvas itself (`this.focus`) and a window-level
    // keydown listener — none of the per-layer children need to participate in Pixi's interaction system. Marking
    // each render-only Container as `eventMode = 'none'` lets the interaction manager skip the entire subtree
    // during hit-testing every pointermove / pointerdown, which is otherwise an O(N) walk over hundreds of skin
    // children per event.
    //
    // CAUTION: `this.background` and `this.designClipMask` are intentionally NOT marked `'none'`. The mask is
    // referenced via `this.designRoot.mask = this.designClipMask` and Pixi v8's mask resolution path interacts with the
    // event-mode setting in subtle ways — clearing it on the mask Graphics has been observed to leave the root
    // unclipped (residual previous-frame content visible, e.g. the LR2 intro title strip stays painted across
    // subsequent frames) and has the side effect of dropping the rendered frame rate. The mask + the static
    // `background` Graphics don't carry interactive children either way, so leaving their `eventMode` at the
    // default is the safest choice.
    for (const layer of [
      this.bgaLayer,
      this.skinLayer,
      this.laneLayer,
      this.noteLayer,
      this.shutterLayer,
      this.bombLayer,
      this.overlayLayer,
      this.textLayer,
    ]) {
      layer.eventMode = 'none';
    }
    // Theme sub-layers (e.g. the LR2 bitmap-text layer) must be parked inside `skinLayer` before the scene graph is
    // assembled so their z-order matches the theme's own layering.
    this.attachThemeLayers();
    this.designRoot.addChild(
      this.background,
      this.bgaLayer,
      this.skinLayer,
      this.laneLayer,
      this.noteLayer,
      this.shutterLayer,
      this.bombLayer,
      this.overlayLayer,
      this.textLayer,
      this.overlay,
      this.designClipMask,
    );
    // Clip every child of `designRoot` to the design rectangle. The mask graphic itself is a child of `designRoot`, so
    // the same viewport scale / translate applies to both the mask and the masked content — Pixi clips against the
    // mask's world-space bounds, which matches the on-screen design rectangle.
    this.designRoot.mask = this.designClipMask;
    this.shutterLayer.label = 'gameplay/shutter';
    this.root.addChild(this.viewportBackground, this.designRoot);
  }

  /**
   * Reveals the prepared scene, starts the intro timeline (theme `scene-start` / `load-end` / `play-start` events), and
   * starts the rAF loop. Must be called after {@link prepare} resolves; calling it before will skip the chart-start
   * scheduling because `audioContextStartTime` only lands in the right ballpark when the audio context is up.
   *
   * Idempotent — repeated calls after the scene has already started no-op.
   */
  public start(): void {
    if (this.disposed) return;
    if (this.sceneStartTime !== 0) return;
    this.root.visible = true;
    // The intro timeline comes from the theme (see {@link themeTiming}; the LR2 family maps `#LOADSTART` / `#LOADEND`
    // / `#PLAYSTART`). `start()` only runs when `paused` is false and `pauseTotal` is still 0, so `playClock()` and
    // `performance.now()` are equivalent here — but seeding through `playClock()` keeps the animation clocks all in the
    // same coordinate system as the pause-aware reads further below.
    const now = this.playClock();
    this.sceneStartTime = now;
    const { loadEndOffsetMs, playStartOffsetMs } = this.themeTiming;
    // Skinless / non-LR2 demos have no timing directives; fall back to the legacy 3-second wait so the slide-in chrome
    // of the built-in fallback frame still has room to land before notes begin.
    const introMs = playStartOffsetMs > 0 ? playStartOffsetMs : FALLBACK_INTRO_DELAY_MS;
    this.scheduledIntroMs = introMs;
    // The chart waits on BOTH the configured PLAY START delay AND the BGA preload (which may still be transcoding video
    // in the background — see `prepare()`). Until the gate opens below, `startTime = +Infinity` keeps `isIntroPlaying`
    // true and the rAF loop in the intro (LR2 LOADING) phase.
    this.startTime = Number.POSITIVE_INFINITY;
    // Scene start fires immediately; load-end and play-start — the events that drive "READY" / chart-start cues — fire
    // later via the `Promise.all` gates below so they wait for the BGA preload too. Exit-phase events are deliberately
    // NOT raised here: `beginExitSequence` raises them at the actual transition moment (ESC / chart end).
    this.onThemeEvent({ kind: 'scene-start', at: now });
    // The `start()` invocation we belong to — captured so the gate handlers below can detect a dispose-and-re-mount and
    // bail out instead of mutating a fresh scene's state.
    const sceneEpoch = this.sceneStartTime;
    const bgaReady = this.bgaReadyPromise ?? Promise.resolve();
    // LOAD END gate — both the configured load-end delay AND the BGA preload need to finish.
    void Promise.all([bgaReady, this.delaySceneStage(loadEndOffsetMs)]).then(() => {
      if (this.disposed) return;
      if (this.sceneStartTime !== sceneEpoch) return;
      this.onThemeEvent({ kind: 'load-end', at: this.playClock() });
    });
    // PLAY START gate — same pattern, but for the configured play-start (or fallback intro). Raises the theme's
    // play-start event (animation clock) and anchors the wall-clock + audio-context start times (chart-engine clock) so
    // the chart engine and BGM samples share a single t=0.
    void Promise.all([bgaReady, this.delaySceneStage(introMs)]).then(() => {
      if (this.disposed) return;
      if (this.sceneStartTime !== sceneEpoch) return;
      this.onThemeEvent({ kind: 'play-start', at: this.playClock() });
      // `startTime` is consumed by `isIntroPlaying` and `currentSeconds`, both of which work in raw wall-clock units
      // (with `currentSeconds` subtracting `pauseTotal` explicitly), so it MUST stay on `performance.now()`.
      this.startTime = performance.now();
      if (this.audioContext) {
        this.audioContextStartTime = this.audioContext.currentTime;
        this.nonstopMixer?.schedule(this.audioContextStartTime);
      }
      // Hand chart playback over to `@be-music/player`'s engine. Fires only after the play-start gate (= same instant
      // the legacy self-judge would have started consuming notes), so the engine's chart-time t=0 lines up with the
      // view's `audioContextStartTime` anchor — no double-leadin.
      this.launchSharedEngine();
    });
    this.app.canvas.focus();
    this.startAnimationLoop();
  }

  private delaySceneStage(offsetMs: number): Promise<void> {
    return new Promise((resolve) => this.setSceneStageTimeout(resolve, Math.max(0, offsetMs)));
  }

  /**
   * Schedules `callback` after `offsetMs`, tracked so {@link dispose} cancels it. Themes use it for their own
   * scene-stage timers (e.g. LR2 `#STARTINPUT`).
   */
  protected setSceneStageTimeout(callback: () => void, offsetMs: number): void {
    let handle = 0;
    handle = window.setTimeout(
      () => {
        this.sceneStageTimeouts.delete(handle);
        callback();
      },
      Math.max(0, offsetMs),
    );
    this.sceneStageTimeouts.add(handle);
  }

  /**
   * Pauses or resumes the play, as Space does. For hosts that offer on-screen controls — a touch device has no keyboard
   * to press Space or Escape on.
   */
  public requestTogglePause(): void {
    if (this.disposed || this.exiting) return;
    this.togglePause();
  }

  /** Whether the play is paused (by Space, {@link requestTogglePause}, or the auto-pause on losing focus). */
  public isPaused(): boolean {
    return this.paused;
  }

  /**
   * The play log of this play once the engine has recorded it — also after Escape, which records the play as given up
   * (`play.aborted`) a moment after `onExit` fires. Resolves `undefined` when none arrives within `timeoutMs` (a replay
   * records none).
   */
  public waitForPlaylog(timeoutMs = 2000): Promise<BeMusicPlaylog | undefined> {
    if (this.playlog !== undefined) return Promise.resolve(this.playlog);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const index = this.playlogWaiters.indexOf(settle);
        if (index >= 0) this.playlogWaiters.splice(index, 1);
        resolve(undefined);
      }, timeoutMs);
      const settle = (playlog: BeMusicPlaylog): void => {
        clearTimeout(timer);
        resolve(playlog);
      };
      this.playlogWaiters.push(settle);
    });
  }

  /**
   * Hands the play over to the host once ({@link sharedEngineInterrupt}): a play still being judged is interrupted, so
   * the engine stops (and, for ESC, records the play as given up); a play whose chart already settled is complete, so
   * its hold is let go and it ends with its play log as usual. A no-op before the engine is running.
   */
  private interruptSharedEngine(reason: 'escape' | 'restart'): void {
    if (this.sharedEngineInterrupt !== undefined) return;
    const signals = this.sharedEngineInputSignals;
    if (signals === undefined) return;
    this.sharedEngineInterrupt = reason;
    this.flushPlaylogView();
    if (this.sharedEngineChartSettled) {
      this.chartEndHold?.abort();
      return;
    }
    signals.pushCommand({ kind: 'interrupt', reason });
  }

  /** Leaves the play the way Escape does: the theme's fade-out runs, then the host's `onExit` fires. */
  public requestExit(): void {
    this.beginExitSequence(() => {
      this.interruptSharedEngine('escape');
      this.sharedEngineAbortController?.abort();
      this.options.onExit?.();
    });
  }

  /**
   * Toggles the dynamics compressor stack on the audio bus at runtime. Mid-play safe: the bus's `setMode` only re-wires
   * downstream stages, so in-flight `BufferSourceNode`s keep playing through the unchanged `keyMixer` / `bgmMixer`
   * nodes.
   *
   * - `setAudioCompressor(false)` → bus mode `'off'` (every stage bypassed; both mixers connect directly to
   *   destination).
   * - `setAudioCompressor(true)` → bus mode is restored to the architecture the constructor chose
   *   (`audioCompressorMode`, default `'split'`). To switch architectures at runtime use {@link setAudioCompressorMode}
   *   instead.
   *
   * Idempotent and a no-op before `prepareAudio` has run; the constructor's `audioCompressor` option seeds the initial
   * state at mount time.
   */
  public setAudioCompressor(enabled: boolean): void {
    if (!this.audioBus) {
      // Bus will be wired with the right mode the next time `prepareAudio` runs. We can't pre-seed
      // `audioCompressorMode` here either: the constructor option is the source of truth until then.
      return;
    }
    const next = enabled ? this.audioCompressorMode : 'off';
    this.audioBus.setMode(next);
  }

  /**
   * Toggles the auto-pause-on-blur behavior at runtime. Future `visibilitychange` / `blur` events will only auto-pause
   * when `enabled` is true; the auto-RESUME path stays unconditional so a user who blurs (auto-pauses) then disables
   * this option still gets back to play state on the next focus.
   *
   * Idempotent — calling with the same value no-ops.
   */
  public setAutoPauseOnBlur(enabled: boolean): void {
    this.autoPauseOnBlur = enabled;
  }

  /**
   * Live setter for {@link CoreGameplayViewOptions.judgedNoteDisplay}. Mutates `this.options` so the per-frame
   * `renderNotes` check picks the new mode on the next paint — letting the user A/B "keep scrolling" vs "hide on judge"
   * without restarting the song.
   */
  public setJudgedNoteDisplay(mode: 'KEEP_SCROLLING' | 'HIDE'): void {
    this.options.judgedNoteDisplay = mode;
  }

  /**
   * Live setter for {@link CoreGameplayViewOptions.showInvisibleNotes}. The invisible-note array is always extracted at
   * chart- prepare time and the green sprite's texture is always preloaded, so flipping this flag mid-song just toggles
   * the per-frame render branch — the overlay appears (or vanishes) on the very next paint.
   */
  public setShowInvisibleNotes(enabled: boolean): void {
    this.options.showInvisibleNotes = enabled;
  }

  /**
   * Switches the compressor architecture between `'split'` (default 3-stage) and `'legacy'` (original
   * single-compressor) at runtime. Mostly useful for the demo's `?compressor=` URL flag and for live A/B comparison
   * while debugging.
   *
   * Calling this while `setAudioCompressor(false)` has the bus in `'off'` mode just remembers the choice — the new
   * architecture will be applied next time compression is re-enabled.
   */
  public setAudioCompressorMode(mode: 'split' | 'legacy'): void {
    this.audioCompressorMode = mode;
    if (this.audioBus && this.audioBus.getMode() !== 'off') {
      this.audioBus.setMode(mode);
    }
  }

  /**
   * Toggle one compressor stage (`'key'` / `'bgm'` / `'master'`) within the split-bus architecture. The stage flag is
   * remembered even when the active mode isn't `'split'` — a future toggle to split mode will pick the user's choice
   * back up.
   *
   * No-op before `prepareAudio` has run; the stage state will be applied via the bus's defaults the next time gameplay
   * mounts.
   */
  public setAudioCompressorStageEnabled(stage: CompressorStage, enabled: boolean): void {
    this.audioBus?.setStageEnabled(stage, enabled);
  }

  /**
   * Sets the user volume of the keysound (`'key'`) or BGM (`'bgm'`) bus, as a linear gain (1 = unity, clamped to
   * `0..2`). Applies live to a running chart; before the audio bus exists the value is kept for when it is built.
   */
  public setAudioVolume(channel: AudioBusChannel, volume: number): void {
    this.audioVolumes[channel] = sanitizeBusVolume(volume);
    this.audioBus?.setBusVolume(channel, volume);
  }

  /**
   * Retunes one compressor (`'key'` / `'bgm'` / `'master'` split stages or `'legacy'`); unspecified fields keep their
   * current value. Applies live to a running chart; before the audio bus exists the tuning is kept for when it is built.
   */
  public setAudioCompressorParams(compressor: TunableCompressor, params: Partial<CompressorParams>): void {
    this.audioCompressorParams[compressor] = { ...this.audioCompressorParams[compressor], ...params };
    this.audioBus?.setCompressorParams(compressor, params);
  }

  /**
   * Begins recording the play scene (canvas video + bus audio mix) into a WebM Blob. Throws when `prepareAudio` hasn't
   * finished setting up the audio context yet, or when the browser doesn't expose `MediaRecorder` /
   * `canvas.captureStream` / a usable codec — UI hosts should surface these failures to the user (the codec case is
   * common on older Safari).
   *
   * Idempotent in the sense that calling while a recording is already active is a no-op (`isRecording()` is the
   * canonical gate hosts should check).
   */
  public startRecording(options: { format?: RecordingFormat } = {}): void {
    if (this.recorder?.isActive()) return;
    if (!this.host || !this.audioContext || !this.audioBus) {
      throw new Error('CoreGameplayView.startRecording: gameplay audio is not ready yet');
    }
    // Recreate the recorder per session — instances are one-shot by design (chunk buffer + audio tap lifecycle), so the
    // host gets a clean blob on every start.
    const host = this.host;
    this.recorder = new GameplayRecorder({
      canvas: host.app.canvas,
      subscribeFrame: (onFrame) => host.onAfterRender(onFrame),
      audioContext: this.audioContext,
      audioOutput: this.audioBus.outputNode,
      format: options.format,
    });
    this.recorder.start();
  }

  /**
   * Ends the active recording and resolves with the assembled Blob plus its MIME type / duration. Resolves with
   * `undefined` when no recording is in progress, so callers can call this unconditionally on chart end / unmount.
   */
  public async stopRecording(): Promise<GameplayRecorderResult | undefined> {
    const recorder = this.recorder;
    if (!recorder) return undefined;
    this.recorder = undefined;
    return recorder.stop();
  }

  public isRecording(): boolean {
    return this.recorder?.isActive() ?? false;
  }

  public dispose(options: CoreGameplayDisposeOptions = {}): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    // Detach the gameplay tick and the input listeners. The shared `Application` keeps running for the next active
    // scene — only the per-scene state below is freed.
    this.exit();
    this.stopAnimationLoop();
    if (this.exitFadeOutHandle !== undefined) {
      window.clearTimeout(this.exitFadeOutHandle);
      this.exitFadeOutHandle = undefined;
    }
    if (this.exitCloseHandle !== undefined) {
      window.clearTimeout(this.exitCloseHandle);
      this.exitCloseHandle = undefined;
    }
    for (const timeout of this.sceneStageTimeouts) {
      window.clearTimeout(timeout);
    }
    this.sceneStageTimeouts.clear();
    if (this.chartEndTimeout !== undefined) {
      window.clearTimeout(this.chartEndTimeout);
      this.chartEndTimeout = undefined;
    }
    for (const timeout of this.keyFlashTimeouts) {
      window.clearTimeout(timeout);
    }
    this.keyFlashTimeouts.clear();
    log.info('listeners detached');
    // Pause every BGA video BEFORE we touch textures. The Pixi `VideoSource` wrapping each video registers a
    // `requestVideoFrameCallback` that re-uploads frames into the GL texture as they decode — leaving those callbacks
    // in flight while we destroy the textures throws inside the GL texture system. Pausing also revokes the Blob URL so
    // the underlying buffer can be released.
    for (const { video, objectUrl } of this.bgaVideos.values()) {
      try {
        video.pause();
        video.removeAttribute('src');
        video.load();
      } catch {
        // Defensive — `load()` can throw on detached videos.
      }
      URL.revokeObjectURL(objectUrl);
    }
    this.bgaVideos.clear();
    this.bgaActiveVideos = {};
    // Hard-stop any active recording before tearing down the bus. `GameplayRecorder.dispose` calls
    // `MediaRecorder.stop()` synchronously (no chunk-flush wait) and disconnects its audio tap from the bus's output
    // node, so the bus can be disposed cleanly afterwards.
    this.recorder?.dispose();
    this.recorder = undefined;
    // WebAudioSession owns the in-flight BufferSource tracking that the bus's connected sources hang off of, so
    // dispose it BEFORE we tear the bus down — that gives the session a chance to call `node.stop()` on every
    // still-playing source so they don't survive into the next chart's bus and bleed audio through. Fire-and-
    // forget the returned promise; the session's dispose path is best-effort.
    // Abort the shared engine driver BEFORE the audio session tear-down so engine ticks don't fire fresh
    // sample triggers onto a session that's about to lose its bus references. The engine catches the abort via
    // `throwIfAborted` and unwinds; our launchSharedEngine catch swallows the resulting `AbortError` because
    // the host already initiated dispose.
    // A play torn down mid-chart is interrupted too, so the engine stops instead of running on to the chart's end.
    this.interruptSharedEngine('escape');
    if (this.sharedEngineAbortController) {
      try {
        this.sharedEngineAbortController.abort();
      } catch {
        // Already aborted or unsupported environment — swallow.
      }
      this.sharedEngineAbortController = undefined;
    }
    this.sharedEngineSignals = undefined;
    this.sharedEngineInputSignals = undefined;
    this.liveTempo.attach(undefined);
    this.sharedEngineClockAnchored = false;
    this.sharedEnginePromise = undefined;
    const preserveAudioTail = options.preserveAudioTail === true && this.chartEnded;
    const audioTailChart = this.resolvedChart ?? this.song?.chart;
    const audioTailCleanupDelayMs =
      preserveAudioTail && audioTailChart !== undefined
        ? chartToElapsedSeconds(
            resolveGameplayAudioTailCleanupDelayMs({
              chart: audioTailChart,
              notes: this.notes,
              autoSampleTriggers: this.autoSampleTriggers,
              decodedSamples: this.decodedSamples,
              bmsonSlicePlayback: this.bmsonSlicePlayback,
              currentSeconds: this.currentSeconds(),
            }),
            this.tempo,
          )
        : 0;
    const webAudioSession = this.webAudioSession;
    this.webAudioSession = undefined;
    this.nonstopMixer?.dispose();
    this.nonstopMixer = undefined;
    // Tear down the bus before closing the AudioContext so its `disconnect()` calls don't race with context shutdown.
    // The bus doesn't own the AudioContext itself; closing that is the next step.
    this.audioAnalyzer?.dispose();
    this.audioAnalyzer = undefined;
    this.audioFrame = undefined;
    const audioBus = this.audioBus;
    this.audioBus = undefined;
    const audioContext = this.audioContext;
    this.audioContext = undefined;
    disposeGameplayAudioGraphAfterDelay(
      {
        session: webAudioSession,
        bus: audioBus,
        context: audioContext,
      },
      preserveAudioTail ? audioTailCleanupDelayMs : 0,
    );
    // Detach our subtree from the host's stage. The host owns the `Application` lifetime; we just stop contributing to
    // its scene graph. The root Container itself stays alive in case the host wants to re-enter the same view (we
    // don't, but it's harmless).
    if (this.root.parent) {
      this.root.parent.removeChild(this.root);
    }
    // Free per-view textures. Order matters: textures BEFORE we destroy the root / sprites, because
    // `Texture.destroy()` emits a `styleChange` event that traverses up to the live `GlTextureSystem` (still alive on
    // the shared host). With our sprites still parented to root, the events route correctly.
    //
    // The destroys are spread across multiple frames via the shared host's ticker: a sync sweep over the gameplay
    // view's full texture set (skin chrome + every #BGA frame slot + per-key bombs, often several hundred entries)
    // hits the GL backend with one `gl.deleteTexture` per call back-to-back, and the driver-side flush stalls the
    // transition into the result scene by 30–80 ms on lower-end devices. Staggering at 8 textures per frame keeps
    // each frame's destroy pass under the per-frame budget while still releasing GPU memory within ~100–200 ms of
    // dispose() returning. The result scene's first paint is unaffected — it draws its own freshly-loaded textures
    // and never references the gameplay set.
    // Let the theme release its own per-view state first; any textures it hands back join the staggered destroy queue
    // after the scene's own.
    const themeTextures = this.disposeTheme();
    try {
      const ticker = this.host?.app.ticker;
      const queue: (Texture | undefined)[] = [
        ...this.textures.values(),
        ...this.bgaTextures.values(),
        ...this.bgaLayerTextures.values(),
        ...themeTextures,
      ];
      const hostIsDisposing = this.host?.isDisposed() === true;
      if (ticker) {
        const cleanup = staggerDestroyTextures(queue, (callback) => {
          ticker.add(callback);
          return () => ticker.remove(callback);
        });
        if (hostIsDisposing) {
          cleanup.drain();
        }
      } else {
        // No live ticker (defensive — host is normally still alive at this point). Fall back to a macrotask scheduler
        // so the destroy chain yields to paint/input between batches rather than monopolizing the current task.
        const cleanup = staggerDestroyTextures(queue, (callback) => {
          let cancelled = false;
          let timeout: ReturnType<typeof setTimeout> | undefined;
          const loop = (): void => {
            if (cancelled) return;
            callback();
            if (!cancelled) timeout = setTimeout(loop, 0);
          };
          timeout = setTimeout(loop, 0);
          return () => {
            cancelled = true;
            if (timeout !== undefined) clearTimeout(timeout);
          };
        });
        if (hostIsDisposing) {
          cleanup.drain();
        }
      }
      this.textures.clear();
      this.bgaTextures.clear();
      this.bgaLayerTextures.clear();
    } catch (error) {
      log.warn('texture cleanup threw', error);
    }
    // Drop every per-frame child pool so the pooled Sprite / Graphics / Text instances are destroyed before the
    // scene-graph subtree below tears them down indirectly. Order matters — the pools' children are parented to the
    // layer Containers we're about to destroy, so going through the pools first means each child is freed via its
    // own `destroy()` (which clears `GraphicsContext` resources) rather than chained through `destroy({children:true})`
    // which can skip some Pixi v8 cleanup paths.
    try {
      this.skinBindingInstance?.dispose();
      this.skinBindingInstance = undefined;
      this.songImages?.dispose();
      this.songImages = undefined;
      for (const crop of this.skinBgaCrops.values()) crop?.close();
      this.skinBgaCrops.clear();
      this.noteLayerPool.destroy();
      this.skinLayerPool.destroy();
      this.overlayLayerPool.destroy();
      this.textLayerPool.destroy();
      this.bombLayerPool.destroy();
      this.bgaLayerPool.destroy();
    } catch (error) {
      log.warn('child pool teardown threw', error);
    }
    // Destroy our scene-graph subtree. With the shared host pattern we never call `app.destroy` here — that would nuke
    // the canvas and the select scene would lose its rendering target.
    try {
      this.root.destroy({ children: true, context: true });
    } catch (error) {
      log.warn('root.destroy threw', error);
    }
    // Drop large per-song reference holders explicitly. Async gates and cancelled browser decode tasks can retain the
    // view for a little while after `dispose()` returns; clearing these fields keeps that short tail from pinning a
    // full chart bundle, decoded PCM, BGA timelines, and skin/font caches.
    this.decodedSamples.clear();
    this.bmsonSlicePlayback = undefined;
    this.autoSampleTriggers = [];

    this.pressedChannels.clear();
    this.lanePressedAt.clear();
    this.laneReleasedAt.clear();
    this.judgeTimings.clear();
    this.longNotes.clear();
    this.longNoteStyle = undefined;
    this.judgeWindows = undefined;
    this.timerStartedAt.clear();
    this.bombStartedAt.clear();
    this.bombJudge.clear();
    this.keyOnFadeOutStart.clear();
    this.wavCmdVolumeMultipliers.clear();
    this.switchingBgas.clear();
    this.bgaSubRegionOrigins.clear();
    this.gaugeHistory.length = 0;
    this.scoreHistory.length = 0;
    this.notes = [];
    this.mineNotes = [];
    this.invisibleNotes.length = 0;
    this.preparedChart = undefined;
    this.touchTokenByChannel = undefined;
    this.resolvedChart = undefined;
    this.resolvedPlayChart = undefined;
    this.randomDraws = undefined;
    this.beatAtSeconds = undefined;
    this.scrollMapper = undefined;
    this.timingResolver = undefined;
    this.bgaTimeline = { base: [], layer: [], poor: [] };
    this.bgaTargetsScratch.length = 0;
    this.laneChannels = [];
    this.laneX.clear();
    this.poorBgaFallbackKey = undefined;
    this.poorBgaFallbackUntilSeconds = Number.POSITIVE_INFINITY;
    this.hasBga = false;
    this.bgaReadyPromise = undefined;
    this.song = undefined;
    this.source = undefined;
    this.host = undefined;
  }

  /**
   * The gauge this run actually plays on. A replay restores the recorded pick so the played-back run judges, drains,
   * and clears exactly as the original did; otherwise it is the host's selection, defaulting to LR2 GROOVE.
   */
  resolveSelectedGauge(): GaugeType {
    return this.options.replay?.play.gauge ?? this.options.gauge ?? 'GROOVE';
  }

  /**
   * Does the ruleset this run judges under show empty POORs inside its POOR counter? LR2 does; beatoraja shows a
   * figure of its own, and IIDX's counter is unmeasured, so both keep them apart.
   */
  private resolveEmptyPoorCountsInPoorDisplay(): boolean {
    const ruleset = this.options.replay?.play.judgeRuleset ?? this.options.judgeRuleset ?? 'lr2';
    return ruleset === 'lr2';
  }

  /** The compat ruleset judging the play (a replay's recorded one wins). */
  resolveJudgeRuleset(): string {
    return this.options.replay?.play.judgeRuleset ?? this.options.judgeRuleset ?? 'lr2';
  }

  /** Whether the engine plays `channel`'s notes itself: every lane under autoplay, the scratch under auto-scratch. */
  isAutoplayedChannel(channel: string): boolean {
    return this.options.autoPlay === true || this.autoScratchChannels.has(channel);
  }

  /**
   * Locates the song's current beat from `currentSeconds` using the BPM-aware tempo points. Required because BMS charts
   * can change tempo mid-song (`#BPM` events) — using the initial BPM alone makes notes after a tempo change drift
   * visibly out of sync with the audio.
   */
  /** True while the wall-clock playhead is still inside the intro buffer. */
  isIntroPlaying(): boolean {
    if (this.startTime === 0) {
      return true;
    }
    return performance.now() < this.startTime;
  }

  /**
   * The tempo the BPM readouts show at `seconds`. Past an LR2 negative-BPM reversal (issue #134) it holds the value at
   * the reversal — LR2's frozen event pump never applies a later BPM event — even though the reverse scroll itself
   * keeps following the forward tempo map.
   */
  nowBpm(seconds: number): number | undefined {
    const resolver = this.timingResolver;
    if (!resolver) return undefined;
    // `displayBpmAtBeat`: a negative `#BPMxx` reads as |trunc(BPM)|, LR2's int NOWBPM.
    return resolver.displayBpmAtBeat(
      this.currentBeat(Math.min(seconds, resolver.reversal?.seconds ?? Number.POSITIVE_INFINITY)),
    );
  }

  /**
   * The BPM the readouts (NOWBPM, the HUD) show at `seconds`: for a stitched NONSTOP chart, whose scroll runs at a
   * constant 150 BPM, the BPM of the stage being played, scaled by its FIT rate (`NonstopStitchMap.tempo`), as LR2
   * shows it; otherwise {@link nowBpm}.
   */
  displayBpm(seconds: number): number | undefined {
    const tempo = this.options.nonstop?.tempo;
    return tempo !== undefined && tempo.length > 0 ? nonstopBpmAt(tempo, seconds) : this.nowBpm(seconds);
  }

  currentBeat(seconds: number): number {
    // LR2 negative-BPM reversal (issue #134): past the first negative `#BPMxx` the chart *visually* scrolls backwards.
    // LR2 mirrors the chart POSITION around the reversal (`2 * pos(R) - pos(now)`), so the reverse scroll runs at the
    // post-reversal |BPM| and pauses through post-reversal STOPs. Every display consumer — renderNotes, measure
    // lines, beatPhase — funnels through this method, so mirroring here covers them all; the forward beat underneath
    // keeps `beatAtSeconds`'s monotonic stop-window cursor intact.
    return mirrorBeatAtTempoReversal(this.timingResolver?.reversal, seconds, this.forwardBeat(seconds));
  }

  private forwardBeat(seconds: number): number {
    // Prefer the proper STOP-aware resolver (built once per song in `prepareSong`). Falls back to a flat-BPM
    // extrapolation when the resolver isn't ready yet (very early frames during mount).
    const resolver = this.timingResolver;
    if (this.beatAtSeconds && resolver && resolver.tempoPoints.length > 0) {
      return this.beatAtSeconds(seconds);
    }
    if (!resolver || resolver.tempoPoints.length === 0) {
      const bpm = this.song?.bpm ?? 130;
      return Math.max(0, seconds * (bpm / 60));
    }
    let active = resolver.tempoPoints[0]!;
    for (const point of resolver.tempoPoints) {
      if (point.seconds <= seconds) {
        active = point;
      } else {
        break;
      }
    }
    return Math.max(0, active.beat + ((seconds - active.seconds) * active.bpm) / 60);
  }

  /**
   * Hands `textures` to Pixi's `PrepareSystem` so the renderer's GPU upload happens NOW, before the first frame that
   * would otherwise touch them. Without this, Pixi defers the upload to the moment a sprite first samples each
   * texture — which means the chart's opening frames pay the cumulative `texSubImage2D` cost of the entire skin
   * sheet (and, mid-chart, the first BGA cue stalls on its image upload). Eager-uploading at prepare time spreads
   * the work across the Decide splash window where the gameplay scene isn't visible yet.
   *
   * The PrepareSystem is conditionally optional — the static `import 'pixi.js/prepare'` at the top of this module
   * registers it when bundled, but we still defensively detect its presence so a future tree-shaking config that
   * eliminates the side-effect import doesn't break the prepare flow at runtime. When absent we silently skip the
   * upload; first-frame stutter returns to the pre-PrepareSystem baseline but nothing else breaks.
   *
   * Errors thrown by the upload (e.g. a corrupt texture, a transient WebGL context loss) are logged and the loop
   * stops — there's no point queuing more uploads on a renderer that just rejected one. The chart still loads; the
   * not-yet-uploaded textures will fall through to lazy upload on first paint, which is the original behavior.
   */
  async preparePixiUpload(textures: Iterable<Texture | undefined>): Promise<void> {
    const renderer = this.host?.app.renderer;
    if (!renderer) return;
    type PrepareLike = { upload: (resource: Texture) => Promise<unknown> };
    const prepare = (renderer as { prepare?: PrepareLike }).prepare;
    if (!prepare || typeof prepare.upload !== 'function') return;
    for (const texture of textures) {
      if (this.disposed) return;
      if (!texture) continue;
      // BGA video textures are skipped: the underlying `<video>` element hasn't decoded any frames yet at prepare
      // time (the chart hasn't started, the cue hasn't fired), so its `videoFrame` / `videoSource` is empty.
      // WebGPU's `copyExternalImageToTexture` rejects an unbacked `<video>` with "Failed to import texture from
      // video element that doesn't have back resource", which Pixi propagates as an uncaught `OperationError`
      // that recurs every frame inside the renderer's PrepareSystem queue. Skipping the eager upload here lets
      // each video texture take Pixi's lazy first-frame path (`Texture.source.update()` once a frame is
      // decoded), which is bounded by the video's natural decode latency rather than a runaway rAF loop.
      if (isVideoTextureSource(texture)) continue;
      try {
        await prepare.upload(texture);
      } catch (error) {
        log.warn('prepare.upload failed; falling back to lazy upload for the rest', error);
        return;
      }
    }
  }

  /**
   * Auto-pause when the document tab / window goes to the background and auto-resume when it comes back to the
   * foreground (matching the LR2 desktop client behavior). The user can still toggle manually with Space without
   * conflicting with this listener — `togglePause` is a symmetric flip, and we only fire it when the visibility state
   * actually changes.
   */
  private readonly handleVisibilityChange = (): void => {
    log.info('visibilitychange', {
      visibilityState: document.visibilityState,
      hidden: document.hidden,
      paused: this.paused,
      autoPaused: this.autoPaused,
      autoPauseOnBlur: this.autoPauseOnBlur,
    });
    // Auto-pause when the tab goes hidden (only if the host opted in). The auto-RESUME path stays unconditional — if we
    // previously auto-paused, we must auto-resume regardless of the toggle's current value, otherwise turning the
    // toggle off mid-blur would strand gameplay in a paused state with no obvious way out.
    if (document.hidden) {
      if (!this.paused && this.autoPauseOnBlur) {
        this.togglePause();
        this.autoPaused = true;
      }
    } else if (this.autoPaused && this.paused) {
      this.togglePause();
      this.autoPaused = false;
    }
  };

  /** True iff we paused because the tab/window backgrounded itself. */
  private autoPaused = false;
  /**
   * Whether `visibilitychange` / `blur` / `pagehide` should auto-pause gameplay. Seeded from `options.autoPauseOnBlur`
   * (default `false`). The host can flip it at runtime via {@link setAutoPauseOnBlur} — useful for a lil-gui toggle
   * that lets the user opt into the LR2-desktop-style "pause when I Cmd-Tab away" behavior.
   */
  private autoPauseOnBlur = false;
  /** Last sampled `document.hidden`, used by the polling safety net. */
  private lastHidden = false;
  /** Last sampled `document.hasFocus()`, used by the polling safety net. */
  private lastFocus = true;
  /** `setInterval` handle for the visibility/focus poll loop. */
  private visibilityPollHandle: number | undefined;

  /**
   * Resolves when {@link prepareBga} has loaded every BGA texture. Set in {@link prepare} (without `await`) so the PLAY
   * scene can be revealed immediately and the LR2 LOADING phase keeps painting while a long-running ffmpeg.wasm video
   * transcode finishes in the background. {@link start} gates the LOAD END timer / chart-start scheduling on this
   * promise so the chart itself doesn't begin until the BGA is actually ready.
   */
  private bgaReadyPromise: Promise<void> | undefined;

  /**
   * Window-level blur/focus fallback for the auto-pause behavior. Some platforms (notably macOS with Chrome) keep the
   * document `visible` across Cmd-Tab app switches, so `visibilitychange` alone misses those cases. We treat `blur` /
   * `focus` the same way as `visibilitychange`, gated on the same `autoPaused` flag so the two listeners cooperate.
   */
  private readonly handleWindowBlur = (): void => {
    log.info('window blur', {
      paused: this.paused,
      autoPaused: this.autoPaused,
      autoPauseOnBlur: this.autoPauseOnBlur,
    });
    // Same opt-in policy as `handleVisibilityChange` — only blur- pause when the host enabled it; auto-resume on focus
    // stays unconditional so flipping the toggle mid-pause can't strand us in a paused state.
    if (!this.paused && this.autoPauseOnBlur) {
      this.togglePause();
      this.autoPaused = true;
    }
  };

  private readonly handleWindowFocus = (): void => {
    log.info('window focus', { paused: this.paused, autoPaused: this.autoPaused });
    if (this.autoPaused && this.paused) {
      this.togglePause();
      this.autoPaused = false;
    }
  };

  private readonly focus = (): void => {
    this.app.canvas.focus();
  };

  /** Holding Backspace for `QUIT_HOLD_THRESHOLD_MS` leaves the play the way Escape does. */
  private readonly quitHold = new QuitHoldController({
    onComplete: () => this.requestExit(),
    now: () => performance.now(),
  });

  private readonly handleQuitHoldKeyUp = (event: KeyboardEvent): void => {
    this.quitHold.handleKeyUp(event);
  };

  private readonly cancelQuitHold = (): void => {
    this.quitHold.cancel();
  };

  /**
   * Captures ESC / F5 in shared-engine mode so the LR2 `#FADEOUT` exit animation runs to completion BEFORE the
   * engine's `PlayerInterruptedError` flow disposes the audio session. Without this intercept, pushing
   * `interrupt(escape)` through the WebInputRuntime would tear down the audio session synchronously inside
   * `manualPlay`'s `finally` block, killing every in-flight `BufferSource` mid-fade — the user hears the chart
   * audio cut to silence the moment ESC fires while the LR2 fadeout overlay is still painting.
   *
   * The handler kicks off `beginExitSequence` (which fades `audioBus.fadeOutAudibleTo(0)` over the LR2 fadeout
   * duration). Once the fade callback resolves, we abort the engine's `AbortController` so the engine throws and
   * unwinds normally — the audio session is already silent by then, so the in-flight-source `node.stop()` calls
   * have nothing audible to interrupt.
   */
  private readonly handleSharedEngineExitKey = (event: KeyboardEvent): void => {
    // Backspace first: its auto-repeat must still be `preventDefault`ed, which the repeat filter below would skip.
    if (this.quitHold.handleKeyDown(event)) return;
    if (event.repeat) return;
    if (event.code === 'Escape') {
      event.preventDefault();
      this.requestExit();
      return;
    }
    if (event.code === 'F5') {
      event.preventDefault();
      this.beginExitSequence(() => {
        this.interruptSharedEngine('restart');
        this.sharedEngineAbortController?.abort();
        this.options.onRestart?.();
      });
      return;
    }
    if (event.code === 'Space') {
      event.preventDefault();
      this.togglePause();
      return;
    }
    // HiSpeed adjustment runs entirely on the view side — the engine has its own `high-speed` input command but
    // the value it tracks is decoupled from the visual scroll speed (`PIXELS_PER_BEAT * this.hiSpeed`) the
    // renderer applies. The WebInputRuntime's lane-input dispatch ignores arrow tokens, so the engine has no
    // way to push HiSpeed changes back to the renderer; we handle them directly here.
    if (event.code === 'ArrowUp') {
      event.preventDefault();
      this.adjustHiSpeed(HISPEED_STEP);
      return;
    }
    if (event.code === 'ArrowDown') {
      event.preventDefault();
      this.adjustHiSpeed(-HISPEED_STEP);
    }
  };

  /**
   * Adjust the visual hi-speed and clamp to [HISPEED_MIN, HISPEED_MAX]. Snap to a 1/1000 grid so accumulated press
   * deltas don't drift off the natural 0.1 grid through float-rounding noise — `0.1` has no exact IEEE-754
   * representation, so adding it 13 times in a row would otherwise produce `1.5000000000000002` and then
   * `1.6000000000000003` etc., visibly off-by-one in the digit panel. The 1/1000 snap absorbs that without breaking
   * even finer steps if HISPEED_STEP shrinks again later.
   */
  private adjustHiSpeed(delta: number): void {
    if (this.options.hiSpeedLocked === true) return;
    // The step moves the player's hi-speed (on their own scale, as the readout shows it); HS-FIX scales the drawn one.
    const next = stepPlayerHiSpeed(this.playerHiSpeed, delta, this.hsFixMultiplier);
    if (next === undefined || next.player === this.playerHiSpeed) return;
    this.playerHiSpeed = next.player;
    this.hiSpeed = next.drawn;
    this.scrollHiSpeed.retarget(next.drawn, performance.now());
    this.options.onHiSpeedChange?.(next.player);
  }

  /**
   * Sets the hi-speed from the host (e.g. a settings menu) while the scene is mounted. `value` is on the scale of
   * {@link CoreGameplayViewOptions.initialHiSpeed}: the chart's HS-FIX multiplier is applied on top, as at mount.
   * Snapped and clamped like the in-game hotkey; non-finite values are ignored.
   */
  public setHiSpeed(value: number): void {
    const next = stepPlayerHiSpeed(value, 0, this.hsFixMultiplier);
    if (next === undefined) return;
    this.playerHiSpeed = next.player;
    if (next.drawn === this.hiSpeed) return;
    this.hiSpeed = next.drawn;
    this.scrollHiSpeed.retarget(next.drawn, performance.now());
  }

  /**
   * Applies the HS-FIX multiplier to {@link hiSpeed} once `prepareSong` has installed the timing resolver. The player's
   * hi-speed is the one they want at `referenceBpm` (`#BASEBPM`, else the start BPM); HS-FIX rescales it so the scroll
   * at another BPM of the chart feels like that, as beatoraja's fixed hi-speed modes do (`LaneRenderer.init`):
   *
   * - `OFF` — leave HS as-is (beatoraja `OFF`; its `STARTBPM` is the same here, since the reference is the start BPM).
   * - `MAXBPM` — scale by `referenceBpm / maxBPM` (beatoraja `MAXBPM`).
   * - `MINBPM` — scale by `referenceBpm / minBPM` (beatoraja `MINBPM`).
   * - `AVERAGE` — scale by `referenceBpm / mainBPM`, the BPM the most notes sit at ({@link resolveChartMainBpm},
   *   beatoraja `MAINBPM`). A time average is skewed by the split-second BPM spikes and STOPs of BPM × N + STOP
   *   gimmicks (an average of ~810 on a 145 BPM chart), the main BPM is not.
   * - `CONSTANT` — true per-frame "constant scroll" needs a render-pipeline change that hasn't landed; falls through
   *   to the `AVERAGE` multiplier so the option still produces a sensible shift instead of doing nothing.
   *
   * Skipped when there are no tempo points (defensive — the resolver can be constructed empty during edge-case mounts)
   * or the chart has no BPM info.
   */
  applyHsFix(resolver: TimingResolver, referenceBpmCandidate: number | undefined, mainBpm: number | undefined): void {
    const mode = this.options.hsFix ?? 'OFF';
    if (mode === 'OFF') return;
    const referenceBpm =
      typeof referenceBpmCandidate === 'number' && referenceBpmCandidate > 0 ? referenceBpmCandidate : undefined;
    if (referenceBpm === undefined) return;
    const tempoPoints = resolver.tempoPoints;
    if (tempoPoints.length === 0) return;
    // |BPM| — a negative `#BPMxx` (LR2 reverse-scroll gimmick) integrates at its magnitude, so the HS-fix range
    // math uses the magnitude too. Zero / non-finite points still drop out via the `> 0` filter.
    const bpms = tempoPoints.map((point) => Math.abs(point.bpm)).filter((bpm) => Number.isFinite(bpm) && bpm > 0);
    if (bpms.length === 0) return;
    let targetBpm: number;
    switch (mode) {
      case 'MAXBPM':
        targetBpm = Math.max(...bpms);
        break;
      case 'MINBPM':
        targetBpm = Math.min(...bpms);
        break;
      default:
        targetBpm = mainBpm ?? referenceBpm;
        break;
    }
    const multiplier = referenceBpm / targetBpm;
    if (!Number.isFinite(multiplier) || multiplier <= 0) return;
    this.hsFixMultiplier = multiplier;
    this.hiSpeed = snapHiSpeed(this.hiSpeed * multiplier) ?? this.hiSpeed;
    // Chart setup, before the notes are on screen — no glide.
    this.scrollHiSpeed.jump(this.hiSpeed);
  }

  /**
   * The LR2 key-on timer of `channel`'s lane (`resolveLr2LaneTimer`): 100 + lane on 1P, 110 + lane on 2P, keys 1-7 (1-9
   * for 9 KEY, whose lanes all run through the 1P bank).
   */
  resolveKeyOnTimerId(channel: string): number | undefined {
    return resolveLr2LaneTimer('key-on', {
      channel,
      laneIndex: resolveSideRelativeLaneIndex(channel, this.chartPlayVariant),
      playVariant: this.chartPlayVariant,
    });
  }

  private startKeyOnTimer(channel: string): void {
    this.lanePressedAt.set(channel, this.playClock());
    const timerId = this.resolveKeyOnTimerId(channel);
    if (timerId === undefined) {
      return;
    }
    this.timerStartedAt.set(timerId, this.playClock());
    // A fresh press cancels any in-flight release fade on the same lane; the laser is fully on again from this instant.
    this.keyOnFadeOutStart.delete(timerId);
  }

  /**
   * Smoothly extinguishes the lane laser when a key (or auto LN head) releases: the LR2 key-on timer (100..117) stays
   * in its currently-active state for {@link resolveKeyOnFadeMs} ms while a render-time alpha taper drives the visible
   * amplitude down to 0, then the timer entry itself is deleted. Anchored on `playClock` so the fade pauses cleanly
   * with the rest of the scene.
   *
   * The taper is what makes manual key-ups, auto-judged short notes (via {@link flashKeyOnTimer}), and auto-LN releases
   * all decay at the same speed without restarting the key-on keyframe (which would blink the LR2 default skin's lane
   * laser back to its fade-in origin before the decay).
   */
  private releaseKeyOnTimer(channel: string): void {
    this.laneReleasedAt.set(channel, this.playClock());
    const timerId = this.resolveKeyOnTimerId(channel);
    if (timerId === undefined) return;
    // Stamp the fade origin unconditionally — the render-side cleanup uses it as the authoritative clock for the
    // 1 → 0 alpha taper, and the previous early-return on a missing `timerStartedAt` left the LN-end path stuck at
    // full brightness whenever the deferred startKeyOnTimer / releaseKeyOnTimer interleaving had already retired
    // the slot (a racy setTimeout cleanup from a previous press could have wiped `timerStartedAt` between the LN's
    // startKeyOnTimer and this release). The `timerStartedAt.has` gate now controls only the deferred cleanup
    // below — the fade start is committed regardless so the render side (lane beam / theme key-on sprites) can taper
    // any still-visible laser through to alpha=0.
    this.keyOnFadeOutStart.set(timerId, this.playClock());
    if (!this.timerStartedAt.has(timerId)) return;
    const fadeMs = this.resolveKeyOnFadeMs(timerId);
    const timeout = window.setTimeout(() => {
      this.keyFlashTimeouts.delete(timeout);
      if (this.disposed) return;
      // If the player (or autoplay) re-pressed the same lane during the fade window, leave the timer running and
      // skip the delete — the new press has its own lifecycle.
      if (!this.pressedChannels.has(channel)) {
        this.timerStartedAt.delete(timerId);
      }
      this.keyOnFadeOutStart.delete(timerId);
    }, fadeMs);
    this.keyFlashTimeouts.add(timeout);
  }

  /**
   * A finger touching down on or moving over the canvas: presses the lane under it, or — when it slid out of the lane it
   * held — releases that lane and presses the new one. Mouse pointers are left alone (a click only focuses the canvas).
   */
  private readonly handleTouchPointer = (event: PointerEvent): void => {
    if (!isTouchPlayPointer(event.pointerType)) return;
    if (event.type === 'pointermove' && !this.touchLanes.isTracking(event.pointerId)) return;
    const { width: designWidth, height: designHeight } = this.stageSize;
    const viewport = resolveScaledViewport(this.app.screen.width, this.app.screen.height, designWidth, designHeight);
    const point = canvasPointToDesign(event.offsetX, event.offsetY, viewport);
    const zones = resolveTouchLaneZones(
      Array.from(this.laneX, ([channel, lane]) => ({ channel, ...lane })),
      {
        stageHeight: designHeight,
      },
    );
    const channel = hitTestTouchLane(zones, point.x, point.y);
    const change =
      event.type === 'pointerdown'
        ? this.touchLanes.down(event.pointerId, channel)
        : this.touchLanes.move(event.pointerId, channel);
    if (event.type === 'pointerdown') event.preventDefault();
    this.pushTouchLaneChange(change, event.timeStamp);
  };

  private readonly handleTouchPointerUp = (event: PointerEvent): void => {
    if (!isTouchPlayPointer(event.pointerType)) return;
    this.pushTouchLaneChange(this.touchLanes.up(event.pointerId), event.timeStamp);
  };

  /** Lifts every finger, e.g. when the play pauses, so no lane stays held through the pause. */
  private releaseAllTouchLanes(): void {
    this.pushTouchLaneChange(this.touchLanes.upAll(), performance.now());
  }

  /**
   * Forwards touch presses / releases to the engine exactly as the keyboard runtime forwards keys: a release as a
   * `kitty-state` release, a press as one `lane-input` per lane (so two lanes tapped together judge two notes) plus a
   * `kitty-state` press that keeps the lane held for long notes and the key beam. `timeStamp` is the event's
   * `DOMHighResTimeStamp`, promoted to the engine's wall-clock domain the same way the keyboard path does.
   */
  private pushTouchLaneChange(change: TouchLaneChange, timeStamp: number): void {
    const signals = this.sharedEngineInputSignals;
    if (!signals || (change.pressed.length === 0 && change.released.length === 0)) return;
    const pressedAt = performance.timeOrigin + timeStamp;
    const releaseTokens = this.resolveTouchTokens(change.released);
    if (releaseTokens.length > 0) {
      signals.pushCommand({ kind: 'kitty-state', pressTokens: [], repeatTokens: [], releaseTokens, pressedAt });
    }
    const pressTokens = this.resolveTouchTokens(change.pressed);
    if (pressTokens.length === 0) return;
    for (const token of pressTokens) signals.pushCommand({ kind: 'lane-input', tokens: [token], pressedAt });
    signals.pushCommand({ kind: 'kitty-state', pressTokens, repeatTokens: [], releaseTokens: [], pressedAt });
  }

  /** The input tokens pressing `channels`: each lane binding's first token, the one its key on the keyboard sends. */
  private resolveTouchTokens(channels: readonly string[]): string[] {
    if (channels.length === 0) return [];
    let tokens = this.touchTokenByChannel;
    if (tokens === undefined) {
      tokens = new Map();
      for (const binding of this.preparedChart?.laneBindings ?? []) {
        const token = binding.inputTokens[0];
        if (token !== undefined && !tokens.has(binding.channel)) tokens.set(binding.channel, token.toLowerCase());
      }
      if (this.preparedChart !== undefined) this.touchTokenByChannel = tokens;
    }
    const resolved: string[] = [];
    for (const channel of channels) {
      const token = tokens.get(channel);
      if (token !== undefined) resolved.push(token);
    }
    return resolved;
  }

  private togglePause(): void {
    if (!this.paused) this.releaseAllTouchLanes();
    if (this.paused) {
      this.paused = false;
      this.pauseTotal += performance.now() - this.pauseTime;
      void this.audioContext?.resume();
      this.resumeActiveBgaVideos();
    } else {
      this.paused = true;
      this.pauseTime = performance.now();
      void this.audioContext?.suspend();
      this.pauseAllBgaVideos();
    }
    // In shared-engine mode the engine maintains its own playback clock + per-tick scheduling; without flipping
    // its pause flag the engine would keep advancing chart-time while the view sits paused, then fast-forward a
    // burst of judge events the moment the view resumes. Propagate the toggle so both sides are aligned. The
    // engine's pause path also calls `audioSession.pause()` / `resume()` which our WebAudioSession maps onto
    // `audioContext.suspend()` / `resume()` — those are idempotent when the context is already in the matching
    // state, so the redundant call from the engine side after our own `audioContext.suspend()` above is a no-op.
    this.sharedEngineInputSignals?.pushCommand({ kind: 'toggle-pause' });
  }

  /**
   * Pause-aware monotonic clock used by every "time since X" animation in the play scene (LR2 timer keyframes,
   * scratch-disc rotation, bomb / FC / POOR-BGA windows, NOWJUDGE / NOWCOMBO decay, …). Returns wall clock minus the
   * accumulated pause duration, and freezes at `pauseTime - pauseTotal` while the scene is paused. Seed sites that
   * drive these animations store `playClock()` values, and the read sites compute `playClock() - seed` — so animations
   * resume exactly where they left off rather than jumping forward by the pause duration.
   */
  playClock(): number {
    if (this.paused) {
      return this.pauseTime - this.pauseTotal;
    }
    return performance.now() - this.pauseTotal;
  }

  /**
   * Pauses every BGA video element in the chart's video pool. The `<video>` element doesn't honor the audio-context
   * suspend, so without this the video keeps playing during a pause overlay.
   */
  private pauseAllBgaVideos(): void {
    for (const handle of this.bgaVideos.values()) {
      if (!handle.video.paused) {
        handle.video.pause();
      }
    }
  }

  /**
   * Resumes only the videos tied to currently-active base / layer cues. Avoids touching videos that were paused for a
   * different reason (e.g. an earlier cue switched away from them in `syncBgaVideo`).
   */
  private resumeActiveBgaVideos(): void {
    for (const track of ['base', 'layer'] as const) {
      const active = this.bgaActiveVideos[track];
      if (!active) continue;
      const handle = this.bgaVideos.get(active.key);
      if (!handle || !handle.video.paused) continue;
      void handle.video.play().catch(() => {
        // Autoplay-policy / codec rejections — ignore silently.
      });
    }
  }

  /**
   * Starts a bomb (hit explosion) on `channel`. The core scene draws it from `bombStartedAt`; themes react through the
   * `bomb` event (the LR2 family stamps its per-lane bomb timer at the same instant).
   */
  private triggerBomb(channel: string, judge?: BeMusicJudge): void {
    const now = this.playClock();
    this.bombStartedAt.set(channel, now);
    if (judge) this.bombJudge.set(channel, judge);
    else this.bombJudge.delete(channel);
    this.onThemeEvent({ kind: 'bomb', channel, at: now });
  }

  private tick = (): void => {
    // Belt-and-suspenders for the rAF-after-dispose race. Even with `app.stop()` removing the renderer's tick listener,
    // our own `cancelAnimationFrame` can lose to a tick that's already mid-flight when ESC fires. Bailing here keeps
    // `render()` from touching destroyed Pixi state.
    if (this.disposed) {
      return;
    }
    this.perf.beginTick();
    const seconds = this.currentSeconds();
    if (!this.paused) {
      // Drain the engine's UI signal buses each frame so frame-snapshot-driven state (score panel, gauge,
      // NOWJUDGE plate) and command-driven visual effects (lane flashes, POOR BGA) stay in sync. The
      // state-applying callbacks were registered at engine launch; here we simply pull from the buses. The
      // engine itself owns judge / sample / chart-end bookkeeping and runs its own tick loop at
      // TUI_FRAME_INTERVAL_MS independent of this rAF.
      this.drainSharedEngineSignals();
      this.updatePlaylogView(seconds);
    }
    this.perf.time('updateFps', () => this.updateFps());
    this.perf.time('updateScores', () => {
      this.updateDisplayedScore();
      this.updateThemeState();
    });
    this.perf.time('render', () => {
      this.render(seconds);
      // A skin drawing through the player's renderer draws the frame just collected now, before Pixi renders.
      this.skinBindingInstance?.flush();
    });
    const report = this.perf.endFrame(() => ({
      stage: this.app.stage.children.length,
      skin: this.skinLayer.children.length,
      overlay: this.overlayLayer.children.length,
      bga: this.bgaLayer.children.length,
      note: this.noteLayer.children.length,
      bomb: this.bombLayer.children.length,
      text: this.textLayer.children.length,
      notesTotal: this.notes.length,
    }));
    if (report) {
      // High-volume (~every sampled frame) — keep on the verbose-only `debug` level so it doesn't drown out the host's
      // Info console with per-frame counts.
      log.debug('perf', report);
    }
  };

  /**
   * Registers the gameplay tick handler on the host's shared `app.ticker`. Replaces the previous self-scheduling rAF
   * loop so we don't run a second `requestAnimationFrame` callback alongside PixiJS's auto-render ticker. The handler
   * itself ({@link tick}) is unchanged — only the scheduling mechanism moved.
   */
  private startAnimationLoop(): void {
    if (this.tickerAttached || !this.host) return;
    this.host.app.ticker.add(this.tick);
    this.tickerAttached = true;
  }

  private stopAnimationLoop(): void {
    if (!this.tickerAttached) return;
    this.host?.app.ticker.remove(this.tick);
    this.tickerAttached = false;
  }

  /**
   * Sample frame rate over a sliding 1-second window. The published value drives theme frame-rate read-outs (the LR2
   * RATE NUMBER panel, which we re-purpose as a frame-rate read-out per the user's request).
   */
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
   * Lerps the displayed score toward the real score so the SCORE panel rolls up after each judgement instead of
   * jumping. Speed is tuned so a single PERFECT (~1000 score) catches up in ~6 frames at 60 fps.
   */
  private updateDisplayedScore(): void {
    const target = this.score.score;
    if (this.displayedScore === target) {
      return;
    }
    const diff = target - this.displayedScore;
    if (Math.abs(diff) < 1) {
      this.displayedScore = target;
      return;
    }
    // Frame-rate independent ease: cover ~30 % of remaining distance per frame.
    const next = this.displayedScore + diff * 0.3;
    this.displayedScore = diff > 0 ? Math.min(next, target) : Math.max(next, target);
  }

  /**
   * Latches at the moment the engine's `manualPlay` / `autoPlay` Promise resolves so the `onChartFinished` /
   * `onExit` callback fires at most once. {@link handleSharedEngineChartFinished} is the only writer.
   */
  chartEnded = false;

  /**
   * Drives the global "fade everything to black" tween while {@link beginExitSequence} is in flight. The skin's
   * authored `#FADEOUT` overlay (if any) only covers whatever the skin artist drew — gameplay-side layers (notes, lane
   * chrome, BGA, shutters, bombs, overlay text) sit *above* `skinLayer` in `designRoot` and would otherwise stay
   * fully visible until the scene is torn down. Fading `designRoot` itself dims every layer uniformly;
   * `viewportBackground` is a sibling of `designRoot` (under `root`), so the page reveals the same `BG` (near-black)
   * the playfield sat against, giving a clean fade-to-black appearance regardless of which lanes are still painting.
   *
   * Called every frame from {@link render}; cheap when the exit sequence isn't running (`designRoot.alpha` is set
   * back to 1 only when it diverges from 1, so steady-state has no GPU cost).
   */
  private applyExitFadeAlpha(): void {
    if (!this.exiting) {
      let alpha = 1;
      if (this.paintsThroughBeMusicSkin) {
        const now = performance.now();
        this.enteredAt ??= now;
        alpha = Math.min(1, (now - this.enteredAt) / BE_MUSIC_ENTER_FADE_MS);
      }
      if (this.designRoot.alpha !== alpha) this.designRoot.alpha = alpha;
      return;
    }
    const fadeOutMs = this.exitFadeOutMs;
    const fadeStart = this.exitFadeStartedAt;
    if (fadeStart === undefined || fadeOutMs <= 0) {
      // Fade hasn't been seeded (or the theme has no fade-out); leave designRoot at full alpha. Close-only themes keep
      // the scene visible until the host transitions us out.
      if (this.designRoot.alpha !== 1) this.designRoot.alpha = 1;
      return;
    }
    const elapsed = this.playClock() - fadeStart;
    this.designRoot.alpha = Math.max(0, Math.min(1, 1 - elapsed / fadeOutMs));
  }

  /**
   * Drives the theme's scene-exit timeline (fade-out → close; LR2 `#FADEOUT` → `#CLOSE`) before handing control back
   * to the host. Raises `exit-fade-out` at call time so theme chrome gated on it (the LR2 family's timer 2, typically a
   * full-screen alpha overlay) plays its authored fade-out; once the fade has elapsed it raises `exit-close` so
   * close-gated chrome (the LR2 default 7-keys STAGE FAILED / CLEARED plate on timer 3) plays before the actual
   * transition fires.
   *
   * Idempotent — re-entry while a fade is in flight is a no-op, so a frantic second ESC press doesn't double-fire the
   * host callback. Themes with no fade-out / close timing collapse to immediate dispatch (the skinless behaviour).
   */
  private beginExitSequence(callback: () => void, options: { fadeAudio?: boolean; minFadeOutMs?: number } = {}): void {
    if (this.exiting || this.disposed) {
      callback();
      return;
    }
    this.exiting = true;
    const closeMs = this.themeTiming.closeMs;
    // A failed play fades out even on a theme without a fade-out of its own (`minFadeOutMs`).
    const fadeOutMs = Math.max(this.themeTiming.fadeOutMs, options.minFadeOutMs ?? 0);
    this.exitFadeOutMs = fadeOutMs;
    if (fadeOutMs <= 0 && closeMs <= 0) {
      callback();
      return;
    }
    const fadeStartedAt = this.playClock();
    this.exitFadeStartedAt = fadeStartedAt;
    this.onThemeEvent({ kind: 'exit-fade-out', at: fadeStartedAt });
    // Drive the audio bus's post-tap fade in lock-step with `applyExitFadeAlpha`'s screen-alpha animation. The fade
    // node sits AFTER the recording tap, so a recording in flight keeps capturing the unattenuated mix; only the
    // speakers go quiet. Skipped when the theme has no fade-out (the screen also stays at full alpha in that path), so
    // a skinless demo gets the historical immediate-cut behavior.
    if (fadeOutMs > 0 && options.fadeAudio !== false) {
      this.audioBus?.fadeOutAudibleTo(0, fadeOutMs);
    }
    const fireClose = (): void => {
      this.onThemeEvent({ kind: 'exit-close', at: this.playClock() });
      this.exitCloseHandle = window.setTimeout(() => {
        this.exitCloseHandle = undefined;
        if (this.disposed) return;
        callback();
      }, closeMs);
    };
    if (fadeOutMs <= 0) {
      fireClose();
      return;
    }
    this.exitFadeOutHandle = window.setTimeout(() => {
      this.exitFadeOutHandle = undefined;
      if (this.disposed) return;
      if (closeMs <= 0) {
        callback();
        return;
      }
      fireClose();
    }, fadeOutMs);
  }

  /**
   * Captures the current play session as a {@link PixiGameplayResultData} snapshot. Returns `undefined` when no song is
   * mounted (defensive — normal flow only calls this after `prepareSong` has run). The snapshot is a plain object so
   * the host can hand it to a result scene that outlives this view.
   */
  public getResultData(): PixiGameplayResultData | undefined {
    if (!this.song) {
      return undefined;
    }
    // Append a final "current values @ now" sample so the polyline reaches the right edge of the chart area even when
    // the last judge fired well before the chart's natural end (e.g. AUTO PERFECTs the final note 5 s before the audio
    // tail clears).
    const totalSeconds = this.resolveSongDurationSeconds();
    const finalProgress = totalSeconds > 0 ? Math.max(0, Math.min(1, this.currentSeconds() / totalSeconds)) : 1;
    const gaugeHistory = [...this.gaugeHistory, { progress: finalProgress, value: this.gaugeState.current }];
    const scoreHistory = [...this.scoreHistory, { progress: finalProgress, exScore: this.score.exScore }];
    return {
      // Shallow-clone the score so a downstream consumer mutating their copy doesn't accidentally rewrite our live
      // state.
      score: { ...this.score },
      maxCombo: this.maxCombo,
      gauge: this.gaugeState.current,
      // The clear rule belongs to the ruleset — a threshold comparison for GROOVE/EASY, "never bottomed out" for
      // the survival gauges — so take the engine's verdict rather than re-deriving it from the percentage.
      cleared: this.gaugeState.cleared,
      playSeconds: this.currentSeconds(),
      song: this.song,
      gaugeHistory,
      scoreHistory,
      ...(this.playlog !== undefined ? { playlog: this.playlog } : {}),
      lamp: resolveClearLamp({
        cleared: this.gaugeState.cleared,
        score: this.score,
        ...(this.gaugeState.type !== undefined ? { gauge: this.gaugeState.type } : {}),
        ruleset: this.resolveJudgeRuleset(),
      }),
      gaugeType: this.gaugeState.type,
      judgeRuleset: this.resolveJudgeRuleset(),
      fast: this.fastCount,
      slow: this.slowCount,
      // `clear` swaps in a fresh list for the next play, so the result can keep this one.
      judgeTimings: this.judgeTimings.all,
    };
  }

  /**
   * Auto-play loop: when enabled, every playable note is judged as PERFECT exactly at its scheduled time. Background
   * lane sounds (`scheduleAutoSamples`) still handle non-input channels separately.
   *
   * Long notes are NOT judged on the head; instead the head time marks the LN as actively held (sample + bomb +
   * sustained key-on timer for the visual lane laser) and the actual scoreboard / gauge / combo commit is deferred to
   * {@link autoFinalizeLongNotes} when chart-time crosses `endSeconds`. This mirrors what real LR2 does (and what
   * `@be-music/player`'s engine does via `pendingAutoLongNotes`): one judgement event per LN, fired at the tail timing
   * so the combo pulse aligns with the LN visually completing rather than at its start.
   */
  /**
   * Brief key-on flash. We start the per-lane LR2 key-on timer (100..107 / 110..117) and schedule it to clear after a
   * short interval so the laser fades like a real keystroke. Used by autoplay (no real keyboard event) so the player
   * still sees the lane / key visuals react.
   */
  /**
   * Auto-judged short notes simulate a "press + release" in one tick: the lane laser lights up immediately (timer set
   * to `playClock()` so the LR2 key-on keyframe begins) and stays at peak alpha for {@link KEY_ON_FLASH_HOLD_MS} before
   * handing off to the release-fade path. Without that brief hold the sprite would taper from full to invisible across
   * the first 1–2 render frames and the press would read as a single-frame blink rather than a deliberate flash.
   */
  private flashKeyOnTimer(channel: string): void {
    this.startKeyOnTimer(channel);
    const timeout = window.setTimeout(() => {
      this.keyFlashTimeouts.delete(timeout);
      if (this.disposed) return;
      // A real press took over during the hold — skip the auto-release, the press lifecycle is in charge. (LN
      // sustains drive their own `hold-lane-until-beat` timer keep-alive via `applyEngineCommand`.)
      if (this.pressedChannels.has(channel)) {
        return;
      }
      this.releaseKeyOnTimer(channel);
    }, KEY_ON_FLASH_HOLD_MS);
    this.keyFlashTimeouts.add(timeout);
  }

  /**
   * Chart-time seconds since the first beat, derived from the audio context clock so it stays *bit-exact* with
   * scheduled `node.start()` times across pause / resume cycles. The wall-clock approach we used previously
   * (`performance.now() - pauseTotal`) drifted out of sync with the audio context on every pause because `suspend()`
   * and `resume()` are asynchronous: the audio clock paused a few ms after we recorded `pauseTime` and resumed a few ms
   * before we credited `pauseTotal`, so each toggle slid the two clocks apart by ~10–30 ms.
   *
   * Anchoring everything on `audioContext.currentTime` removes that accumulating drift entirely. For environments where
   * the audio context isn't ready yet we fall back to the wall-clock model.
   */
  currentSeconds(): number {
    if (this.audioContext && this.audioContextStartTime > 0) {
      return this.tempoClock.chartSecondsAt((this.audioContext.currentTime - this.audioContextStartTime) * 1000);
    }
    const nowMs = this.paused ? this.pauseTime : performance.now();
    return this.tempoClock.chartSecondsAt(nowMs - this.startTime - this.pauseTotal);
  }

  /** The play tempo in force: the one the play started at, or the last change. */
  public getTempo(): number {
    return this.tempo;
  }

  /** The player's hi-speed in force (on the scale of `initialHiSpeed`), a replay's recorded one included. */
  public getHiSpeed(): number {
    return this.playerHiSpeed;
  }

  /**
   * Changes the play tempo during the play (clamped by `clampPlayTempo`). Only in `pitch` mode: the samples follow it
   * through their playback rate, playing ones included, and so do the BGA videos and a NONSTOP chart's fades. Keep
   * pitch stretched the samples to the tempo they loaded at, and a replay follows its log, so both refuse it. The
   * engine applies it at the chart time it takes the command and records it in the play log; the view follows from the
   * chart second the engine reports. Returns whether the change was taken.
   */
  public setTempo(tempo: number): boolean {
    return !this.disposed && this.liveTempo.request(tempo);
  }

  /** Follows a tempo change the engine made: the view's clock, the BGA videos, the NONSTOP fades and the host. */
  private followTempoChange(change: PlayerTempoChange): void {
    if (this.disposed) return;
    this.tempo = change.tempo;
    this.tempoClock.setTempoAtChartSeconds(change.seconds, change.tempo);
    setVideoPlaybackTempo(
      [...this.bgaVideos.values()].map((handle) => handle.video),
      change.tempo,
    );
    if (this.audioContext && this.audioContextStartTime > 0) {
      const chartStart = this.audioContextStartTime;
      this.nonstopMixer?.retime(
        this.currentSeconds(),
        (seconds) => chartStart + this.tempoClock.clockMsAt(seconds) / 1000,
      );
    }
    this.options.onTempoChange?.(change.tempo);
  }

  private publishJudge(judge: JudgeKind, seconds: number, channel?: string): void {
    const until = seconds + 0.6;
    this.lastJudge = judge;
    this.lastJudgeUntil = until;
    this.lastJudgeAt = this.playClock();
    // Themes restart their per-side judge animation on every judgement (LR2 timer 46 / 47 drives the attached
    // `#DST_NOWJUDGE` / `#DST_NOWCOMBO` chains from time=0 per hit). When `channel` isn't supplied (legacy callers) we
    // default to the 1P side. PMS / 9 KEY is single-side so every judgement collapses onto 1P regardless of the
    // sourcing channel — the LR2 9-key skin authors only the 1P judge plate (channels 22..25 belong to the central /
    // right half of the Pop'n nine-lane bank, not the second player).
    const isPlayer2 = this.chartPlayVariant !== '9' && typeof channel === 'string' && channel.startsWith('2');
    const side: '1P' | '2P' = isPlayer2 ? '2P' : '1P';
    this.onThemeEvent({ kind: 'judge', side, at: this.playClock() });
    // Snapshot the verdict + combo for this side so DP rendering shows each lane group's *own* combo number — frozen at
    // the moment that side last hit a note — rather than mirroring the global running combo on both sides.
    // A course stage also snapshots the course combo, which an LR2 skin shows there during an expert or grade course.
    this.judgeSideState[side] = {
      judge,
      until,
      combo: this.tracker.combo,
      ...(this.courseCombo !== undefined ? { courseCombo: this.courseCombo.combo } : {}),
    };
    // POOR / BAD judgements briefly swap the base BGA for the chart's POOR BGA. We trigger the same window for `BAD`
    // because the LR2 spec doesn't distinguish the two for the BGA channel.
    if (judge === 'POOR' || judge === 'BAD') {
      this.lastPoorAt = this.playClock();
    }
    // Mirror the running combo into our high-water mark. `tracker.combo` resets on every BAD/POOR, so this captures the
    // longest unbroken GREAT-or-better streak the player has reached so far. Used as the "MAX COMBO" readout for the
    // result screen — see `getResultData`.
    if (this.tracker.combo > this.maxCombo) {
      this.maxCombo = this.tracker.combo;
    }
    // Append a sample to the result-screen polyline histories. We do this in `publishJudge` (rather than at each judge
    // call site) because every gauge / EX-score change funnels through the same judgement path — adding the sample once
    // here keeps the three judge sites (manual hit, auto-PERFECT, auto-miss) symmetric.
    const totalSeconds = this.resolveSongDurationSeconds();
    const progress = totalSeconds > 0 ? Math.max(0, Math.min(1, seconds / totalSeconds)) : 0;
    this.gaugeHistory.push({ progress, value: this.gaugeState.current });
    this.scoreHistory.push({ progress, exScore: this.score.exScore });
    this.maybeFireFullCombo();
  }

  /**
   * Raises the `full-combo` theme event (LR2 timers 48 = 1P, 49 = 2P) the moment the player's running combo equals the
   * chart's playable note count — i.e. every note has been hit GREAT-or-better and the chain never broke. Latches
   * `fullComboFired` so subsequent judges don't re-raise it (which would replay the skin's FC slide-in animation from
   * time=0).
   *
   * AUTO mode also reaches this state on the very last note (every judge is auto-PERFECT, so combo === total at the
   * end) — the player specifically asked for the FC presentation to fire in AUTO too, which falls out for free since
   * the path is the same `applyJudgeToSummary` → `publishJudge` chain manual play uses.
   *
   * One event covers both sides because we don't yet model per-side combos. For DP this is correct (one player, one
   * combo). Battle mode would split.
   */
  private maybeFireFullCombo(): void {
    if (this.fullComboFired) return;
    if (this.score.bad > 0 || this.score.poor > 0) return;
    if (this.score.total <= 0) return;
    if (this.tracker.combo < this.score.total) return;
    this.fullComboFired = true;
    this.onThemeEvent({ kind: 'full-combo', at: this.playClock() });
    log.info('FULL COMBO');
  }

  private render(seconds: number): void {
    const screenWidth = this.app.screen.width;
    const screenHeight = this.app.screen.height;
    const { width: designWidth, height: designHeight } = this.stageSize;
    const viewport = resolveScaledViewport(screenWidth, screenHeight, designWidth, designHeight);
    setDesignTextResolution(resolveDesignTextResolution(viewport.scale, this.app.renderer.resolution));
    setDesignPixelRatio(viewport.scale * this.app.renderer.resolution);
    // Only rebuild the static rect graphics when their backing dimensions actually change. The previous unconditional
    // `.clear().rect().fill()` chain ran on every rAF tick and rebuilt the GraphicsContext for each — Pixi v8 has no
    // change-detection built in.
    if (this.cachedScreenWidth !== screenWidth || this.cachedScreenHeight !== screenHeight) {
      this.viewportBackground.clear().rect(0, 0, screenWidth, screenHeight).fill(BG);
      this.cachedScreenWidth = screenWidth;
      this.cachedScreenHeight = screenHeight;
    }
    this.designRoot.position.set(viewport.x, viewport.y);
    this.designRoot.scale.set(viewport.scale);
    this.stampDesignRect(this.stageSize);
    this.host?.setStageOrientation(resolveStageOrientation(this.stageSize));
    this.applyExitFadeAlpha();
    this.audioFrame = this.audioAnalyzer?.sample(this.playClock());
    this.perf.time('renderSkin', () => this.renderThemeLayer(designWidth, designHeight));
    // LR2 negative-BPM reversal: the event pump stops firing BGA cues there, so the cue clock is clamped (freeze, not
    // rewind) while an already-playing movie keeps running on the true clock. All other `seconds` readers here
    // (progress ratio, time readouts, judge-until comparisons) stay on the true clock.
    const reversalSeconds = this.timingResolver?.reversal?.seconds;
    const bgaCueSeconds = reversalSeconds === undefined ? seconds : Math.min(seconds, reversalSeconds);
    this.perf.time('renderBga', () => this.renderBga(seconds, bgaCueSeconds));
    this.perf.time('renderLanes', () => renderLanes.call(this, designWidth, designHeight));
    this.perf.time('renderNotes', () => renderNotes.call(this, seconds, designHeight));
    this.perf.time('renderShutter', () => renderShutter.call(this));
    this.perf.time('renderBombs', () => renderBombs.call(this));
    this.perf.time('renderText', () => renderText.call(this, designWidth, designHeight, seconds));
  }

  /**
   * Draws every active bomb into `bombLayerPool` (between the pool's `begin` / `end`). Defaults to the be-music skin's
   * bomb effect; themes that ship their own bomb sheet override it.
   */
  protected renderBombEffects(): void {
    renderBombEffects.call(this);
  }

  private skinBindingInstance: BeMusicGameplayBinding | undefined;
  /** Song images handed to the be-music skin (`frame.songImage`), from the playing song's asset source. */
  private songImages: SongImageCache | undefined;

  /**
   * The be-music skin's gameplay binding while the scene paints through a skin: lanes, notes, and hit effects are handed
   * to it as data and the skin draws them on its own canvas. `undefined` for themes, whose missing pieces (lanes, notes
   * without a cell, bombs) are drawn here in the built-in Phantom style instead.
   */
  get skinBinding(): BeMusicGameplayBinding | undefined {
    const skin = this.options.beMusicSkin;
    if (!skin || this.options.skinlessChromeRenderer) return undefined;
    if (!this.skinBindingInstance) {
      this.songImages = new SongImageCache({
        resolveSource: (song) =>
          this.source !== undefined && song.sourceId === this.source.id ? this.source : undefined,
      });
      this.skinBindingInstance = new BeMusicGameplayBinding(skin, {
        songImage: this.songImages.lookup,
        settings: this.beMusicSkinSettings,
        renderer: this.host?.app.renderer,
      });
    }
    return this.skinBindingInstance;
  }

  /**
   * Replaces the player's values for the be-music skin's `settings` (see the `beMusicSkinSettings` option); the skin
   * draws with them from the next frame. `undefined` goes back to the skin's defaults.
   */
  public setBeMusicSkinSettings(stored: Readonly<Record<string, unknown>> | undefined): void {
    this.beMusicSkinSettings = stored;
    this.skinBindingInstance?.setSettings(stored);
  }

  /**
   * Composites the chart's BGA into the theme's BGA rectangles ({@link collectBgaTargets}; the default-family BGA
   * rectangle unless a theme supplies its own). Three layers stack from back to front: base (channel 04 / bmson `bga.events`), layer
   * (channel 07 / 0A / bmson `layerEvents`), and a POOR override (channel 06 / `poorEvents`) that briefly replaces the
   * base while the player is inside the POOR-judgement window (`DEFAULT_POOR_BGA_DISPLAY_SECONDS`).
   *
   * The renderer is idempotent per frame — it tears down any existing sprites and rebuilds from the active cues, so cue
   * switches show up the next frame without explicit dirty tracking.
   */
  /**
   * `cueSeconds` picks which BGA cue is active; `seconds` is the true clock that plays the cue (movie offsets, SWBGA
   * frames). They differ only past an LR2 negative-BPM reversal, where the event pump stops firing new BGA cues but a
   * movie that is already playing keeps running.
   */
  private renderBga(seconds: number, cueSeconds = seconds): void {
    this.bgaLayerPool.begin();
    this.bgaTargetsScratch.length = 0;
    // Honor the LR2 panel-1 BGA toggle (`#SRC_BUTTON,type=72`). - `'OFF'` → never render - `'AUTOPLAY_ONLY'` → render
    // only when autoplay is on - `'ON'` (default) → render whenever the chart has BGA
    const bgaMode = this.options.bga ?? 'ON';
    if (bgaMode === 'OFF') {
      this.bgaLayerPool.end();
      return;
    }
    if (bgaMode === 'AUTOPLAY_ONLY' && !this.options.autoPlay) {
      this.bgaLayerPool.end();
      return;
    }
    if (!this.hasBga) {
      this.bgaLayerPool.end();
      return;
    }
    // Render into EVERY rectangle the theme reports this frame (a DP LR2 skin can show several at once).
    const visibleBgas = this.bgaTargetsScratch;
    this.collectBgaTargets(visibleBgas);
    if (visibleBgas.length === 0) {
      this.bgaLayerPool.end();
      return;
    }
    // Drive video BGA playback once per frame (not per-rect) — base / layer cues are global to the chart, every rect
    // shows the same source video. Picking the first visible entry's `noBase` / `noLayer` flags as the controlling ones
    // is fine in practice: the LR2 default skin uses identical flags on every rect, and a future skin that mixes them
    // per-rect would still get a consistent global playback state from this single sync point.
    const controllingBga = visibleBgas[0]!;
    const poorWindowMs = DEFAULT_POOR_BGA_DISPLAY_SECONDS * 1000;
    const inPoorWindow =
      !controllingBga.noPoor && this.lastPoorAt > 0 && this.playClock() - this.lastPoorAt < poorWindowMs;
    // A stitched NONSTOP chart shows one BGA stack per stage, crossfading at the seams; any other chart one stack.
    const stacks = this.resolveBgaStacks(
      cueSeconds,
      controllingBga.noBase === true,
      controllingBga.noLayer === true,
      inPoorWindow,
    );
    const leading = stacks.reduce<(typeof stacks)[number] | undefined>(
      (best, stack) => (best === undefined || stack.alpha >= best.alpha ? stack : best),
      undefined,
    );
    const baseCue = leading?.baseCue;
    const layerCue = leading?.layerCue;
    const baseKey = baseCue?.bmpKey;
    const layerKey = layerCue?.bmpKey;
    let poorKey = this.nonstopBgaTimelines !== undefined ? leading?.poorKey : undefined;
    if (inPoorWindow && this.nonstopBgaTimelines === undefined) {
      poorKey = pickActiveBgaKey(this.bgaTimeline.poor, cueSeconds);
    }
    // BMP00 fallback: when no explicit POOR cue is active but the chart left `#POORBGA` blank with a `#BMP00` defined,
    // paint BMP00 during the miss window. Capped at the first authored POOR cue's chart-time so a chart that does
    // eventually author POOR isn't permanently stuck on the placeholder.
    if (
      inPoorWindow &&
      poorKey === undefined &&
      this.poorBgaFallbackKey !== undefined &&
      cueSeconds < this.poorBgaFallbackUntilSeconds
    ) {
      poorKey = this.poorBgaFallbackKey;
    }
    if (this.nonstopBgaTimelines === undefined && stacks[0] !== undefined) stacks[0].poorKey = poorKey;
    this.syncBgaVideo('base', baseCue, seconds);
    this.syncBgaVideo('layer', layerCue, seconds);

    const binding = this.skinBinding;
    if (binding?.drawsBga) {
      // The skin composites the BGA itself: hand it the images and leave the BGA layer empty.
      binding.setBga(
        buildSkinBgaFrame(
          {
            base: baseKey !== undefined ? this.resolveBgaFrameKey(baseKey, baseCue?.seconds, seconds) : undefined,
            layer: layerKey !== undefined ? this.resolveBgaFrameKey(layerKey, layerCue?.seconds, seconds) : undefined,
            poor: poorKey,
          },
          (key, track) =>
            this.resolveSkinBgaImage((track === 'layer' ? this.bgaLayerTextures : this.bgaTextures).get(key)),
        ),
      );
      this.bgaLayerPool.end();
      return;
    }

    for (const bga of visibleBgas) {
      if (bga.w <= 0 || bga.h <= 0) continue;
      const drawLayer = (
        key: string | undefined,
        textures: ReadonlyMap<string, Texture>,
        layerName: 'base' | 'layer' | 'poor',
        cueSeconds: number | undefined,
        alpha = 1,
      ): void => {
        if (!key) return;
        const resolvedKey = this.resolveBgaFrameKey(key, cueSeconds, seconds);
        const texture = textures.get(resolvedKey);
        if (!texture) return;
        // The rect stands for the 256x256 BMS canvas: an image that fits it keeps its pixel size there, centered
        // horizontally and top-aligned (a 256x161 frame leaves a band at the bottom), while a larger image or a
        // video fills the rect, as LR2 and beatoraja do.
        const placed = this.bgaVideos.has(resolvedKey)
          ? bga
          : resolveBgaImageRect(
              texture.frame.width,
              texture.frame.height,
              bga,
              this.bgaSubRegionOrigins.get(resolvedKey),
            );
        if (layerName !== 'layer' && (placed.w < bga.w || placed.h < bga.h)) {
          // The base canvas around a small image is black (a 1x1 black BMP blanks the BGA in LR2 and beatoraja), so
          // fill the rect before drawing the image; the layer track's canvas stays transparent.
          const backdrop = this.bgaLayerPool.acquireSprite();
          backdrop.texture = Texture.WHITE;
          backdrop.label = `bga/${layerName}/canvas`;
          backdrop.position.set(bga.x, bga.y);
          backdrop.width = bga.w;
          backdrop.height = bga.h;
          bga.applyToSprite(backdrop);
          backdrop.tint = 0x000000;
          backdrop.alpha *= alpha;
        }
        const sprite = this.bgaLayerPool.acquireSprite();
        sprite.texture = texture;
        sprite.label = `bga/${layerName}[key=${resolvedKey}]`;
        sprite.position.set(placed.x, placed.y);
        sprite.width = placed.w;
        sprite.height = placed.h;
        bga.applyToSprite(sprite);
        sprite.alpha *= alpha;
        // BMS spec — `#ARGBxx AARRGGBB` (and the ARGB tuple embedded in `#EXBMPxx a,r,g,b,filename`) declare the BMP
        // slot's alpha + RGB tint for layer composition. Apply the parsed values via Pixi's per-sprite `tint` (RGB
        // multiply) and `alpha` (overall opacity); the default `#FFFFFFFF` round-trips to `tint = 0xFFFFFF` / `alpha =
        // 1` which is the no-op identity, so charts that omit both directives see no change. `resolveBmsBmpArgb`
        // prefers `#ARGBxx` over the `#EXBMPxx`-embedded tuple when both target the same slot, matching the LR2 /
        // beatoraja precedence. BGA-cue keys come from `buildBgaTimelines`, which routes through `normalizeObjectKey` —
        // exactly the same key normalization the parser applies to the `chart.bms.argb` / `chart.bms.exBmp` maps, so
        // the direct lookup matches.
        const resolvedChart = this.resolvedChart;
        if (resolvedChart) {
          // Tint resolution honors the original cue key first (so `#ARGBxx 01` applies even when `#SWBGA01` is ALSO
          // active and the per-frame source slot lacks its own tint). Falling back to the resolved frame key catches
          // the inverse case: chart tints the source `#BMPYY` slot but not the `#SWBGA01` alias.
          const argb = resolveBmsBmpArgb(resolvedChart, key) ?? resolveBmsBmpArgb(resolvedChart, resolvedKey);
          if (argb) {
            sprite.tint = (argb.r << 16) | (argb.g << 8) | argb.b;
            // Compose with the call-site alpha that `applyToSprite` may have already written (e.g. skin-driven LR2
            // fades) so the chart-level α stacks multiplicatively rather than overriding it.
            sprite.alpha *= argb.a / 255;
          }
        }
      };
      for (const stack of stacks) {
        if (stack.poorKey) {
          // POOR uses base-mode decoding (no chroma key) since it replaces the stack's base+layer composite during its
          // window. POOR has no per-cue origin time we can hand to `drawLayer` for `#SWBGAxx` frame timing; chart
          // authors don't typically pair POOR with switching BGA, and a static frame is the safer fallback.
          drawLayer(stack.poorKey, this.bgaTextures, 'poor', undefined, stack.alpha);
          continue;
        }
        // `cue.seconds` anchors switching-BGA frame timing — `pickSwitchingBgaFrame` advances frames relative to when
        // the cue fired, not relative to the chart origin.
        drawLayer(stack.baseCue?.bmpKey, this.bgaTextures, 'base', stack.baseCue?.seconds, stack.alpha);
        // Layer track is composited on top with black→transparent so the base track shows through where the
        // foreground BMP is empty.
        drawLayer(stack.layerCue?.bmpKey, this.bgaLayerTextures, 'layer', stack.layerCue?.seconds, stack.alpha);
      }
    }
    this.bgaLayerPool.end();
  }

  /**
   * The BGA stacks to draw at `cueSeconds`: the chart's base and layer cues at full opacity, or for a stitched NONSTOP
   * chart each stage's own cues (and, during a POOR, its own POOR image) at the opacity of its crossfade, earlier
   * stages first.
   */
  private resolveBgaStacks(
    cueSeconds: number,
    noBase: boolean,
    noLayer: boolean,
    inPoorWindow: boolean,
  ): Array<{ alpha: number; baseCue: BgaCue | undefined; layerCue: BgaCue | undefined; poorKey?: string }> {
    const pick = (
      timeline: { base: readonly BgaCue[]; layer: readonly BgaCue[]; poor?: readonly BgaCue[] },
      alpha: number,
    ) => ({
      alpha,
      baseCue: noBase ? undefined : pickActiveBgaCue(timeline.base, cueSeconds),
      layerCue: noLayer ? undefined : pickActiveBgaCue(timeline.layer, cueSeconds),
      ...(inPoorWindow && timeline.poor !== undefined ? { poorKey: pickActiveBgaKey(timeline.poor, cueSeconds) } : {}),
    });
    const stages = this.options.nonstop?.stages;
    const timelines = this.nonstopBgaTimelines;
    if (stages === undefined || timelines === undefined) {
      // The chart's own POOR cue (with its `#BMP00` fallback) is resolved by the caller.
      return [pick({ base: this.bgaTimeline.base, layer: this.bgaTimeline.layer }, 1)];
    }
    return stages.flatMap((stage, index) => {
      const alpha = resolveNonstopBgaAlpha(stage, cueSeconds);
      return alpha > 0 ? [pick(timelines[index]!, alpha)] : [];
    });
  }

  /**
   * The slot to show for the BGA cue `key` that fired at `cueSeconds`. BMS spec — `#SWBGAxx fr:tot:lp:ARGB N1 N2 ...`
   * declares an animated BGA: when the cue's slot matches a parsed entry, advance through its frame list at the
   * authored interval and show the source `#BMPxx` of the currently-visible frame. Otherwise (no `#SWBGAxx` entry, or
   * no cue time as for POOR) `key` itself.
   */
  private resolveBgaFrameKey(key: string, cueSeconds: number | undefined, seconds: number): string {
    if (cueSeconds === undefined) return key;
    const swBga = this.switchingBgas.get(key);
    if (!swBga) return key;
    const elapsedMs = Math.max(0, (seconds - cueSeconds) * 1000);
    return pickSwitchingBgaFrame(swBga, elapsedMs) || key;
  }

  /**
   * Cropped copies of the `#BGAxx` sub-region textures, for a skin that composites the BGA itself (a canvas image can't
   * carry the crop the way a Pixi sub-texture does). `null` while the crop is being made.
   */
  readonly skinBgaCrops = new Map<Texture, ImageBitmap | null>();

  /**
   * The image behind a loaded BGA texture, for `frame.bga`: the decoded bitmap or the `<video>` element itself, or a
   * cropped copy for a `#BGAxx` sub-region (made on first use, so `undefined` for a frame or two).
   */
  private resolveSkinBgaImage(texture: Texture | undefined): BeMusicImage | undefined {
    if (!texture) return undefined;
    const source = texture.source;
    const resource = source.resource as BeMusicImage | undefined;
    if (!resource) return undefined;
    const { frame } = texture;
    if (frame.x === 0 && frame.y === 0 && frame.width === source.width && frame.height === source.height) {
      return resource;
    }
    const crop = this.skinBgaCrops.get(texture);
    if (crop !== undefined) return crop ?? undefined;
    this.skinBgaCrops.set(texture, null);
    createImageBitmap(resource, frame.x, frame.y, frame.width, frame.height).then(
      (bitmap) => {
        if (this.disposed || !this.skinBgaCrops.has(texture)) bitmap.close();
        else this.skinBgaCrops.set(texture, bitmap);
      },
      () => {
        // Leave the `null` marker: the crop isn't retried, the sub-region just doesn't show.
      },
    );
    return undefined;
  }

  /**
   * Drives playback of a video BGA on a single track (`base` or `layer`). When the cue's key matches a known video: -
   * first time it fires, `play()` from the cue's start offset - re-firing the same cue is a no-op (video keeps playing)
   * - switching keys pauses the previous video, then plays the new
   *
   * Static (non-video) cues just clear the active-video record so the next video transition starts fresh. The seek
   * offset uses `seconds - cue.seconds` directly because BMS BGA semantics are "start playing this video from t=0 the
   * moment the cue fires".
   */
  private syncBgaVideo(track: 'base' | 'layer', cue: BgaCue | undefined, seconds: number): void {
    // Hold off on every video state mutation until the chart-start gate has fired and `audioContextStartTime` is
    // anchored to the audio clock. Without this guard `renderBga` (which runs every tick from the moment `start()`
    // reveals the scene) picks up the t=0 BGA cue while we're still in the LR2 LOADING phase and `play()`s the video —
    // the user sees the BGA running behind the LOADING / DONE chrome. By short-circuiting we also avoid populating
    // `bgaActiveVideos[track]`, so when PLAY START fires the next sync call still sees `previous = undefined` and
    // re-enters the "first cue" branch with the correct seek offset.
    if (this.audioContextStartTime === 0) {
      return;
    }
    const previous = this.bgaActiveVideos[track];
    const key = cue?.bmpKey;
    const handle = key ? this.bgaVideos.get(key) : undefined;
    if (!handle) {
      // Cue points at a still image (or nothing). If we were playing a video, pause it.
      if (previous) {
        const prevHandle = this.bgaVideos.get(previous.key);
        if (prevHandle && !prevHandle.video.paused) {
          prevHandle.video.pause();
        }
        this.bgaActiveVideos[track] = undefined;
      }
      return;
    }
    if (previous?.key === key) {
      // Same cue still active — nothing to do; the video plays forward on its own and the Pixi VideoSource pulls fresh
      // frames each tick.
      return;
    }
    if (previous) {
      const prevHandle = this.bgaVideos.get(previous.key);
      if (prevHandle && !prevHandle.video.paused) {
        prevHandle.video.pause();
      }
    }
    const cueSeconds = cue?.seconds ?? 0;
    this.bgaActiveVideos[track] = { key: key!, cueSeconds };
    const offset = Math.max(0, seconds - cueSeconds);
    // The video runs at the play tempo, so its time stays the chart time since its cue.
    handle.video.playbackRate = this.tempo;
    try {
      handle.video.currentTime = Math.min(offset, Math.max(0, handle.video.duration - 0.05) || offset);
    } catch {
      // Some browsers throw on currentTime assignment before the video has its initial buffer. Best-effort — play()
      // below will retry once the buffer arrives.
    }
    void handle.video.play().catch(() => {
      // Autoplay policy / codec rejections — silently swallow so the still-image fallback keeps working.
    });
  }

  /**
   * Milliseconds since the chart's first beat for chrome count-ins. Before the play-start gate opens (`startTime` is
   * still +Infinity) it counts toward the scheduled intro end and holds just below zero if the BGA preload runs long.
   */
  resolveChartMs(): number | undefined {
    if (this.startTime === 0) return undefined;
    if (Number.isFinite(this.startTime))
      return this.tempoClock.chartSecondsAt(performance.now() - this.startTime) * 1000;
    return Math.min(-1, this.playClock() - this.sceneStartTime - this.scheduledIntroMs);
  }

  /** Records the latest key press / autoplay hit for input-reactive skin visuals. */
  private noteImpulse(channel: string): void {
    this.lastImpulseAt = this.playClock();
    this.lastImpulseKind = resolveBeMusicLaneKind(
      channel,
      resolveLr2LaneIndex(channel, this.chartPlayVariant),
      this.chartPlayVariant,
    );
  }

  /**
   * The lane covers of each play side with lanes, as {@link renderShutter} draws them (whether or not it does: a skin
   * that sets `drawsLaneCover` reads them to draw its own). The array and its entries are reused across frames.
   */
  resolveLaneCovers(): readonly BeMusicLaneCover[] {
    let cache = this.laneCovers;
    if (!cache || cache.channels !== this.laneChannels) {
      const covers: BeMusicLaneCover[] = [];
      for (const side of ['1P', '2P'] as const) {
        if (this.laneChannels.some((channel) => isChannelOnSide(channel, side))) {
          covers.push({ side, sudden: 0, hidden: 0, lift: 0 });
        }
      }
      cache = { channels: this.laneChannels, covers };
      this.laneCovers = cache;
    }
    const { laneCover, shutter } = this.options;
    for (const cover of cache.covers) {
      const mode = (cover.side === '1P' ? this.options.hiddenSudden1P : this.options.hiddenSudden2P) ?? 'OFF';
      fillLaneCover(cover, mode, shutter, laneCover);
      // A replay's SUDDEN+ / HIDDEN+ (the scene draws no LIFT, so that stays 0).
      const replayed = this.replayCovers?.find((entry) => entry.side === cover.side);
      if (replayed !== undefined) {
        cover.sudden = replayed.sudden;
        cover.hidden = replayed.hidden;
      }
    }
    return cache.covers;
  }

  /** What the player sees now in the play log's units: the drawn hi-speed on this scene's scale, HS-FIX and covers. */
  private resolvePlaylogView(): PlaylogViewState {
    const covers = this.resolveLaneCovers().map(({ side, sudden, hidden, lift }) => ({ side, sudden, hidden, lift }));
    const view: PlaylogViewState = {
      hiSpeed: this.hiSpeed,
      hiSpeedScale: BE_MUSIC_HI_SPEED_SCALE,
      hsFix: this.options.hsFix ?? 'OFF',
      covers,
    };
    // The visible time at the main BPM without `#SCROLL`, so another scale's replay can match it.
    const visibleMs = this.resolveVisibleMs(covers[0], this.chartBpmRange?.mainBpm, 1);
    if (visibleMs !== undefined && visibleMs > 0) view.visibleMs = visibleMs;
    // At the play log's precision, so cover fractions record without float noise.
    return roundPlaylogView(view);
  }

  /** The view the recorded play log starts from (`play.view`); later changes go through {@link updatePlaylogView}. */
  private startPlaylogView(): PlaylogViewState {
    const view = this.resolvePlaylogView();
    this.playlogViewCoalescer = createPlaylogViewCoalescer(view);
    return view;
  }

  /**
   * Per frame, once the lanes are laid out: while recording, sends the engine what changed in the view (at most one
   * change per 100 ms, so a held key records a few); while replaying, shows the recorded view at the playhead as far as
   * {@link CoreGameplayViewOptions.replayView} asks.
   */
  private updatePlaylogView(seconds: number): void {
    if (this.laneX.size === 0) return;
    if (this.replayViewCursor !== undefined) {
      const recorded = this.replayViewCursor.next(Math.round(seconds * 1_000_000));
      if (recorded !== undefined) this.applyReplayView(recorded);
      return;
    }
    const signals = this.sharedEngineInputSignals;
    if (this.playlogViewCoalescer === undefined || signals === undefined) return;
    const change = this.playlogViewCoalescer.observe(this.resolvePlaylogView(), performance.now());
    if (change !== undefined) signals.pushCommand({ kind: 'view', change });
  }

  /** Sends the engine the view change still held back by the coalescer, as the play ends ({@link updatePlaylogView}). */
  private flushPlaylogView(): void {
    const signals = this.sharedEngineInputSignals;
    if (this.replayViewCursor !== undefined || this.playlogViewCoalescer === undefined || signals === undefined) return;
    if (this.laneX.size === 0) return;
    const change = this.playlogViewCoalescer.flush(this.resolvePlaylogView());
    if (change !== undefined) signals.pushCommand({ kind: 'view', change });
  }

  /**
   * Shows a replay's recorded view over the viewer's own: the covers as recorded, and the hi-speed as recorded on this
   * scale, or matching the recorded visible time when it was played on another (`resolveReplayHiSpeed`).
   */
  private applyReplayView(recorded: PlaylogViewState): void {
    const replay = this.options.replayView ?? DEFAULT_PLAYLOG_VIEW_REPLAY;
    this.replayCovers = undefined;
    const view = resolveReplayView(recorded, this.resolvePlaylogView(), replay);
    if (replay.covers) this.replayCovers = view.covers;
    if (!replay.hiSpeed) return;
    const sudden = view.covers?.[0]?.sudden ?? 0;
    const mainBpm = this.chartBpmRange?.mainBpm;
    const hiSpeed = resolveReplayHiSpeed(view, BE_MUSIC_HI_SPEED_SCALE, (visibleMs) =>
      mainBpm === undefined
        ? undefined
        : resolveHiSpeedForVisibleMs(this.resolveLaneHeightPx(), sudden, 0, PIXELS_PER_BEAT, mainBpm, visibleMs),
    );
    const next = hiSpeed === undefined ? undefined : snapHiSpeed(hiSpeed);
    if (next === undefined || next === this.hiSpeed) return;
    this.hiSpeed = next;
    this.playerHiSpeed = snapHiSpeed(next / this.hsFixMultiplier) ?? this.playerHiSpeed;
    this.scrollHiSpeed.retarget(next, performance.now());
  }

  /**
   * How long a note stays visible below `cover` (the first play side's) at the current scroll and BPM, over the lanes
   * laid out last frame, divided by the `#SCROLL` × `#SPEED` rate at the playhead (0 while the chart scrolls backwards or
   * stands still, as beatoraja shows it). `undefined` until the lanes are laid out or while the BPM is unknown.
   */
  resolveVisibleMs(
    cover: BeMusicLaneCover | undefined,
    bpm: number | undefined,
    scrollRate: number,
  ): number | undefined {
    if (this.laneX.size === 0 || bpm === undefined || !(bpm > 0)) return undefined;
    return resolveNoteVisibleMs(
      this.resolveLaneHeightPx(),
      cover?.sudden ?? 0,
      cover?.lift ?? 0,
      PIXELS_PER_BEAT * this.hiSpeed,
      bpm,
      scrollRate,
    );
  }

  /** The tallest lane laid out last frame, in design pixels (0 before the lanes are laid out). */
  private resolveLaneHeightPx(): number {
    let laneHeight = 0;
    for (const lane of this.laneX.values()) {
      laneHeight = Math.max(laneHeight, lane.bottom - lane.top);
    }
    return laneHeight;
  }

  /**
   * Paints the chrome layers (`skinLayer` / `overlayLayer`) for this frame and sets their transforms together with the
   * BGA layer's. The default draws the skinless chrome through `skinlessChromeRenderer` (or the be-music skin's
   * `gameplay.renderChrome`) in raw design coordinates; themes override it to paint their own skin.
   */
  protected renderThemeLayer(_width: number, _height: number): void {
    this.skinLayerPool.begin();
    this.overlayLayerPool.begin();
    try {
      this.skinLayer.scale.set(1);
      this.skinLayer.position.set(0, 0);
      this.overlayLayer.scale.set(1);
      this.overlayLayer.position.set(0, 0);
      this.bgaLayer.scale.set(1);
      this.bgaLayer.position.set(0, 0);
      const context = {
        layer: this.skinLayer,
        overlayLayer: this.overlayLayer,
        layerPool: this.skinLayerPool,
        overlayLayerPool: this.overlayLayerPool,
        runtime: resolveSkinlessGameplayChromeRuntime.call(this),
      };
      if (this.options.skinlessChromeRenderer) {
        this.options.skinlessChromeRenderer(context);
      } else {
        this.skinBinding?.renderChrome({ ...context, layout: this.resolveBeMusicLayout() });
      }
    } finally {
      this.skinLayerPool.end();
      this.overlayLayerPool.end();
    }
  }

  /**
   * The gameplay layout handed to the be-music skin's chrome: stage, lanes, playfield bounds, judgement line, and BGA
   * rect. Lane geometry only changes with the chart and the stage, so it is rebuilt when the lane channels, the play
   * variant, or the stage (a rotation) change.
   */
  private resolveBeMusicLayout(): BeMusicGameplayLayout {
    const stage = this.beMusicStage ?? LEGACY_STAGE;
    const cached = this.beMusicLayout;
    if (
      cached &&
      cached.channels === this.laneChannels &&
      cached.variant === this.chartPlayVariant &&
      cached.stage === stage
    ) {
      return cached.layout;
    }
    const layout = resolveGameplayLayout(
      { laneChannels: this.laneChannels, playVariant: this.chartPlayVariant, layoutMode: this.layoutMode },
      stage,
    );
    this.beMusicLayout = { channels: this.laneChannels, variant: this.chartPlayVariant, stage, layout };
    return layout;
  }

  /** Redraws the design clip mask and background for a stage of `size`, when it differs from the last one drawn. */
  private stampDesignRect(size: GameplayStageSize): void {
    if (size.width === this.stampedDesignWidth && size.height === this.stampedDesignHeight) return;
    this.stampedDesignWidth = size.width;
    this.stampedDesignHeight = size.height;
    this.designClipMask.clear().rect(0, 0, size.width, size.height).fill(0xffffff);
    this.background.clear().rect(0, 0, size.width, size.height).fill(BG);
  }

  /** Approximate total duration of the loaded chart in seconds. */
  resolveSongDurationSeconds(): number {
    if (!this.song) {
      return 0;
    }
    return this.songDurationSeconds;
  }

  /**
   * Cached cumulative beats at each measure boundary, keyed by song identity. Computed on first access so we don't walk
   * the measure list every frame. Each entry is the beat count at the *start* of the measure with that index (measure 0
   * starts at beat 0).
   */
  measureBeatCache: { songId: string | undefined; beats: number[] } = { songId: undefined, beats: [] };

  /**
   * Kicks off the shared-engine playback loop in the background. Called from the play-start gate inside
   * {@link start}. The returned promise is captured on `this.sharedEnginePromise` so a defensive re-entry
   * doesn't spawn a second engine; we don't `await` it because the chart can run for several minutes and
   * `start()` must return synchronously to the host's setVisible chain.
   *
   * Catches {@link PlayerInterruptedError} so the engine's `interrupt(escape)` / `interrupt(restart)` commands
   * route to the host's `onExit` / `onRestart` callbacks the same way the legacy DOM keyhandler did.
   */
  /**
   * The chart the engine plays in shared-engine mode: the one `prepareSong` resolved. Since the renderer hands the
   * engine its own `PreparedPlaybackChartData` instance (which already encodes shuffle / DP-flip), the chart events
   * here only feed engine-internal helpers (timing resolver, BGM / BGA / dynamic-volume realtime audio scheduling),
   * none of which care about the shuffled lane channels. The resolved chart carries no control flow, so the engine
   * plays it as is; {@link randomDraws} travel with it for the RANDOM summary.
   */
  private buildSharedEngineChart(): BeMusicJson {
    return this.resolvedChart ?? this.song!.chart;
  }

  private launchSharedEngine(): void {
    if (this.disposed || this.sharedEnginePromise) return;
    if (!this.song || !this.audioContext || !this.audioBus) return;
    // Build the chart the engine sees from the view's already-shuffled notes / mines / invisibles. The view's
    // `applyRandomMode` mutates `runtimeNote.channel` (NOT `event.channel`), so without this remap the engine
    // would extract notes from `chart.events` with their ORIGINAL pre-shuffle channels — its judge would target
    // a different lane than the visual the player is reading, so RANDOM / MIRROR / S-RANDOM / SCATTER would
    // make the chart unplayable. Rebuilding `events` with the post-shuffle channel keeps the engine and the
    // renderer on the same shuffle.
    const chart = this.buildSharedEngineChart();
    const callbacks: WebUiRuntimeCallbacks = {
      onFrame: (frame) => this.applyEngineFrame(frame),
      onCommand: (command) => this.applyEngineCommand(command),
      onJudgeCombo: (state) => this.applyEngineJudgeCombo(state),
      onSignalsReady: (signals) => {
        this.sharedEngineSignals = signals;
      },
    };
    // A replay shows its recorded view along the playhead; a recorded play logs its own from the start.
    this.playlogViewCoalescer = undefined;
    this.replayCovers = undefined;
    this.replayViewCursor =
      this.options.replay !== undefined
        ? new PlaylogViewCursor(this.options.replay.play.view, this.options.replay.play.viewChanges)
        : undefined;
    this.sharedEnginePromise = runEngineDriver({
      chart,
      audio: {
        audioContext: this.audioContext,
        audioBus: this.audioBus,
        decodedSamples: this.decodedSamples,
        wavCmdVolumeMultipliers: this.wavCmdVolumeMultipliers,
        bmsonSlicePlayback: this.bmsonSlicePlayback,
        // The engine plays through its own session: a stitched NONSTOP chart's stage rates (FIT) and fades go with it.
        ...(this.nonstopMixer !== undefined ? { stageMixer: this.nonstopMixer } : {}),
        playbackRate: samplePlaybackRate(this),
        playbackRateFollowsTempo: supportsLiveTempoChange(this.options.tempoPitchMode ?? 'pitch'),
      },
      mode: this.options.autoPlay ? 'auto' : 'manual',
      ui: callbacks,
      onInputSignalsReady: (signals) => {
        this.sharedEngineInputSignals = signals.inputSignals;
        this.sharedEngineInterrupt = undefined;
        this.sharedEngineChartSettled = false;
        // A tempo asked for while the engine was starting.
        this.liveTempo.attach(signals.inputSignals);
      },
      // Listen on the window (default) so the runtime sees keyboard events regardless of which DOM element
      // currently holds focus — matches the legacy `window.addEventListener('keydown', ...)` behaviour. The
      // canvas's `tabIndex = 0` only makes it focusable, not auto-focused, so a canvas-scoped listener would
      // only fire after the user clicked the canvas first.
      shouldSkipKey: (event) => {
        // Suppress lane-input dispatch when the user is typing into a focused text input (search box, etc.).
        const target = event.target as HTMLElement | null;
        if (target) {
          const tag = target.tagName;
          if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
          if (target.isContentEditable === true) return true;
        }
        // ESC and F5 are handled by the view's own listener (set up in `enter`) so the LR2 `#FADEOUT` animation
        // runs to completion BEFORE the engine's `PlayerInterruptedError` flow disposes the audio session. If
        // we let the runtime push `interrupt(escape)` directly, the engine's `dispose()` would `node.stop()`
        // every in-flight BufferSource immediately, killing the chart audio mid-fade. Same idea for Space:
        // routing the toggle through the view's `togglePause` keeps the view's `paused` flag, the audio bus's
        // suspend, the BGA video pause, and the engine's playback clock all on the same single entry-point.
        if (event.code === 'Escape' || event.code === 'F5' || event.code === 'Space') return true;
        // Backspace is the view's hold-to-quit key (`QuitHoldController`), never a lane.
        if (event.code === QUIT_HOLD_KEY_CODE) return true;
        if (event.code === 'ArrowUp' || event.code === 'ArrowDown') return true;
        return false;
      },
      engineOptions: {
        // The draws `resolvedChart` was resolved with; the engine plays that chart as is and names them in its summary.
        ...(this.randomDraws !== undefined ? { randomDraws: this.randomDraws } : {}),
        // The view's own intro timing already gated the chart to PLAYSTART; tell the engine to start its chart
        // immediately so its t=0 lines up with our `audioContextStartTime` anchor instead of imposing the
        // engine's default 1.5 s lead-in on top.
        leadInMs: 0,
        // The play tempo: the engine's clock runs `tempo` times as fast and judges in chart time. A change during the
        // play comes back through `onTempoChange`, at the chart second the engine took it.
        speed: this.tempo,
        onTempoChange: (change) => this.followTempoChange(change),
        // Forward AUTO SCRATCH: engine has a single boolean rather than per-side, so either-side AUTO SCRATCH
        // turns scratch auto on for both 16 / 26 channels. That's a per-side fidelity loss for rare DP charts
        // where only one player's scratch should auto-spin (the demo's lil-gui surfaces them as two separate
        // toggles), but the alternative — leaving auto off — was worse: scratch notes the user expected to be
        // auto-spun would just sit there as misses, and the legacy `autoScratchJudge` path is gated off in
        // shared-engine mode. A future engine extension could split the flag per side.
        autoScratch: this.options.autoScratch1P === true || this.options.autoScratch2P === true,
        // Hand the engine the same `PreparedPlaybackChartData` instance the renderer is already pointing at
        // (`this.notes` / `this.mineNotes` / `this.invisibleNotes` are references into this bundle). The
        // engine's `autoPlay` / `manualPlay` use it verbatim instead of running their own
        // `preparePlaybackChartData` pass, so the renderer's parallel arrays and the engine's playable note
        // arrays are guaranteed to be the same instances — no `inferBmsLnTypeWhenMissing` flag to keep in
        // sync, no `laneModeExtension` to forward separately (the bundle already encodes the lane bindings
        // computed under the right extension), no `bms.controlFlow` re-resolve to deduplicate, no
        // `random1P: 'OFF'` truthy-check to fix. Every "view extracted differently than engine" bug is
        // structurally impossible because there is only one extract.
        preparedChart: this.preparedChart,
        // The gauge is part of the judging setup, not just a skin colour: the engine resolves it against the active
        // ruleset's gauge line-up and runs its curve, so HARD really drains and DEATH really ends the run.
        // `resolveSelectedGauge` prefers the replay's recorded pick, so a played-back log runs its original gauge.
        gauge: this.resolveSelectedGauge(),
        ...(this.options.replay === undefined && this.options.course !== undefined
          ? { course: this.options.course }
          : {}),
        // A stitched NONSTOP chart's later stages take over the judge rank (a replay restores the recorded changes).
        ...(this.options.replay === undefined && this.options.nonstop !== undefined
          ? { stageRanks: this.options.nonstop.stageRanks }
          : {}),
        ...(this.options.replay?.chart.judgeRank.stageRanks !== undefined
          ? {
              stageRanks: this.options.replay.chart.judgeRank.stageRanks.map((change) => ({
                ...change,
                seconds: change.timeUs / 1_000_000,
              })),
            }
          : {}),
        // The engine reports the ruleset after applying the judge ruleset, the debug window override, and (for a
        // replay) the recorded settings below, so the windows skins see are the ones the run is judged with.
        onRulesetResolved: (info) => this.applyResolvedRuleset(info),
        signal: (this.sharedEngineAbortController = new AbortController()).signal,
        // Keys stay live after the last note until the fade-out is over; the outro starts when the chart settles.
        holdAfterChart: {
          signal: (this.chartEndHold = new AbortController()).signal,
          onSettled: () => {
            this.sharedEngineChartSettled = true;
            this.drainSharedEngineSignals();
            this.handleSharedEngineChartFinished(undefined, true);
          },
        },
        ...(this.options.replay !== undefined
          ? {
              // Replay playback — feed the recorded input stream; the engine ignores live lane input, and the run
              // records no new play-log (replaying a replay would only duplicate the file). Auto scratch, the
              // judge ruleset, the debug judge-window override, the end-on-failure flag and the course stage are
              // restored from the log so the judging setup matches the recording.
              replayInputs: this.options.replay.inputs,
              // The tempo changes of the play, followed as the replay reaches them (`resolveReplayTempo`).
              ...(this.replayTempo !== undefined && this.replayTempo.changes.length > 0
                ? { replayTempoChanges: this.replayTempo.changes }
                : {}),
              // A play given up with ESC replays up to where it was given up, as its re-simulations do.
              ...(this.options.replay.play.aborted === true && this.options.replay.play.abortedAtUs !== undefined
                ? { replayAbortedAtUs: this.options.replay.play.abortedAtUs }
                : {}),
              autoScratch: this.options.replay.play.autoScratch,
              judgeRuleset: this.options.replay.play.judgeRuleset ?? 'lr2',
              // Logs from before plays ended on failure kept judging to the end; replay them that way.
              endOnFailure: this.options.replay.play.endOnFailure === true,
              ...(this.options.replay.play.course !== undefined ? { course: this.options.replay.play.course } : {}),
              ...(this.options.replay.play.judgeWindowOverrideMs !== undefined
                ? { judgeWindowMs: this.options.replay.play.judgeWindowOverrideMs }
                : {}),
            }
          : {
              ...(this.options.judgeRuleset !== undefined ? { judgeRuleset: this.options.judgeRuleset } : {}),
              // Play-log recording: the engine snapshots the resolved (post-shuffle) chart and the raw input
              // replay, then hands the assembled log here right before the play promise settles. The host reads it
              // back through `getResultData().playlog` for the result screen's auto-save.
              recordPlaylog: {
                gauge: this.options.gauge,
                ...(this.options.chartSha256 !== undefined ? { chartSha256: this.options.chartSha256 } : {}),
                ...(this.options.chartMd5 !== undefined ? { chartMd5: this.options.chartMd5 } : {}),
                ...(this.options.playlogRecorder !== undefined ? { recorder: this.options.playlogRecorder } : {}),
                // The engine plays the chart this view resolved; the song's chart is the source both fingerprints
                // describe (`#RANDOM` unresolved, no lane option applied).
                ...(this.song !== undefined ? { sourceChart: this.song.chart } : {}),
                ...(this.options.random1P !== undefined || this.options.random2P !== undefined
                  ? {
                      randomLane: {
                        ...(this.options.random1P !== undefined ? { p1: this.options.random1P } : {}),
                        ...(this.options.random2P !== undefined ? { p2: this.options.random2P } : {}),
                      },
                    }
                  : {}),
                ...(this.options.dpFlip !== undefined ? { dpFlip: this.options.dpFlip } : {}),
                // What the player sees at the start; the changes during the play go in as `view` commands.
                view: this.startPlaylogView(),
                ...(this.song?.chartPath !== undefined ? { native: { chartPath: this.song.chartPath } } : {}),
              },
              onPlaylogRecorded: (playlog) => {
                this.playlog = playlog;
                const waiters = this.playlogWaiters.splice(0);
                for (const resolve of waiters) resolve(playlog);
              },
            }),
      },
    })
      .then((summary) => {
        log.info('shared engine driver finished');
        this.drainSharedEngineSignals();
        this.applyEngineSummary(summary);
        this.applyFinalComboSummary(summary);
        // A play the view interrupted (ESC / F5 / teardown) has already handed the host over; it does not finish.
        if (this.sharedEngineInterrupt !== undefined) return;
        // A held play ends when its outro lets go; one that ended on its own (a failed gauge, a replay stopping where its
        // log was given up) starts it now.
        const waiting = this.onHeldPlayEnded;
        if (waiting !== undefined) {
          this.onHeldPlayEnded = undefined;
          waiting(summary);
          return;
        }
        this.handleSharedEngineChartFinished(summary);
      })
      .catch((error: unknown) => {
        // The view's own ESC / F5 handler (`handleSharedEngineExitKey`) drives the LR2 fadeout animation, calls
        // the host's `onExit` / `onRestart` from the fade-completion callback, and then aborts the engine's
        // signal — which is what produced this rejection. The view is already disposing (or about to), so the
        // catch handler short-circuits to avoid double-firing the host transition. Same logic for any rejection
        // landing after `dispose` has flipped `disposed` (e.g. parent component teardown without ESC).
        if (this.disposed) return;
        if (this.sharedEngineAbortController?.signal.aborted) return;
        if (error instanceof PlayerInterruptedError) {
          if (error.reason === 'escape') {
            this.beginExitSequence(() => this.options.onExit?.());
          } else if (error.reason === 'restart') {
            this.options.onRestart?.();
          }
          return;
        }
        log.warn('shared engine driver threw', error);
      });
  }

  /**
   * Pulls the latest frame snapshot + queued commands + judge-combo state from the engine's signal buses. Called
   * from {@link tick} when shared-engine mode is on; the per-call callbacks were registered at engine launch.
   */
  private drainSharedEngineSignals(): void {
    if (!this.sharedEngineSignals) return;
    const result = drainWebUiSignals(
      this.sharedEngineSignals.uiSignals,
      {
        onFrame: (frame) => this.applyEngineFrame(frame),
        onCommand: (command) => this.applyEngineCommand(command),
        onJudgeCombo: (state) => this.applyEngineJudgeCombo(state),
      },
      {
        stateSignals: this.sharedEngineSignals.stateSignals,
        lastJudgeComboTick: this.sharedEngineLastJudgeComboTick,
      },
    );
    this.sharedEngineLastJudgeComboTick = result.lastJudgeComboTick;
  }

  /**
   * Mirrors the engine's per-frame snapshot into the view's score / gauge / fast-slow fields so the LR2 NUMBER
   * elements + score-graph keep rendering from the existing source paths — they don't need to know the engine
   * replaced the in-tree judge ladder. The summary's optional `gauge` payload populates `this.gaugeState` so the
   * skin's `#DST_GAUGE` chrome animates against the same value the engine considers authoritative.
   */
  private applyEngineFrame(frame: Readonly<PlayerUiFramePayload>): void {
    // Re-anchor the view's chart-time clock to the engine's the very first time the engine publishes a frame.
    // The engine's `playbackClock` (and therefore the chart-time it stamps on every judge / sample / ui-signal
    // event) anchors at the moment the engine creates the clock — which lands a few ms to a few hundred ms
    // AFTER the view set `audioContextStartTime` in its PLAYSTART gate, since `manualPlay` runs through its
    // entire prepare phase between those two points. Without re-anchoring, every note appears to pass the
    // judgment line slightly EARLIER (in view time) than the engine actually judges it, so the visual hit
    // doesn't line up with the score event.
    //
    // Using the first non-zero `frame.currentSeconds` snaps the view's `audioContextStartTime` so that
    // `currentSeconds() === frame.currentSeconds` from now on. Subsequent frames don't re-anchor — both
    // clocks tick on the AudioContext now, so the offset stays locked.
    if (!this.sharedEngineClockAnchored && frame.currentSeconds > 0 && this.audioContext) {
      this.audioContextStartTime =
        this.audioContext.currentTime - this.tempoClock.clockMsAt(frame.currentSeconds) / 1000;
      this.sharedEngineClockAnchored = true;
      this.nonstopMixer?.schedule(this.audioContextStartTime);
    }
    this.applyEngineSummary(frame.summary);
  }

  private applyEngineSummary(summary: Readonly<PlayerSummary>): void {
    // `summary.total` is the engine's authoritative scorable-note count (`scorableNotes.length`, which excludes
    // Free-Zone channels). The view's own initial `score.total` is computed independently in `prepareSong` from
    // `notes.filter(isPlayableInputChannel).length`, which DOES include Free-Zone — so on charts that use
    // channel `17` / `27` as Free-Zone the two diverge by the Free-Zone count. That mismatch makes
    // `maybeFireFullCombo`'s `tracker.combo === score.total` predicate unreachable (combo can only ever climb to
    // the engine's smaller scorable count) and the FC presentation never fires. Sync `score.total` to the
    // engine's value here so the view always agrees with the authority on the scorable population.
    this.score.total = summary.total;
    this.score.perfect = summary.perfect;
    this.score.great = summary.great;
    this.score.good = summary.good;
    this.score.bad = summary.bad;
    this.score.emptyPoor = summary.emptyPoor;
    // `this.score` is the DISPLAY copy: under LR2 the POOR counter folds empty POORs in, matching the real thing
    // (OpenLR2 `ApplyJudgeNote` increments `playerstat.poor` for the empty-POOR branch, and LR2 exposes no
    // separate stat). Every LR2 read-out — the POOR row, BP, the per-judge rates, the skin's num 84 / 89 / 114 —
    // goes through this object, so folding here keeps them all consistent. `summary.poor` itself stays split.
    this.score.poor = resolveDisplayedPoor(summary, this.resolveEmptyPoorCountsInPoorDisplay());
    this.score.exScore = summary.exScore;
    this.score.score = summary.score;
    this.fastCount = summary.fast;
    this.slowCount = summary.slow;
    if (summary.gauge) {
      const previous = this.gaugeState.current;
      this.gaugeState = { ...summary.gauge };
      // Gauge-rise / gauge-max theme feedback (LR2 timers 42 / 44). Mirrors what the legacy `applyGaugeDelta` did —
      // raise on every transition so authored skin elements (rise sparkle, max-glow overlay) animate. We compare against the previous frame's value rather than against an "EMPTY_POOR-
      // sized delta" because the engine drives gauge updates monotonically through `summary.gauge.current`,
      // not through judge deltas.
      const next = summary.gauge.current;
      if (next !== previous) {
        this.onThemeEvent({ kind: 'gauge', previous, next });
        // Latch the first rise above the starting value and the first time the gauge tops out.
        const moments = this.playMoments;
        if (next > summary.gauge.initial) moments.gaugeRiseAtMs ??= this.playClock();
        if (next >= summary.gauge.max) moments.gaugeMaxAtMs ??= this.playClock();
      }
      if (summary.gauge.failedMidPlay === true) this.playMoments.failedAtMs ??= this.playClock();
    }
    // `poor` excludes empty POORs, so this counts judged notes only.
    const judged = summary.perfect + summary.great + summary.good + summary.bad + summary.poor;
    if (summary.total > 0 && judged >= summary.total) this.playMoments.allNotesDoneAtMs ??= this.playClock();
    // Note: the per-note `judged` flag is no longer synced here. The renderer's `this.notes` /
    // `this.mineNotes` are references into the same `PreparedPlaybackChartData` instance the engine is
    // judging against (handed in via `engineOptions.preparedChart`), so when the engine sets
    // `note.judged = true` the renderer sees it on the next paint with no copy step. The fragile
    // index-based sync this used to perform was the source of the Phase-4c HIDE-on-judge dropout, the
    // mid-chart full-combo cue, and the AUTO PLAY < 200_000 score regressions — every one of them was
    // really "engine extract produced a different array than view extract." With the shared instance
    // there is no second extract.
  }

  private applyFinalComboSummary(summary: Readonly<PlayerSummary>): void {
    if (this.options.autoPlay !== true) return;
    if (summary.total <= 0) return;
    if (summary.perfect + summary.great + summary.good < summary.total) return;
    if (summary.bad > 0 || summary.poor > 0) return;
    this.tracker.combo = Math.max(this.tracker.combo, summary.total);
    this.maxCombo = Math.max(this.maxCombo, summary.total);
    if (this.courseCombo !== undefined) advanceCourseCombo(this.courseCombo, this.tracker.combo);
  }

  /**
   * Maps an engine UI command to the matching view-side visual effect. The visual-effect helpers
   * (`flashKeyOnTimer`, `startKeyOnTimer`, `releaseKeyOnTimer`, `triggerBomb`) are kept in shared-engine mode because
   * they own the per-lane timer book-keeping the lane beams animate against — only the judge / sample-trigger code
   * paths above were removed. Every command is then forwarded to the theme as a `lane-command` event (the LR2 family
   * drives its LN-hold timers and turntable from it).
   */
  private applyEngineCommand(command: PlayerUiCommand): void {
    switch (command.kind) {
      case 'flash-lane':
        this.noteImpulse(command.channel);
        this.flashKeyOnTimer(command.channel);
        break;
      case 'press-lane':
        this.noteImpulse(command.channel);
        this.pressedChannels.add(command.channel);
        this.startKeyOnTimer(command.channel);
        break;
      case 'release-lane':
        this.pressedChannels.delete(command.channel);
        this.releaseKeyOnTimer(command.channel);
        break;
      case 'hold-lane-until-beat':
        // Mark the lane as held for the LN's duration. Without this, a `flash-lane` command that arrives in
        // the same tick (typical for the LN HEAD: autoplay emits BOTH `flash-lane` and `hold-lane-until-beat`
        // on every LN start) schedules a `flashKeyOnTimer` setTimeout that calls `releaseKeyOnTimer` after
        // `KEY_ON_FLASH_HOLD_MS` because `pressedChannels.has(channel)` is `false`, and the lane laser fades
        // out ~150 ms into the LN even though the LN body is still scrolling. Adding the channel to
        // `pressedChannels` here makes the auto-release skip path fire the same way it does for a real key
        // press, and the laser stays lit for the full LN sustain. The matching `release-lane` (emitted by
        // `drainPendingAutoLongNotes` / `drainPendingAutoScratchLongNotes` at the LN tail) deletes the
        // channel and lets the lane laser fade out at the tail timing.
        this.pressedChannels.add(command.channel);
        this.startKeyOnTimer(command.channel);
        // The engine's hold-until-beat command implicitly says "the LN is firing now"; bomb-flash on the head
        // mirrors the legacy autoJudge behavior so the lane still blinks a positive-feedback explosion at LN
        // start in autoplay.
        this.triggerBomb(command.channel);
        break;
      case 'trigger-poor-bga':
        this.lastPoorAt = command.seconds;
        // Empty POOR (the engine fires `trigger-poor-bga` for both real POOR judges AND for empty presses /
        // unjudged-misses-past-window) doesn't go through `publishJudgeCombo` for empty-press cases, so the
        // result-screen gauge / score polylines would skip those samples in shared-engine mode and the graph
        // wouldn't match the legacy view's. Append history points here so the graph stays smooth across both
        // paths. Real POOR judges that ALSO publish a judge-combo will get a second sample from
        // `applyEngineJudgeCombo`'s `publishJudge` call — that's a no-op visually (both samples land at almost
        // the same `progress`) and keeps the contract "every gauge / EX-score change records a sample."
        this.recordSharedEngineHistorySample(command.seconds);
        break;
      case 'clear-poor-bga':
        this.lastPoorAt = -Number.POSITIVE_INFINITY;
        break;
      case 'long-note-start':
        this.longNotes.start(command.channel, command.beat, command.mode, this.playClock());
        break;
      case 'long-note-end':
        this.longNotes.end(command.channel, command.outcome);
        break;
    }
    this.onThemeEvent({ kind: 'lane-command', command });
  }

  /** Keeps the engine's long-note style and its judge windows (converted to ms) for the skin runtime. */
  private applyResolvedRuleset(info: PlayerRulesetInfo): void {
    this.longNoteStyle = info.longNoteStyle;
    this.judgeWindows = toBeMusicJudgeWindows(info.windows);
  }

  /**
   * The mode a long note plays in: the one the engine announced while it is held, otherwise worked out from the
   * ruleset's long-note style (unknown until the engine reports its ruleset).
   */
  resolveLongNoteMode(note: RuntimeNote): BeMusicLongNote['mode'] {
    const held = this.longNotes.heldMode(note.channel, note.beat);
    if (held !== undefined) return held;
    return this.longNoteStyle === undefined
      ? undefined
      : resolveBeMusicLongNoteMode(this.longNoteStyle, note.longNoteMode);
  }

  /**
   * Pushes one sample to {@link gaugeHistory} / {@link scoreHistory} using the current engine-derived
   * \`gaugeState.current\` and \`score.exScore\` snapshots. Called from the shared-engine command handler when
   * the engine reports a gauge / score change that doesn't flow through \`publishJudgeCombo\` (= empty POOR).
   * In legacy mode the same arrays are pushed exclusively from \`publishJudge\`.
   */
  private recordSharedEngineHistorySample(seconds: number): void {
    const totalSeconds = this.resolveSongDurationSeconds();
    const progress = totalSeconds > 0 ? Math.max(0, Math.min(1, seconds / totalSeconds)) : 0;
    this.gaugeHistory.push({ progress, value: this.gaugeState.current });
    this.scoreHistory.push({ progress, exScore: this.score.exScore });
  }

  /**
   * Drives every per-judge visual the LR2 skin animates against from the engine's stateSignals judge-combo bus:
   *
   * - `tracker.combo` mirrors the engine's running combo so `#SRC_NUMBER,st=70` (NOWCOMBO) renders the right
   *   number, and the `maxCombo` high-water mark feeds the result screen's MAX COMBO readout.
   * - `publishJudge` does the rest of the legacy per-judge work — it stamps timer 46 (1P) or 47 (2P) so the
   *   `#DST_NOWJUDGE` / `#DST_NOWCOMBO` keyframe chains animate from time=0 on every hit (without this, the
   *   plate stays invisible because the timer's playhead is parked at scene start), latches `lastJudge` /
   *   `lastJudgeUntil` so the fallback `#SRC_TEXT` paints the verdict, snapshots `judgeSideState[side]` for DP
   *   per-side rendering, swaps to the POOR BGA on POOR/BAD, appends a sample to gauge / score histories for
   *   the result graph, and fires `maybeFireFullCombo` for timers 48/49.
   * - On PERFECT / GREAT we additionally fire the lane bomb (the engine's `flash-lane` command is severity-
   *   independent so we can't piggy-back on it; the bomb is a positive-feedback cue specifically for clean
   *   hits). The legacy `commitFinalJudge` ran the same gate.
   */
  private applyEngineJudgeCombo(state: Readonly<PlayerJudgeComboSignalState>): void {
    if (state.judge === 'READY') return;
    this.tracker.combo = state.combo;
    if (state.combo > this.maxCombo) this.maxCombo = state.combo;
    if (this.courseCombo !== undefined) advanceCourseCombo(this.courseCombo, state.combo);
    const judgeKind = state.judge as JudgeKind;
    // Autoplay hits, mine BADs, and missed notes carry no `deltaMs`; the log skips them.
    this.judgeTimings.push(this.playClock(), state.judge, state.deltaMs, state.channel);
    this.publishJudge(judgeKind, this.currentSeconds(), state.channel);
    if ((judgeKind === 'PERFECT' || judgeKind === 'GREAT') && state.channel) {
      this.triggerBomb(state.channel, judgeKind);
    }
  }

  /**
   * Fires when the engine driver's `manualPlay` / `autoPlay` promise resolves cleanly (= chart played to its end
   * without an interrupt). The host's `onChartFinished` callback receives a `PixiGameplayResultData` snapshot and
   * the LR2 `#FADEOUT` → `#CLOSE` exit timeline runs before the result-screen transition. The engine's resolution
   * is the authoritative end-of-chart signal — the view's `currentSeconds` clock lags slightly behind the engine's
   * own bookkeeping, so we don't gate on it.
   */
  /**
   * Starts the outro once the chart is over. `held` means the engine's play is still open (keys still live): the fade-out
   * runs first, then the play is let go and the result waits for its final summary.
   */
  private handleSharedEngineChartFinished(finalSummary: Readonly<PlayerSummary> | undefined, held = false): void {
    if (this.disposed || this.chartEnded) return;
    this.chartEnded = true;
    this.playMoments.outroAtMs ??= this.playClock();
    // The end-of-play policy both gameplay families share (`scene/play-ending.ts`): a lead-out after the last note, or —
    // for a play cut short by its gauge emptying — no lead-out and a sound + picture fade-out before the result.
    const ending = resolvePlayEnding({
      summary: finalSummary,
      notes: this.notes,
      timing: this.timingResolver,
      currentSeconds: this.currentSeconds(),
      tempo: this.tempo,
      themeFadeOutMs: this.themeTiming.fadeOutMs,
    });
    // Hold the play scene for roughly two measures after the final note. This keeps the last hit / final keysound from
    // being swallowed by an immediate result transition while still falling back to a one-frame defer on empty charts or
    // charts whose non-note tail has already carried us past the target.
    this.chartEndTimeout = window.setTimeout(() => {
      this.chartEndTimeout = undefined;
      if (this.disposed) return;
      this.drainSharedEngineSignals();
      if (finalSummary !== undefined) {
        this.applyEngineSummary(finalSummary);
        this.applyFinalComboSummary(finalSummary);
      }
      const finish = (): void => {
        const result = this.getResultData();
        if (this.options.onChartFinished && result) {
          this.options.onChartFinished(result);
          return;
        }
        this.options.onExit?.();
      };
      this.beginExitSequence(
        () => {
          if (!held) {
            finish();
            return;
          }
          // The outro is over: let the held play end, and show the result with its final summary.
          this.onHeldPlayEnded = () => {
            if (!this.disposed) finish();
          };
          this.flushPlaylogView();
          this.chartEndHold?.abort();
        },
        { fadeAudio: ending.fadeAudio, minFadeOutMs: ending.fadeOutMs },
      );
    }, ending.leadOutMs);
  }
}

/**
 * Returns whether `texture` is backed by a Pixi `VideoSource` (i.e. a `<video>` element). Used by the
 * `PrepareSystem` upload path to skip eager GPU uploads on video-backed textures: the underlying `<video>` may
 * not have decoded any frames at prepare time, and WebGPU's `copyExternalImageToTexture` rejects an unbacked
 * `<video>` with "Failed to import texture from video element that doesn't have back resource", which Pixi
 * propagates as a re-firing `OperationError` inside its rAF queue.
 */
function isVideoTextureSource(texture: Texture): boolean {
  return texture.source instanceof VideoSource;
}

// `clampSampleOffset` / `clampSampleDuration` / `startSampleNode` lived here while the gameplay view managed its
// own audio playback. With Phase 4b-i / 4b-ii routing every cue through {@link WebAudioSession}, the canonical
// implementations now live in `web-audio-session.ts` (re-exported there for tests) — this module no longer needs
// them.
