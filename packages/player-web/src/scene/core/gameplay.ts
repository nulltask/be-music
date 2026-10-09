import {
  Application,
  Container,
  Graphics,
  Rectangle,
  Text,
  TextStyle,
  Texture,
  VideoSource,
  type Sprite,
} from 'pixi.js';
// Side-effect import: registers Pixi's `PrepareSystem` on the renderer so {@link CoreGameplayView.preparePixiUpload}
// can drive eager GPU uploads. Pixi v8 deliberately ships the prepare module out of the default bundle (it's a
// large optional system that not every app needs); the import has to land before any `Application.init` runs that
// expects `renderer.prepare` to exist.
import 'pixi.js/prepare';
import {
  collectSampleTriggers,
  createBmsonSamplePlaybackMap,
  createTimingResolver,
  type TimedSampleTrigger,
} from '@be-music/audio-renderer/triggers';
import {
  createEmptyScore,
  createScoreTracker,
  resolveDisplayedPoor,
  resolveIidxRankLabel,
  type JudgeKind,
  type ScoreSummary,
  type ScoreTracker,
} from '@be-music/player/core/scoring';
import {
  PlayerInterruptedError,
  preparePlaybackChartData,
  type PreparedPlaybackChartData,
  type PlayerSummary,
} from '@be-music/player/core/engine';
import type { GrooveGaugeType } from '@be-music/player/core/groove-gauge';
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
import {
  createBeatAtSecondsResolverFromTimingResolver,
  createScrollTimeline,
  createSpeedTimeline,
} from '@be-music/player/core/timeline';
import { createScrollDistanceMapper, type ScrollDistanceMapperLike } from '@be-music/player/core/scroll-distance';
import { type TimedLandmineNote, type TimedPlayableNote } from '@be-music/player/playable-notes';
import type { BeMusicPlaylog } from '@be-music/player/playlog';
import { applyPlaylogArrangement } from '../../chart/playlog-arrangement.ts';
import { findFirstIndexAtOrAfter, findFirstIndexNumberAtOrAfter, runWithConcurrency } from '@be-music/utils/core';
import type { BrowserSongAssetSource, BrowserSongEntry } from '../../collection/types.ts';
import {
  loadAssetBytes,
  normalizePath,
  resolveChartImageAsset,
  resolveChartAudioAsset,
  resolveChartPlayVariant,
} from '../../collection/collection.ts';
import { loadTextureFromBytes, loadVideoTextureFromBytes } from '../../media/textures.ts';
import {
  type AudioBusChannel,
  type AudioBusHandle,
  type CompressorMode,
  type CompressorParams,
  type TunableCompressor,
  type CompressorStage,
  buildAudioBus,
  sanitizeBusVolume,
} from '../../runtime/audio-bus.ts';
import { GameplayRecorder, type GameplayRecorderResult } from '../../recording/gameplay-recorder.ts';
import { PerfTracker } from '../perf.ts';
import { type PixiSceneHost } from '../host.ts';
import { ChildPool, staggerDestroyTextures } from '../pixi-utils.ts';
import { AudioAnalyzer, type AudioFeatures } from '../../runtime/audio-analysis.ts';
import { runEngineDriver } from '../../runtime/engine-driver.ts';
import { createWebAudioSession, type WebAudioSession } from '../../runtime/web-audio-session.ts';
import { drainWebUiSignals, type WebUiRuntimeCallbacks } from '../../runtime/web-ui-runtime.ts';
import { normalizeObjectKey, resolveBmsBase, type BeMusicEvent, type BeMusicJson } from '@be-music/json';
import { resolveBmsControlFlow } from '@be-music/parser';
import {
  collectBmsExWavVolumeMultipliers,
  collectBmsWavCmdVolumeMultipliers,
  createBeatResolver,
  parseBmsBga,
  parseBmsSwBga,
  pickSwitchingBgaFrame,
  resolveBmsBmpArgb,
  resolveChartReferenceBpm,
  type BmsSwitchingBga,
} from '@be-music/chart';
import {
  BG,
  BGA,
  DESIGN_HEIGHT,
  DESIGN_WIDTH,
  HISPEED_MAX,
  HISPEED_MIN,
  HISPEED_STEP,
  FALLBACK_INTRO_DELAY_MS,
  LR2_1P_KEYON_TIMER_BASE,
  LR2_2P_KEYON_TIMER_BASE,
  PIXELS_PER_BEAT,
  PLAYFIELD,
} from '../gameplay-constants.ts';
import {
  buildBgaTimeline,
  collectBgaTextureLoadKeys,
  isVideoExtension,
  pickActiveBgaCue,
  pickActiveBgaKey,
  type BgaCue,
} from './gameplay-bga.ts';
import {
  isPlayableInputChannel,
  resolvePlayVariantLaneChannels,
  resolveLr2LaneIndex,
  resolveSideRelativeLaneIndex,
  resolveSkinlessLaneLayout,
} from '../gameplay-lanes.ts';
import type {
  SkinlessGameplayChromeRenderer,
  SkinlessGameplayChromeRuntime,
  SkinlessGameplayJudgeState,
} from '../gameplay-chrome.ts';
import { resolveGameplayAudioTailCleanupDelayMs, resolvePostChartResultDelayMs } from './gameplay-result-delay.ts';
import { CORE_TEXT_FONT } from './fonts.ts';
import type {
  BeMusicBomb,
  BeMusicEffectLevel,
  BeMusicGameplayLayout,
  BeMusicLaneFrame,
  BeMusicSkin,
  BeMusicStage,
} from '../../skin/be-music/types.ts';
import { resolveBeMusicLaneKind } from '../../skin/be-music/registry.ts';
import { resolveGameplayLayout } from '@be-music/skin-sdk';
import { BeMusicGameplayBinding, resolveBeMusicSkinStage } from '../../skin/be-music/binding.ts';
import {
  PHANTOM_BOMB_DURATION_MS,
  renderPhantomBombs,
  renderPhantomLanes,
  renderPhantomLongNote,
  renderPhantomNote,
} from '../../skins/phantom/playfield.ts';
import {
  resolveDesignTextResolution,
  resolveScaledViewport,
  setDesignPixelRatio,
  setDesignTextResolution,
} from './viewport.ts';
import type { PixiGameplayResultData } from './result-data.ts';
import { logger } from '../../logger.ts';

const log = logger('gameplay');

/**
 * View-side runtime note alias. Used to keep `this.notes` typed even though the view no longer extends
 * `TimedPlayableNote` with extra renderer state — judge status is now tracked through the same `judged` flag
 * the engine mutates on the **shared** instance handed in via `engineOptions.preparedChart`. See
 * `PlayerOptions.preparedChart` for the design rationale; the alias stays in case future renderer-only state
 * needs to attach back here.
 */
type RuntimeNote = TimedPlayableNote;

/**
 * Mine / landmine note (BMS channels D1-D9 / E1-E9 for the 1P / 2P sides). Same shared-instance treatment as
 * `RuntimeNote`: the engine mutates `judged` on the same `TimedLandmineNote` instance the renderer's
 * `this.mineNotes` array already references, so there is no separate `hit` flag for the view to keep in sync.
 *
 * On a key press inside the BAD window we trigger a BAD verdict, play the mine explosion sample (`#WAV 00`), drain the
 * gauge by the chart-encoded damage value, and reset combo to zero. The underlying `playableNotes` array stays
 * untouched so a regular note in the same window past / future the mine can still be judged on the next press.
 */
type RuntimeMineNote = TimedLandmineNote;

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

const AUDIO_DECODE_CONCURRENCY = 8;
const BGA_DECODE_CONCURRENCY = 4;

/**
 * One rectangle the chart's BGA is composited into. The core scene paints into the default-family BGA rect; themes
 * supply their own via {@link CoreGameplayView.collectBgaTargets} (the LR2 family maps its `#DST_BGA` entries).
 */
export interface GameplayBgaTarget {
  /** Destination rect in design pixels, already normalized. Zero-sized rects are skipped. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Suppress the base track (channel 04) on this rect. */
  noBase: boolean;
  /** Suppress the layer track (channels 07 / 0A) on this rect. */
  noLayer: boolean;
  /** Suppress the POOR override (channel 06) on this rect. */
  noPoor: boolean;
  /**
   * Applies the destination's alpha / tint / blend (and any rotation) to a BGA sprite after the scene positioned and
   * sized it. The chart-level `#ARGBxx` tint is composed on top afterwards.
   */
  applyToSprite(sprite: Sprite): void;
}

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

/** Design canvas of the scene: its width / height and, for the be-music path, the skin's stage. */
export interface GameplayStageSize {
  width: number;
  height: number;
}

/** The LR2-compatible 640x480 canvas. */
const LEGACY_STAGE_SIZE: GameplayStageSize = { width: DESIGN_WIDTH, height: DESIGN_HEIGHT };
/** The 640x480 stage with the fixed default-family BGA square, for skins that declare no stage of their own. */
const LEGACY_STAGE: BeMusicStage = { ...LEGACY_STAGE_SIZE, resolveBgaRect: () => ({ ...BGA }) };

/** Lane rectangle in design pixels. `bottom` is the judgement line a note's bottom edge lands on. */
export interface GameplayLaneRect {
  x: number;
  w: number;
  top: number;
  bottom: number;
}

/** Note-sprite slots a theme can supply textures for. `invisible` is the debug keysound overlay. */
export type GameplayThemeNoteKind = 'note' | 'lnstart' | 'lnend' | 'lnbody' | 'mine' | 'invisible';

/**
 * Theme-supplied cell for one note sprite. `texture` is `undefined` when the theme authors the slot but the cell could
 * not be cropped this frame — the scene then draws nothing for that part (LN body / caps) or falls back to its own
 * drawing (single notes / mines / invisible notes).
 */
export interface GameplayThemeNoteCell {
  texture: Texture | undefined;
  width: number;
  height: number;
}

/** Inputs for {@link CoreGameplayView.renderThemeMeasureLines}. */
export interface GameplayMeasureLineFrame {
  /** Beat at the start of every measure. */
  beats: readonly number[];
  /** First index into `beats` worth visiting. */
  firstBeatIndex: number;
  /** Walk stops past this beat (`+Infinity` while a `#SCROLL` / `#SPEED` mapper is active). */
  maxBeat: number;
  pixelsPerBeat: number;
  /** Scroll distance in beats from the current playhead to `beat`. */
  beatDistance: (beat: number) => number;
  /** Lane area top / judgement-line bottom in design pixels. */
  top: number;
  bottom: number;
}

/** Scene timing a theme authors: the intro gates before chart start and the exit fade / close lengths, in ms. */
export interface GameplayThemeTiming {
  /** Offset from scene start at which loading counts as finished (LR2 `#LOADSTART + #LOADEND`). */
  loadEndOffsetMs: number;
  /** Offset from scene start at which the chart begins; `0` falls back to {@link FALLBACK_INTRO_DELAY_MS}. */
  playStartOffsetMs: number;
  /** Exit fade-out length; `0` skips the fade. */
  fadeOutMs: number;
  /** Hold after the fade before the host callback fires; `0` skips it. */
  closeMs: number;
}

const DEFAULT_THEME_TIMING: GameplayThemeTiming = {
  loadEndOffsetMs: 0,
  playStartOffsetMs: 0,
  fadeOutMs: 0,
  closeMs: 0,
};

/**
 * Scene moments a theme can react to (the LR2 family stamps its skin timers from these). `at` is the
 * {@link CoreGameplayView.playClock} value the scene recorded for the moment.
 */
export type GameplayThemeEvent =
  | { kind: 'scene-start'; at: number }
  | { kind: 'load-end'; at: number }
  | { kind: 'play-start'; at: number }
  | { kind: 'exit-fade-out'; at: number }
  | { kind: 'exit-close'; at: number }
  | { kind: 'judge'; side: '1P' | '2P'; at: number }
  | { kind: 'full-combo'; at: number }
  | { kind: 'gauge'; previous: number; next: number }
  | { kind: 'bomb'; channel: string; at: number }
  | { kind: 'bomb-retired'; channel: string }
  | { kind: 'lane-command'; command: PlayerUiCommand };

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
   * and no new play-log is recorded for the run. `prepare` rejects when the loaded chart does not match the log
   * (different `#RANDOM` roll / different chart file).
   */
  replay?: BeMusicPlaylog;
  /**
   * Judge-window ruleset for the shared engine (`PlayerOptions.judgeRuleset`): `'lr2'` (default) / `'beatoraja'`
   * / `'iidx'`. Recorded into the play-log; replays re-apply the log's own value instead.
   */
  judgeRuleset?: 'lr2' | 'beatoraja' | 'iidx';
  /**
   * SHA-256 (lowercase hex) of the source chart file bytes, when the host computed one. Stamped into the recorded
   * play-log (`chart.sha256`) so a dropped log can be matched back to its chart by content.
   */
  chartSha256?: string;
  /**
   * 1P gauge variant (`#SRC_BUTTON,type=40`). Selects the ruleset's gauge (the engine resolves the curve) and drives
   * the gauge-on-red-branch op flags (43 / 45). 2P-side gauge isn't yet separately wired — the engine
   * consumes the 1P value and applies it to the single shared gauge.
   */
  gauge?: 'GROOVE' | 'HARD' | 'DEATH' | 'EASY';
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
   * - `'HIDE'` (default) — judged notes vanish at the judgement instant. Matches the LR2 / beatoraja default behavior
   *   and keeps the playfield visually clean during dense passages.
   * - `'KEEP_SCROLLING'` — judged notes stay on screen and keep scrolling until their position crosses the judgement
   *   line. Equivalent to beatoraja's `LANEEFFECT ON` mode; useful as a timing-learning aid because the player can see
   *   *where* a press landed relative to the line.
   *
   * Only single notes are gated. Long-note bodies are always positionally clipped (the body persists until the tail
   * passes the line regardless of head-hit state) so this option doesn't disturb LN visuals.
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
 * Placeholder gauge state for the frames before the engine reports one. Values match the LR2 groove defaults so the
 * bar does not visibly jump when the first real frame lands; everything real arrives via `summary.gauge`.
 */
function createPlaceholderGaugeState(type: GrooveGaugeType = 'GROOVE'): PlayerGaugeSummary {
  const survival = type === 'HARD' || type === 'DEATH';
  return {
    current: survival ? 100 : 20,
    max: 100,
    clearThreshold: survival ? 0 : 80,
    initial: survival ? 100 : 20,
    effectiveTotal: 0,
    cleared: survival,
    type,
    survival,
    failedMidPlay: false,
  };
}

/**
 * Family-neutral gameplay scene: engine driver, input, judging, Web Audio, BGA compositing, lane geometry, note / LN /
 * bomb / lane drawing through the be-music skin, skinless chrome, pause / restart / exit, recording, and result data.
 *
 * Theme families (the LR2 family's `PixiGameplayView`) extend this class and override the `protected` theme hooks —
 * `prepareTheme`, `renderThemeLayer`, `collectBgaTargets`, `resolveThemeLaneRect`, `resolveThemeNoteCell`,
 * `renderThemeMeasureLines`, `renderThemeText`, `renderBombEffects`, `themeTiming`, `onThemeEvent`, … — each of which
 * defaults to the skinless behaviour, so the class paints a complete scene on its own.
 */
export class CoreGameplayView<TOptions extends CoreGameplayViewOptions = CoreGameplayViewOptions> {
  /**
   * The host that owns the underlying `Application`. Set by {@link mount}; before that, accessing `this.app` throws —
   * the scene must always be mounted to a host before any rendering or input interaction can happen. See
   * `PixiSceneHost` for the single-Application architecture rationale.
   */
  private host: PixiSceneHost | undefined;
  /**
   * Top-level Container the scene host attaches to its `app.stage` while gameplay is active. All visible nodes
   * (`viewportBackground` + `root`) live as children of this sceneRoot, so the host can mount/unmount the whole
   * gameplay subtree as one operation.
   */
  private readonly sceneRoot = new Container();
  private readonly root = new Container();
  /**
   * Clip mask for the design rect — sits as a child of `root` so the same `position` / `scale` transform applies to it
   * as the sprites it clips. Pixi uses the mask's world-space bounds to decide what's visible; with the mask drawn at
   * `(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT)` in design space, the post-transform bounds match the on-screen design
   * rectangle exactly, and any sprite that animates in from off-canvas (LR2 default's `#DST_IMAGE,...,758,0,...`
   * slide-ins, etc.) gets clipped at the design edge instead of bleeding into the pillarbox / letterbox of a screen
   * with a different aspect ratio.
   */
  private readonly designClipMask = new Graphics();
  /** Layout last handed to the be-music chrome, keyed by the lane set it was built for. */
  private beMusicLayout:
    | { channels: readonly string[]; variant: ChartPlayVariant | undefined; layout: BeMusicGameplayLayout }
    | undefined;
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
  private readonly laneLayer = new Graphics();
  private readonly noteLayer = new Container();
  /**
   * Shutter mask layer. Sits above `noteLayer` so the dark rectangles drawn here cover the scrolling notes underneath
   * but stay below the judgement-line / HUD overlays. Cleared and redrawn every frame from `playOptions.hiddenSudden` +
   * `playOptions.shutter`.
   */
  private readonly shutterLayer = new Graphics();
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
  protected readonly noteLayerPool: ChildPool = new ChildPool(this.noteLayer);
  protected skinLayerPool: ChildPool = new ChildPool(this.skinLayer);
  protected overlayLayerPool: ChildPool = new ChildPool(this.overlayLayer);
  protected readonly textLayerPool: ChildPool = new ChildPool(this.textLayer);
  protected readonly bombLayerPool: ChildPool = new ChildPool(this.bombLayer);
  private readonly bgaLayerPool = new ChildPool(this.bgaLayer);
  private readonly overlay = new Text({
    text: '',
    style: new TextStyle({
      fill: 0xf8fafc,
      fontSize: 22,
      fontWeight: '700',
      align: 'center',
      fontFamily: CORE_TEXT_FONT,
    }),
  });
  protected song: BrowserSongEntry | undefined;
  protected source: BrowserSongAssetSource | undefined;
  /**
   * The chart's `#RANDOM` / `#IF` control flow resolved for THIS play session. `song.chart` is the raw parsed JSON
   * (kept for metadata stability), but every gameplay-time consumer — note extraction, timing resolver, sample
   * triggers, BGA timeline, measure walk — reads `resolvedChart` so the rolled random branches actually take effect.
   * Without this step BMS charts using `#RANDOM` / `#SETRANDOM` / `#SWITCH` either omit every conditional section or
   * include them all (depending on parser default), neither of which matches LR2 behavior.
   */
  private resolvedChart: BeMusicJson | undefined;
  /**
   * `seconds → beat` resolver that properly accounts for `#STOP` windows. During a STOP, this returns the same beat
   * across the window's duration so the playfield freezes in place. Without it the previous hand-rolled `currentBeat`
   * extrapolation would scroll notes through STOP zones at the prevailing BPM, breaking many BMS arrangements that lean
   * on STOP for visual emphasis.
   */
  private beatAtSeconds: ((seconds: number) => number) | undefined;
  /**
   * Distance integrator that consumes `#SCROLL` and `#SPEED` events. Note Y positions are computed as `lane.bottom -
   * distanceBetween(currentBeat, note.beat) * pixelsPerBeat` instead of `(note.beat - currentBeat) * pixelsPerBeat`,
   * so: - `#SCROLL,2` doubles the local scroll rate (notes pass twice as fast), - `#SCROLL,-1` reverses the scroll
   * direction (notes scroll backwards through the playfield), and - `#SPEED` lerps the visual speed between control
   * points. Falls back to plain beat-difference math when no scroll/speed events are present.
   */
  private scrollMapper: ScrollDistanceMapperLike | undefined;
  /**
   * Engine's `preparePlaybackChartData` result, computed once during {@link prepareSong} and forwarded to the
   * shared engine via `engineOptions.preparedChart`. Holds the canonical `notes` / `landmineNotes` /
   * `invisibleNotes` arrays the renderer points at (`this.notes` / `this.mineNotes` / `this.invisibleNotes`
   * are the same instances), so any mutation the engine performs on a note's `judged` flag is automatically
   * visible to the renderer with no separate sync step. `undefined` until the song has been prepared.
   */
  private preparedChart: PreparedPlaybackChartData | undefined;
  protected notes: RuntimeNote[] = [];
  /**
   * Landmine notes (channels D1-D9 / E1-E9). Sorted by `seconds` for the same binary-search-by-time access pattern the
   * playable-note judge loop uses. Hit-test runs in `judge()` BEFORE the playable-note check so a press that lands
   * inside the BAD window of both a mine and a regular note prefers the mine — matches LR2 behavior where the mine
   * explodes first.
   */
  private mineNotes: RuntimeMineNote[] = [];
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
  private invisibleNotes: TimedPlayableNote[] = [];
  private maxLongNoteBeatSpan = 0;
  private chartLastNoteEndSeconds = 0;
  private songDurationSeconds = 0;
  protected laneChannels: string[] = [];
  /**
   * Cached `resolveChartPlayVariant` result for the loaded chart. Used to pick the right per-variant theme layout (LR2
   * `play_<variant>` skin, keymode op 160..164), and to switch lane-channel detection to the PMS layout (`17` is a lane
   * note, `22..25` are 1P-side lanes) instead of the default IIDX layout. Defaults to `'7'` before any chart is loaded so the existing
   * 7K-flavored fallbacks keep behaving as before for skinless / pre-prepare code paths.
   */
  protected chartPlayVariant: ChartPlayVariant = '7';
  protected laneX: Map<string, GameplayLaneRect> = new Map();
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
  private lastJudgeAt: number | undefined;
  private lastImpulseAt: number | undefined;
  private lastImpulseKind: 'white' | 'black' | 'scratch' | undefined;
  private startTime = 0;
  /**
   * True while the chart's assets are still loading: from {@link prepare} until audio is decoded and the BGA preload
   * (which may be transcoding video) has settled. Skins show it as NOW LOADING on the lanes.
   */
  private assetsLoading = false;
  /** Set by {@link mount}: show the playfield (in its loading state) during {@link prepare} instead of hiding it. */
  private revealWhilePreparing = false;
  /**
   * `audioContext.currentTime` value that corresponds to chart-second 0. Used to schedule background samples with
   * sample-accurate Web Audio timing.
   */
  private audioContextStartTime = 0;
  protected paused = false;
  private pauseTime = 0;
  private pauseTotal = 0;
  /**
   * Idempotency / re-entrancy guard for {@link dispose}. ESC → `onExit` → `showSelect` → `dispose` is fine on a single
   * press, but a quick double-tap (or a chart-end `setTimeout` racing the keypress) used to fire `dispose` twice and
   * crash on the second pass when `app` was already torn down. Now the second call short-circuits immediately.
   */
  protected disposed = false;
  private audioContext: AudioContext | undefined;
  /**
   * Audio routing handle. Owns two stable mixers (`keyMixer` for player-input keysounds, `bgmMixer` for auto-triggered
   * BGM) plus the per-bus and master compressor stages. Sample sources connect to the appropriate mixer; the bus's
   * `setMode` method swaps the downstream wiring without disturbing those source- side connections.
   *
   * See `audio-bus.ts` for the architecture and per-mode topology.
   */
  private audioBus: AudioBusHandle | undefined;
  /** Analyser tapped off the bus output; feeds audio-reactive be-music skins. */
  private audioAnalyzer: AudioAnalyzer | undefined;
  /** This frame's audio features (sampled once per render, on the play clock). */
  private audioFrame: AudioFeatures | undefined;
  /**
   * Most-recently-applied compressor mode. Distinct from the bus's `mode` getter so we can decide what to flip back to
   * when `setAudioCompressor(true)` re-enables compression after a temporary `'off'` (we restore whatever
   * `audioCompressorMode` the constructor / URL flag selected).
   */
  private audioCompressorMode: CompressorMode = 'split';
  /** Compressor tuning overrides, seeded from the options and kept across audio-bus rebuilds. */
  private audioCompressorParams: Partial<Record<TunableCompressor, Partial<CompressorParams>>> = {};
  /** User keysound / BGM bus volumes, seeded from the options and kept across audio-bus rebuilds. */
  private audioVolumes: Record<AudioBusChannel, number> = { key: 1, bgm: 1 };
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
  private webAudioSession: WebAudioSession | undefined;
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
   * Latch flipped on the first non-zero `frame.currentSeconds` from the engine. The view's
   * `audioContextStartTime` is re-anchored at that moment so the renderer's chart-time matches what the engine
   * judges against — without this snap, the engine's `playbackClock` (which anchors at the moment it's
   * constructed inside `manualPlay`'s prepare phase) sits a few ms to a few hundred ms behind the view's
   * PLAYSTART anchor and notes pass the judgment line ahead of the engine's actual judge event.
   */
  private sharedEngineClockAnchored = false;
  private decodedSamples = new Map<string, AudioBuffer>();
  /**
   * Per-`#WAVxx` slot volume multipliers from `#WAVCMD 01 xx vv` lines, expressed as 0..1 linear gain. Built once per
   * chart by {@link prepareSong} via the shared `collectBmsWavCmdVolumeMultipliers` helper, looked up on every
   * `playSample` / `playSampleByKey` so a slot with no `#WAVCMD` directive returns `undefined` and the fast path (no
   * extra GainNode) takes over.
   *
   * Pitch / loop bytes (`pp = 00` / `02`) are intentionally NOT collected here: they require sample-graph rewiring
   * (playbackRate, loopStart / loopEnd) which the current pipeline doesn't surface yet — see the spec audit. Volume is
   * the dominant in-the-wild use of `#WAVCMD`, so this already covers the common case.
   */
  private wavCmdVolumeMultipliers = new Map<string, number>();
  /**
   * Parsed `#SWBGAxx` directives keyed by slot id. Built once per chart by {@link prepareSong}, looked up on every BGA
   * frame draw — `pickSwitchingBgaFrame(entry, elapsedMs)` resolves the currently-visible source `#BMPxx` key to swap
   * into the layer draw. Slots without a `#SWBGAxx` declaration stay absent so the fast path (single texture lookup)
   * takes over.
   */
  private switchingBgas = new Map<string, BmsSwitchingBga>();
  /**
   * bmson per-event slice playback map. For bmson charts the audio-renderer's `createBmsonSamplePlaybackMap`
   * precomputes which portion of each `sound_channels[]` WAV a given note is supposed to play — `offsetSeconds` is the
   * seek-into-file position, `durationSeconds` (when set) caps how long the slice should run. Built once per chart in
   * `prepareSong`; `playSample` looks each note's event up here and calls `node.start(when, offset, duration)`
   * accordingly so the sliced-WAV authoring intent is preserved.
   *
   * Stays `undefined` for non-bmson charts (they have no slicing semantics — each note plays its entire WAV from t=0).
   */
  private bmsonSlicePlayback:
    | Map<BeMusicEvent, { offsetSeconds: number; durationSeconds?: number; sliceId: string }>
    | undefined;
  private autoSampleTriggers: TimedSampleTrigger[] = [];
  protected score: ScoreSummary = createEmptyScore(0);
  protected tracker: ScoreTracker = createScoreTracker();
  /**
   * Highest value of `tracker.combo` reached during the current play. `tracker.combo` resets to 0 on every BAD / POOR,
   * so we mirror it here whenever it exceeds the previous max. Used as the authoritative "MAX COMBO" readout for the
   * result screen — the old fallback (`score.perfect + score.great`) overcounted on broken-combo plays since it tallies
   * hit count rather than the longest unbroken streak.
   */
  protected maxCombo = 0;
  /**
   * Play-log assembled by the shared engine right before its play promise settles (`onPlaylogRecorded`). Snapshotted
   * into {@link getResultData} so the result host can offer it as a download.
   */
  private playlog: BeMusicPlaylog | undefined;
  /**
   * Per-play sampled history of `(progress, gauge%)` pairs. Recorded inside `publishJudge` (the single chokepoint for
   * every judge event) and seeded with a `(0, initialGauge)` entry on `prepareSong` so the polyline starts from the LR2
   * default starting gauge (20 %) instead of the first judge's value.
   *
   * `progress` is `seconds / totalSongSeconds` clamped to `[0, 1]`. Drives the result scene's gauge-chart polyline
   * (LR2 `Lr2GaugeChartElement` and friends).
   */
  private gaugeHistory: Array<{ progress: number; value: number }> = [];
  /** Same shape as `gaugeHistory`, but tracking running EX score. */
  private scoreHistory: Array<{ progress: number; exScore: number }> = [];
  protected lastJudge = '';
  protected lastJudgeUntil = 0;
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
  protected judgeSideState: Record<'1P' | '2P', { judge: JudgeKind | ''; until: number; combo: number }> = {
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
  protected readonly pressedChannels: Set<string> = new Set();
  /**
   * Per-key-on-timer (`100..117`) play-clock timestamp of an in-flight release fade. When set, the lane beam (and a
   * theme's key-on sprites) taper from 1 → 0 over {@link resolveKeyOnFadeMs} starting at the recorded value, so an LN
   * release decays instead of popping off. {@link releaseKeyOnTimer} populates this; {@link
   * startKeyOnTimer} clears it on a fresh press.
   */
  protected readonly keyOnFadeOutStart: Map<number, number> = new Map();
  protected readonly bombStartedAt: Map<string, number> = new Map();
  private readonly bgaTargetsScratch: GameplayBgaTarget[] = [];
  /**
   * Mirror of the engine's gauge state, refreshed from every `summary.gauge` frame. The gauge model itself
   * (per-judge deltas, TOTAL scaling, guts softening, clear rule) lives entirely in the active ruleset — this view
   * only renders what the engine reports, so LR2 / beatoraja / IIDX differences need no change here. The placeholder
   * below is what renders between scene construction and the first frame.
   */
  protected gaugeState: PlayerGaugeSummary = createPlaceholderGaugeState();
  /**
   * FAST / SLOW counts. Incremented on every GREAT or GOOD judgement — PERFECT is "on time" so it doesn't count,
   * BAD/POOR break combo and aren't tracked here. Mirrors `applyFastSlowForJudge` in `packages/player`'s engine. Reset
   * per play in `prepareSong`.
   */
  private fastCount = 0;
  private slowCount = 0;
  /**
   * Set to `true` once the player has hit every chart note without a single BAD / POOR break. Latches on first
   * achievement so the `full-combo` theme event (LR2 FC timers 48 / 49) only fires once per play — replaying the chart resets this in
   * `prepareSong`. Note: AUTO mode reaches FC the moment the last note's auto-PERFECT lands, so the FC presentation
   * also plays during autoplay sessions (the player specifically asked for that behavior).
   */
  private fullComboFired = false;
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
   * Map of timer-id → `playClock()` timestamp at which the timer started, using the LR2 timer numbering from
   * `gameplay-constants.ts`. The core scene drives the key-on bank (100–119) for the lane beams; theme families stamp
   * their own timers (bombs, FC, judge, scene stages, …) into the same map. Removed when the timer "stops" (e.g. key
   * release for key-on).
   */
  protected readonly timerStartedAt: Map<number, number> = new Map();
  /**
   * BPM-aware seconds → beat resolver, prepared once per song. Used by `renderNotes` to position scrolling notes
   * correctly across `#BPM` change events; the previous hand-rolled `beatAtSeconds` only saw the initial BPM, which
   * made notes drift through tempo transitions.
   */
  protected timingResolver: ReturnType<typeof createTimingResolver> | undefined;
  /**
   * Per-layer BGA cue lists, sorted by chart-time seconds. Each cue's `bmpKey` is the resource key our texture cache is
   * keyed by (BMS id like "01" for BMS charts, header.name like "base.png" for bmson). `bmpKey === undefined` is the
   * "clear / hide" command (BMS `00`).
   */
  private bgaTimeline: { base: BgaCue[]; layer: BgaCue[]; poor: BgaCue[] } = {
    base: [],
    layer: [],
    poor: [],
  };
  /**
   * BMP-resource → decoded `Texture` cache for the **base** + **POOR** tracks. Loaded lazily during `prepareBga()` so
   * the playfield can start displaying samples while background images keep streaming in. Black pixels are preserved
   * (this is the bottommost BGA layer).
   */
  private bgaTextures = new Map<string, Texture>();
  /**
   * BMP-resource → decoded `Texture` cache for the **layer** track (`#BMP` channels 07 and 0A). Decoded separately from
   * {@link bgaTextures} with a chroma-key that turns pure-black pixels transparent — mirrors the BMS BGA "layer"
   * convention used by `packages/player/src/bga.ts` so the foreground composites cleanly over the base track. Even when
   * the same BMP id appears on both tracks we keep two textures because `chroma-key` is destructive.
   */
  private bgaLayerTextures = new Map<string, Texture>();
  /**
   * BMP-key → `<video>` element for video BGA cues (`.mp4` / `.webm` / etc.). `renderBga` seeks + plays these on cue
   * transitions; `dispose` revokes their object URLs.
   *
   * Stored separately from {@link bgaTextures} only because the sync logic needs the underlying media element — the
   * texture itself is also added to `bgaTextures` / `bgaLayerTextures` so the existing renderer paths pick it up
   * unchanged.
   */
  private bgaVideos = new Map<string, { video: HTMLVideoElement; objectUrl: string }>();
  /**
   * Tracks which video is currently associated with each BGA layer and the chart-time it was seeded at. We use this to
   * detect cue transitions in `renderBga` (start the new cue's video, pause the previous one) and to compute the
   * `currentTime` offset relative to the cue's start seconds.
   */
  private bgaActiveVideos: { base?: { key: string; cueSeconds: number }; layer?: { key: string; cueSeconds: number } } =
    {};
  /** `performance.now()` of the most recent POOR judgement, drives the POOR-BGA window. */
  private lastPoorAt = 0;
  /**
   * BMS spec — when the chart omits `#POORBGA` and provides `#BMP00`, the BMP00 image acts as the implicit POOR
   * placeholder until an explicit `#xxx06` POOR cue takes over. Set during {@link prepareSong} so the renderer can
   * paint BMP00 on a miss before any authored POOR event fires; left `undefined` when the chart already authors a
   * proper POOR track or doesn't ship a BMP00 fallback. Mirrors the TUI BGA renderer's `poorFallbackKey` plumbing.
   */
  private poorBgaFallbackKey: string | undefined;
  /**
   * Chart-time after which the BMP00 POOR fallback yields to the explicit POOR timeline. Equal to the first authored
   * POOR cue's `seconds` (or `Infinity` when no POOR cues exist). The renderer compares the chart playhead against this
   * so a chart that authors POOR mid-song falls back to BMP00 only during the pre-roll.
   */
  private poorBgaFallbackUntilSeconds = Number.POSITIVE_INFINITY;
  /** Whether the chart actually carries any BGA events (drives LR2 op 170/171). */
  protected hasBga = false;
  /** Smoothed score for the count-up animation. Lerps toward `score.score`. */
  protected displayedScore = 0;
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
  protected readonly options: TOptions;

  public constructor(options: TOptions = {} as TOptions) {
    this.options = options;
    if (options.initialHiSpeed !== undefined && Number.isFinite(options.initialHiSpeed)) {
      // Snap to the same 1/1000 grid `adjustHiSpeed` uses so a host-supplied `1.5000000000000002` (the obvious
      // float-drift failure mode of repeated +0.1 steps) lands on the canonical grid value the in-game adjust hotkey
      // would produce.
      const snapped = Math.round(options.initialHiSpeed * 1000) / 1000;
      this.hiSpeed = Math.max(HISPEED_MIN, Math.min(HISPEED_MAX, snapped));
    }
    this.autoPauseOnBlur = options.autoPauseOnBlur ?? false;
    this.audioVolumes = {
      key: sanitizeBusVolume(options.audioVolumes?.key ?? 1),
      bgm: sanitizeBusVolume(options.audioVolumes?.bgm ?? 1),
    };
    this.audioCompressorParams = { ...options.audioCompressorParams };
  }

  /**
   * Convenience accessor for the host's `Application`. Throws if called before {@link mount}; this is intentional —
   * every code path that touches `this.app` runs after mount completes.
   */
  private get app(): Application {
    if (!this.host) {
      throw new Error('CoreGameplayView: app accessed before mount');
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
    return DEFAULT_THEME_TIMING;
  }

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
    const { right } = resolveSkinlessLaneLayout(this.laneChannels, this.laneChannels.length, this.chartPlayVariant);
    const rect = stage.resolveBgaRect(right);
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

  /** The be-music skin's stage while the scene paints through it, otherwise `undefined`. */
  private get beMusicStage(): BeMusicStage | undefined {
    if (this.options.skinlessChromeRenderer) return undefined;
    const skin = this.options.beMusicSkin;
    return skin ? resolveBeMusicSkinStage(skin) : undefined;
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
   * Convenience wrapper that runs {@link prepare} and {@link start} back-to-back — the historical "mount everything and
   * play" entry point. Hosts that want to overlap heavy load with a Decide splash should call `prepare()` early and
   * call `start()` only when the splash is dismissed. See the `showDecide` flow in `player-web-demo`.
   */
  public async mount(host: PixiSceneHost, song: BrowserSongEntry, source?: BrowserSongAssetSource): Promise<void> {
    // No splash covers the load window on this path, so the playfield comes up straight away and shows the loading
    // state (see `revealWhilePreparing`) instead of a blank stage while chart audio decodes.
    this.revealWhilePreparing = true;
    await this.prepare(host, song, source);
    if (this.disposed) return;
    this.start();
  }

  /**
   * Attaches the scene-graph subtree to the host, wires DOM listeners, parses the chart, and decodes every audio sample
   * the chart references — the slow part of going from "song picked" to "gameplay can begin". The scene is added to the
   * stage with `sceneRoot.visible = false` so a Decide splash (or any other overlay) can keep painting during the load
   * window without competing for stage z-order.
   *
   * Returns once chart audio is decoded (timer / chart-start scheduling is deferred to {@link start}). BGA preload runs
   * concurrently and is allowed to land mid-play; the playfield is up by the time `start()` fires regardless.
   */
  public async prepare(host: PixiSceneHost, song: BrowserSongEntry, source?: BrowserSongAssetSource): Promise<void> {
    this.host = host;
    this.song = song;
    this.source = source;
    // Label every top-level node so the PixiJS Devtools "Scene Graph" panel reads as `gameplay > {bga,skin,lane,…}`
    // instead of a wall of `Container` rows. Layer ordering matches `addChild` below.
    this.sceneRoot.label = 'gameplay/scene';
    this.root.label = 'gameplay/root';
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
    // The stage size is fixed for the scene's lifetime, so the mask and design background never change shape
    // post-mount. Stamp them once here and skip the per-frame rebuild that was contributing to the rAF handler's
    // runtime.
    const stage = this.stageSize;
    this.designClipMask.rect(0, 0, stage.width, stage.height).fill(0xffffff);
    this.background.rect(0, 0, stage.width, stage.height).fill(BG);
    // The gameplay scene owns its own pointerdown listener on the canvas itself (`this.focus`) and a window-level
    // keydown listener — none of the per-layer children need to participate in Pixi's interaction system. Marking
    // each render-only Container as `eventMode = 'none'` lets the interaction manager skip the entire subtree
    // during hit-testing every pointermove / pointerdown, which is otherwise an O(N) walk over hundreds of skin
    // children per event.
    //
    // CAUTION: `this.background` and `this.designClipMask` are intentionally NOT marked `'none'`. The mask is
    // referenced via `this.root.mask = this.designClipMask` and Pixi v8's mask resolution path interacts with the
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
    this.root.addChild(
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
    // Clip every child of `root` to the design rectangle. The mask graphic itself is a child of `root`, so the same
    // viewport scale / translate applies to both the mask and the masked content — Pixi clips against the mask's world-
    // space bounds, which matches the on-screen design rectangle.
    this.root.mask = this.designClipMask;
    this.shutterLayer.label = 'gameplay/shutter';
    this.sceneRoot.addChild(this.viewportBackground, this.root);
    // Attach to the host's already-initialized stage. The host owns the `Application` (canvas, ticker, WebGL context) —
    // we just contribute our scene-graph subtree.
    host.app.stage.addChild(this.sceneRoot);
    // ESC / F5 / Space / ArrowUp / ArrowDown stay on the view so the LR2 `#FADEOUT` exit animation runs to
    // completion BEFORE the engine's interrupt flow disposes the audio session, and so HiSpeed adjustment
    // affects the visual scroll speed (which the engine doesn't own). The WebInputRuntime's `shouldSkipKey`
    // filter mirrors this list so it doesn't also push duplicate `interrupt` / `toggle-pause` commands. Lane
    // input goes through the WebInputRuntime's own `keydown` listener to the engine's input bus.
    window.addEventListener('keydown', this.handleSharedEngineExitKey);
    this.app.canvas.addEventListener('pointerdown', this.focus);
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
    // Hide the scene-graph subtree until {@link start} fires so a Decide splash (or any other overlay) can keep
    // painting on the shared stage during the load window without z-order contention. `start()` flips this back on the
    // moment the host hands control over to gameplay.
    this.sceneRoot.visible = false;
    this.assetsLoading = true;
    this.prepareSong(song);
    if (this.revealWhilePreparing) {
      // Hold the chart clock before its start (see `start()`) and draw the loading playfield while assets decode.
      this.startTime = Number.POSITIVE_INFINITY;
      this.sceneRoot.visible = true;
      this.startAnimationLoop();
    }
    await this.prepareTheme();
    if (this.disposed) return;
    await this.prepareAudio();
    if (this.disposed) return;
    // BGA preload runs IN THE BACKGROUND — `prepare()` resolves here even if `prepareBga()` is still decoding videos.
    // The ffmpeg.wasm fallback for unsupported codecs (e.g. legacy `.mpg`) can take ~tens of seconds, and the user
    // wants the PLAY scene to transition in immediately and play its LR2 LOADING animation during that wait rather than
    // freezing the Decide splash. {@link start} gates the actual chart start (LR2 timer 40 → 41 / op 80 → 81) on
    // `bgaReadyPromise`, so notes still don't begin until the BGA is in place.
    this.bgaReadyPromise = this.prepareBga().catch((error) => {
      log.warn('BGA preload failed; continuing without it', error);
    });
    void this.bgaReadyPromise.then(() => {
      this.assetsLoading = false;
    });
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
    this.sceneRoot.visible = true;
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
   * Hides / shows the scene's subtree on the shared stage. Toggles `sceneRoot.visible` (cheap) instead of touching the
   * canvas display — the canvas is shared with the select scene now, so we mustn't make it `display: none` from here.
   */
  public setVisible(visible: boolean): void {
    this.sceneRoot.visible = visible;
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
  public startRecording(): void {
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
    // Detach the gameplay tick from the host ticker. The shared `Application` keeps running for the next active scene
    // — only the per-scene state below is freed.
    this.stopAnimationLoop();
    // Detach window-level event listeners so a stray keypress doesn't hit a disposed view.
    window.removeEventListener('keydown', this.handleSharedEngineExitKey);
    if (this.host) {
      this.host.app.canvas.removeEventListener('pointerdown', this.focus);
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
    this.sharedEngineClockAnchored = false;
    this.sharedEnginePromise = undefined;
    const preserveAudioTail = options.preserveAudioTail === true && this.chartEnded;
    const audioTailChart = this.resolvedChart ?? this.song?.chart;
    const audioTailCleanupDelayMs =
      preserveAudioTail && audioTailChart !== undefined
        ? resolveGameplayAudioTailCleanupDelayMs({
            chart: audioTailChart,
            notes: this.notes,
            autoSampleTriggers: this.autoSampleTriggers,
            decodedSamples: this.decodedSamples,
            bmsonSlicePlayback: this.bmsonSlicePlayback,
            currentSeconds: this.currentSeconds(),
          })
        : 0;
    const webAudioSession = this.webAudioSession;
    this.webAudioSession = undefined;
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
    // its scene graph. The sceneRoot Container itself stays alive in case the host wants to re-enter the same view (we
    // don't, but it's harmless).
    if (this.sceneRoot.parent) {
      this.sceneRoot.parent.removeChild(this.sceneRoot);
    }
    // Free per-view textures. Order matters: textures BEFORE we destroy the sceneRoot / sprites, because
    // `Texture.destroy()` emits a `styleChange` event that traverses up to the live `GlTextureSystem` (still alive on
    // the shared host). With our sprites still parented to sceneRoot, the events route correctly.
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
      this.sceneRoot.destroy({ children: true, context: true });
    } catch (error) {
      log.warn('sceneRoot.destroy threw', error);
    }
    // Drop large per-song reference holders explicitly. Async gates and cancelled browser decode tasks can retain the
    // view for a little while after `dispose()` returns; clearing these fields keeps that short tail from pinning a
    // full chart bundle, decoded PCM, BGA timelines, and skin/font caches.
    this.decodedSamples.clear();
    this.bmsonSlicePlayback = undefined;
    this.autoSampleTriggers = [];

    this.pressedChannels.clear();
    this.timerStartedAt.clear();
    this.bombStartedAt.clear();
    this.keyOnFadeOutStart.clear();
    this.wavCmdVolumeMultipliers.clear();
    this.switchingBgas.clear();
    this.gaugeHistory.length = 0;
    this.scoreHistory.length = 0;
    this.notes = [];
    this.mineNotes = [];
    this.invisibleNotes.length = 0;
    this.preparedChart = undefined;
    this.resolvedChart = undefined;
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

  private prepareSong(song: BrowserSongEntry): void {
    // Resolve `#RANDOM` / `#SETRANDOM` / `#SWITCH` control flow first so every play-time consumer below sees the same
    // chosen branches. `Math.random` is the random source (LR2 re-rolls each play) — for deterministic playback
    // (replays, tests) the host can swap this for a seeded PRNG later.
    const resolved = resolveBmsControlFlow(song.chart, { random: Math.random });
    this.resolvedChart = resolved;
    // BMS spec — `#WAVCMD 01 xx vv` declares per-slot volume overrides (0..127 byte). Collect once now so every
    // subsequent `playSample{,ByKey}` is a single Map lookup; slots without an entry fall through to the unity-gain
    // fast path. Pitch / loop bytes are skipped — the helper only emits volume multipliers.
    this.wavCmdVolumeMultipliers = collectBmsWavCmdVolumeMultipliers(resolved.bms.wavCmds, resolveBmsBase(resolved));
    // BMS spec — `#EXWAVxx [flags] params filename` declares an extended WAV slot with optional pan / volume /
    // frequency. Apply the volume side here so the existing per-trigger `connectSampleNodeWithWavCmdGain` splices the
    // `#EXWAV` attenuation in alongside any `#WAVCMD 01 xx vv` value. Pan / freq are deliberately skipped — they need a
    // StereoPannerNode / playbackRate split that the current graph doesn't yet wire up.
    const exWavMultipliers = collectBmsExWavVolumeMultipliers(resolved.bms.exWav);
    for (const [slot, multiplier] of exWavMultipliers) {
      // Compose multiplicatively with `#WAVCMD` so authors who use both directives on the same slot get the combined
      // attenuation rather than one silently overriding the other.
      const previous = this.wavCmdVolumeMultipliers.get(slot) ?? 1;
      this.wavCmdVolumeMultipliers.set(slot, previous * multiplier);
    }
    // BMS spec — `#SWBGAxx fr:tot:lp:ARGB N1 N2 ...` declares an animated BGA slot. Pre-parse every entry now so
    // per-frame BGA composition stays a single `Map.get` plus `pickSwitchingBgaFrame` (no per-frame regex / split).
    this.switchingBgas.clear();
    const base = resolveBmsBase(resolved);
    for (const [slot, raw] of Object.entries(resolved.bms.swBga)) {
      const parsed = parseBmsSwBga(raw, base);
      if (parsed) {
        this.switchingBgas.set(slot, parsed);
      }
    }
    // Build the chart's playable / landmine / invisible note arrays via the engine's own `preparePlaybackChartData`
    // so the renderer holds the exact same `TimedPlayableNote[]` / `TimedLandmineNote[]` instances the engine
    // will judge against. We keep a reference to the entire prepared bundle and forward it through
    // `engineOptions.preparedChart` later, telling the engine to skip its own internal extract pass.
    //
    // This is the structural fix for the whole class of view ↔ engine drift bugs the Phase-4c shared-engine
    // migration kept tripping over: an `inferBmsLnTypeWhenMissing` flag missing on one side, a
    // `bms.controlFlow` array re-resolved on the engine side, a `random1P: 'OFF'` truthy-check evaluating to
    // `false` because `'OFF'` is a non-empty string, a missing `laneModeExtension` mapping PMS to IIDX 10-key
    // DP, … each one shifted the index alignment of the renderer's parallel `this.notes` arrays vs the
    // engine's, and `applyEngineFrame` ended up mirroring `judged` flags onto the wrong note. Sharing the
    // instance means the parallel arrays are no longer parallel — they're the same array, the engine mutates
    // `judged` directly, and the renderer just reads it. There is no second extract that could disagree.
    // Resolve the chart's intended play variant up front so the lane-binding pass sees the host's
    // classification (instead of falling back to the engine's content heuristic). Mirrors the beatoraja
    // path's `composeBeatorajaEngineOptions` wiring in the beatoraja gameplay scene. Without this:
    //   - `.bme` POPN-9 charts (full `11..19` on `#PLAYER 1`) classify as `'7'` via the engine's heuristic
    //     and lose the POPN-9 `f/v/g/b` lane bindings on channels `16..19`.
    //   - `.bms` / `.bme` charts that author PMS-STD content (`11..15 + 22..25`, no scratch) classify as
    //     `'10'` (IIDX 5K DP) and route the right-side POPN columns through the IIDX 2P key bindings.
    // `resolveChartPlayVariant` already encodes the right rules for both (see `@be-music/chart`); threading
    // the result here gives the engine + adapter + renderer a single source of truth without each one
    // re-running its own heuristic.
    const hostPlayVariant = this.song ? resolveChartPlayVariant(this.song) : undefined;
    const prepared = preparePlaybackChartData(
      resolved,
      {
        // Always extract the invisible / keysound array even when the overlay is off — so the lil-gui toggle
        // can flip the visualization on mid-song without a chart restart. The cost is purely memory (one
        // sorted array of 3x / 4x events); the per-frame render loop is gated on `showInvisibleNotes` and
        // bails immediately when the flag is off.
        showInvisibleNotes: true,
        laneModeExtension: extractChartExtension(this.song?.chartPath),
        playVariant: hostPlayVariant,
      },
      true /* inferBmsLnTypeWhenMissing */,
      0 /* auxiliaryPlaybackEndSeconds — engine recomputes its own audio horizon from realtime triggers */,
    );
    this.preparedChart = prepared;
    this.notes = prepared.notes;
    this.mineNotes = prepared.landmineNotes;
    this.invisibleNotes = prepared.invisibleNotes;
    if (this.options.replay !== undefined) {
      // Replay playback — the recorded play-log carries the FINAL note arrangement (post-flip, post-shuffle), so
      // instead of re-rolling the lane transforms we re-apply the recorded channels onto the freshly prepared
      // notes. A mismatch means the loaded chart is not the one the log was recorded against (different `#RANDOM`
      // roll or a different file) — surface it as a prepare failure rather than replaying garbage.
      const arranged = applyPlaylogArrangement(this.options.replay.chart.notes, prepared);
      if (!arranged.ok) {
        throw new Error(`play-log replay chart mismatch: ${arranged.reason}`);
      }
    } else {
      // DP FLIP — swap 1P / 2P channels in place. Cheap O(n) walk because we already iterate `notes` for sorting; SP
      // charts skip every entry (no `2x` channels exist). Mine notes are flipped together so they stay anchored to the
      // same visual lane after the flip.
      if (this.options.dpFlip) {
        for (const note of this.notes) {
          note.channel = flipDpChannel(note.channel);
        }
        for (const mine of this.mineNotes) {
          mine.channel = flipDpChannel(mine.channel);
        }
        for (const invisible of this.invisibleNotes) {
          invisible.channel = flipDpChannel(invisible.channel);
        }
      }
      // RANDOM / MIRROR / S-RANDOM / SCATTER — shuffle the 1P / 2P keyboard lanes independently. Scratch (channels 16 /
      // 26) never moves. Per LR2 convention, the shuffle is drawn at chart-prepare time so a single play session has a
      // stable arrangement (F5-restart re-rolls it). Mine channels are included in the same shuffle pass so a mine on
      // lane 4 lands wherever the shuffle moved lane 4 — keeping the mine's visual relationship to the surrounding chord
      // intact.
      applyRandomMode(
        this.notes as Array<{ channel: string }>,
        '1',
        this.options.random1P ?? 'OFF',
        Math.random,
        this.mineNotes as Array<{ channel: string }>,
        this.invisibleNotes as Array<{ channel: string }>,
      );
      applyRandomMode(
        this.notes as Array<{ channel: string }>,
        '2',
        this.options.random2P ?? 'OFF',
        Math.random,
        this.mineNotes as Array<{ channel: string }>,
        this.invisibleNotes as Array<{ channel: string }>,
      );
    }
    this.maxLongNoteBeatSpan = this.notes.reduce((max, note) => {
      if (note.endBeat === undefined) {
        return max;
      }
      return Math.max(max, Math.max(0, note.endBeat - note.beat));
    }, 0);
    this.chartLastNoteEndSeconds = this.notes.reduce((acc, note) => Math.max(acc, note.endSeconds ?? note.seconds), 0);
    this.songDurationSeconds = this.chartLastNoteEndSeconds;
    this.chartEnded = false;
    // Drop the previous chart's active-sample tracking. Stale entries would otherwise let a `c=true` note on the new
    // chart suppress its own first trigger because a same-key node from the old play looks "still playing" until it
    // ends naturally.

    // Lay out the whole keyboard of the chart's play variant (5 / 7 / 9 / 10 / 14 / 24 / 48 KEY), not just the lanes
    // the chart happens to use, so a sparse chart still plays on full lanes. The variant also decides channel `17`
    // (a lane in 9 KEY, FREE ZONE in IIDX) and the 9 KEY layout the LR2 default 9-keys play skin expects.
    this.chartPlayVariant = resolveChartPlayVariant(song);
    this.laneChannels = resolvePlayVariantLaneChannels(this.notes, this.chartPlayVariant);
    // Initialize from `prepared.scorableNotes.length` so the view's initial `score.total` matches the engine's
    // authoritative `summary.total` (= same `scorableNotes` filter, with Free-Zone channels excluded). Without
    // this, charts that use a Free-Zone channel had a renderer-side total larger than the engine's by the
    // Free-Zone count, and `maybeFireFullCombo`'s `tracker.combo === score.total` predicate became
    // unreachable — combo could only ever climb to the engine's smaller scorable count, and the FC cue never
    // fired. `applyEngineFrame` still mirrors `summary.total` defensively each frame, but that's now a no-op
    // on the common path.
    this.score = createEmptyScore(prepared.scorableNotes.length);
    this.tracker = createScoreTracker();
    // Reset the result-screen "MAX COMBO" tracker whenever a fresh chart is prepared — restart (R), song-pick from
    // select, etc. Otherwise the previous play's max would leak into the new one.
    this.maxCombo = 0;
    // Wipe per-side judge / combo snapshots so a fresh chart doesn't briefly paint the previous play's verdict on its
    // first frame (the `until` chart-time is in the previous chart's coordinate system; comparing it to the new chart's
    // `currentSeconds()` would render stale state until the new play crosses that mark).
    this.lastJudge = '';
    this.lastJudgeUntil = 0;
    this.judgeSideState = {
      '1P': { judge: '', until: 0, combo: 0 },
      '2P': { judge: '', until: 0, combo: 0 },
    };
    // Result-screen polyline histories. Seeding waits until after `gaugeState` is reinitialized below — at this point
    // we'd still be reading the **previous** play's gauge value.
    this.gaugeHistory = [];
    this.scoreHistory = [];
    const resolver = createTimingResolver(resolved);
    this.timingResolver = resolver;
    // Build a STOP-aware seconds→beat resolver for `currentBeat`.
    this.beatAtSeconds = createBeatAtSecondsResolverFromTimingResolver(resolver);
    // Build the #SCROLL / #SPEED distance integrator. Skipped when the chart has no such events, so the common case
    // stays on the plain beat-diff path with no extra cost.
    const beatResolver = createBeatResolver(resolved);
    const scrollTimeline = createScrollTimeline(resolved, beatResolver);
    const speedTimeline = createSpeedTimeline(resolved, beatResolver);
    this.scrollMapper =
      scrollTimeline.length > 0 || speedTimeline.length > 0
        ? createScrollDistanceMapper(scrollTimeline, speedTimeline, { invalidDistance: 0 })
        : undefined;
    this.autoSampleTriggers = collectSampleTriggers(resolved, resolver, { inferBmsLnTypeWhenMissing: true })
      .filter((trigger) => !isPlayableInputChannel(trigger.channel))
      .sort((left, right) => left.seconds - right.seconds);
    // bmson 1.0.0 slicing — for bmson charts, each `sound_channels[]` entry is a single audio file that gets sliced at
    // every distinct pulse where any of its notes fire, and each note plays its assigned slice (`audio_offset` ..
    // `audio_offset + slice_duration`) instead of the whole WAV from t=0. The audio-renderer already computes the
    // per-event slice playback table; we wire it up here so the playable- note path (`playSample`) can look up the
    // offset / duration by event identity at trigger time. BMS / json charts skip the build (the map stays undefined)
    // since they have no slicing semantics — every note plays its WAV from the start.
    this.bmsonSlicePlayback =
      resolved.sourceFormat === 'bmson'
        ? createBmsonSamplePlaybackMap(
            resolved,
            resolver,
            // Include both playable notes and the auto-trigger BGM events so the {@link WebAudioSession} can resolve
            // slice metadata for both code paths through a single Map lookup. Without the trigger events here, the
            // session's `scheduleEvent` would fall back to "play whole WAV" for every BGM cue, regressing bmson
            // sliced-WAV authoring intent (each note's `audio_offset` / `slice_duration` window).
            [
              ...this.notes.map((note) => note.event),
              ...this.mineNotes.map((note) => note.event),
              ...this.invisibleNotes.map((note) => note.event),
              ...this.autoSampleTriggers.map((trigger) => trigger.event),
            ],
            beatResolver,
          )
        : undefined;
    this.songDurationSeconds = Math.max(this.chartLastNoteEndSeconds, this.autoSampleTriggers.at(-1)?.seconds ?? 0);
    // BMS spec — `#BASEBPM N` declares the chart's reference BPM for HS-FIX calibration. The shared
    // `resolveChartReferenceBpm` helper prefers `#BASEBPM` over the chart's initial `#BPM` so a chart whose `#BPM` is
    // its peak / average rather than its scroll-feel reference still calibrates at the speed the author intended; falls
    // back to the parsed `metadata.bpm` and finally the song-list BPM hint when neither is present.
    this.applyHsFix(resolver, resolveChartReferenceBpm(resolved, this.song?.bpm));
    // Initialize gauge with the actual playable-note count and the chart's #TOTAL value so PG/GR gain matches LR2: a
    // long chart with TOTAL=300 and 1000 notes gets +0.3 per PG/GR, while a short TOTAL=160 100-note chart gets +1.6
    // per PG/GR.
    this.gaugeState = createPlaceholderGaugeState(this.resolveSelectedGauge());
    // Now that the gauge has its starting value (LR2 default 20 %), seed the polyline history so the result-screen
    // graph starts at the correct origin instead of the first judge's value.
    this.gaugeHistory.push({ progress: 0, value: this.gaugeState.current });
    this.scoreHistory.push({ progress: 0, exScore: 0 });
    this.fastCount = 0;
    this.slowCount = 0;
    this.fullComboFired = false;
    this.displayedScore = 0;
    this.bgaTimeline = buildBgaTimeline(resolved, resolver);
    // BMS spec — when `#POORBGA` is unset but `#BMP00` exists, BMP00 becomes the implicit POOR placeholder until an
    // explicit `#xxx06` cue fires. Mirrors the TUI BGA renderer's `poorFallbackKey` so the web side stops showing a
    // black POOR plate on misses for charts that rely on this convention.
    const poorBmp00 = resolved.resources.bmp['00'];
    const shouldUsePoorBmp00Fallback =
      typeof resolved.bms.poorBga !== 'string' && typeof poorBmp00 === 'string' && poorBmp00.length > 0;
    this.poorBgaFallbackKey = shouldUsePoorBmp00Fallback ? '00' : undefined;
    this.poorBgaFallbackUntilSeconds = this.bgaTimeline.poor[0]?.seconds ?? Number.POSITIVE_INFINITY;
    this.hasBga =
      this.bgaTimeline.base.length > 0 || this.bgaTimeline.layer.length > 0 || this.bgaTimeline.poor.length > 0;
  }

  /**
   * The gauge this run actually plays on. A replay restores the recorded pick so the played-back run judges, drains,
   * and clears exactly as the original did; otherwise it is the host's selection, defaulting to LR2 GROOVE.
   */
  protected resolveSelectedGauge(): GrooveGaugeType {
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

  /**
   * Locates the song's current beat from `currentSeconds` using the BPM-aware tempo points. Required because BMS charts
   * can change tempo mid-song (`#BPM` events) — using the initial BPM alone makes notes after a tempo change drift
   * visibly out of sync with the audio.
   */
  /** True while the wall-clock playhead is still inside the intro buffer. */
  protected isIntroPlaying(): boolean {
    if (this.startTime === 0) {
      return true;
    }
    return performance.now() < this.startTime;
  }

  protected currentBeat(seconds: number): number {
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
  protected async preparePixiUpload(textures: Iterable<Texture | undefined>): Promise<void> {
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

  private async prepareAudio(): Promise<void> {
    if (!this.source || !this.song) {
      return;
    }
    // `latencyHint: 'interactive'` asks the browser for the lowest round-trip latency it can offer — at the cost of CPU
    // efficiency vs `'playback'`. For a rhythm game the trade-off is right: keypress → sample audible delay is the
    // player's primary perception of "responsiveness", and we'd rather burn a few extra cycles than land samples on a
    // 20–30 ms late. Browsers that don't honor the hint silently ignore it.
    this.audioContext = new AudioContext({ latencyHint: 'interactive' });
    // AudioContext starts in `suspended` state on most browsers until a user gesture, and the *first* `node.start()`
    // call on a still-suspended context can sit in the queue for ~30ms while the browser ramps the audio graph up.
    // Calling `resume()` here — we're inside the user-gesture chain that started the play session — pre-warms it so the
    // very first sample fires at baseline latency. Errors (no-gesture / already-running) are swallowed because both are
    // harmless.
    void this.audioContext.resume().catch(() => undefined);
    // Surface the device-reported latency so the player has visibility into how much "free" delay the audio stack is
    // adding before our schedule even begins. `baseLatency` is "how late the audio graph commits a buffer" (driver /
    // hardware buffer headroom); `outputLatency` (when populated) tracks the OS audio queue. Combined they form the
    // floor of "press → hear" latency we can't optimize away from JS.
    const ctx = this.audioContext;
    log.info('AudioContext ready', {
      sampleRate: ctx.sampleRate,
      state: ctx.state,
      baseLatencyMs: typeof ctx.baseLatency === 'number' ? +(ctx.baseLatency * 1000).toFixed(2) : 'n/a',
      outputLatencyMs:
        typeof (ctx as { outputLatency?: number }).outputLatency === 'number'
          ? +((ctx as { outputLatency: number }).outputLatency * 1000).toFixed(2)
          : 'n/a',
    });
    // Build the audio bus. See `audio-bus.ts` for the full architecture; in short:
    //
    // key sources → keyMixer → keyComp ↘ masterComp → makeup → destination ('split') BGM sources → bgmMixer → bgmComp ↗
    //
    // 'legacy' collapses both buses onto a single compressor; 'off' bypasses every compressor stage. Sample sources
    // always feed `keyMixer` / `bgmMixer`, never directly to the destination, so a mode switch never has to reconnect
    // in-flight `BufferSourceNode`s — important because hundreds of one-shots come and go per second on dense charts.
    this.audioCompressorMode = this.options.audioCompressorMode ?? 'split';
    const initialMode: CompressorMode = this.options.audioCompressor === false ? 'off' : this.audioCompressorMode;
    this.audioBus = buildAudioBus(this.audioContext, initialMode, {
      initialStages: this.options.audioCompressorStages,
      initialVolumes: this.audioVolumes,
      initialCompressorParams: this.audioCompressorParams,
    });
    // Audio-reactive skins read the post-mix signal from the bus's analysis tap.
    this.audioAnalyzer = new AudioAnalyzer(this.audioContext);
    this.audioBus.outputNode.connect(this.audioAnalyzer.input);
    // Use the control-flow-resolved chart so #IF-gated #WAVxx declarations match the chosen #RANDOM branch.
    const chart = this.resolvedChart ?? this.song.chart;
    // BMS spec — `#VOLWAV <0..ZZ>` declares the chart's master volume scaling (100 = unity, 80 = 80 % loud, > 100
    // boosts). Applying it here means every sample triggered for THIS chart (key bus, BGM bus, every compressor mode)
    // flows through the single dedicated stage in the bus and the recorder captures the post-`#VOLWAV` signal, matching
    // the CLI renderer's `resolveChartVolWavGain` behavior. Charts that omit `#VOLWAV` parse to `undefined` and are
    // left at unity.
    const volWavRaw = chart.bms.volWav;
    if (typeof volWavRaw === 'number' && Number.isFinite(volWavRaw) && volWavRaw >= 0) {
      this.audioBus.setMasterGain(volWavRaw / 100);
    }
    // BMS spec: `#WAVxx` slot index is base-36 (`00..ZZ`), so a chart can declare up to 1296 unique samples. An earlier
    // revision capped this preload at the first 256 entries, which silently dropped audio for any sample referenced by
    // a slot 100+ on dense charts (a typical "Lunatic Crave"-tier chart easily hits 500+ unique WAVs). The parser
    // already enforces the spec ceiling, so iterating every declared path here is safe; memory on a fully-populated
    // chart is at most ~1300 decoded buffers, dominated by the underlying PCM rather than any per-entry overhead.
    const wavPaths = Object.values(chart.resources.wav).filter((path): path is string => typeof path === 'string');
    // BMS spec — `#PATH_WAV <prefix>` declares a sub-directory the chart's WAVs live under. The audio asset resolver
    // walks the prefixed form first when set so a chart authored as `wav/` + bare `kick.wav` references resolves the
    // file as `wav/kick.wav`.
    const pathWavPrefix = typeof chart.bms.pathWav === 'string' ? chart.bms.pathWav : undefined;
    await runWithConcurrency(wavPaths, AUDIO_DECODE_CONCURRENCY, async (path) => {
      if (this.disposed || !this.source || !this.song || !this.audioContext) return;
      // Audio-aware asset lookup: charts almost universally declare `.wav` paths but archives often ship `.ogg` /
      // `.mp3`. Try the codec fallback chain (opus → ogg → mp3 → wav → original). Audio entries are stored as lazy
      // `File` references in the source map (the drop pipeline defers their byte load to keep gigabytes of WAV
      // samples out of memory), so `loadAssetBytes` is the unwrap step that actually calls `arrayBuffer()` on demand
      // for THIS chart. The bounded worker pool prevents hundreds of browser audio decoders from allocating PCM at
      // once on dense charts.
      const entry = resolveChartAudioAsset(this.source, this.song.chartPath, path, {
        pathPrefix: pathWavPrefix,
      });
      const bytes = await loadAssetBytes(entry);
      if (this.disposed || !this.audioContext) return;
      if (!bytes) {
        return;
      }
      try {
        // Cache key is the chart-declared path (not the actually loaded codec path) so `playSampleByKey` /
        // `playSample` continue to look up by the chart's `#WAV` value.
        const decoded = await this.audioContext.decodeAudioData(bytes.slice().buffer);
        if (this.disposed) return;
        this.decodedSamples.set(normalizePath(path).toLowerCase(), decoded);
      } catch {
        // Browsers vary in codec support; unsupported samples are skipped. `decodeAudioData` also rejects when the
        // AudioContext is closed mid-decode (e.g. ESC pressed during loading) — the catch swallows that as well so
        // dispose can complete cleanly.
      }
    });
    // Build the WebAudioSession now that the sample cache is populated. The session captures the maps by reference
    // (the underlying entries can still grow if asset loading races onto a later tick), and owns every sample
    // playback path from this point on — `playSample` / `playSampleByKey` / `scheduleAutoSamples` all delegate to
    // it. See the field doc for why this beats keeping the audio plumbing inline on the view.
    if (!this.disposed && this.audioContext && this.audioBus) {
      this.webAudioSession = createWebAudioSession({
        audioContext: this.audioContext,
        audioBus: this.audioBus,
        chart: this.resolvedChart ?? this.song!.chart,
        decodedSamples: this.decodedSamples,
        wavCmdVolumeMultipliers: this.wavCmdVolumeMultipliers,
        bmsonSlicePlayback: this.bmsonSlicePlayback,
      });
    }
  }

  /**
   * Decodes every BMP resource referenced by the chart's BGA timelines into a Pixi `Texture`, keyed by the same string
   * the timeline cues reference. Loads run with bounded parallelism so a long preamble doesn't gate the playfield
   * without fanning browser decoders out without limit.
   */
  private async prepareBga(): Promise<void> {
    const song = this.song;
    const source = this.source;
    if (!song || !source || !this.hasBga) {
      return;
    }
    // Build a map of `bmpKey → file path` covering both BMS-style ids and bmson `bga.header[].name`s. The bmson header
    // carries the actual resource name; the id-keyed `resources.bmp` map is fed from BMS `#BMPxx` directives (and
    // ignored for bmson charts).
    const refs = new Map<string, string>();
    // Use the control-flow-resolved chart so #IF-gated BMP / bga header declarations match the chosen #RANDOM branch.
    const chart = this.resolvedChart ?? song.chart;
    // Partition the referenced BMP keys by which track(s) they appear in. The base + POOR tracks share decode settings
    // (no chroma key, since they sit at the bottom of the BGA composite); the layer track gets a black→transparent
    // decode so the foreground can punch through. `collectBgaTextureLoadKeys` also pulls in the source BMPs for referenced
    // `#BGAxx` sub-region aliases — without those, BGA+ charts can have a timeline cue but no decoded source texture.
    const { base: baseTrackKeys, layer: layerTrackKeys } = collectBgaTextureLoadKeys(
      chart,
      this.bgaTimeline,
      this.poorBgaFallbackKey,
    );
    const referencedKeys = new Set<string>([...baseTrackKeys, ...layerTrackKeys]);
    for (const [id, path] of Object.entries(chart.resources.bmp)) {
      if (typeof path === 'string' && referencedKeys.has(id)) {
        refs.set(id, path);
      }
    }
    for (const entry of chart.bmson.bga.header) {
      if (referencedKeys.has(entry.name)) {
        refs.set(entry.name, entry.name);
      }
    }
    await runWithConcurrency([...refs.entries()], BGA_DECODE_CONCURRENCY, async ([key, path]) => {
      if (this.disposed) return;
      // BMP / video assets are stored as lazy `File` references in the song bundle. Read on demand so memory stays
      // low while browsing — the bytes only land in the heap for BGA assets actually referenced by the focused chart.
      // Use the image-aware resolver so charts that declare `#BMPxx foo.bmp` but ship `foo.png` (or `.jpg` / `.gif`)
      // still find the asset; video extensions fall through to the original path verbatim. Decoding is bounded because
      // image/video decoders allocate native memory outside the JS heap; fanning every BGA out at once can kill the
      // Chrome renderer before any decode promise rejects.
      const entry = resolveChartImageAsset(source, song.chartPath, path);
      const bytes = await loadAssetBytes(entry);
      if (this.disposed) return;
      if (!bytes) {
        return;
      }
      const usedAsBase = baseTrackKeys.has(key);
      const usedAsLayer = layerTrackKeys.has(key);
      try {
        if (isVideoExtension(path)) {
          // Video BGA — wraps a `<video>` element in a Pixi texture. The same texture handle is used on both tracks
          // (no chroma-key on layer; black-keying a moving video looks worse than just letting the artist's blacks
          // show).
          const handle = await loadVideoTextureFromBytes(path, bytes, {
            maxLongEdgePx: this.options.bgaTranscodeMaxLongEdgePx,
            useWebCodecs: this.options.bgaTranscodeUseWebCodecs,
          });
          if (!handle) return;
          // Late-arriving video decode after the player ESC'd back to the song select — drop the texture / video
          // immediately so we don't leak it onto a dead app.
          if (this.disposed) {
            try {
              handle.video.pause();
              handle.video.removeAttribute('src');
              handle.video.load();
            } catch {
              // Best effort; the video will be GC'd anyway.
            }
            URL.revokeObjectURL(handle.objectUrl);
            try {
              handle.texture.destroy(true);
            } catch {
              // Already-destroyed Pixi resources throw; swallow.
            }
            return;
          }
          this.bgaVideos.set(key, { video: handle.video, objectUrl: handle.objectUrl });
          if (usedAsBase) this.bgaTextures.set(key, handle.texture);
          if (usedAsLayer) this.bgaLayerTextures.set(key, handle.texture);
          return;
        }
        if (usedAsBase) {
          const texture = await loadTextureFromBytes(path, bytes);
          if (this.disposed) {
            texture?.destroy(true);
            return;
          }
          if (texture) {
            this.bgaTextures.set(key, texture);
          }
        }
        if (usedAsLayer) {
          // BMS' layer track (`#xxx07`) chroma-keys pure black pixels by convention so the foreground composites over
          // the base BGA. The bmson 1.0.0 spec breaks explicitly with that: "Unlike BMS Layer Channel #xxx07, black
          // pixels will not be made transparent." Bmson layer authors deliver pre-multiplied / alpha- channel artwork
          // and expect blacks to render as black. Gate the chroma-key on chart source so BMS-derived layers keep the
          // historical blend while bmson layers come through untouched.
          const keyOutBlack = chart.sourceFormat !== 'bmson';
          const texture = await loadTextureFromBytes(path, bytes, { keyOutBlack });
          if (this.disposed) {
            texture?.destroy(true);
            return;
          }
          if (texture) {
            this.bgaLayerTextures.set(key, texture);
          }
        }
      } catch {
        // Decode failures (corrupt files, unsupported encodings) are skipped silently so the rest of the chart still
        // renders.
      }
    });
    this.registerSubRegionBgaTextures(chart);
    if (this.disposed) return;
    // Eager-upload every freshly loaded BGA texture (and any sub-region aliases registered above) so the first BGA
    // cue mid-chart doesn't stall on its own first sample. Mirrors the skin path in `prepare()`. This is fire-and-
    // forget from the prepareBga callsite — `bgaReadyPromise` already gates chart start, and adding the upload to
    // its tail just lengthens that promise by the upload work, which is what we want.
    await this.preparePixiUpload(this.bgaTextures.values());
    if (this.disposed) return;
    await this.preparePixiUpload(this.bgaLayerTextures.values());
  }

  /**
   * Builds Pixi sub-textures for every `#BGAxx YY x1 y1 x2 y2 dx dy` directive after the source `#BMPYY` images have
   * finished loading. Each sub-region BGA aliases slot `xx` to a frame- cropped view of slot `YY`, so a chart that
   * authors `#BGA01 02 0 0 256 256 0 0` makes BGA cues for `01` render the corresponding portion of `#BMP02` rather
   * than failing the texture lookup.
   *
   * Both the base and layer texture maps are populated so a sub-region aliased into either track resolves correctly.
   * Texture sources are reused across slots — Pixi releases the underlying GPU resource only when the last referencing
   * sub-texture is destroyed, which `dispose()` handles via `destroyUniqueTextures`.
   */
  private registerSubRegionBgaTextures(chart: BeMusicJson): void {
    const base = resolveBmsBase(chart);
    for (const [bgaSlot, raw] of Object.entries(chart.bms.bga)) {
      const normalizedBgaSlot = normalizeObjectKey(bgaSlot, base);
      const parsed = parseBmsBga(raw, base);
      if (!parsed) continue;
      const frameWidth = parsed.ex - parsed.sx;
      const frameHeight = parsed.ey - parsed.sy;
      if (frameWidth <= 0 || frameHeight <= 0) continue;
      const sourceBase = this.bgaTextures.get(parsed.sourceBmp);
      const sourceLayer = this.bgaLayerTextures.get(parsed.sourceBmp);
      const seed = sourceBase ?? sourceLayer;
      if (!seed) {
        // Source `#BMPYY` failed to load (or was never declared); the BGA cue for this slot will silently no-op rather
        // than fall back to a misleading full-frame render.
        continue;
      }
      // Reuse the loaded image source — Pixi treats a `Texture` sharing a `source` plus a different `frame` rectangle
      // as a cheap view, no extra GPU upload. Keeping `frame` in pixel coordinates that match the source image size
      // guarantees the crop the chart author intended.
      const frame = new Rectangle(parsed.sx, parsed.sy, frameWidth, frameHeight);
      if (sourceBase && !this.bgaTextures.has(normalizedBgaSlot)) {
        this.bgaTextures.set(normalizedBgaSlot, new Texture({ source: sourceBase.source, frame }));
      }
      if (sourceLayer && !this.bgaLayerTextures.has(normalizedBgaSlot)) {
        this.bgaLayerTextures.set(normalizedBgaSlot, new Texture({ source: sourceLayer.source, frame }));
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
    if (event.repeat) return;
    if (event.code === 'Escape') {
      event.preventDefault();
      this.beginExitSequence(() => {
        this.sharedEngineAbortController?.abort();
        this.options.onExit?.();
      });
      return;
    }
    if (event.code === 'F5') {
      event.preventDefault();
      this.beginExitSequence(() => {
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
    const next = Math.round((this.hiSpeed + delta) * 1000) / 1000;
    this.hiSpeed = Math.max(HISPEED_MIN, Math.min(HISPEED_MAX, next));
  }

  /**
   * Applies the LR2 HS-FIX multiplier to {@link hiSpeed} once `prepareSong` has installed the timing resolver. Pegs the
   * user's chosen HS to a chosen BPM so the visual scroll feels uniform across BPM changes:
   *
   * - `OFF` — leave HS as-is.
   * - `MAXBPM` — scale by `mainBPM / maxBPM` (slow sections feel proportionally slower).
   * - `MINBPM` — scale by `mainBPM / minBPM` (fast sections feel proportionally faster).
   * - `AVERAGE` — scale by `mainBPM / avgBPM` where avgBPM is the time-weighted mean.
   * - `CONSTANT` — true per-frame "constant scroll" needs a render- pipeline change that hasn't landed; falls through
   *   to the `AVERAGE` multiplier so the option still produces a sensible shift instead of doing nothing.
   *
   * Skipped when there are no tempo points (defensive — the resolver can be constructed empty during edge-case mounts)
   * or the chart has no BPM info.
   */
  private applyHsFix(resolver: ReturnType<typeof createTimingResolver>, mainBpmCandidate: number | undefined): void {
    const mode = this.options.hsFix ?? 'OFF';
    if (mode === 'OFF') return;
    const mainBpm = typeof mainBpmCandidate === 'number' && mainBpmCandidate > 0 ? mainBpmCandidate : undefined;
    if (mainBpm === undefined) return;
    const tempoPoints = resolver.tempoPoints;
    if (tempoPoints.length === 0) return;
    const bpms = tempoPoints.map((point) => point.bpm).filter((bpm) => Number.isFinite(bpm) && bpm > 0);
    if (bpms.length === 0) return;
    const maxBpm = Math.max(...bpms);
    const minBpm = Math.min(...bpms);
    let multiplier = 1;
    switch (mode) {
      case 'MAXBPM':
        multiplier = mainBpm / maxBpm;
        break;
      case 'MINBPM':
        multiplier = mainBpm / minBpm;
        break;
      case 'AVERAGE':
      case 'CONSTANT': {
        // Time-weighted average — each tempo segment runs from `point.seconds` to the next point's `seconds` (or the
        // chart's last note for the final segment). Using a flat arithmetic mean would over-weight a tiny BPM-change
        // blip relative to a long segment at the surrounding BPM.
        const finalSeconds = Math.max(this.songDurationSeconds, tempoPoints.at(-1)?.seconds ?? 0);
        let weightedSum = 0;
        let totalDuration = 0;
        for (let index = 0; index < tempoPoints.length; index += 1) {
          const point = tempoPoints[index]!;
          const next = tempoPoints[index + 1];
          const start = Math.max(0, point.seconds);
          const end = Math.max(start, next ? next.seconds : finalSeconds);
          const duration = end - start;
          if (duration <= 0 || !Number.isFinite(point.bpm) || point.bpm <= 0) continue;
          weightedSum += point.bpm * duration;
          totalDuration += duration;
        }
        const average = totalDuration > 0 ? weightedSum / totalDuration : mainBpm;
        multiplier = mainBpm / Math.max(1, average);
        break;
      }
    }
    if (!Number.isFinite(multiplier) || multiplier <= 0) return;
    const next = Math.round(this.hiSpeed * multiplier * 1000) / 1000;
    this.hiSpeed = Math.max(HISPEED_MIN, Math.min(HISPEED_MAX, next));
  }

  private resolveKeyOnTimerId(channel: string): number | undefined {
    const laneIndex = resolveSideRelativeLaneIndex(channel, this.chartPlayVariant);
    // 9 KEY (Pop'n) uses lane slots 1..9 — the 7-cap below would otherwise drop slots 8 / 9. Other modes top out at
    // slot 7.
    const maxSlot = this.chartPlayVariant === '9' ? 9 : 7;
    if (laneIndex < 0 || laneIndex > maxSlot) {
      return undefined;
    }
    // LR2 spec: timer 100 = 1P SC, 101..107 = 1P key1..7; timer 110 = 2P SC, 111..117 = 2P key1..7. PMS / 9 KEY is
    // single-side so every lane (whether the chart sources it from `1X` or `2X`) routes through the 1P-side base; the
    // resolver already collapses both layouts onto slots 1..9.
    const isPlayer2 = this.chartPlayVariant !== '9' && channel.startsWith('2');
    const base = isPlayer2 ? LR2_2P_KEYON_TIMER_BASE : LR2_1P_KEYON_TIMER_BASE;
    return base + laneIndex;
  }

  private startKeyOnTimer(channel: string): void {
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

  private togglePause(): void {
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
  protected playClock(): number {
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
  private triggerBomb(channel: string): void {
    const now = this.playClock();
    this.bombStartedAt.set(channel, now);
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
    }
    this.perf.time('updateFps', () => this.updateFps());
    this.perf.time('updateScores', () => {
      this.updateDisplayedScore();
      this.updateThemeState();
    });
    this.perf.time('render', () => this.render(seconds));
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
  private chartEnded = false;

  /**
   * Drives the global "fade everything to black" tween while {@link beginExitSequence} is in flight. The skin's
   * authored `#FADEOUT` overlay (if any) only covers whatever the skin artist drew — gameplay-side layers (notes, lane
   * chrome, BGA, shutters, bombs, overlay text) sit *above* `skinLayer` in `root` and would otherwise stay fully
   * visible until the scene is torn down. Fading `root` itself dims every layer uniformly; `viewportBackground` is a
   * sibling of `root` (under `sceneRoot`), so the page reveals the same `BG` (near-black) the playfield sat against,
   * giving a clean fade-to-black appearance regardless of which lanes are still painting.
   *
   * Called every frame from {@link render}; cheap when the exit sequence isn't running (`root.alpha` is set back to 1
   * only when it diverges from 1, so steady-state has no GPU cost).
   */
  private applyExitFadeAlpha(): void {
    if (!this.exiting) {
      if (this.root.alpha !== 1) this.root.alpha = 1;
      return;
    }
    const fadeOutMs = this.themeTiming.fadeOutMs;
    const fadeStart = this.exitFadeStartedAt;
    if (fadeStart === undefined || fadeOutMs <= 0) {
      // Fade hasn't been seeded (or the theme has no fade-out); leave root at full alpha. Close-only themes keep the
      // scene visible until the host transitions us out.
      if (this.root.alpha !== 1) this.root.alpha = 1;
      return;
    }
    const elapsed = this.playClock() - fadeStart;
    this.root.alpha = Math.max(0, Math.min(1, 1 - elapsed / fadeOutMs));
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
  private beginExitSequence(callback: () => void, options: { fadeAudio?: boolean } = {}): void {
    if (this.exiting || this.disposed) {
      callback();
      return;
    }
    this.exiting = true;
    const { fadeOutMs, closeMs } = this.themeTiming;
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
  protected currentSeconds(): number {
    if (this.audioContext && this.audioContextStartTime > 0) {
      return Math.max(0, this.audioContext.currentTime - this.audioContextStartTime);
    }
    if (this.paused) {
      return Math.max(0, (this.pauseTime - this.startTime - this.pauseTotal) / 1000);
    }
    return Math.max(0, (performance.now() - this.startTime - this.pauseTotal) / 1000);
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
    this.judgeSideState[side] = {
      judge,
      until,
      combo: this.tracker.combo,
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
    this.root.position.set(viewport.x, viewport.y);
    this.root.scale.set(viewport.scale);
    this.applyExitFadeAlpha();
    this.audioFrame = this.audioAnalyzer?.sample(this.playClock());
    this.perf.time('renderSkin', () => this.renderThemeLayer(designWidth, designHeight));
    this.perf.time('renderBga', () => this.renderBga(seconds));
    this.perf.time('renderLanes', () => this.renderLanes(designWidth, designHeight));
    this.perf.time('renderNotes', () => this.renderNotes(seconds, designHeight));
    this.perf.time('renderShutter', () => this.renderShutter());
    this.perf.time('renderBombs', () => this.renderBombs());
    this.perf.time('renderText', () => this.renderText(designWidth, designHeight, seconds));
  }

  /**
   * One-shot bomb cleanup. Runs every frame so each bomb stops once its effect has played out
   * ({@link resolveBombDurationMs} — the be-music skin's effect length, or a theme-authored span). Retired bombs raise
   * `bomb-retired` so a theme can stop its own per-lane bomb timer; without this retirement a theme's "play once and
   * clamp" explosion would keep displaying its last frame forever.
   */
  private cleanupBombTimers(): void {
    if (this.bombStartedAt.size === 0) {
      return;
    }
    const now = this.playClock();
    for (const [channel, startedAt] of this.bombStartedAt) {
      const cleanupAtMs = this.resolveBombDurationMs(channel);
      if (now - startedAt < cleanupAtMs) {
        continue;
      }
      this.bombStartedAt.delete(channel);
      this.onThemeEvent({ kind: 'bomb-retired', channel });
    }
  }

  /**
   * Draws the LR2 HIDDEN / SUDDEN / HID+SUD masks over the playfield. Pulls the union of all lanes' top/bottom from
   * `laneX` so the mask exactly covers the lane area regardless of how the theme laid the lanes out (single-side, DP,
   * etc.).
   *
   * `playOptions.shutter` (0..1) controls the fraction of the playfield each active mask covers. With HID+SUD that
   * fraction applies to BOTH ends, so 0.5 leaves a thin slit in the middle.
   */
  private renderShutter(): void {
    this.shutterLayer.clear();
    // LANE COVER (`button_type 46`) is the master ON/OFF switch for the playfield mask. With it OFF, no shutter renders
    // even if HIDDEN / SUDDEN / HID+SUD is selected — matches LR2's behavior where the user toggles LANE COVER off to
    // hide the cover without losing the height they had dialed in. The HIDDEN / SUDDEN cycle picks WHERE the mask sits
    // (top / bottom / both); this gate decides WHETHER it shows.
    if (this.options.laneCover === false) return;
    if (this.laneX.size === 0) return;
    const shutter = Math.max(0, Math.min(1, this.options.shutter ?? 0.25));
    if (shutter <= 0) return;
    const mode1P = this.options.hiddenSudden1P ?? 'OFF';
    const mode2P = this.options.hiddenSudden2P ?? 'OFF';
    if (mode1P === 'OFF' && mode2P === 'OFF') return;
    // Per-side mask: collect each side's lane bounding box from `laneX`. Channels 11..16, 18, 19 are 1P (keyboard +
    // scratch + start/select); 21..26, 28, 29 are 2P. SP charts only have 1P lanes registered, so the 2P loop will
    // yield an empty bbox and skip rendering — drawing the 1P mask covers the whole playfield in that case, exactly as
    // before.
    this.paintSideShutter(this.collectSideBounds('1P'), mode1P, shutter);
    this.paintSideShutter(this.collectSideBounds('2P'), mode2P, shutter);
  }

  private collectSideBounds(side: '1P' | '2P'):
    | {
        left: number;
        right: number;
        top: number;
        bottom: number;
      }
    | undefined {
    let left = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    let top = Number.POSITIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;
    let any = false;
    for (const [channel, lane] of this.laneX) {
      const onSide = isChannelOnSide(channel, side);
      if (!onSide) continue;
      any = true;
      left = Math.min(left, lane.x);
      right = Math.max(right, lane.x + lane.w);
      top = Math.min(top, lane.top);
      bottom = Math.max(bottom, lane.bottom);
    }
    if (!any) return undefined;
    if (!Number.isFinite(left) || !Number.isFinite(right) || bottom - top <= 0) return undefined;
    return { left, right, top, bottom };
  }

  private paintSideShutter(
    bounds: { left: number; right: number; top: number; bottom: number } | undefined,
    mode: 'OFF' | 'HIDDEN' | 'SUDDEN' | 'HID+SUD',
    shutter: number,
  ): void {
    if (!bounds || mode === 'OFF') return;
    const width = bounds.right - bounds.left;
    const height = bounds.bottom - bounds.top;
    const maskHeight = height * shutter;
    if (mode === 'SUDDEN' || mode === 'HID+SUD') {
      // SUDDEN — opaque rect at the TOP of the playfield. Notes emerge below it.
      this.shutterLayer.rect(bounds.left, bounds.top, width, maskHeight).fill({ color: 0x000000, alpha: 0.92 });
    }
    if (mode === 'HIDDEN' || mode === 'HID+SUD') {
      // HIDDEN — opaque rect at the BOTTOM of the playfield, just above the judge line (lanes' `bottom` is the judge
      // line bottom edge — the mask itself ends there).
      this.shutterLayer
        .rect(bounds.left, bounds.bottom - maskHeight, width, maskHeight)
        .fill({ color: 0x000000, alpha: 0.92 });
    }
  }

  private renderBombs(): void {
    // Pooled per-frame children — see `ChildPool` in `pixi-utils.ts`. The previous `disposeChildren` rebuild ran a
    // destroy + Sprite-allocation cycle for every active explosion; the pool reuses parented sprites across frames.
    this.bombLayerPool.begin();
    this.cleanupBombTimers();
    // When a theme owns the playfield its bombs are part of the theme's own chrome (the LR2 skin's `#DST_IMAGE` set,
    // gated on bomb timer 50–57 / 60–67). Drawing our own copy on top would double-render the explosion, so this path
    // only fires for the skinless experience.
    if (this.themeOwnsPlayfield || this.bombStartedAt.size === 0) {
      this.bombLayerPool.end();
      return;
    }
    this.renderBombEffects();
    this.bombLayerPool.end();
  }

  /**
   * Draws every active bomb into `bombLayerPool` (between the pool's `begin` / `end`). Defaults to the be-music skin's
   * bomb effect; themes that ship their own bomb sheet override it.
   */
  protected renderBombEffects(): void {
    const now = this.playClock();
    const bombs: BeMusicBomb[] = [];
    for (const [channel, startedAt] of this.bombStartedAt) {
      const lane = this.laneX.get(channel);
      if (!lane) continue;
      bombs.push({
        channel,
        kind: resolveBeMusicLaneKind(
          channel,
          resolveLr2LaneIndex(channel, this.chartPlayVariant),
          this.chartPlayVariant,
        ),
        x: lane.x,
        w: lane.w,
        y: lane.bottom,
        elapsedMs: Math.max(0, now - startedAt),
        // Stable per hit: the start time changes on every re-trigger, so a new hit gets a new scatter.
        seed: Math.floor(startedAt * 7.31) % 100_003,
      });
    }
    const binding = this.skinBinding;
    if (binding) {
      binding.addBombs(bombs);
      return;
    }
    renderPhantomBombs({
      pool: this.bombLayerPool,
      bombs,
      nowMs: now,
      combo: this.tracker.combo,
      effects: this.options.beMusicEffects ?? 'full',
      audio: this.audioFrame,
    });
  }

  private skinBindingInstance: BeMusicGameplayBinding | undefined;

  /**
   * The be-music skin's gameplay binding while the scene paints through a skin: lanes, notes, and hit effects are handed
   * to it as data and the skin draws them on its own canvas. `undefined` for themes, whose missing pieces (lanes, notes
   * without a cell, bombs) are drawn here in the built-in Phantom style instead.
   */
  private get skinBinding(): BeMusicGameplayBinding | undefined {
    const skin = this.options.beMusicSkin;
    if (!skin || this.options.skinlessChromeRenderer) return undefined;
    this.skinBindingInstance ??= new BeMusicGameplayBinding(skin);
    return this.skinBindingInstance;
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
  private renderBga(seconds: number): void {
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
    const baseCue = controllingBga.noBase ? undefined : pickActiveBgaCue(this.bgaTimeline.base, seconds);
    const layerCue = controllingBga.noLayer ? undefined : pickActiveBgaCue(this.bgaTimeline.layer, seconds);
    const baseKey = baseCue?.bmpKey;
    const layerKey = layerCue?.bmpKey;
    const poorWindowMs = DEFAULT_POOR_BGA_DISPLAY_SECONDS * 1000;
    const inPoorWindow =
      !controllingBga.noPoor && this.lastPoorAt > 0 && this.playClock() - this.lastPoorAt < poorWindowMs;
    let poorKey = inPoorWindow ? pickActiveBgaKey(this.bgaTimeline.poor, seconds) : undefined;
    // BMP00 fallback: when no explicit POOR cue is active but the chart left `#POORBGA` blank with a `#BMP00` defined,
    // paint BMP00 during the miss window. Capped at the first authored POOR cue's chart-time so a chart that does
    // eventually author POOR isn't permanently stuck on the placeholder.
    if (
      inPoorWindow &&
      poorKey === undefined &&
      this.poorBgaFallbackKey !== undefined &&
      seconds < this.poorBgaFallbackUntilSeconds
    ) {
      poorKey = this.poorBgaFallbackKey;
    }
    this.syncBgaVideo('base', baseCue, seconds);
    this.syncBgaVideo('layer', layerCue, seconds);

    for (const bga of visibleBgas) {
      const { x, y, w, h } = bga;
      if (w <= 0 || h <= 0) continue;
      const drawLayer = (
        key: string | undefined,
        textures: ReadonlyMap<string, Texture>,
        layerName: string,
        cueSeconds: number | undefined,
      ): void => {
        if (!key) return;
        // BMS spec — `#SWBGAxx fr:tot:lp:ARGB N1 N2 ...` declares an animated BGA. When the cue's slot matches a parsed
        // entry, advance through its frame list at the authored interval and swap in the source `#BMPxx` texture for
        // the currently-visible frame. The fast path (no `#SWBGAxx` entry) leaves `key` untouched so the existing
        // static texture lookup wins.
        let resolvedKey = key;
        if (cueSeconds !== undefined) {
          const swBga = this.switchingBgas.get(key);
          if (swBga) {
            const elapsedMs = Math.max(0, (seconds - cueSeconds) * 1000);
            const frameKey = pickSwitchingBgaFrame(swBga, elapsedMs);
            if (frameKey) resolvedKey = frameKey;
          }
        }
        const texture = textures.get(resolvedKey);
        if (!texture) return;
        // Stretch the BGA texture to fill this rect exactly. The previous version routed through a BMS 256×256 spec
        // canvas which left non-256 sources covering only part of the DST and produced visible "letterbox" gaps. LR2
        // stretches straight to the skin rect, matching here.
        const sprite = this.bgaLayerPool.acquireSprite();
        sprite.texture = texture;
        sprite.label = `bga/${layerName}[key=${resolvedKey}]`;
        sprite.position.set(x, y);
        sprite.width = w;
        sprite.height = h;
        bga.applyToSprite(sprite);
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
      if (poorKey) {
        // POOR uses base-mode decoding (no chroma key) since it replaces the entire base+layer composite during its
        // window. POOR has no per-cue origin time we can hand to `drawLayer` for `#SWBGAxx` frame timing; chart authors
        // don't typically pair POOR with switching BGA, and a static frame is the safer fallback.
        drawLayer(poorKey, this.bgaTextures, 'poor', undefined);
      } else {
        // `cue.seconds` anchors switching-BGA frame timing — `pickSwitchingBgaFrame` advances frames relative to when
        // the cue fired, not relative to the chart origin.
        drawLayer(baseKey, this.bgaTextures, 'base', baseCue?.seconds);
        // Layer track is composited on top with black→transparent so the base track shows through where the foreground
        // BMP is empty.
        drawLayer(layerKey, this.bgaLayerTextures, 'layer', layerCue?.seconds);
      }
    }
    this.bgaLayerPool.end();
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
  private resolveChartMs(): number | undefined {
    if (this.startTime === 0) return undefined;
    if (Number.isFinite(this.startTime)) return performance.now() - this.startTime;
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

  private resolveSkinlessGameplayChromeRuntime(): SkinlessGameplayChromeRuntime {
    const total = this.score.total > 0 ? this.score.total : 0;
    const seconds = this.currentSeconds();
    const usesPlayer2 = this.chartPlayVariant !== '9' && this.laneChannels.some((channel) => channel.startsWith('2'));
    const judgeSides: SkinlessGameplayJudgeState[] = [];
    for (const side of ['1P', '2P'] as const) {
      if (side === '2P' && !usesPlayer2) {
        continue;
      }
      const state = this.judgeSideState[side];
      if (state.judge && seconds <= state.until) {
        judgeSides.push({ side, judge: state.judge, combo: state.combo });
      }
    }
    return {
      songTitle: this.song?.title,
      songArtist: this.song?.artist,
      bpm: this.song?.bpm,
      hiSpeed: this.hiSpeed,
      score: this.score.score,
      exScore: this.score.exScore,
      exScoreMax: total * 2,
      combo: this.tracker.combo,
      maxCombo: this.maxCombo,
      perfect: this.score.perfect,
      great: this.score.great,
      good: this.score.good,
      bad: this.score.bad,
      poor: this.score.poor,
      gauge: this.gaugeState.current,
      clearThreshold: this.gaugeState.clearThreshold,
      laneCount: this.laneChannels.length,
      laneChannels: this.laneChannels,
      playVariant: this.chartPlayVariant,
      lastJudge: seconds <= this.lastJudgeUntil ? this.lastJudge : undefined,
      judgeSides,
      rank: total <= 0 ? undefined : resolveIidxRankLabel(this.score.exScore, total),
      autoplay: this.options.autoPlay === true,
      hasBga: this.hasBga,
      nowMs: this.playClock(),
      progressRatio: (() => {
        const totalSeconds = this.resolveSongDurationSeconds();
        return totalSeconds > 0 ? Math.max(0, Math.min(1, seconds / totalSeconds)) : 0;
      })(),
      beatPhase: (() => {
        const beat = this.currentBeat(seconds);
        return beat - Math.floor(beat);
      })(),
      rulesetLabel: this.options.replay?.play.judgeRuleset ?? this.options.judgeRuleset ?? 'lr2',
      gaugeLabel: this.gaugeState.type ?? 'GROOVE',
      gaugeSurvival: this.gaugeState.survival === true,
      fast: this.fastCount,
      slow: this.slowCount,
      totalNotes: total,
      // While assets load the count-in waits: the skin shows NOW LOADING instead.
      chartMs: this.assetsLoading ? undefined : this.resolveChartMs(),
      loading: this.assetsLoading,
      judgeAtMs: this.lastJudgeAt,
      impulseAtMs: this.lastImpulseAt,
      impulseKind: this.lastImpulseKind,
      effects: this.options.beMusicEffects ?? 'full',
      audio: this.audioFrame,
    };
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
        runtime: this.resolveSkinlessGameplayChromeRuntime(),
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
   * rect. Lane geometry only changes with the chart, so it is rebuilt when the lane channels or play variant change.
   */
  private resolveBeMusicLayout(): BeMusicGameplayLayout {
    const cached = this.beMusicLayout;
    if (cached && cached.channels === this.laneChannels && cached.variant === this.chartPlayVariant) {
      return cached.layout;
    }
    const layout = resolveGameplayLayout(
      { laneChannels: this.laneChannels, playVariant: this.chartPlayVariant },
      this.beMusicStage ?? LEGACY_STAGE,
    );
    this.beMusicLayout = { channels: this.laneChannels, variant: this.chartPlayVariant, layout };
    return layout;
  }

  /** Approximate total duration of the loaded chart in seconds. */
  protected resolveSongDurationSeconds(): number {
    if (!this.song) {
      return 0;
    }
    return this.songDurationSeconds;
  }

  private renderLanes(width: number, height: number): void {
    this.laneLayer.clear();
    this.laneX.clear();
    const themeOwnsPlayfield = this.themeOwnsPlayfield;
    const fallbackTop = PLAYFIELD.y;
    const fallbackBottom = PLAYFIELD.judgementY;
    const { lanes: fallbackLanes, left: fallbackLeft } = resolveSkinlessLaneLayout(
      this.laneChannels,
      this.laneChannels.length,
      this.chartPlayVariant,
    );

    const skinlessLanes: BeMusicLaneFrame[] = [];
    this.laneChannels.forEach((channel, index) => {
      // A theme-authored lane rect wins; channels the theme doesn't place use the default-family layout.
      const themeLane = this.resolveThemeLaneRect(channel, width, height);
      const fallbackLane = fallbackLanes[index];
      const x = themeLane ? themeLane.x : (fallbackLane?.x ?? fallbackLeft);
      const w = themeLane ? themeLane.w : Math.max(4, fallbackLane?.w ?? PLAYFIELD.w);
      const top = themeLane ? themeLane.top : fallbackTop;
      const bottom = themeLane ? themeLane.bottom : fallbackBottom;
      this.laneX.set(channel, { x, w, top, bottom });

      if (themeOwnsPlayfield) {
        // With a theme owning the playfield, the lane background, judgement line and key lasers are all rendered by the
        // theme itself. Drawing our own colored rectangles on top of that just paints over the skin -- which is exactly
        // the "scratch lane is too red" / "judgement line is white" problem we want to avoid. Skip them here.
        return;
      }
      skinlessLanes.push({
        channel,
        kind: resolveBeMusicLaneKind(
          channel,
          resolveLr2LaneIndex(channel, this.chartPlayVariant),
          this.chartPlayVariant,
        ),
        x,
        w,
        top,
        bottom,
        beam: this.resolveFallbackLaneLaserAlpha(channel),
      });
    });

    if (!themeOwnsPlayfield && skinlessLanes.length > 0) {
      const beat = this.currentBeat(this.currentSeconds());
      const binding = this.skinBinding;
      if (binding) {
        binding.addLanes(skinlessLanes);
        return;
      }
      renderPhantomLanes({
        graphics: this.laneLayer,
        lanes: skinlessLanes,
        beatPhase: beat - Math.floor(beat),
        nowMs: this.playClock(),
        combo: this.tracker.combo,
        effects: this.options.beMusicEffects ?? 'full',
        audio: this.audioFrame,
      });
    }
  }

  private resolveFallbackLaneLaserAlpha(channel: string): number {
    const timerId = this.resolveKeyOnTimerId(channel);
    if (timerId === undefined) {
      return 0;
    }
    if (this.pressedChannels.has(channel)) {
      return 1;
    }
    if (!this.timerStartedAt.has(timerId)) {
      return 0;
    }
    const fadeStart = this.keyOnFadeOutStart.get(timerId);
    if (fadeStart === undefined) {
      return 1;
    }
    const fadeMs = this.resolveKeyOnFadeMs(timerId);
    const elapsed = Math.max(0, this.playClock() - fadeStart);
    if (elapsed >= fadeMs) {
      this.keyOnFadeOutStart.delete(timerId);
      this.timerStartedAt.delete(timerId);
      return 0;
    }
    return Math.max(0, 1 - elapsed / fadeMs);
  }

  private renderNotes(seconds: number, _height: number): void {
    this.noteLayerPool.begin();
    if (this.isIntroPlaying()) {
      // Intro period — the theme is sliding its frame chrome in. Notes and measure lines stay off-screen until the
      // playhead is live. The `noteLayerPool.end()` below hides every pooled child that the (skipped) draw passes
      // would have re-acquired.
      this.noteLayerPool.end();
      return;
    }
    const currentBeat = this.currentBeat(seconds);
    const pixelsPerBeat = PIXELS_PER_BEAT * this.hiSpeed;
    this.renderMeasureLines(currentBeat, pixelsPerBeat);
    // Note: the lane-bottom beat-pulse glow is drawn by the LR2 skin itself — the "rhythm timer" `#DST_IMAGE` at SRC y=2007
    // in the default 7-keys skin, anchored to timer 140. `elapsedSinceTimer(140)` remaps the chart's current fractional
    // beat to the 0..1000 ms keyframe window the LR2 skin's keyframe chain authored, so the glow flashes on every beat
    // regardless of BPM. The custom `renderBeatAura` we used to call here was duplicate visual noise and has been
    // removed. Distance integrator. With `#SCROLL` / `#SPEED` events present we let the mapper compute the integrated
    // distance; otherwise we fall back to a flat `(beat - currentBeat)` to skip the segment-walking overhead.
    const beatDistance = this.scrollMapper
      ? (toBeat: number): number => this.scrollMapper!.distanceBetween(currentBeat, toBeat)
      : (toBeat: number): number => toBeat - currentBeat;
    let laneHeight = 1;
    for (const lane of this.laneX.values()) {
      laneHeight = Math.max(laneHeight, lane.bottom - lane.top);
    }
    const maxVisibleBeat = currentBeat + (laneHeight + 48) / Math.max(1, pixelsPerBeat);
    // Debug visualization — paint invisible / keysound notes FIRST so playable notes + mines paint over them. Skipped
    // entirely (and the array stays empty) when the option is off.
    if (this.options.showInvisibleNotes && this.invisibleNotes.length > 0) {
      // Themes can supply a sprite for the overlay (the LR2 family uses the Pop'n green wide note of its 9-keys play
      // skin). When unavailable we fall through to a flat green rectangle so the overlay still reads.
      const firstInvisibleIndex = this.scrollMapper
        ? 0
        : findFirstIndexAtOrAfter(this.invisibleNotes, currentBeat, (note) => note.beat);
      for (let invIndex = firstInvisibleIndex; invIndex < this.invisibleNotes.length; invIndex += 1) {
        const invisible = this.invisibleNotes[invIndex]!;
        if (!this.scrollMapper && invisible.beat > maxVisibleBeat) {
          break;
        }
        const lane = this.laneX.get(invisible.channel);
        if (!lane) continue;
        const y = lane.bottom - beatDistance(invisible.beat) * pixelsPerBeat;
        if (y < lane.top - 48 || y > lane.bottom) continue;
        const cell = this.resolveThemeNoteCell(
          'invisible',
          resolveLr2LaneIndex(invisible.channel, this.chartPlayVariant),
        );
        if (cell?.texture) {
          const sprite = this.noteLayerPool.acquireSprite();
          sprite.texture = cell.texture;
          sprite.label = `invisible-note[ch=${invisible.channel}]`;
          sprite.x = lane.x + (lane.w - cell.width) / 2;
          sprite.y = y - cell.height;
          sprite.width = cell.width;
          sprite.height = cell.height;
          continue;
        }
        const graphic = this.noteLayerPool.acquireGraphics();
        graphic.label = `invisible-note-fallback[ch=${invisible.channel}]`;
        graphic.rect(lane.x + 2, y - 4, Math.max(4, lane.w - 4), 4).fill({ color: 0x33dd66, alpha: 0.7 });
      }
    }
    const firstNoteIndex = this.scrollMapper
      ? 0
      : findFirstIndexAtOrAfter(this.notes, currentBeat - this.maxLongNoteBeatSpan, (note) => note.beat);
    for (let noteIndex = firstNoteIndex; noteIndex < this.notes.length; noteIndex += 1) {
      const note = this.notes[noteIndex]!;
      if (!this.scrollMapper && note.beat > maxVisibleBeat) {
        break;
      }
      // Judged notes (hit / auto-missed) intentionally stay on screen and continue scrolling — only their *position*
      // governs visibility.
      const lane = this.laneX.get(note.channel);
      if (!lane) {
        continue;
      }
      const y = lane.bottom - beatDistance(note.beat) * pixelsPerBeat;
      // Use the LR2-spec lane index for theme note lookups (LR2 `#SRC_NOTE,...,index`): 2P side notes need to read
      // `skin.notes[kind][10..17]`, not the position-based `[8..15]` that `resolveLaneIndex` would give.
      const laneIndex = resolveLr2LaneIndex(note.channel, this.chartPlayVariant);
      // Long-note render: draw LN_BODY between start and end beats, capped with LN_START / LN_END sprites. Falls
      // through to single-note render if the chart has no long-note end-beat for this entry.
      if (note.endBeat !== undefined) {
        const yEnd = lane.bottom - beatDistance(note.endBeat) * pixelsPerBeat;
        // yEnd is *above* y (smaller value, since beats grow upward visually). Hide the LN once its tail (yEnd) has
        // visually crossed the judgement-line bottom — at that point every part of the long note is below the line and
        // shouldn't paint over the keys area. Also clip when the head is still off-screen above the playfield.
        if (yEnd > lane.bottom || y < lane.top - 48) {
          continue;
        }
        this.renderLongNote(laneIndex, note.channel, lane, y, yEnd);
        continue;
      }
      // Single notes hide the moment their bottom edge passes the judgement-line bottom (= `lane.bottom`). Until then
      // the note's visibility depends on `judgedNoteDisplay`: - `'HIDE'` (default) — judged notes disappear the instant
      // they were judged (LR2 / beatoraja default behavior). - `'KEEP_SCROLLING'` — judged notes keep scrolling until
      // their position passes the line (≈ beatoraja's LANEEFFECT ON).
      if (y < lane.top - 48 || y > lane.bottom) {
        continue;
      }
      // Read the engine's `judged` flag directly off the shared `TimedPlayableNote` instance — the engine
      // mutates it the moment it resolves the note's verdict, and because the renderer and the engine
      // hold the same array (handed in via `engineOptions.preparedChart`), there is no parallel `hit` flag
      // to keep in sync. HIDE-on-judge mode uses this to clip the note immediately at the judgment moment;
      // KEEP_SCROLLING leaves it on screen until its position passes the line.
      if (note.judged && this.options.judgedNoteDisplay !== 'KEEP_SCROLLING') {
        continue;
      }
      this.renderSingleNote(laneIndex, note.channel, lane, y);
    }
    // Landmine notes — same scroll math, separate sprite. Drawn after regular notes so a mine sitting at the same beat
    // as a playable note paints on top (LR2 default skin's mine sprites carry their own outline so the visual hierarchy
    // reads correctly).
    const firstMineIndex = this.scrollMapper
      ? 0
      : findFirstIndexAtOrAfter(this.mineNotes, currentBeat, (note) => note.beat);
    for (let mineIndex = firstMineIndex; mineIndex < this.mineNotes.length; mineIndex += 1) {
      const mine = this.mineNotes[mineIndex]!;
      if (!this.scrollMapper && mine.beat > maxVisibleBeat) {
        break;
      }
      if (mine.judged) continue;
      const lane = this.laneX.get(mine.channel);
      if (!lane) continue;
      const y = lane.bottom - beatDistance(mine.beat) * pixelsPerBeat;
      if (y < lane.top - 48 || y > lane.bottom) continue;
      const laneIndex = resolveLr2LaneIndex(mine.channel, this.chartPlayVariant);
      this.renderMineNote(laneIndex, mine.channel, lane, y);
    }
    this.noteLayerPool.end();
  }

  /**
   * Renders one landmine sprite. Tries the theme's mine cell first (e.g. the LR2 skin's `#SRC_NOTE` `mine` slot,
   * animated per its `divX/divY/cycle`); falls back to a red rectangle with a yellow caution stripe so the no-skin path
   * still flags the hazard distinctly from playable notes.
   */
  private renderMineNote(laneIndex: number, channel: string, lane: GameplayLaneRect, y: number): void {
    const cell = this.resolveThemeNoteCell('mine', laneIndex);
    if (cell?.texture) {
      const sprite = this.noteLayerPool.acquireSprite();
      sprite.texture = cell.texture;
      sprite.label = `mine[lane=${laneIndex},ch=${channel}]`;
      sprite.x = lane.x + (lane.w - cell.width) / 2;
      sprite.y = y - cell.height;
      sprite.width = cell.width;
      sprite.height = cell.height;
      return;
    }
    const graphic = this.noteLayerPool.acquireGraphics();
    graphic.label = `mine-fallback[lane=${laneIndex},ch=${channel}]`;
    const mineX = lane.x + 2;
    const mineW = Math.max(4, lane.w - 4);
    graphic
      .roundRect(mineX, y - 12, mineW, 12, 3)
      .fill(0x6e1414)
      .stroke({ color: 0xffd166, width: 1, alignment: 1 });
    // Diagonal caution stripes.
    const stripeStep = 8;
    for (let sx = mineX - 12; sx < mineX + mineW; sx += stripeStep) {
      graphic
        .poly([sx, y - 1, sx + 4, y - 1, sx + 4 + 8, y - 11, sx + 8, y - 11])
        .fill({ color: 0xffd166, alpha: 0.55 });
    }
    graphic.rect(mineX, y - 12, mineW, 1).fill({ color: 0xff8a8a, alpha: 0.8 });
  }

  /**
   * Cached cumulative beats at each measure boundary, keyed by song identity. Computed on first access so we don't walk
   * the measure list every frame. Each entry is the beat count at the *start* of the measure with that index (measure 0
   * starts at beat 0).
   */
  private measureBeatCache: { songId: string | undefined; beats: number[] } = { songId: undefined, beats: [] };

  private resolveMeasureBeats(): number[] {
    const song = this.song;
    if (!song) {
      return [];
    }
    if (this.measureBeatCache.songId === song.id) {
      return this.measureBeatCache.beats;
    }
    const beats: number[] = [];
    let cumulative = 0;
    // BMS measure length is the relative size of the measure, where 1.0 is a full 4/4 measure (= 4 beats). Walk the
    // chart's measure list and record the beat at the start of each measure. Use the resolved chart so #IF-gated #xx02
    // (measure-length) declarations match the chosen #RANDOM branch.
    const chart = this.resolvedChart ?? song.chart;
    // bmson 1.0.0 spec — `lines: []` (explicit empty array) is the author opting out of barlines entirely (the "100 %
    // minimoo-G effect"). Honor the suppress flag the parser sets and short-circuit before we'd otherwise derive
    // 4/4-default barlines from the event stream.
    if (chart.bmson.barlinesSuppressed === true) {
      this.measureBeatCache = { songId: song.id, beats };
      return beats;
    }
    const measures = chart.measures;
    // The chart's `measures` array only carries measures with an EXPLICIT length declaration (`#xx02`). A typical
    // 4/4-only chart has no entries at all, so falling out at "length === 0" skipped every measure line for those
    // songs. Derive the chart's last measure from event data instead — measure lines need to render at every measure
    // boundary regardless of whether the author bothered to declare the time signature.
    let maxMeasureIndex = -1;
    for (const measure of measures) {
      if (measure.index > maxMeasureIndex) maxMeasureIndex = measure.index;
    }
    for (const event of chart.events) {
      if (event.measure > maxMeasureIndex) maxMeasureIndex = event.measure;
    }
    if (maxMeasureIndex < 0) {
      this.measureBeatCache = { songId: song.id, beats };
      return beats;
    }
    const lengthByIndex = new Map(measures.map((m) => [m.index, m.length]));
    for (let i = 0; i <= maxMeasureIndex + 1; i += 1) {
      beats.push(cumulative);
      // Default length 1 = full 4/4 measure. Only declared measures override this.
      const length = lengthByIndex.get(i) ?? 1;
      cumulative += length * 4;
    }
    this.measureBeatCache = { songId: song.id, beats };
    return beats;
  }

  /**
   * Draws horizontal measure lines on the playfield at every `#MEASURE` boundary. A theme may draw its own
   * ({@link renderThemeMeasureLines}; the LR2 family uses `#SRC_LINE` / `#DST_LINE`); otherwise we fall back to a thin
   * bar spanning the lane area.
   */
  private renderMeasureLines(currentBeat: number, pixelsPerBeat: number): void {
    const beats = this.resolveMeasureBeats();
    if (beats.length === 0 || this.laneChannels.length === 0) {
      return;
    }
    const firstChannel = this.laneChannels[0]!;
    const lastChannel = this.laneChannels[this.laneChannels.length - 1]!;
    const left = this.laneX.get(firstChannel);
    const right = this.laneX.get(lastChannel);
    if (!left || !right) {
      return;
    }
    const top = left.top;
    const bottom = left.bottom;
    const firstBeatIndex = this.scrollMapper
      ? 0
      : findFirstIndexNumberAtOrAfter(beats, currentBeat - 1 / Math.max(1, pixelsPerBeat));
    const maxBeat = this.scrollMapper
      ? Number.POSITIVE_INFINITY
      : currentBeat + (bottom - top + 1) / Math.max(1, pixelsPerBeat);
    const beatDistance = this.scrollMapper
      ? (toBeat: number): number => this.scrollMapper!.distanceBetween(currentBeat, toBeat)
      : (toBeat: number): number => toBeat - currentBeat;
    if (this.renderThemeMeasureLines({ beats, firstBeatIndex, maxBeat, pixelsPerBeat, beatDistance, top, bottom })) {
      return;
    }
    // Fallback: simple white strip when the theme draws none. One pooled `Graphics` carries every line — the
    // accumulated rect-fill commands form one batched draw, no per-line allocation.
    const x0 = left.x;
    const x1 = right.x + right.w;
    const graphic = this.noteLayerPool.acquireGraphics();
    for (let beatIndex = firstBeatIndex; beatIndex < beats.length; beatIndex += 1) {
      const beat = beats[beatIndex]!;
      if (!this.scrollMapper && beat > maxBeat) {
        break;
      }
      const y = bottom - beatDistance(beat) * pixelsPerBeat;
      if (y < top - 1 || y > bottom + 1) {
        continue;
      }
      graphic.rect(x0, Math.round(y), x1 - x0, 1).fill({ color: 0x9a8fd0, alpha: 0.28 });
    }
  }

  private renderSingleNote(laneIndex: number, channel: string, lane: GameplayLaneRect, y: number): void {
    // `y` is where the chart timing intersects the judgement line for this note. We anchor the sprite by its **bottom
    // edge** so the just-timing moment lines up with the bottom edge of the visual note (LR2 / BMS convention) instead
    // of the center.
    const cell = this.resolveThemeNoteCell('note', laneIndex);
    if (cell?.texture) {
      const sprite = this.noteLayerPool.acquireSprite();
      sprite.texture = cell.texture;
      sprite.label = `note[lane=${laneIndex},ch=${channel}]`;
      sprite.x = lane.x + (lane.w - cell.width) / 2;
      sprite.y = y - cell.height;
      sprite.width = cell.width;
      sprite.height = cell.height;
      return;
    }
    const kind = resolveBeMusicLaneKind(channel, laneIndex, this.chartPlayVariant);
    const binding = this.skinBinding;
    if (binding) {
      binding.addNote({ kind, x: lane.x, w: lane.w, y });
      return;
    }
    const graphic = this.noteLayerPool.acquireGraphics();
    graphic.label = `note-fallback[lane=${laneIndex},ch=${channel}]`;
    renderPhantomNote({ graphics: graphic, kind, x: lane.x, w: lane.w, y, nowMs: this.playClock() });
  }

  /**
   * Renders a long note as a vertical band: LN_BODY tiled (or stretched) between LN_START (lower) and LN_END (upper).
   * The body / caps come from the theme per lane index when available ({@link resolveThemeNoteCell}); otherwise the
   * body falls back to the be-music skin's long-note drawing.
   */
  private renderLongNote(
    laneIndex: number,
    channel: string,
    lane: GameplayLaneRect,
    yStart: number,
    yEnd: number,
  ): void {
    // `yStart` / `yEnd` are the chart-time intersections with the judgement line. With the bottom-edge anchor
    // convention (matching LR2 / BMS): - LN_START's *bottom edge* sits at `yStart` (just-timing of the head) - LN_END's
    // *bottom edge* sits at `yEnd` (just-timing of the tail) The body fills the band between them; we clamp the bottom
    // to the judgement-line bottom (= `lane.bottom`) so the body never paints over the keys area below the line — even
    // mid-LN where the head has already passed but the tail is still above.
    const top = Math.max(lane.top - 48, Math.min(yStart, yEnd));
    const bottom = Math.min(lane.bottom, Math.max(yStart, yEnd));
    const bodyCell = this.resolveThemeNoteCell('lnbody', laneIndex);
    if (bodyCell) {
      if (bodyCell.texture) {
        const sprite = this.noteLayerPool.acquireSprite();
        sprite.texture = bodyCell.texture;
        sprite.label = `ln-body[lane=${laneIndex},ch=${channel}]`;
        sprite.x = lane.x + (lane.w - bodyCell.width) / 2;
        // Shift the body up by one cell-height so the body's bottom edge aligns with the LN_START's bottom edge (=
        // judgement line at the head's just-timing). Without this, the body sticks out ~half a note below the line at
        // perfect timing.
        sprite.y = top - bodyCell.height;
        sprite.width = bodyCell.width;
        sprite.height = Math.max(1, bottom - top);
      }
    } else {
      const kind = resolveBeMusicLaneKind(channel, laneIndex, this.chartPlayVariant);
      const binding = this.skinBinding;
      if (binding) {
        binding.addLongNote({ kind, x: lane.x, w: lane.w, top, bottom });
      } else {
        const graphic = this.noteLayerPool.acquireGraphics();
        graphic.label = `ln-body-fallback[lane=${laneIndex},ch=${channel}]`;
        renderPhantomLongNote({ graphics: graphic, kind, x: lane.x, w: lane.w, top, bottom, nowMs: this.playClock() });
      }
    }
    // LN_END at the top (yEnd), LN_START at the bottom (yStart).
    const endCell = this.resolveThemeNoteCell('lnend', laneIndex);
    if (endCell?.texture) {
      const sprite = this.noteLayerPool.acquireSprite();
      sprite.texture = endCell.texture;
      sprite.label = `ln-end[lane=${laneIndex},ch=${channel}]`;
      sprite.x = lane.x + (lane.w - endCell.width) / 2;
      sprite.y = yEnd - endCell.height;
      sprite.width = endCell.width;
      sprite.height = endCell.height;
    }
    // Hide the LN head once it has visually passed the judgement-line bottom. The body+end keep showing until the tail
    // crosses (handled by the caller's `yEnd > lane.bottom` early-out).
    if (yStart <= lane.bottom) {
      const startCell = this.resolveThemeNoteCell('lnstart', laneIndex);
      if (startCell?.texture) {
        const sprite = this.noteLayerPool.acquireSprite();
        sprite.texture = startCell.texture;
        sprite.label = `ln-start[lane=${laneIndex},ch=${channel}]`;
        sprite.x = lane.x + (lane.w - startCell.width) / 2;
        sprite.y = yStart - startCell.height;
        sprite.width = startCell.width;
        sprite.height = startCell.height;
      }
    }
  }

  private renderText(width: number, height: number, seconds: number): void {
    this.textLayerPool.begin();
    this.renderThemeText(seconds);
    this.textLayerPool.end();
    this.overlay.visible = this.paused;
    this.overlay.text = 'Paused';
    this.overlay.anchor.set(0.5);
    this.overlay.position.set(width / 2, height / 2);
  }

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
   * Builds the `BeMusicJson` snapshot the engine sees in shared-engine mode. Since the renderer now hands the
   * engine its own `PreparedPlaybackChartData` instance (which already encodes shuffle / DP-flip via the
   * post-`applyRandomMode` channel mutations on each `TimedPlayableNote`), the engine never re-runs
   * `extractTimedNotes`, and the chart events handed in here are only consumed by engine-internal helpers
   * (control-flow resolve fast path, timing resolver, BGM / BGA / dynamic-volume realtime audio scheduling).
   * Those helpers all operate on non-playable channels — none of them care about the shuffled lane channels —
   * so the renderer no longer needs to remap playable-channel events to match the view's shuffle.
   *
   * The one transformation we still need is to clear `bms.controlFlow` before handing the chart to the engine.
   * `CoreGameplayView.prepareSong` already ran `resolveBmsControlFlow` once and pushed every active
   * `#xxx` header / object entry into `json.events`, but the resolver does NOT clear `controlFlow` afterwards —
   * the array stays populated on the resolved chart. Without zeroing it out here, the engine's own
   * `resolveBmsControlFlowForPlayback` would walk the same array a second time and
   * `applyActiveControlFlowEntry` would duplicate every `kind: 'object'` entry into `json.events`. The engine
   * doesn't extract notes from those duplicated events any more, but the realtime-audio collectors (BGM / BGA
   * cues) would still pick them up and trigger duplicate sample plays. The empty `controlFlow` short-circuits
   * `resolveControlFlow` to a clone-and-return on the engine side, which is exactly what we want.
   */
  private buildSharedEngineChart(): BeMusicJson {
    const chart = this.resolvedChart ?? this.song!.chart;
    if (chart.bms.controlFlow.length === 0) {
      return chart;
    }
    return { ...chart, bms: { ...chart.bms, controlFlow: [] } };
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
    this.sharedEnginePromise = runEngineDriver({
      chart,
      audio: {
        audioContext: this.audioContext,
        audioBus: this.audioBus,
        decodedSamples: this.decodedSamples,
        wavCmdVolumeMultipliers: this.wavCmdVolumeMultipliers,
        bmsonSlicePlayback: this.bmsonSlicePlayback,
      },
      mode: this.options.autoPlay ? 'auto' : 'manual',
      ui: callbacks,
      onInputSignalsReady: (signals) => {
        this.sharedEngineInputSignals = signals.inputSignals;
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
        // ESC and F5 are handled by the view's own listener (set up in `mount`) so the LR2 `#FADEOUT` animation
        // runs to completion BEFORE the engine's `PlayerInterruptedError` flow disposes the audio session. If
        // we let the runtime push `interrupt(escape)` directly, the engine's `dispose()` would `node.stop()`
        // every in-flight BufferSource immediately, killing the chart audio mid-fade. Same idea for Space:
        // routing the toggle through the view's `togglePause` keeps the view's `paused` flag, the audio bus's
        // suspend, the BGA video pause, and the engine's playback clock all on the same single entry-point.
        if (event.code === 'Escape' || event.code === 'F5' || event.code === 'Space') return true;
        if (event.code === 'ArrowUp' || event.code === 'ArrowDown') return true;
        return false;
      },
      engineOptions: {
        // The view's own intro timing already gated the chart to PLAYSTART; tell the engine to start its chart
        // immediately so its t=0 lines up with our `audioContextStartTime` anchor instead of imposing the
        // engine's default 1.5 s lead-in on top.
        leadInMs: 0,
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
        signal: (this.sharedEngineAbortController = new AbortController()).signal,
        ...(this.options.replay !== undefined
          ? {
              // Replay playback — feed the recorded input stream; the engine ignores live lane input, and the run
              // records no new play-log (replaying a replay would only duplicate the file). Auto scratch, the
              // judge ruleset, and the debug judge-window override are restored from the log so the judging setup
              // matches the recording.
              replayInputs: this.options.replay.inputs,
              autoScratch: this.options.replay.play.autoScratch,
              judgeRuleset: this.options.replay.play.judgeRuleset ?? 'lr2',
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
                ...(this.options.random1P !== undefined || this.options.random2P !== undefined
                  ? {
                      randomLane: {
                        ...(this.options.random1P !== undefined ? { p1: this.options.random1P } : {}),
                        ...(this.options.random2P !== undefined ? { p2: this.options.random2P } : {}),
                      },
                    }
                  : {}),
                ...(this.options.dpFlip !== undefined ? { dpFlip: this.options.dpFlip } : {}),
                ...(this.song?.chartPath !== undefined ? { native: { chartPath: this.song.chartPath } } : {}),
              },
              onPlaylogRecorded: (playlog) => {
                this.playlog = playlog;
              },
            }),
      },
    })
      .then((summary) => {
        log.info('shared engine driver finished');
        this.drainSharedEngineSignals();
        this.applyEngineSummary(summary);
        this.applyFinalComboSummary(summary);
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
      this.audioContextStartTime = this.audioContext.currentTime - frame.currentSeconds;
      this.sharedEngineClockAnchored = true;
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
      }
    }
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
    }
    this.onThemeEvent({ kind: 'lane-command', command });
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
    const judgeKind = state.judge as JudgeKind;
    this.publishJudge(judgeKind, this.currentSeconds(), state.channel);
    if ((judgeKind === 'PERFECT' || judgeKind === 'GREAT') && state.channel) {
      this.triggerBomb(state.channel);
    }
  }

  /**
   * Fires when the engine driver's `manualPlay` / `autoPlay` promise resolves cleanly (= chart played to its end
   * without an interrupt). The host's `onChartFinished` callback receives a `PixiGameplayResultData` snapshot and
   * the LR2 `#FADEOUT` → `#CLOSE` exit timeline runs before the result-screen transition. The engine's resolution
   * is the authoritative end-of-chart signal — the view's `currentSeconds` clock lags slightly behind the engine's
   * own bookkeeping, so we don't gate on it.
   */
  private handleSharedEngineChartFinished(finalSummary: Readonly<PlayerSummary> | undefined): void {
    if (this.disposed || this.chartEnded) return;
    this.chartEnded = true;
    const delayMs = resolvePostChartResultDelayMs(this.notes, this.timingResolver, this.currentSeconds());
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
      const result = this.getResultData();
      this.beginExitSequence(
        () => {
          if (this.options.onChartFinished && result) {
            this.options.onChartFinished(result);
            return;
          }
          this.options.onExit?.();
        },
        { fadeAudio: false },
      );
    }, delayMs);
  }
}

function disposeGameplayAudioGraphAfterDelay(
  graph: {
    session: WebAudioSession | undefined;
    bus: AudioBusHandle | undefined;
    context: AudioContext | undefined;
  },
  delayMs: number,
): void {
  const cleanup = (): void => {
    void graph.session?.dispose();
    graph.bus?.dispose();
    void graph.context?.close();
  };
  if (delayMs <= 0) {
    cleanup();
    return;
  }
  window.setTimeout(cleanup, delayMs);
}

/**
 * Returns the lowercased filename extension (including the leading dot, e.g. `.pms` / `.bme` / `.bms`) of
 * `chartPath`, or `undefined` if the path doesn't include a recognizable suffix. The engine's
 * `resolveLaneMode` consumes this via `laneModeExtension` so PMS / BME / BMS charts route to the right binding
 * family even when the chart's content alone is ambiguous (e.g. PMS charts that don't use channel `17`, or
 * BME charts on `#PLAYER 1` that omit the 6 / 7 keys). Returning `undefined` falls back to the engine's
 * content-based heuristics, matching the pre-fix behavior on chart paths the host doesn't surface.
 */
function extractChartExtension(chartPath: string | undefined): string | undefined {
  if (typeof chartPath !== 'string' || chartPath.length === 0) {
    return undefined;
  }
  const lastDot = chartPath.lastIndexOf('.');
  if (lastDot < 0) {
    return undefined;
  }
  // Anchor on the last path segment so `.` characters that appear in directory names (e.g. `Bok.fps/01.bms`)
  // don't get mistaken for the chart's own extension.
  const lastSlash = Math.max(chartPath.lastIndexOf('/'), chartPath.lastIndexOf('\\'));
  if (lastDot < lastSlash) {
    return undefined;
  }
  const ext = chartPath.slice(lastDot).toLowerCase();
  return ext.length > 1 ? ext : undefined;
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

/**
 * Swaps a BMS channel's side digit (1↔2) so a 1P-side channel becomes its 2P-side counterpart and vice versa. Used to
 * apply DP FLIP at chart-prepare time. Non-side channels (BGM, BGA, any single-character channel) pass through
 * unchanged.
 */
function flipDpChannel(channel: string): string {
  if (channel.length !== 2) return channel;
  const side = channel[0];
  const lane = channel[1]!;
  if (side === '1') return '2' + lane;
  if (side === '2') return '1' + lane;
  return channel;
}

/**
 * Returns whether a BMS channel string belongs to the given play-side. Used by per-side gameplay overlays (LANE COVER /
 * HIDDEN / SUDDEN masks) so each side can render an independent shutter without leaking onto the other side's lanes on
 * a DP chart.
 *
 * Channel layout (LR2 convention): - 1P keyboard: `11..15` + `18` + `19`; scratch: `16` - 2P keyboard: `21..25` + `28`
 * + `29`; scratch: `26`
 *
 * Anything else (BGM, BGA, BPM, etc.) returns `false` for BOTH sides — those don't appear in `laneX` anyway.
 */
function isChannelOnSide(channel: string, side: '1P' | '2P'): boolean {
  if (channel.length !== 2) return false;
  const head = channel[0];
  if (side === '1P') return head === '1';
  return head === '2';
}

/**
 * 1P / 2P keyboard lane channels in lane-1..lane-7 order. Scratch (channel 16 / 26) is excluded — `applyRandomMode`
 * never touches it, matching LR2 where RANDOM/MIRROR shuffle the keyboard lanes only.
 */
const ONE_P_KEYBOARD_LANES: readonly string[] = ['11', '12', '13', '14', '15', '18', '19'];
const TWO_P_KEYBOARD_LANES: readonly string[] = ['21', '22', '23', '24', '25', '28', '29'];

/**
 * Shuffles `notes` in place per the chosen arrangement mode. Only the keyboard lanes for `side` are touched — scratches
 * and the other side pass through untouched. The `usedLanes` filter trims the permutation domain to the lanes actually
 * present in the chart so 5K charts (lanes 1..5 only) MIRROR / RANDOM cleanly inside that subset.
 *
 * - `MIRROR` — deterministic reversal of `usedLanes`
 * - `RANDOM` — single chart-wide permutation (Fisher-Yates with the supplied RNG)
 * - `S-RANDOM` — per-chord permutation; chord notes share the beat key, and we re-permute within that group so notes on
 *   the same beat never collide on one lane
 * - `SCATTER` — currently aliased to `RANDOM`; reserved for a future per-measure permutation pass
 */
function applyRandomMode(
  notes: Array<{ channel: string }>,
  side: '1' | '2',
  mode: 'OFF' | 'MIRROR' | 'RANDOM' | 'S-RANDOM' | 'SCATTER',
  rng: () => number,
  // Extra channel-bearing arrays (e.g. mine notes) that should follow the same lane shuffle as the playable notes. The
  // `usedLanes` set is computed from `notes` only — secondary entries on a lane that has no playable notes get remapped
  // through the same chart-wide map / chord permutation, so mines stay anchored to the visual lane they were authored
  // on relative to the surrounding chord.
  ...secondary: Array<Array<{ channel: string }>>
): void {
  if (mode === 'OFF') return;
  const allLanes = side === '1' ? ONE_P_KEYBOARD_LANES : TWO_P_KEYBOARD_LANES;
  const usedLanes = allLanes.filter((lane) => notes.some((note) => note.channel === lane));
  if (usedLanes.length < 2) return;

  const remapAll = (map: Map<string, string>): void => {
    for (const note of notes) {
      const target = map.get(note.channel);
      if (target) note.channel = target;
    }
    for (const arr of secondary) {
      for (const entry of arr) {
        const target = map.get(entry.channel);
        if (target) entry.channel = target;
      }
    }
  };

  if (mode === 'MIRROR') {
    const map = new Map<string, string>();
    for (let index = 0; index < usedLanes.length; index += 1) {
      map.set(usedLanes[index]!, usedLanes[usedLanes.length - 1 - index]!);
    }
    remapAll(map);
    return;
  }

  if (mode === 'RANDOM' || mode === 'SCATTER') {
    const perm = shuffleArray([...usedLanes], rng);
    const map = new Map<string, string>();
    for (let index = 0; index < usedLanes.length; index += 1) {
      map.set(usedLanes[index]!, perm[index]!);
    }
    remapAll(map);
    return;
  }

  if (mode === 'S-RANDOM') {
    // Group keyboard-lane notes by beat — every note in a chord shares the same `beat` key, so a fresh permutation per
    // group gives each note a distinct lane within that chord. The secondary arrays (mines) get the chord-local map too
    // so an adjacent mine in the same beat ends up beside the re-arranged chord, not floating to a stale lane.
    const grouped = new Map<number, Array<{ channel: string }>>();
    const beatOf = (note: { channel: string }): number | undefined => {
      const beat = (note as { beat?: number }).beat;
      return typeof beat === 'number' ? beat : undefined;
    };
    const groupBy = (arr: Array<{ channel: string }>): void => {
      for (const note of arr) {
        if (!usedLanes.includes(note.channel)) continue;
        const beat = beatOf(note);
        if (beat === undefined) continue;
        const group = grouped.get(beat);
        if (group) {
          group.push(note);
        } else {
          grouped.set(beat, [note]);
        }
      }
    };
    groupBy(notes);
    for (const arr of secondary) groupBy(arr);
    for (const chord of grouped.values()) {
      const perm = shuffleArray([...usedLanes], rng);
      const map = new Map<string, string>();
      for (let index = 0; index < usedLanes.length; index += 1) {
        map.set(usedLanes[index]!, perm[index]!);
      }
      for (const note of chord) {
        const target = map.get(note.channel);
        if (target) note.channel = target;
      }
    }
  }
}

/**
 * In-place Fisher-Yates shuffle. Returns the same array for call-chaining — callers usually just discard the return
 * value since the array is mutated.
 */
function shuffleArray<T>(array: T[], rng: () => number): T[] {
  for (let index = array.length - 1; index > 0; index -= 1) {
    const target = Math.floor(rng() * (index + 1));
    const swap = array[target]!;
    array[target] = array[index]!;
    array[index] = swap;
  }
  return array;
}

// `clampSampleOffset` / `clampSampleDuration` / `startSampleNode` lived here while the gameplay view managed its
// own audio playback. With Phase 4b-i / 4b-ii routing every cue through {@link WebAudioSession}, the canonical
// implementations now live in `web-audio-session.ts` (re-exported there for tests) — this module no longer needs
// them.
