import { Application, Container, Graphics, Sprite, Text, TextStyle, Texture } from 'pixi.js';
import {
  collectSampleTriggers,
  createBmsonSamplePlaybackMap,
  createTimingResolver,
  type TimedSampleTrigger,
} from '@be-music/audio-renderer/triggers';
import {
  createScoreTracker,
  applyJudgeToSummary,
  computeScoreRate,
  resolveIidxRankLabel,
  type JudgeKind,
  type ScoreSummary,
} from '@be-music/player/core/scoring';
import { resolveJudgeWindowsMs } from '@be-music/player/core/judge-window';
import {
  applyGrooveGaugeJudge,
  createGrooveGaugeState,
  type GrooveGaugeJudgeKind,
  type GrooveGaugeState,
} from '@be-music/player/core/groove-gauge';
import {
  createBeatAtSecondsResolverFromTimingResolver,
  createScrollTimeline,
  createSpeedTimeline,
} from '@be-music/player/core/timeline';
import { createScrollDistanceMapper, type ScrollDistanceMapperLike } from '@be-music/player/core/scroll-distance';
import { extractTimedNotes, type TimedLandmineNote, type TimedPlayableNote } from '@be-music/player/playable-notes';
import { findClosestCandidateInWindow } from '@be-music/player/judging';
import { findFirstIndexAtOrAfter, findFirstIndexNumberAtOrAfter } from '@be-music/utils/core';
import type { BrowserSongAssetSource, BrowserSongEntry } from './types.ts';
import {
  loadAssetBytes,
  normalizePath,
  resolveChartImageAsset,
  resolveChartAudioAsset,
  resolveChartPlayVariant,
} from './library.ts';
import {
  type Lr2BarGraphElement,
  type Lr2DestinationRect,
  type Lr2ImageElement,
  type Lr2ImageRect,
  type Lr2JudgeLineElement,
  type Lr2Skin,
  type Lr2SliderElement,
  type Lr2SpecialGraphic,
  type Lr2TextElement,
  LR2_SPECIAL_GRAPHIC,
  isLr2SpecialGraphic,
} from '@be-music/lr2-skin';
import { loadSkinAssetTexture, loadTextureFromBytes, loadVideoTextureFromBytes } from './lr2-textures.ts';
import {
  applyDestinationToSprite,
  createCroppedTexture,
  evaluateKeyframes,
  normaliseRect,
  pickAnimatedCell,
  renderNumberElement,
} from './lr2-render.ts';
import { type AudioBusHandle, type CompressorMode, type CompressorStage, buildAudioBus } from './audio-bus.ts';
import { GameplayRecorder, type GameplayRecorderResult } from './gameplay-recorder.ts';
import { PerfTracker } from './pixi-perf.ts';
import { type PixiSceneHost } from './pixi-scene-host.ts';
import { destroyUniqueTextures, disposeChildren } from './pixi-utils.ts';
import { normalizeObjectKey, resolveBmsBase, type BeMusicEvent, type BeMusicJson } from '@be-music/json';
import { resolveBmsControlFlow } from '@be-music/parser';
import {
  createBeatResolver,
  isBmsBgmVolumeChangeChannel,
  isBmsDynamicVolumeChangeChannel,
  isBmsKeyVolumeChangeChannel,
  parseBmsDynamicVolumeGain,
  resolveChartReferenceBpm,
  sortEvents,
} from '@be-music/chart';
import {
  BG,
  BLUE,
  BOMB_CYCLE_MS,
  BOMB_DIVX,
  BOMB_DIVY,
  DESIGN_HEIGHT,
  DESIGN_WIDTH,
  HISPEED_MAX,
  HISPEED_MIN,
  HISPEED_STEP,
  FALLBACK_INTRO_DELAY_MS,
  LR2_1P_BOMB_TIMER_BASE,
  LR2_1P_KEYON_TIMER_BASE,
  LR2_1P_LN_HOLD_TIMER_BASE,
  LR2_2P_BOMB_TIMER_BASE,
  LR2_2P_KEYON_TIMER_BASE,
  LR2_2P_LN_HOLD_TIMER_BASE,
  MUTED,
  PANEL,
  PIXELS_PER_BEAT,
  PLAYFIELD,
  RED,
  WHITE,
  YELLOW,
} from './pixi-gameplay-constants.ts';
import {
  buildBgaTimeline,
  isVideoExtension,
  pickActiveBgaCue,
  pickActiveBgaKey,
  type BgaCue,
} from './pixi-gameplay-bga.ts';
import {
  isPlayableInputChannel,
  isScratch,
  resolveKeyChannel,
  resolveLaneChannels,
  resolveLr2LaneIndex,
  resolveSideRelativeLaneIndex,
} from './pixi-gameplay-lanes.ts';
import {
  computeBombDurationsMs,
  computeFullComboDurationMs,
  computeGaugeTimerDurationsMs,
  computeKeyOnFadeDurationsMs,
  computeLnHoldDurationsMs,
  computeRankOp,
  createEmptyScore,
  formatTime,
  isLr2OverlayImage,
  lastJudgeToNowComboKind,
  renderGrooveGaugeElement,
  renderNowComboElement,
  resolveDifficultyName,
  resolveJudgeSkinKind,
  resolveNumberValue,
} from './pixi-gameplay-hud.ts';
import { renderFallbackLr2Frame } from './pixi-gameplay-fallback.ts';
import { resolveScaledViewport } from './lr2-scene-render.ts';
import { loadSkinBitmapFonts } from './lr2-font-loader.ts';
import { makeLr2BitmapTextSprite, type Lr2LoadedFont } from './lr2-bitmap-text.ts';
import { logger } from './logger.ts';

const log = logger('gameplay');

interface RuntimeNote extends TimedPlayableNote {
  hit: boolean;
}

/**
 * Mine / landmine note (BMS channels D1-D9 / E1-E9 for the 1P /
 * 2P sides). Mirrors `RuntimeNote`'s `hit` flag so the same
 * "judged once, never re-judged" bookkeeping applies, but uses
 * the simpler `TimedLandmineNote` source shape (no LN body / end
 * beat / sound channel — landmines are point-in-time hazards).
 *
 * On a key press inside the BAD window we trigger a BAD verdict,
 * play the mine explosion sample (`#WAV 00`), drain the gauge by
 * the chart-encoded damage value, and reset combo to zero. The
 * underlying `playableNotes` array stays untouched so a regular
 * note in the same window past / future the mine can still be
 * judged on the next press.
 */
interface RuntimeMineNote extends TimedLandmineNote {
  hit: boolean;
}

/**
 * Fallback lane-laser release fade duration in ms. The actual
 * value used at runtime is the longest `time` keyframe across the
 * skin's elements gated on the lane's key-on timer (computed in
 * {@link prepareSkin} via `computeKeyOnFadeDurationsMs`); this
 * constant kicks in only when a key-on slot has no skin element
 * (skinless mode, or a slot the skin doesn't author). 120 ms
 * matches the LR2 default skin's typical key-on keyframe span and
 * is a perceptually comfortable decay for auto-judge feedback.
 */
const KEY_ON_FADE_OUT_MS = 120;

/**
 * "Fully on" hold time before {@link flashKeyOnTimer} hands the
 * lane laser to the release-fade path. Without this hold the
 * sprite would only stay at peak alpha for the first frame (≈16
 * ms at 60 fps) before the fade tween kicked in, which made
 * auto-judged short-note flashes look like a single-frame
 * blink. ~60 ms is enough to register visually as a deliberate
 * "tap" without lingering through the next note.
 */
const KEY_ON_FLASH_HOLD_MS = 60;

/**
 * Fallback bomb-explosion cleanup duration in ms. The actual value
 * used at runtime is the longest `time` keyframe across the skin's
 * elements gated on a given bomb timer (50..69), computed in
 * {@link prepareSkin} via `computeBombDurationsMs`. This constant
 * is the fallback for skinless mode and for bomb slots the loaded
 * skin doesn't author. 150 ms matches the LR2 default 7-keys
 * skin's bomb cycle.
 */
const BOMB_CLEANUP_FALLBACK_MS = 150;

/**
 * Fallback gauge-increase timer (42 / 43) cleanup duration in ms,
 * used when the loaded skin has no element authored on those
 * timers. ~300 ms is a comfortable flash window for the gauge bar
 * "rise" sparkle when the skin doesn't dictate one.
 */
const GAUGE_INCREASE_FALLBACK_MS = 300;

/**
 * Snapshot of the play session, captured at chart-end (or whenever
 * the host asks for it via {@link PixiGameplayView.getResultData}).
 * Routed through the host into the result scene so it can render
 * the LR2 result skin without holding onto the gameplay view.
 *
 * Field meaning:
 * - `score` — same shape as {@link ScoreSummary}: per-judge counts,
 *   total notes, EX-score, and the displayed (count-up smoothed)
 *   IIDX score.
 * - `maxCombo` — longest GREAT-or-better streak observed during
 *   the play (resets on every BAD/POOR).
 * - `gauge` — final gauge percentage (0–100), used to drive
 *   pass / fail ops on the result skin.
 * - `cleared` — `true` when the gauge ended at-or-above the chart's
 *   pass threshold (≥ 80 % for HARD-style charts; we use NORMAL's
 *   80 % default for now since gauge type isn't user-selectable).
 * - `playSeconds` — clock time the player spent on the chart, for
 *   the result skin's "TIME" readout.
 * - `song` — chart metadata (title, artist, BPM, …) for the song
 *   info panel; the same `BrowserSongEntry` the gameplay view was
 *   mounted with.
 */
/**
 * One sample of the gauge polyline. `progress` is the chart-time
 * fraction (0 = first note, 1 = last playable / sample trigger);
 * `value` is the gauge percentage at that moment (0..100).
 *
 * Used by the result scene's `Lr2GaugeChartElement` renderer —
 * see `pixi-result.ts`. The series always contains at least one
 * entry (the chart-start origin seeded in `prepareSong`).
 */
export interface GaugeHistorySample {
  progress: number;
  value: number;
}

/**
 * One sample of the EX-score polyline. Same shape as
 * {@link GaugeHistorySample} but the value is an absolute
 * EX-score count (0..`total*2`). The result scene normalises by
 * the chart's theoretical max when drawing.
 */
export interface ScoreHistorySample {
  progress: number;
  exScore: number;
}

export interface PixiGameplayResultData {
  score: ScoreSummary;
  maxCombo: number;
  gauge: number;
  cleared: boolean;
  playSeconds: number;
  song: BrowserSongEntry;
  /**
   * Per-judge samples of `(progress, gauge%)`. Populated through the
   * play session by `publishJudge`. The result scene uses this to
   * draw `#SRC_GAUGECHART_1P` / `_2P` polylines that animate left-
   * to-right between the SRC's `start` and `end` ms.
   */
  gaugeHistory: GaugeHistorySample[];
  /** Per-judge samples of `(progress, exScore)`. Drives `#SRC_SCORECHART`. */
  scoreHistory: ScoreHistorySample[];
}

export interface PixiGameplayViewOptions {
  skin?: Lr2Skin;
  onExit?: () => void;
  /**
   * Restart hook. Fired when the player presses the restart hotkey
   * (`R` by default) — host should dispose this view and mount a
   * fresh one with the same song. The view itself can't recreate
   * its `Application` cleanly, so re-mount is the host's job.
   */
  onRestart?: () => void;
  /**
   * Natural-end hook. Fires once when the chart has finished playing
   * (every playable note judged + a small audio tail buffer). The
   * snapshot is the same payload {@link PixiGameplayView.getResultData}
   * returns — passed eagerly so the host doesn't have to reach back
   * into the soon-to-be-disposed gameplay view to read it. When this
   * hook is supplied, `onExit` is **not** called for natural completion;
   * `onExit` is reserved for the user-initiated escape (ESC). Hosts that
   * don't want a result screen can leave this unset and rely on `onExit`
   * for both paths (legacy behaviour).
   */
  onChartFinished?: (result: PixiGameplayResultData) => void;
  /** When true, every note is auto-judged as PERFECT at its scheduled time. */
  autoPlay?: boolean;
  /**
   * When true, the gameplay automatically pauses on tab visibility
   * change (`document.hidden`) and window blur, and auto-resumes on
   * focus / `pageshow`. When false (the default), the play scene
   * keeps running in the background — convenient for capturing
   * recordings while another window holds focus, and matches the
   * "no surprise pauses" behaviour most rhythm-game hosts ship.
   */
  autoPauseOnBlur?: boolean;
  /**
   * Initial visual scroll-speed multiplier. Mirrors the live
   * runtime hotkey (`ArrowUp` / `ArrowDown` adjusts this value
   * during play); the option lets the host seed it from the
   * select-screen play-options panel so the user doesn't have to
   * re-dial their preferred HS at every song. Clamped to
   * [`HISPEED_MIN`, `HISPEED_MAX`] internally; defaults to 1.5.
   */
  initialHiSpeed?: number;
  /**
   * BGA display mode picked from the LR2 panel-1 BGA toggle
   * (`#SRC_BUTTON,type=72`). Defaults to `'ON'` so charts that
   * ship a BGA render it by default. With `'OFF'` the BGA layer
   * stays empty for the entire play; with `'AUTOPLAY_ONLY'` the
   * BGA only shows when {@link autoPlay} is also true.
   */
  bga?: 'OFF' | 'ON' | 'AUTOPLAY_ONLY';
  /**
   * BGA frame size picked from `#SRC_BUTTON,type=73`. NORMAL uses
   * the skin's default `#DST_BGA` rect (op 30); EXTEND chooses
   * the larger variant (op 31). Defaults to NORMAL.
   */
  bgaSize?: 'NORMAL' | 'EXTEND';
  /**
   * Score-graph display flag picked from `#SRC_BUTTON,type=70`.
   * Drives ops 38 (off) / 39 (on) on the gameplay runtime so the
   * skin's score-prediction line chrome (gated on op 39) shows
   * when enabled. Defaults to `false` to mirror the LR2 default.
   */
  scoreGraph?: boolean;
  /**
   * HS-FIX mode picked from `#SRC_BUTTON,type=55`. Applied as a
   * one-time multiplier on `initialHiSpeed` at chart-prepare time
   * so the user's chosen HS feels consistent across BPM changes.
   * `'CONSTANT'` falls back to `'AVERAGE'` for now — true
   * per-frame BPM-aware scrolling needs a render-pipeline
   * change that hasn't landed yet.
   */
  hsFix?: 'OFF' | 'MAXBPM' | 'MINBPM' | 'AVERAGE' | 'CONSTANT';
  /**
   * HIDDEN / SUDDEN / HID+SUD effect picked from
   * `#SRC_BUTTON,type=50/51`:
   *
   * - `OFF`     — no mask
   * - `HIDDEN`  — bottom of the playfield is masked (notes
   *   disappear before reaching the judge line)
   * - `SUDDEN`  — top of the playfield is masked (notes appear
   *   suddenly partway down)
   * - `HID+SUD` — both
   *
   * Defaults to `'OFF'`.
   */
  hiddenSudden1P?: 'OFF' | 'HIDDEN' | 'SUDDEN' | 'HID+SUD';
  hiddenSudden2P?: 'OFF' | 'HIDDEN' | 'SUDDEN' | 'HID+SUD';
  /**
   * Shutter coverage (0..1) — how much of the playfield each
   * active mask occupies. `0.25` covers the bottom 25 % for
   * HIDDEN, the top 25 % for SUDDEN, and 25 % at each end for
   * HID+SUD. Drives slider `type=4 / 5` on the panel-1 shutter
   * track. Defaults to `0.25`.
   */
  shutter?: number;
  /**
   * LANE COVER ON / OFF toggle (LR2 button_type 46). When true,
   * the gameplay-side mask renders at `shutter`'s configured
   * height. When false, the mask is suppressed regardless of
   * `shutter` — preserves the user's last height across toggles
   * so they don't have to redial it after re-enabling.
   */
  laneCover?: boolean;
  /**
   * 1P side auto-scratch flag — when true, the scratch lane
   * (channel 16) auto-judges as PERFECT at every note's scheduled
   * time even when {@link autoPlay} is off. The player only has
   * to play the keys.
   */
  autoScratch1P?: boolean;
  /** 2P side auto-scratch (channel 26). */
  autoScratch2P?: boolean;
  /**
   * DP FLIP — when true, swaps every note's 1P / 2P channel at
   * chart-prepare time. Only DP charts have notes on both sides
   * so SP charts are unaffected. Mirrors LR2's `#SRC_BUTTON,type=54`.
   */
  dpFlip?: boolean;
  /**
   * Note-arrangement mode for the 1P keyboard lanes
   * (`#SRC_BUTTON,type=42`). Applied at chart-prepare time so
   * the shuffle is consistent across the play session — pressing
   * F5 (restart) reuses the same `random1P` value but draws a
   * fresh permutation.
   */
  random1P?: 'OFF' | 'MIRROR' | 'RANDOM' | 'S-RANDOM' | 'SCATTER';
  /** 2P side note arrangement (`#SRC_BUTTON,type=43`). */
  random2P?: 'OFF' | 'MIRROR' | 'RANDOM' | 'S-RANDOM' | 'SCATTER';
  /**
   * 1P gauge variant (`#SRC_BUTTON,type=40`). Drives both the
   * gauge formula (`createGrooveGaugeState`) and the gauge-on-
   * red-branch op flags (43 / 45). 2P-side gauge isn't yet
   * separately wired — `createGrooveGaugeState` consumes the 1P
   * value and applies it to the single shared gauge.
   */
  gauge?: 'GROOVE' | 'HARD' | 'DEATH' | 'EASY';
  /**
   * When true (default), the audio bus runs through dynamics
   * compressors that soften clipping when many BMS samples fire
   * simultaneously (jacks, dense BGM stacks). Set to `false` to
   * bypass every compressor and feed sample sources directly to
   * `audioContext.destination`.
   *
   * Equivalent to `audioCompressorMode === 'off'` when `false`.
   * When `true` (or omitted), the active mode comes from
   * `audioCompressorMode` (defaults to `'split'`).
   */
  audioCompressor?: boolean;
  /**
   * Compressor architecture when `audioCompressor` is enabled.
   *
   * - `'split'` (default) — separate compressors on the key /
   *   BGM buses plus a master limiter; key bus tuned aggressively
   *   for transient peaks, BGM bus tuned for musical glue, master
   *   for clip protection. Prevents BGM ducking under dense input
   *   bursts (a known failure mode of the legacy single-bus
   *   compressor).
   * - `'legacy'` — original single-compressor topology, kept for
   *   A/B comparison via the demo's `?compressor=legacy` URL flag
   *   so behaviour can be diff-tested directly.
   *
   * `'off'` is reachable via `audioCompressor: false` rather than
   * being a valid value here — `audioCompressor` is the user-
   * facing toggle, this option only chooses **which** compressed
   * topology to use when compression is on.
   */
  audioCompressorMode?: 'split' | 'legacy';
  /**
   * Initial per-stage on/off flags for the split-bus architecture.
   * Defaults to all `true` (every stage engaged). Hosts that
   * surface a UI for per-stage bypass should pass the current UI
   * state here so the bus comes up matching the visible selection
   * — otherwise the user's stage choices on the select screen
   * would be silently reset every gameplay re-mount.
   */
  audioCompressorStages?: { key?: boolean; bgm?: boolean; master?: boolean };
  /**
   * When set to a positive integer, BGA videos that need the
   * ffmpeg.wasm fallback (legacy `.mpg` / `.wmv` / `.avi` /
   * unsupported codecs) are downscaled during transcode so
   * neither edge exceeds this many pixels. Aspect ratio is
   * preserved.
   *
   * Single-threaded libx264 cost scales linearly with pixel
   * count, so capping at 720 / 480 / etc. is the biggest
   * single-threaded speed lever once `-preset ultrafast` is in
   * effect. Visual parity holds well under nearest-filter
   * scaling because the BGA layer is rendered into a 256-px
   * spec canvas.
   *
   * `undefined` / `0` / negative values disable the cap and
   * the source resolution passes through unchanged (the
   * default behaviour).
   */
  bgaTranscodeMaxLongEdgePx?: number;
  /**
   * When true, the BGA transcode fallback uses the browser's
   * WebCodecs `VideoEncoder` API instead of libx264 in
   * ffmpeg.wasm. The decode step still goes through ffmpeg
   * because WebCodecs' `VideoDecoder` doesn't speak the legacy
   * codecs (MPEG-1, VC-1, etc.) BMS BGA usually ships in.
   *
   * Hardware-accelerated where the browser exposes a platform
   * encoder — typically a 5–20× encode-side speedup. Silently
   * falls back to the ffmpeg-only path when the browser
   * doesn't support WebCodecs, the encoder rejects the
   * configured parameters, or the raw decoded frames would
   * exceed the in-memory budget.
   */
  bgaTranscodeUseWebCodecs?: boolean;
  /**
   * Debug overlay — when true, the renderer paints a thin green
   * bar at every invisible / keysound note's chart position
   * (BMS channels `3x` / `4x`, the chart author's hidden
   * keysound layout). The bars never affect gameplay or
   * judgement; they're a chart-inspection aid for verifying
   * which lane each `#WAV` sample is wired to. Defaults to
   * `false` so the regular play surface stays uncluttered.
   */
  showInvisibleNotes?: boolean;
  /**
   * Optional source skin for the green note sprite drawn on
   * top of each invisible note when {@link showInvisibleNotes}
   * is on. The renderer pulls `notes.note[3]` from this skin —
   * index 3 is the green wide note in the LR2 default
   * `play_9.lr2skin` POP layout (Pop'n's third lane), so the
   * convention is: pass the loaded 9-keys play variant here
   * and the invisible-note overlay uses the same green sprite
   * a PMS chart would.
   *
   * Falls back to a flat green rectangle when the skin is
   * absent, lacks `notes.note[3]`, or its texture failed to
   * load. Texture is preloaded alongside the active skin's
   * own assets in {@link prepareSkin} so by the time
   * `renderNotes` runs the cropped cell is ready.
   */
  invisibleNoteSkin?: Lr2Skin;
  /**
   * Single-note visibility after judgement.
   *
   * - `'HIDE'` (default) — judged notes vanish at the
   *   judgement instant. Matches the LR2 / beatoraja default
   *   behaviour and keeps the playfield visually clean during
   *   dense passages.
   * - `'KEEP_SCROLLING'` — judged notes stay on screen and
   *   keep scrolling until their position crosses the
   *   judgement line. Equivalent to beatoraja's
   *   `LANEEFFECT ON` mode; useful as a timing-learning aid
   *   because the player can see *where* a press landed
   *   relative to the line.
   *
   * Only single notes are gated. Long-note bodies are always
   * positionally clipped (the body persists until the tail
   * passes the line regardless of head-hit state) so this
   * option doesn't disturb LN visuals.
   */
  judgedNoteDisplay?: 'KEEP_SCROLLING' | 'HIDE';
}

export class PixiGameplayView {
  /**
   * The host that owns the underlying `Application`. Set by
   * {@link mount}; before that, accessing `this.app` throws — the
   * scene must always be mounted to a host before any rendering or
   * input interaction can happen. See `PixiSceneHost` for the
   * single-Application architecture rationale.
   */
  private host: PixiSceneHost | undefined;
  /**
   * Top-level Container the scene host attaches to its `app.stage`
   * while gameplay is active. All visible nodes
   * (`viewportBackground` + `root`) live as children of this
   * sceneRoot, so the host can mount/unmount the whole gameplay
   * subtree as one operation.
   */
  private readonly sceneRoot = new Container();
  private readonly root = new Container();
  /**
   * Clip mask for the design rect — sits as a child of `root` so
   * the same `position` / `scale` transform applies to it as the
   * sprites it clips. Pixi uses the mask's world-space bounds to
   * decide what's visible; with the mask drawn at
   * `(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT)` in design space, the
   * post-transform bounds match the on-screen design rectangle
   * exactly, and any sprite that animates in from off-canvas
   * (LR2 default's `#DST_IMAGE,...,758,0,...` slide-ins, etc.)
   * gets clipped at the design edge instead of bleeding into the
   * pillarbox / letterbox of a screen with a different aspect
   * ratio.
   */
  private readonly designClipMask = new Graphics();
  /**
   * Cached screen / design dimensions baked into the static
   * graphics (`viewportBackground`, `background`,
   * `designClipMask`). Compared against the per-frame values
   * so we only call `.clear().rect().fill()` when the size
   * actually changes — Pixi v8 rebuilds the GraphicsContext on
   * every chain, and redrawing identical rects every rAF tick
   * was a noticeable contributor to gameplay frame time on
   * dense charts.
   */
  private cachedScreenWidth = -1;
  private cachedScreenHeight = -1;
  private readonly viewportBackground = new Graphics();
  private readonly background = new Graphics();
  /**
   * BGA composite layer. Sits below `skinLayer` so the skin's "BGA frame"
   * decoration draws on top, and above `background` so the BGA is visible
   * inside the play screen. One `Sprite` per layer (base / layer1+2 /
   * POOR override) is reused frame-to-frame to avoid Pixi child churn.
   */
  private readonly bgaLayer = new Container();
  private readonly skinLayer = new Container();
  private readonly laneLayer = new Graphics();
  private readonly noteLayer = new Container();
  /**
   * Shutter mask layer. Sits above `noteLayer` so the dark
   * rectangles drawn here cover the scrolling notes underneath
   * but stay below the judgement-line / HUD overlays. Cleared
   * and redrawn every frame from `playOptions.hiddenSudden` +
   * `playOptions.shutter`.
   */
  private readonly shutterLayer = new Graphics();
  private readonly bombLayer = new Container();
  /**
   * Sits above `noteLayer` / `bombLayer` and below `textLayer`. Holds the
   * skin elements that should visually punch through the note stream:
   * the judgement plate, NOWCOMBO digits, and the AUTOPLAY indicator.
   */
  private readonly overlayLayer = new Container();
  private readonly textLayer = new Container();
  private readonly overlay = new Text({
    text: '',
    style: new TextStyle({
      fill: 0xf8fafc,
      fontSize: 22,
      fontWeight: '700',
      align: 'center',
      fontFamily: 'system-ui, sans-serif',
    }),
  });
  private song: BrowserSongEntry | undefined;
  private source: BrowserSongAssetSource | undefined;
  /**
   * The chart's `#RANDOM` / `#IF` control flow resolved for THIS play
   * session. `song.chart` is the raw parsed JSON (kept for metadata
   * stability), but every gameplay-time consumer — note extraction,
   * timing resolver, sample triggers, BGA timeline, measure walk —
   * reads `resolvedChart` so the rolled random branches actually
   * take effect. Without this step BMS charts using `#RANDOM` /
   * `#SETRANDOM` / `#SWITCH` either omit every conditional section or
   * include them all (depending on parser default), neither of which
   * matches LR2 behaviour.
   */
  private resolvedChart: BeMusicJson | undefined;
  /**
   * `seconds → beat` resolver that properly accounts for `#STOP`
   * windows. During a STOP, this returns the same beat across the
   * window's duration so the playfield freezes in place. Without it
   * the previous hand-rolled `currentBeat` extrapolation would scroll
   * notes through STOP zones at the prevailing BPM, breaking many
   * BMS arrangements that lean on STOP for visual emphasis.
   */
  private beatAtSeconds: ((seconds: number) => number) | undefined;
  /**
   * Distance integrator that consumes `#SCROLL` and `#SPEED` events.
   * Note Y positions are computed as
   * `lane.bottom - distanceBetween(currentBeat, note.beat) *
   * pixelsPerBeat` instead of `(note.beat - currentBeat) *
   * pixelsPerBeat`, so:
   *   - `#SCROLL,2` doubles the local scroll rate (notes pass twice
   *     as fast),
   *   - `#SCROLL,-1` reverses the scroll direction (notes scroll
   *     backwards through the playfield), and
   *   - `#SPEED` lerps the visual speed between control points.
   * Falls back to plain beat-difference math when no scroll/speed
   * events are present.
   */
  private scrollMapper: ScrollDistanceMapperLike | undefined;
  private notes: RuntimeNote[] = [];
  /**
   * Landmine notes (channels D1-D9 / E1-E9). Sorted by `seconds`
   * for the same binary-search-by-time access pattern the
   * playable-note judge loop uses. Hit-test runs in `judge()`
   * BEFORE the playable-note check so a press that lands inside
   * the BAD window of both a mine and a regular note prefers the
   * mine — matches LR2 behaviour where the mine explodes first.
   */
  private mineNotes: RuntimeMineNote[] = [];
  /**
   * Invisible / keysound notes (BMS channels `3x` / `4x`). Held
   * separately from {@link notes} because they don't participate
   * in scoring or judgement — they exist purely so a press on
   * the matching lane fires the per-note `#WAV` sample. The
   * extractor already remaps `3x → 1x` / `4x → 2x` so each
   * entry's `channel` lines up with the playable lane it shares.
   *
   * Populated only when {@link PixiGameplayViewOptions.showInvisibleNotes}
   * is on — this is a debug visualisation, not gameplay state.
   * The renderer paints a thin green bar per entry so the chart
   * author's hidden keysound layout is legible alongside the
   * regular note stream.
   */
  private invisibleNotes: TimedPlayableNote[] = [];
  /**
   * LR2 turntable physics — per-side angular state for sprites
   * authored with `op4 === 1` (1P scratch) or `op4 === 2` (2P
   * scratch).
   *
   * Model:
   * - **Baseline**: the disc always spins forward at a constant
   *   angular velocity (1 rev/sec).
   * - **Press**: snaps the velocity to `baseline ± delta`. The
   *   delta is larger than the baseline, so a brake (`−delta`)
   *   actually drives `v` negative — the disc visibly reverses
   *   direction, like a real DJ scratching the platter back.
   * - **Streak alternation**: a press within
   *   {@link TURNTABLE_STREAK_GAP_MS} of the previous press
   *   continues a "scratch run" — the sign flips on each
   *   press, so consecutive rapid hits alternate forward /
   *   reverse / forward / reverse just like manual scratching.
   *   A press after a longer pause resets the streak so
   *   isolated presses always brake first (not jump forward).
   * - **Recovery**: between presses, velocity exponentially
   *   relaxes back to baseline, so the brake / forward push
   *   fades and the disc resumes its idle cadence on its own.
   *
   * State is integrated in {@link updateTurntable} on the
   * tick loop and read by `renderImageElement` per frame.
   */
  private turntableAngle: Record<'1' | '2', number> = { '1': 0, '2': 0 };
  /**
   * Initialised in the constructor body to the baseline so
   * the disc spins from t=0 even before any input arrives.
   * Not initialised inline because `private static readonly`
   * fields can't be safely referenced at instance-field-init
   * time across all TS targets.
   */
  private turntableVelocity: Record<'1' | '2', number>;
  /**
   * Direction the *next* press will push the disc. `-1` brakes
   * (drives velocity below baseline → momentary reverse);
   * `+1` accelerates (drives velocity above baseline →
   * momentary forward spike). Flipped after every press to
   * produce the alternating "scratch run" feel; reset to `-1`
   * after a quiet gap so isolated presses always brake first.
   */
  private turntableNextSign: Record<'1' | '2', -1 | 1> = { '1': -1, '2': -1 };
  /**
   * Last-press timestamp per side (in `playClock()` ms), used
   * to detect streak continuity. A press within
   * {@link TURNTABLE_STREAK_GAP_MS} keeps the alternation
   * going; a press after a longer pause resets `nextSign` to
   * `-1` so the first press of a fresh streak brakes.
   */
  private turntableLastImpulseAt: Record<'1' | '2', number> = {
    '1': Number.NEGATIVE_INFINITY,
    '2': Number.NEGATIVE_INFINITY,
  };
  private turntableLastUpdateAt = 0;
  private static readonly TURNTABLE_BASELINE_RAD_PER_SEC = 2 * Math.PI;
  /**
   * Snap delta on each press. Larger than
   * {@link TURNTABLE_BASELINE_RAD_PER_SEC} so a brake
   * (`baseline − delta`) is genuinely negative — the disc
   * visibly reverses rather than just slowing down.
   */
  private static readonly TURNTABLE_PRESS_DELTA_RAD_PER_SEC = 3 * Math.PI;
  private static readonly TURNTABLE_RECOVERY_PER_SEC = 3;
  /**
   * Time window (ms) within which two presses count as part
   * of the same streak. ~250 ms is faster than a casual
   * isolated press and slower than the fastest practical
   * scratch tempo (about 10 Hz = 100 ms gaps), so it cleanly
   * separates "rapid scratch run" from "two unrelated single
   * presses".
   */
  private static readonly TURNTABLE_STREAK_GAP_MS = 250;
  private maxLongNoteBeatSpan = 0;
  private chartLastNoteEndSeconds = 0;
  private songDurationSeconds = 0;
  private remainingNotes = 0;
  private autoJudgeCursor = 0;
  private autoMissCursor = 0;
  private laneChannels: string[] = [];
  /**
   * Cached `resolveChartPlayVariant` result for the loaded chart.
   * Used to pick the right `play_<variant>.lr2skin`, the right
   * keymode op (160..164), and to switch lane-channel detection
   * to the PMS layout (`17` is a lane note, `22..25` are 1P-side
   * lanes) instead of the default IIDX layout. Defaults to `'7'`
   * before any chart is loaded so the existing 7K-flavoured
   * fallbacks keep behaving as before for skinless / pre-prepare
   * code paths.
   */
  private chartPlayVariant: '5' | '7' | '9' | '10' | '14' = '7';
  private laneX = new Map<string, { x: number; w: number; top: number; bottom: number }>();
  private textures = new Map<string, Texture>();
  /**
   * `performance.now()` value captured at `mount()`. Skin animations (LR2
   * timer 0/40/41 — scene-start / READY / play-start) anchor here so the
   * intro slide-ins, scratch turntable rotation, and similar visuals play
   * from the moment the gameplay view appears, not from the moment notes
   * begin scrolling.
   */
  private sceneStartTime = 0;
  private startTime = 0;
  /**
   * `audioContext.currentTime` value that corresponds to chart-second 0.
   * Used to schedule background samples with sample-accurate Web Audio timing.
   */
  private audioContextStartTime = 0;
  private paused = false;
  private pauseTime = 0;
  private pauseTotal = 0;
  /**
   * Idempotency / re-entrancy guard for {@link dispose}. ESC →
   * `onExit` → `showSelect` → `dispose` is fine on a single press,
   * but a quick double-tap (or a chart-end `setTimeout` racing the
   * keypress) used to fire `dispose` twice and crash on the second
   * pass when `app` was already torn down. Now the second call
   * short-circuits immediately.
   */
  private disposed = false;
  /** Lazy-loaded LR2 bitmap fonts (font index → glyph payload). */
  private bitmapFonts: Map<number, Lr2LoadedFont> = new Map();
  private audioContext: AudioContext | undefined;
  /**
   * Audio routing handle. Owns two stable mixers (`keyMixer` for
   * player-input keysounds, `bgmMixer` for auto-triggered BGM) plus
   * the per-bus and master compressor stages. Sample sources
   * connect to the appropriate mixer; the bus's `setMode` method
   * swaps the downstream wiring without disturbing those source-
   * side connections.
   *
   * See `audio-bus.ts` for the architecture and per-mode topology.
   */
  private audioBus: AudioBusHandle | undefined;
  /**
   * Most-recently-applied compressor mode. Distinct from the bus's
   * `mode` getter so we can decide what to flip back to when
   * `setAudioCompressor(true)` re-enables compression after a
   * temporary `'off'` (we restore whatever `audioCompressorMode`
   * the constructor / URL flag selected).
   */
  private audioCompressorMode: CompressorMode = 'split';
  /**
   * Active recorder (canvas video + audio bus tap → WebM blob)
   * when the host has started a recording session via
   * {@link startRecording}. `undefined` while idle. We hold the
   * instance across the play session so `stopRecording` /
   * `dispose` can finalize cleanly even if the chart ends mid-
   * recording.
   */
  private recorder: GameplayRecorder | undefined;
  private decodedSamples = new Map<string, AudioBuffer>();
  /**
   * bmson per-event slice playback map. For bmson charts the
   * audio-renderer's `createBmsonSamplePlaybackMap` precomputes
   * which portion of each `sound_channels[]` WAV a given note
   * is supposed to play — `offsetSeconds` is the seek-into-file
   * position, `durationSeconds` (when set) caps how long the
   * slice should run. Built once per chart in `prepareSong`;
   * `playSample` looks each note's event up here and calls
   * `node.start(when, offset, duration)` accordingly so the
   * sliced-WAV authoring intent is preserved.
   *
   * Stays `undefined` for non-bmson charts (they have no
   * slicing semantics — each note plays its entire WAV from
   * t=0).
   */
  private bmsonSlicePlayback: Map<BeMusicEvent, { offsetSeconds: number; durationSeconds?: number; sliceId: string }> | undefined;
  /**
   * Most recent {@link AudioBufferSourceNode} per sample key,
   * tracked so bmson `note.c = true` (continuation flag) can
   * skip retriggering a sample that's still emitting from a
   * previous note. The map entry is cleared by the node's
   * `onended` callback once playback finishes naturally — the
   * "still playing" check then reduces to `has(sampleKey)`.
   *
   * Populated by every successful `playSample` / `playSampleByKey`
   * call regardless of source format; only consulted by bmson
   * `c=true` callers, so BMS playback (which has no
   * continuation flag) is unaffected.
   */
  private activeSampleNodes = new Map<string, AudioBufferSourceNode>();
  private scheduled = new Set<RuntimeNote>();
  private autoSampleTriggers: TimedSampleTrigger[] = [];
  private autoTriggerNextIndex = 0;
  /**
   * BMS dynamic-volume timeline (channels `97` BGM-volume /
   * `98` key-volume). Each entry records the chart-time at
   * which the corresponding bus's gain should switch to the
   * authored 0..1 value. The cursor advances as the playhead
   * crosses each event in `scheduleAutoSamples`. Empty for
   * non-BMS charts (the source-format gate matches the CLI's
   * `collectRealtimeAudioVolumeEvents`).
   */
  private volumeChangeEvents: Array<{ seconds: number; bus: 'key' | 'bgm'; gain: number }> = [];
  private volumeChangeCursor = 0;
  private score: ScoreSummary = createEmptyScore(0);
  private tracker = createScoreTracker();
  /**
   * Highest value of `tracker.combo` reached during the current play.
   * `tracker.combo` resets to 0 on every BAD / POOR, so we mirror it
   * here whenever it exceeds the previous max. Used as the
   * authoritative "MAX COMBO" readout for the result screen — the
   * old fallback (`score.perfect + score.great`) overcounted on
   * broken-combo plays since it tallies hit count rather than the
   * longest unbroken streak.
   */
  private maxCombo = 0;
  /**
   * Per-play sampled history of `(progress, gauge%)` pairs. Recorded
   * inside `publishJudge` (the single chokepoint for every judge
   * event) and seeded with a `(0, initialGauge)` entry on
   * `prepareSong` so the polyline starts from the LR2 default
   * starting gauge (20 %) instead of the first judge's value.
   *
   * `progress` is `seconds / totalSongSeconds` clamped to `[0, 1]`.
   * Drives `Lr2GaugeChartElement` rendering on the result scene —
   * see `pixi-result.ts` for the polyline reveal animation.
   */
  private gaugeHistory: Array<{ progress: number; value: number }> = [];
  /** Same shape as `gaugeHistory`, but tracking running EX score. */
  private scoreHistory: Array<{ progress: number; exScore: number }> = [];
  private lastJudge = '';
  private lastJudgeUntil = 0;
  /**
   * Per-side judge / combo snapshots. Each side captures the
   * verdict text, the chart-time at which the plate should
   * disappear, and the running combo *at the moment that side's
   * note was judged*. The DP renderer reads these directly so
   * the 1P assembly displays the combo at the latest 1P hit and
   * the 2P assembly displays the combo at the latest 2P hit —
   * they only stay synchronised on charts where every press
   * triggers identical-timing hits on both sides (a coincidence,
   * not the rule).
   *
   * SP charts only ever populate the `'1P'` slot, so the global
   * `lastJudge` / `lastJudgeUntil` aliases above keep their
   * existing behaviour for the fallback `renderText` path.
   */
  private judgeSideState: Record<'1P' | '2P', { judge: JudgeKind | ''; until: number; combo: number }> = {
    '1P': { judge: '', until: 0, combo: 0 },
    '2P': { judge: '', until: 0, combo: 0 },
  };
  private frame: number | undefined;
  private chartEndTimeout: number | undefined;
  /**
   * `setTimeout` handles for the LR2 scene-exit sequence (timers
   * 2 = FADEOUT, 3 = CLOSE). Cleared on dispose so the deferred
   * host callback can't fire onto a torn-down view.
   */
  private exitFadeOutHandle: number | undefined;
  private exitCloseHandle: number | undefined;
  /**
   * True once {@link beginExitSequence} starts the FADEOUT → CLOSE
   * → host-callback chain. Re-entry is suppressed so a frantic
   * second ESC press while the fade is animating doesn't leak a
   * second callback or restart the timeline.
   */
  private exiting = false;
  private readonly keyFlashTimeouts = new Set<number>();
  private readonly pressedChannels = new Set<string>();
  /**
   * Per-key-on-timer (`100..117`) play-clock timestamp of an
   * in-flight release fade. When set, `renderSkinImage` tapers the
   * sprite's `alpha` from 1 → 0 over the matching entry of
   * {@link keyOnFadeDurationMs} starting at the recorded value, so
   * an LN release decays instead of popping off.
   * {@link releaseKeyOnTimer} populates this;
   * {@link startKeyOnTimer} clears it on a fresh press.
   */
  private readonly keyOnFadeOutStart = new Map<number, number>();
  /**
   * Per-key-on-timer fade duration in ms, derived from the LR2
   * skin's `#DST_*` keyframes anchored to that timer (longest
   * `time` value across all elements). Populated in
   * {@link prepareSkin}; consumers fall back to
   * {@link KEY_ON_FADE_OUT_MS} when a timer has no skin element.
   */
  private readonly keyOnFadeDurationMs = new Map<number, number>();
  /**
   * Per-bomb-timer (`50..69`) explosion cleanup duration in ms.
   * Populated in {@link prepareSkin} from the skin's authored
   * keyframes; {@link cleanupBombTimers} falls back to
   * {@link BOMB_CLEANUP_FALLBACK_MS} for slots the skin doesn't
   * author (or for skinless mode).
   */
  private readonly bombDurationMs = new Map<number, number>();
  /**
   * Per-LN-hold-effect-timer (`70..89`) play-clock at which the
   * release fade began. {@link renderSkinImage} consumes this to
   * taper the sprite alpha down to 0 over
   * {@link lnHoldFadeDurationMs} starting at the recorded value.
   * {@link startLnHoldTimer} clears the entry on a fresh LN head;
   * {@link releaseLnHoldTimer} populates it at the tail.
   */
  private readonly lnHoldFadeOutStart = new Map<number, number>();
  /**
   * Per-LN-hold-effect-timer fade duration derived from the
   * skin's keyframes anchored to that timer (longest `time`
   * across elements). Populated in {@link prepareSkin}; consumers
   * fall back to {@link KEY_ON_FADE_OUT_MS} when the skin doesn't
   * author the slot (skinless mode, or a chart that never used
   * LN-hold visuals).
   */
  private readonly lnHoldFadeDurationMs = new Map<number, number>();
  /**
   * Per-gauge-rise / gauge-max timer (`42..45`) keyframe spans
   * derived from the skin in {@link prepareSkin}.
   * {@link applyGaugeDelta} consults the rise entries (42 / 43)
   * to time the gauge-increase flash; max entries (44 / 45) stay
   * active for as long as the gauge sits at 100 %, so their span
   * is informational only.
   */
  private readonly gaugeTimerDurationMs = new Map<number, number>();
  /**
   * Active `setTimeout` handle for the gauge-increase flash
   * (timer 42 / 43). Cleared on each new rise so consecutive
   * increases re-stamp the flash instead of letting a stale
   * deferred-delete retire the freshly-stamped timer.
   */
  private gaugeIncreaseTimeout: number | undefined;
  /**
   * In-flight long-note holds keyed by channel. Populated when the
   * head of an LN is judged (the press lands inside the note's
   * judge window) and cleared either on release or when the chart
   * times out the hold (see `finalizeOverheldLongNotes`). Until
   * the tail is finalized the head's `applyJudgeToSummary` /
   * `applyGaugeDelta` calls are deferred — earlier the gameplay
   * committed the head verdict on press, which made every LN
   * effectively a single-tap note and ignored the release timing
   * entirely.
   */
  private readonly activeLongNotes = new Map<
    string,
    {
      readonly note: RuntimeNote;
      readonly headJudge: JudgeKind;
      readonly headSignedDeltaMs: number;
    }
  >();
  private readonly bombStartedAt = new Map<string, number>();
  private bombTexture: Texture | undefined;
  private readonly runtimeOps = new Set<number>();
  /**
   * LR2 groove-gauge state. Replaces the simpler hard-coded
   * +1/+0.5/-2/-6 deltas with the proper LR2 formula:
   *
   *   gain = effectiveTotal / playableNoteCount
   *
   * where `effectiveTotal` comes from the chart's `#TOTAL`
   * directive (or 160 if absent) and `playableNoteCount` is the
   * number of judgeable notes after `#RANDOM` resolution. PERFECT /
   * GREAT each grant `gain`, GOOD grants `gain / 2`, BAD = -4,
   * POOR (chart-side miss) = -6, EMPTY_POOR (input on empty lane) =
   * -2. Min/max clamped at 2 / 100, initial value 20.
   */
  private gaugeState: GrooveGaugeState = createGrooveGaugeState(0, undefined);
  /**
   * Peak-hold meter state for the groove gauge. The renderer
   * paints an extra "lit" bead at the highest gauge value seen
   * recently — the peak follows the gauge up instantly, holds
   * for a window after the gauge starts dropping, and then
   * decays back down to the current value. Mimics LR2's
   * gauge bar (and audio level meters generally) where a thin
   * "ghost" indicator marks the recent high above the live
   * fill.
   */
  private gaugePeak = 0;
  /** `playClock()` ms when the peak was last raised. */
  private gaugePeakUpdatedAt = 0;
  /** `playClock()` ms of the most recent peak update tick. */
  private gaugePeakLastTickAt = 0;
  private static readonly GAUGE_PEAK_HOLD_MS = 700;
  private static readonly GAUGE_PEAK_DECAY_PCT_PER_SEC = 60;
  /**
   * FAST / SLOW counts. Incremented on every GREAT or GOOD judgement
   * — PERFECT is "on time" so it doesn't count, BAD/POOR break combo
   * and aren't tracked here. Mirrors `applyFastSlowForJudge` in
   * `packages/player`'s engine. Reset per play in `prepareSong`.
   */
  private fastCount = 0;
  private slowCount = 0;
  /**
   * Set to `true` once the player has hit every chart note without
   * a single BAD / POOR break. Latches on first achievement so the
   * LR2 FC timers (48 / 49) only fire once per play — replaying the
   * chart resets this in `prepareSong`. Note: AUTO mode reaches FC
   * the moment the last note's auto-PERFECT lands, so the FC
   * presentation also plays during autoplay sessions (the player
   * specifically asked for that behaviour).
   */
  private fullComboFired = false;
  /**
   * Duration in milliseconds of the longest FC-anchored keyframe
   * sequence in the loaded skin. Used by `cleanupFullComboTimer`
   * to remove timer 48 / 49 from `timerStartedAt` once the
   * animation has finished — without that, the skin's FC graphic
   * (typically authored with `loop = -1` "play once and clamp")
   * would stay frozen on its final frame for the rest of the play
   * session, mirroring the bomb-cleanup pattern. Defaults to
   * 3000 ms when no FC element is present in the skin.
   */
  private fullComboDurationMs = 3000;
  /**
   * High-speed multiplier. 1.0 = base PIXELS_PER_BEAT. Adjustable at runtime
   * via Arrow Up / Arrow Down (steps of 0.25, clamped to [0.5, 6.0]). Mirrors
   * LR2's "hi-speed" knob: only affects the visual scroll rate, never timing.
   *
   * Seeded to 2.5 to match `DEFAULT_PLAY_OPTIONS.hiSpeed` in
   * `pixi-select` — the select view always passes `initialHiSpeed`
   * along when transitioning to gameplay, so this is just the
   * fallback when gameplay is mounted directly without a
   * preceding select scene (tests / direct-launch tooling).
   */
  private hiSpeed = 2.5;
  /**
   * Map of timer-id → performance.now() timestamp at which the timer started.
   * Populated for the LR2 timers we currently drive: bomb (50–69), key-on
   * (100–119), and full-combo (48/49). Removed when the timer "stops"
   * (e.g. key release for key-on, animation completion for bombs).
   */
  private readonly timerStartedAt = new Map<number, number>();
  /**
   * BPM-aware seconds → beat resolver, prepared once per song. Used by
   * `renderNotes` to position scrolling notes correctly across `#BPM`
   * change events; the previous hand-rolled `beatAtSeconds` only saw the
   * initial BPM, which made notes drift through tempo transitions.
   */
  private timingResolver: ReturnType<typeof createTimingResolver> | undefined;
  /**
   * Per-layer BGA cue lists, sorted by chart-time seconds. Each cue's
   * `bmpKey` is the resource key our texture cache is keyed by (BMS id
   * like "01" for BMS charts, header.name like "base.png" for bmson).
   * `bmpKey === undefined` is the "clear / hide" command (BMS `00`).
   */
  private bgaTimeline: { base: BgaCue[]; layer: BgaCue[]; poor: BgaCue[] } = {
    base: [],
    layer: [],
    poor: [],
  };
  /**
   * BMP-resource → decoded `Texture` cache for the **base** + **POOR**
   * tracks. Loaded lazily during `prepareBga()` so the playfield can
   * start displaying samples while background images keep streaming in.
   * Black pixels are preserved (this is the bottommost BGA layer).
   */
  private bgaTextures = new Map<string, Texture>();
  /**
   * BMP-resource → decoded `Texture` cache for the **layer** track
   * (`#BMP` channels 07 and 0A). Decoded separately from
   * {@link bgaTextures} with a chroma-key that turns pure-black pixels
   * transparent — mirrors the BMS BGA "layer" convention used by
   * `packages/player/src/bga.ts` so the foreground composites cleanly
   * over the base track. Even when the same BMP id appears on both
   * tracks we keep two textures because `chroma-key` is destructive.
   */
  private bgaLayerTextures = new Map<string, Texture>();
  /**
   * BMP-key → `<video>` element for video BGA cues (`.mp4` /
   * `.webm` / etc.). `renderBga` seeks + plays these on cue
   * transitions; `dispose` revokes their object URLs.
   *
   * Stored separately from {@link bgaTextures} only because the
   * sync logic needs the underlying media element — the texture
   * itself is also added to `bgaTextures` / `bgaLayerTextures` so
   * the existing renderer paths pick it up unchanged.
   */
  private bgaVideos = new Map<string, { video: HTMLVideoElement; objectUrl: string }>();
  /**
   * Tracks which video is currently associated with each BGA layer
   * and the chart-time it was seeded at. We use this to detect cue
   * transitions in `renderBga` (start the new cue's video, pause
   * the previous one) and to compute the `currentTime` offset
   * relative to the cue's start seconds.
   */
  private bgaActiveVideos: { base?: { key: string; cueSeconds: number }; layer?: { key: string; cueSeconds: number } } =
    {};
  /** `performance.now()` of the most recent POOR judgement, drives the POOR-BGA window. */
  private lastPoorAt = 0;
  /**
   * BMS spec — when the chart omits `#POORBGA` and provides
   * `#BMP00`, the BMP00 image acts as the implicit POOR
   * placeholder until an explicit `#xxx06` POOR cue takes
   * over. Set during {@link prepareSong} so the renderer can
   * paint BMP00 on a miss before any authored POOR event
   * fires; left `undefined` when the chart already authors a
   * proper POOR track or doesn't ship a BMP00 fallback. Mirrors
   * the TUI BGA renderer's `poorFallbackKey` plumbing.
   */
  private poorBgaFallbackKey: string | undefined;
  /**
   * Chart-time after which the BMP00 POOR fallback yields to
   * the explicit POOR timeline. Equal to the first authored
   * POOR cue's `seconds` (or `Infinity` when no POOR cues
   * exist). The renderer compares the chart playhead against
   * this so a chart that authors POOR mid-song falls back to
   * BMP00 only during the pre-roll.
   */
  private poorBgaFallbackUntilSeconds = Number.POSITIVE_INFINITY;
  /** Whether the chart actually carries any BGA events (drives op 170/171). */
  private hasBga = false;
  /** Smoothed score for the count-up animation. Lerps toward `score.score`. */
  private displayedScore = 0;
  /**
   * Frame-rate sampling state. We accumulate frames over a one-second
   * window and publish the rate to the LR2 RATE NUMBER panel.
   */
  private fpsFrameCount = 0;
  private fpsWindowStart = 0;
  private fps = 0;
  /**
   * Per-frame section timing tracker. Logs a console summary every
   * second when enabled (via `?perf` URL flag or
   * `globalThis.__BE_MUSIC_PERF__ = true`). When disabled the wrapper
   * adds no measurable overhead.
   */
  private readonly perf = new PerfTracker('gameplay');

  public constructor(private readonly options: PixiGameplayViewOptions = {}) {
    if (options.initialHiSpeed !== undefined && Number.isFinite(options.initialHiSpeed)) {
      // Snap to the same 1/1000 grid `adjustHiSpeed` uses so a
      // host-supplied `1.5000000000000002` (the obvious float-drift
      // failure mode of repeated +0.1 steps) lands on the canonical
      // grid value the in-game adjust hotkey would produce.
      const snapped = Math.round(options.initialHiSpeed * 1000) / 1000;
      this.hiSpeed = Math.max(HISPEED_MIN, Math.min(HISPEED_MAX, snapped));
    }
    this.autoPauseOnBlur = options.autoPauseOnBlur ?? false;
    // Seed the per-side turntable velocity at the baseline rate
    // so the disc visibly spins from the moment the scene mounts
    // — even before any input arrives or any chart loads.
    this.turntableVelocity = {
      '1': PixiGameplayView.TURNTABLE_BASELINE_RAD_PER_SEC,
      '2': PixiGameplayView.TURNTABLE_BASELINE_RAD_PER_SEC,
    };
  }

  /**
   * Convenience accessor for the host's `Application`. Throws if
   * called before {@link mount}; this is intentional — every code
   * path that touches `this.app` runs after mount completes.
   */
  private get app(): Application {
    if (!this.host) {
      throw new Error('PixiGameplayView: app accessed before mount');
    }
    return this.host.app;
  }

  /**
   * Convenience wrapper that runs {@link prepare} and {@link start}
   * back-to-back — the historical "mount everything and play"
   * entry point. Hosts that want to overlap heavy load with a
   * Decide splash should call `prepare()` early and call
   * `start()` only when the splash is dismissed. See the
   * `showDecide` flow in `player-web-demo`.
   */
  public async mount(host: PixiSceneHost, song: BrowserSongEntry, source?: BrowserSongAssetSource): Promise<void> {
    await this.prepare(host, song, source);
    if (this.disposed) return;
    this.start();
  }

  /**
   * Attaches the scene-graph subtree to the host, wires DOM
   * listeners, parses the chart, and decodes every audio sample
   * the chart references — the slow part of going from "song
   * picked" to "gameplay can begin". The scene is added to the
   * stage with `sceneRoot.visible = false` so a Decide splash
   * (or any other overlay) can keep painting during the load
   * window without competing for stage z-order.
   *
   * Returns once chart audio is decoded (timer / chart-start
   * scheduling is deferred to {@link start}). BGA preload runs
   * concurrently and is allowed to land mid-play; the playfield
   * is up by the time `start()` fires regardless.
   */
  public async prepare(host: PixiSceneHost, song: BrowserSongEntry, source?: BrowserSongAssetSource): Promise<void> {
    this.host = host;
    this.song = song;
    this.source = source;
    // Label every top-level node so the PixiJS Devtools "Scene Graph"
    // panel reads as `gameplay > {bga,skin,lane,…}` instead of a wall
    // of `Container` rows. Layer ordering matches `addChild` below.
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
    // DESIGN_WIDTH / DESIGN_HEIGHT are module constants for
    // gameplay (LR2 default 640×480), so the mask and design
    // background never change shape post-mount. Stamp them once
    // here and skip the per-frame rebuild that was contributing
    // to the rAF handler's runtime.
    this.designClipMask.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill(0xffffff);
    this.background.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill(BG);
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
    // Clip every child of `root` to the design rectangle. The
    // mask graphic itself is a child of `root`, so the same
    // viewport scale / translate applies to both the mask and
    // the masked content — Pixi clips against the mask's world-
    // space bounds, which matches the on-screen design
    // rectangle.
    this.root.mask = this.designClipMask;
    this.shutterLayer.label = 'gameplay/shutter';
    this.sceneRoot.addChild(this.viewportBackground, this.root);
    // Attach to the host's already-initialised stage. The host owns
    // the `Application` (canvas, ticker, WebGL context) — we just
    // contribute our scene-graph subtree.
    host.app.stage.addChild(this.sceneRoot);
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    this.app.canvas.addEventListener('pointerdown', this.focus);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    // `visibilitychange` covers tab switching but not always app switching
    // (Cmd-Tab / Alt-Tab) — fall back to window blur/focus so the gameplay
    // also pauses when the user moves to another OS app entirely. Use the
    // capture phase so we still see the events even if PixiJS or another
    // listener decides to stop propagation along the bubbling path.
    window.addEventListener('blur', this.handleWindowBlur, true);
    window.addEventListener('focus', this.handleWindowFocus, true);
    window.addEventListener('pagehide', this.handleWindowBlur);
    window.addEventListener('pageshow', this.handleWindowFocus);
    // Polling safety net. Some embedded environments / OS-window managers
    // suppress the `visibilitychange` and `blur` events entirely (notably
    // when the dev-tools panel takes focus on the same window). A 250 ms
    // poll on `document.hidden` and `document.hasFocus()` catches those
    // cases without measurable cost.
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
    // Hide the scene-graph subtree until {@link start} fires so a
    // Decide splash (or any other overlay) can keep painting on
    // the shared stage during the load window without z-order
    // contention. `start()` flips this back on the moment the
    // host hands control over to gameplay.
    this.sceneRoot.visible = false;
    this.prepareSong(song);
    await this.prepareSkin();
    if (this.disposed) return;
    await this.prepareAudio();
    if (this.disposed) return;
    // BGA preload runs IN THE BACKGROUND — `prepare()` resolves
    // here even if `prepareBga()` is still decoding videos. The
    // ffmpeg.wasm fallback for unsupported codecs (e.g. legacy
    // `.mpg`) can take ~tens of seconds, and the user wants the
    // PLAY scene to transition in immediately and play its LR2
    // LOADING animation during that wait rather than freezing the
    // Decide splash. {@link start} gates the actual chart start
    // (LR2 timer 40 → 41 / op 80 → 81) on `bgaReadyPromise`, so
    // notes still don't begin until the BGA is in place.
    this.bgaReadyPromise = this.prepareBga().catch((error) => {
      log.warn('BGA preload failed; continuing without it', error);
    });
  }

  /**
   * Reveals the prepared scene, seeds the LR2 scene-stage timers,
   * and starts the rAF loop. Must be called after {@link prepare}
   * resolves; calling it before will skip the chart-start
   * scheduling because `audioContextStartTime` only lands in the
   * right ballpark when the audio context is up.
   *
   * Idempotent — repeated calls after the scene has already
   * started no-op.
   */
  public start(): void {
    if (this.disposed) return;
    if (this.sceneStartTime !== 0) return;
    this.sceneRoot.visible = true;
    // Compute the LR2 intro timeline. Per `docs/LR2SkinHelp.md`:
    //
    //   t=0                                 scene start (timer 0)
    //   t=LOADSTART                         load begins
    //   t=LOADSTART + LOADEND               load ends, "READY" fires
    //                                       (timer 40)
    //   t=LOADSTART + LOADEND + PLAYSTART   chart begins, play-start
    //                                       fires (timer 41)
    //
    // `#PLAYSTART` is therefore the gap between load-end and chart
    // start, not the full intro length. The LR2 default 7-keys
    // ships LOADSTART=0, LOADEND≈1500, PLAYSTART≈1500 → ~3 s before
    // notes begin, which lines up with how the skin's title
    // overlay fades out (anchored to timer 40 with a fade keyframe
    // landing at ~PLAYSTART ms after that). Treating PLAYSTART as
    // the full intro length (the previous version) made the chart
    // start while the title was still on screen.
    // `start()` only runs when `paused` is false and `pauseTotal`
    // is still 0, so `playClock()` and `performance.now()` are
    // equivalent here — but seeding through `playClock()` keeps the
    // animation clocks all in the same coordinate system as the
    // pause-aware reads further below.
    const now = this.playClock();
    this.sceneStartTime = now;
    const timing = this.options.skin?.timing ?? {};
    const loadStartMs = Math.max(0, timing.loadStart ?? 0);
    const loadEndOffsetMs = loadStartMs + Math.max(0, timing.loadEnd ?? 0);
    const playStartOffsetMs = loadEndOffsetMs + Math.max(0, timing.playStart ?? 0);
    // Skinless / non-LR2 demos have no timing directives; fall
    // back to the legacy 3-second wait so the slide-in chrome of
    // the built-in fallback frame still has room to land before
    // notes begin.
    const introMs = playStartOffsetMs > 0 ? playStartOffsetMs : FALLBACK_INTRO_DELAY_MS;
    // The chart waits on BOTH the configured PLAY START delay
    // AND the BGA preload (which may still be transcoding video
    // in the background — see `prepare()`). Until the gate
    // opens below, `startTime = +Infinity` keeps `isIntroPlaying`
    // true and the rAF loop in the LR2 LOADING phase.
    this.startTime = Number.POSITIVE_INFINITY;
    // Seed the LR2 scene-stage timers so the skin's
    // `#STARTINPUT` / `#LOADSTART` / `#LOADEND` / `#PLAYSTART`
    // directives drive their attached `#DST_*` keyframes
    // (without seeds, anything anchored to those timers would
    // pin to time 0 and never animate).
    //
    // Timer 0 (scene start) fires immediately; timer 1
    // (`#STARTINPUT`) keeps its configured offset. Timer 40
    // (`#LOADEND`) and timer 41 (`#PLAYSTART`) — the events
    // that drive "READY" / chart-start cues — are seeded later
    // via the `Promise.all` gates below so they wait for the
    // BGA preload too.
    //
    // Timer 2 (FADEOUT) and timer 3 (CLOSE) are deliberately NOT
    // seeded here even when the skin authored `#FADEOUT` /
    // `#CLOSE` durations: those directives describe scene-EXIT
    // phase animations (= "when the scene starts to close, fade
    // out for N ms then close"), not offsets from scene mount.
    // `beginExitSequence` is what stamps them at the actual
    // transition moment (ESC / chart end) so the LR2 default
    // 7-keys "STAGE FAILED" plate (anchored to timer 3) only
    // paints during the brief exit window instead of bleeding
    // over the gameplay field for the entire chart.
    this.timerStartedAt.set(0, now);
    this.seedSceneStageTimer(1, timing.startInput);
    // LR2 op 80 / 81 ("load not complete" / "load complete") gate
    // the centered title / genre / artist display in the play
    // skin. Op 80 is on during the LOADING phase; the 80→81 flip
    // fires alongside timer 40 once the gate opens.
    this.runtimeOps.add(80);
    this.runtimeOps.delete(81);
    if (this.loadCompleteTimerHandle !== undefined) {
      window.clearTimeout(this.loadCompleteTimerHandle);
      this.loadCompleteTimerHandle = undefined;
    }
    // The `start()` invocation we belong to — captured so the
    // gate handlers below can detect a dispose-and-re-mount and
    // bail out instead of mutating a fresh scene's state.
    const sceneEpoch = this.sceneStartTime;
    const bgaReady = this.bgaReadyPromise ?? Promise.resolve();
    const delay = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, Math.max(0, ms)));
    // LOAD END gate — both the configured `#LOADEND` delay AND
    // the BGA preload need to finish. Fires LR2 timer 40 and
    // flips op 80→81 (READY), which the skin's load-complete
    // animations key off of.
    void Promise.all([bgaReady, delay(loadEndOffsetMs)]).then(() => {
      if (this.disposed) return;
      if (this.sceneStartTime !== sceneEpoch) return;
      this.timerStartedAt.set(40, this.playClock());
      this.runtimeOps.delete(80);
      this.runtimeOps.add(81);
    });
    // PLAY START gate — same pattern, but for the configured
    // `#PLAYSTART` (or fallback intro). Fires timer 41 (animation
    // clock) and anchors the wall-clock + audio-context start
    // times (chart-engine clock) so the chart engine and BGM
    // samples share a single t=0.
    void Promise.all([bgaReady, delay(introMs)]).then(() => {
      if (this.disposed) return;
      if (this.sceneStartTime !== sceneEpoch) return;
      this.timerStartedAt.set(41, this.playClock());
      // `startTime` is consumed by `isIntroPlaying` and
      // `currentSeconds`, both of which work in raw wall-clock
      // units (with `currentSeconds` subtracting `pauseTotal`
      // explicitly), so it MUST stay on `performance.now()`.
      this.startTime = performance.now();
      if (this.audioContext) {
        this.audioContextStartTime = this.audioContext.currentTime;
      }
    });
    this.app.canvas.focus();
    this.tick();
  }

  /**
   * Schedules a scene-stage timer to fire at `offsetMs` after
   * scene mount. Used for LR2 timing directives
   * (`#STARTINPUT` / `#LOADSTART` / `#LOADEND` / `#FADEOUT` /
   * `#CLOSE`) — see `mount()` for the full mapping.
   *
   * `undefined` offset → fall back to "fire immediately" so a
   * skin that omits the directive still has the timer
   * available to elements that gated on it (matches the
   * pre-skin-timing default behaviour).
   */
  private seedSceneStageTimer(timer: number, offsetMs: number | undefined): void {
    const safeOffset = offsetMs === undefined ? 0 : Math.max(0, offsetMs);
    if (safeOffset <= 0) {
      this.timerStartedAt.set(timer, this.sceneStartTime);
      return;
    }
    window.setTimeout(() => {
      if (this.disposed) return;
      this.timerStartedAt.set(timer, this.playClock());
    }, safeOffset);
  }

  /**
   * Hides / shows the scene's subtree on the shared stage. Toggles
   * `sceneRoot.visible` (cheap) instead of touching the canvas
   * display — the canvas is shared with the select scene now, so
   * we mustn't make it `display: none` from here.
   */
  public setVisible(visible: boolean): void {
    this.sceneRoot.visible = visible;
  }

  /**
   * Toggles the dynamics compressor stack on the audio bus at
   * runtime. Mid-play safe: the bus's `setMode` only re-wires
   * downstream stages, so in-flight `BufferSourceNode`s keep
   * playing through the unchanged `keyMixer` / `bgmMixer` nodes.
   *
   * - `setAudioCompressor(false)` → bus mode `'off'` (every stage
   *   bypassed; both mixers connect directly to destination).
   * - `setAudioCompressor(true)` → bus mode is restored to the
   *   architecture the constructor chose (`audioCompressorMode`,
   *   default `'split'`). To switch architectures at runtime use
   *   {@link setAudioCompressorMode} instead.
   *
   * Idempotent and a no-op before `prepareAudio` has run; the
   * constructor's `audioCompressor` option seeds the initial state
   * at mount time.
   */
  public setAudioCompressor(enabled: boolean): void {
    if (!this.audioBus) {
      // Bus will be wired with the right mode the next time
      // `prepareAudio` runs. We can't pre-seed `audioCompressorMode`
      // here either: the constructor option is the source of truth
      // until then.
      return;
    }
    const next = enabled ? this.audioCompressorMode : 'off';
    this.audioBus.setMode(next);
  }

  /**
   * Toggles the auto-pause-on-blur behaviour at runtime. Future
   * `visibilitychange` / `blur` events will only auto-pause when
   * `enabled` is true; the auto-RESUME path stays unconditional so
   * a user who blurs (auto-pauses) then disables this option still
   * gets back to play state on the next focus.
   *
   * Idempotent — calling with the same value no-ops.
   */
  public setAutoPauseOnBlur(enabled: boolean): void {
    this.autoPauseOnBlur = enabled;
  }

  /**
   * Live setter for {@link PixiGameplayViewOptions.judgedNoteDisplay}.
   * Mutates `this.options` so the per-frame `renderNotes` check
   * picks the new mode on the next paint — letting the user
   * A/B "keep scrolling" vs "hide on judge" without restarting
   * the song.
   */
  public setJudgedNoteDisplay(mode: 'KEEP_SCROLLING' | 'HIDE'): void {
    this.options.judgedNoteDisplay = mode;
  }

  /**
   * Live setter for {@link PixiGameplayViewOptions.showInvisibleNotes}.
   * The invisible-note array is always extracted at chart-
   * prepare time and the green sprite's texture is always
   * preloaded, so flipping this flag mid-song just toggles the
   * per-frame render branch — the overlay appears (or vanishes)
   * on the very next paint.
   */
  public setShowInvisibleNotes(enabled: boolean): void {
    this.options.showInvisibleNotes = enabled;
  }

  /**
   * Switches the compressor architecture between `'split'` (default
   * 3-stage) and `'legacy'` (original single-compressor) at
   * runtime. Mostly useful for the demo's `?compressor=` URL flag
   * and for live A/B comparison while debugging.
   *
   * Calling this while `setAudioCompressor(false)` has the bus in
   * `'off'` mode just remembers the choice — the new architecture
   * will be applied next time compression is re-enabled.
   */
  public setAudioCompressorMode(mode: 'split' | 'legacy'): void {
    this.audioCompressorMode = mode;
    if (this.audioBus && this.audioBus.getMode() !== 'off') {
      this.audioBus.setMode(mode);
    }
  }

  /**
   * Toggle one compressor stage (`'key'` / `'bgm'` / `'master'`)
   * within the split-bus architecture. The stage flag is remembered
   * even when the active mode isn't `'split'` — a future toggle to
   * split mode will pick the user's choice back up.
   *
   * No-op before `prepareAudio` has run; the stage state will be
   * applied via the bus's defaults the next time gameplay mounts.
   */
  public setAudioCompressorStageEnabled(stage: CompressorStage, enabled: boolean): void {
    this.audioBus?.setStageEnabled(stage, enabled);
  }

  /**
   * Begins recording the play scene (canvas video + bus audio
   * mix) into a WebM Blob. Throws when `prepareAudio` hasn't
   * finished setting up the audio context yet, or when the
   * browser doesn't expose `MediaRecorder` /
   * `canvas.captureStream` / a usable codec — UI hosts should
   * surface these failures to the user (the codec case is
   * common on older Safari).
   *
   * Idempotent in the sense that calling while a recording is
   * already active is a no-op (`isRecording()` is the canonical
   * gate hosts should check).
   */
  public startRecording(): void {
    if (this.recorder?.isActive()) return;
    if (!this.host || !this.audioContext || !this.audioBus) {
      throw new Error('PixiGameplayView.startRecording: gameplay audio is not ready yet');
    }
    // Recreate the recorder per session — instances are one-shot
    // by design (chunk buffer + audio tap lifecycle), so the
    // host gets a clean blob on every start.
    this.recorder = new GameplayRecorder({
      canvas: this.host.app.canvas,
      audioContext: this.audioContext,
      audioOutput: this.audioBus.outputNode,
    });
    this.recorder.start();
  }

  /**
   * Ends the active recording and resolves with the assembled
   * Blob plus its MIME type / duration. Resolves with
   * `undefined` when no recording is in progress, so callers
   * can call this unconditionally on chart end / unmount.
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

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    // Cancel our own rAF (the gameplay tick loop). The shared
    // `Application` and its ticker keep running for the next active
    // scene — only the per-scene state below is freed.
    if (this.frame !== undefined) {
      cancelAnimationFrame(this.frame);
      this.frame = undefined;
    }
    // Detach window-level event listeners so a stray keypress
    // doesn't hit a disposed view.
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
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
    if (this.loadCompleteTimerHandle !== undefined) {
      window.clearTimeout(this.loadCompleteTimerHandle);
      this.loadCompleteTimerHandle = undefined;
    }
    if (this.gaugeIncreaseTimeout !== undefined) {
      window.clearTimeout(this.gaugeIncreaseTimeout);
      this.gaugeIncreaseTimeout = undefined;
    }
    if (this.exitFadeOutHandle !== undefined) {
      window.clearTimeout(this.exitFadeOutHandle);
      this.exitFadeOutHandle = undefined;
    }
    if (this.exitCloseHandle !== undefined) {
      window.clearTimeout(this.exitCloseHandle);
      this.exitCloseHandle = undefined;
    }
    if (this.chartEndTimeout !== undefined) {
      window.clearTimeout(this.chartEndTimeout);
      this.chartEndTimeout = undefined;
    }
    for (const timeout of this.keyFlashTimeouts) {
      window.clearTimeout(timeout);
    }
    this.keyFlashTimeouts.clear();
    log.info('listeners detached');
    // Pause every BGA video BEFORE we touch textures. The Pixi
    // `VideoSource` wrapping each video registers a
    // `requestVideoFrameCallback` that re-uploads frames into the
    // GL texture as they decode — leaving those callbacks in
    // flight while we destroy the textures throws inside the GL
    // texture system. Pausing also revokes the Blob URL so the
    // underlying buffer can be released.
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
    // Hard-stop any active recording before tearing down the bus.
    // `GameplayRecorder.dispose` calls `MediaRecorder.stop()`
    // synchronously (no chunk-flush wait) and disconnects its
    // audio tap from the bus's output node, so the bus can be
    // disposed cleanly afterwards.
    this.recorder?.dispose();
    this.recorder = undefined;
    // Tear down the bus before closing the AudioContext so its
    // `disconnect()` calls don't race with context shutdown. The bus
    // doesn't own the AudioContext itself; closing that is the next
    // step.
    this.audioBus?.dispose();
    this.audioBus = undefined;
    void this.audioContext?.close();
    // Detach our subtree from the host's stage. The host owns the
    // `Application` lifetime; we just stop contributing to its
    // scene graph. The sceneRoot Container itself stays alive in
    // case the host wants to re-enter the same view (we don't, but
    // it's harmless).
    if (this.sceneRoot.parent) {
      this.sceneRoot.parent.removeChild(this.sceneRoot);
    }
    // Free per-view textures. Order matters: textures BEFORE we
    // destroy the sceneRoot / sprites, because `Texture.destroy()`
    // emits a `styleChange` event that traverses up to the live
    // `GlTextureSystem` (still alive on the shared host). With our
    // sprites still parented to sceneRoot, the events route
    // correctly.
    try {
      destroyUniqueTextures([
        ...this.textures.values(),
        ...this.bgaTextures.values(),
        ...this.bgaLayerTextures.values(),
        this.bombTexture,
      ]);
      this.textures.clear();
      this.bgaTextures.clear();
      this.bgaLayerTextures.clear();
      this.bombTexture = undefined;
    } catch (error) {
      log.warn('texture cleanup threw', error);
    }
    // Destroy our scene-graph subtree. With the shared host pattern
    // we never call `app.destroy` here — that would nuke the canvas
    // and the select scene would lose its rendering target.
    try {
      this.sceneRoot.destroy({ children: true });
    } catch (error) {
      log.warn('sceneRoot.destroy threw', error);
    }
    this.host = undefined;
  }

  private prepareSong(song: BrowserSongEntry): void {
    // Resolve `#RANDOM` / `#SETRANDOM` / `#SWITCH` control flow first
    // so every play-time consumer below sees the same chosen branches.
    // `Math.random` is the random source (LR2 re-rolls each play) —
    // for deterministic playback (replays, tests) the host can swap
    // this for a seeded PRNG later.
    const resolved = resolveBmsControlFlow(song.chart, { random: Math.random });
    this.resolvedChart = resolved;
    const extracted = extractTimedNotes(resolved, {
      includeLandmine: true,
      // Always extract the invisible / keysound array even when the
      // overlay is off — so the lil-gui toggle can flip the
      // visualisation on mid-song without a chart restart. The cost
      // is purely memory (one sorted array of 3x / 4x events); the
      // per-frame render loop is gated on `showInvisibleNotes` and
      // bails immediately when the flag is off.
      includeInvisible: true,
      inferBmsLnTypeWhenMissing: true,
    });
    this.notes = extracted.playableNotes
      .map((note) => ({ ...note, hit: false }))
      .sort((left, right) => left.beat - right.beat || left.seconds - right.seconds);
    this.mineNotes = extracted.landmineNotes
      .map((note) => ({ ...note, hit: false }))
      .sort((left, right) => left.beat - right.beat || left.seconds - right.seconds);
    this.invisibleNotes = extracted.invisibleNotes
      .slice()
      .sort((left, right) => left.beat - right.beat || left.seconds - right.seconds);
    // DP FLIP — swap 1P / 2P channels in place. Cheap O(n) walk
    // because we already iterate `notes` for sorting; SP charts
    // skip every entry (no `2x` channels exist). Mine notes are
    // flipped together so they stay anchored to the same visual
    // lane after the flip.
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
    // RANDOM / MIRROR / S-RANDOM / SCATTER — shuffle the 1P / 2P
    // keyboard lanes independently. Scratch (channels 16 / 26)
    // never moves. Per LR2 convention, the shuffle is drawn at
    // chart-prepare time so a single play session has a stable
    // arrangement (F5-restart re-rolls it). Mine channels are
    // included in the same shuffle pass so a mine on lane 4 lands
    // wherever the shuffle moved lane 4 — keeping the mine's
    // visual relationship to the surrounding chord intact.
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
    this.maxLongNoteBeatSpan = this.notes.reduce((max, note) => {
      if (note.endBeat === undefined) {
        return max;
      }
      return Math.max(max, Math.max(0, note.endBeat - note.beat));
    }, 0);
    this.chartLastNoteEndSeconds = this.notes.reduce((acc, note) => Math.max(acc, note.endSeconds ?? note.seconds), 0);
    this.songDurationSeconds = this.chartLastNoteEndSeconds;
    this.remainingNotes = this.notes.length;
    this.autoJudgeCursor = 0;
    this.autoMissCursor = 0;
    this.chartEnded = false;
    // Drop the previous chart's active-sample tracking. Stale
    // entries would otherwise let a `c=true` note on the new
    // chart suppress its own first trigger because a same-key
    // node from the old play looks "still playing" until it
    // ends naturally.
    this.activeSampleNodes.clear();
    // Drop any held LN state from a previous song / restart. Without
    // this the next chart's first release on a cleared channel would
    // try to finalize the prior chart's hold and double-commit.
    this.activeLongNotes.clear();
    // Reset the turntable physics so the disc starts each chart at
    // angle 0, spinning at baseline. Without this, F5-restarting
    // mid-spin would leave the new play's first visible frame at a
    // random angle (or with a residual brake / forward state if
    // the player had just scratched at song-end), and the alternation
    // streak from the prior play would carry into the new song's
    // first press.
    this.turntableAngle = { '1': 0, '2': 0 };
    this.turntableVelocity = {
      '1': PixiGameplayView.TURNTABLE_BASELINE_RAD_PER_SEC,
      '2': PixiGameplayView.TURNTABLE_BASELINE_RAD_PER_SEC,
    };
    this.turntableNextSign = { '1': -1, '2': -1 };
    this.turntableLastImpulseAt = { '1': Number.NEGATIVE_INFINITY, '2': Number.NEGATIVE_INFINITY };
    this.turntableLastUpdateAt = 0;
    // PMS / 9 KEY (Pop'n) charts route channel `17` (and the
    // PMS-STD `22..25` block) as lane notes — `resolveLaneChannels`
    // would otherwise filter `17` out as FREE ZONE under the IIDX
    // default ordering. Hand it the chart variant so the lane set
    // matches what the LR2 default `play_9.lr2skin` expects.
    this.chartPlayVariant = resolveChartPlayVariant(song);
    this.laneChannels = resolveLaneChannels(this.notes, this.chartPlayVariant);
    this.score = createEmptyScore(this.notes.filter((note) => isPlayableInputChannel(note.channel)).length);
    this.tracker = createScoreTracker();
    // Reset the result-screen "MAX COMBO" tracker whenever a fresh
    // chart is prepared — restart (R), song-pick from select, etc.
    // Otherwise the previous play's max would leak into the new one.
    this.maxCombo = 0;
    // Wipe per-side judge / combo snapshots so a fresh chart
    // doesn't briefly paint the previous play's verdict on its
    // first frame (the `until` chart-time is in the previous
    // chart's coordinate system; comparing it to the new chart's
    // `currentSeconds()` would render stale state until the new
    // play crosses that mark).
    this.lastJudge = '';
    this.lastJudgeUntil = 0;
    this.judgeSideState = {
      '1P': { judge: '', until: 0, combo: 0 },
      '2P': { judge: '', until: 0, combo: 0 },
    };
    // Result-screen polyline histories. Seeding waits until after
    // `gaugeState` is reinitialised below — at this point we'd still
    // be reading the **previous** play's gauge value.
    this.gaugeHistory = [];
    this.scoreHistory = [];
    const resolver = createTimingResolver(resolved);
    this.timingResolver = resolver;
    // Build a STOP-aware seconds→beat resolver for `currentBeat`.
    this.beatAtSeconds = createBeatAtSecondsResolverFromTimingResolver(resolver);
    // Build the #SCROLL / #SPEED distance integrator. Skipped when
    // the chart has no such events, so the common case stays on the
    // plain beat-diff path with no extra cost.
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
    this.autoTriggerNextIndex = 0;
    // BMS dynamic volume — channels `97` (BGM bus) and `98`
    // (key bus). hitkey BMS Memo encodes the value as a
    // hex-style 2-digit pair where `01..FF` maps to 1/255..1.0
    // gain. Mirror the CLI's `collectRealtimeAudioVolumeEvents`
    // gate (BMS source format only) so bmson charts (which use
    // their own per-channel routing) don't get treated as BMS
    // volume events.
    this.volumeChangeEvents =
      resolved.sourceFormat === 'bms'
        ? sortEvents(resolved.events)
            .filter((event) => isBmsDynamicVolumeChangeChannel(event.channel))
            .flatMap<{ seconds: number; bus: 'key' | 'bgm'; gain: number }>((event) => {
              const gain = parseBmsDynamicVolumeGain(event.value);
              if (gain === undefined) return [];
              const bus = isBmsKeyVolumeChangeChannel(event.channel)
                ? 'key'
                : isBmsBgmVolumeChangeChannel(event.channel)
                  ? 'bgm'
                  : undefined;
              if (!bus) return [];
              const seconds = Math.max(0, resolver.eventToSeconds(event));
              return [{ seconds, bus, gain }];
            })
            .sort((left, right) => left.seconds - right.seconds)
        : [];
    this.volumeChangeCursor = 0;
    // bmson 1.0.0 slicing — for bmson charts, each
    // `sound_channels[]` entry is a single audio file that gets
    // sliced at every distinct pulse where any of its notes fire,
    // and each note plays its assigned slice (`audio_offset` ..
    // `audio_offset + slice_duration`) instead of the whole WAV
    // from t=0. The audio-renderer already computes the per-event
    // slice playback table; we wire it up here so the playable-
    // note path (`playSample`) can look up the offset / duration
    // by event identity at trigger time. BMS / json charts skip
    // the build (the map stays undefined) since they have no
    // slicing semantics — every note plays its WAV from the
    // start.
    this.bmsonSlicePlayback =
      resolved.sourceFormat === 'bmson'
        ? createBmsonSamplePlaybackMap(
            resolved,
            resolver,
            [...this.notes, ...this.mineNotes, ...this.invisibleNotes].map((note) => note.event),
            beatResolver,
          )
        : undefined;
    this.songDurationSeconds = Math.max(this.chartLastNoteEndSeconds, this.autoSampleTriggers.at(-1)?.seconds ?? 0);
    // BMS spec — `#BASEBPM N` declares the chart's reference
    // BPM for HS-FIX calibration. The shared
    // `resolveChartReferenceBpm` helper prefers `#BASEBPM` over
    // the chart's initial `#BPM` so a chart whose `#BPM` is its
    // peak / average rather than its scroll-feel reference still
    // calibrates at the speed the author intended; falls back to
    // the parsed `metadata.bpm` and finally the song-list BPM
    // hint when neither is present.
    this.applyHsFix(resolver, resolveChartReferenceBpm(resolved, this.song?.bpm));
    // Initialize gauge with the actual playable-note count and the
    // chart's #TOTAL value so PG/GR gain matches LR2: a long chart
    // with TOTAL=300 and 1000 notes gets +0.3 per PG/GR, while a
    // short TOTAL=160 100-note chart gets +1.6 per PG/GR.
    const playableNoteCount = this.notes.filter((note) => isPlayableInputChannel(note.channel)).length;
    this.gaugeState = createGrooveGaugeState(
      playableNoteCount,
      resolved.metadata.total,
      this.options.gauge ?? 'GROOVE',
    );
    // Reset the peak-hold meter so the new chart starts with the
    // peak indicator pinned to the gauge's seeded starting value
    // (LR2 default 20 %) — the prior play's residual peak would
    // otherwise hang above the gauge for ~1 s after restart.
    this.gaugePeak = this.gaugeState.current;
    this.gaugePeakUpdatedAt = 0;
    this.gaugePeakLastTickAt = 0;
    // Now that the gauge has its starting value (LR2 default 20 %),
    // seed the polyline history so the result-screen graph starts at
    // the correct origin instead of the first judge's value.
    this.gaugeHistory.push({ progress: 0, value: this.gaugeState.current });
    this.scoreHistory.push({ progress: 0, exScore: 0 });
    this.fastCount = 0;
    this.slowCount = 0;
    this.fullComboFired = false;
    this.displayedScore = 0;
    this.bgaTimeline = buildBgaTimeline(resolved, resolver);
    // BMS spec — when `#POORBGA` is unset but `#BMP00` exists,
    // BMP00 becomes the implicit POOR placeholder until an
    // explicit `#xxx06` cue fires. Mirrors the TUI BGA
    // renderer's `poorFallbackKey` so the web side stops
    // showing a black POOR plate on misses for charts that
    // rely on this convention.
    const poorBmp00 = resolved.resources.bmp['00'];
    const shouldUsePoorBmp00Fallback =
      typeof resolved.bms.poorBga !== 'string' && typeof poorBmp00 === 'string' && poorBmp00.length > 0;
    this.poorBgaFallbackKey = shouldUsePoorBmp00Fallback ? '00' : undefined;
    this.poorBgaFallbackUntilSeconds = this.bgaTimeline.poor[0]?.seconds ?? Number.POSITIVE_INFINITY;
    this.hasBga =
      this.bgaTimeline.base.length > 0 || this.bgaTimeline.layer.length > 0 || this.bgaTimeline.poor.length > 0;
    this.initializeRuntimeOps();
  }

  /**
   * Locates the song's current beat from `currentSeconds` using the BPM-aware
   * tempo points. Required because BMS charts can change tempo mid-song
   * (`#BPM` events) — using the initial BPM alone makes notes after a tempo
   * change drift visibly out of sync with the audio.
   */
  /** True while the wall-clock playhead is still inside the intro buffer. */
  private isIntroPlaying(): boolean {
    if (this.startTime === 0) {
      return true;
    }
    return performance.now() < this.startTime;
  }

  private currentBeat(seconds: number): number {
    // Prefer the proper STOP-aware resolver (built once per song in
    // `prepareSong`). Falls back to a flat-BPM extrapolation when the
    // resolver isn't ready yet (very early frames during mount).
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
   * Applies an LR2 NORMAL-gauge judge to the current state. Accepts
   * `EMPTY_POOR` for input-on-empty-lane mispresses (-2 to gauge).
   *
   * Also drives the LR2 1P-side gauge-rise (timer 42) and gauge-
   * max (timer 44) timers off the before/after diff so authored
   * skin elements (rise sparkle, max-glow overlay) animate at
   * the right moment. 2P-side timers (43 / 45) wait for DP
   * gauge support.
   */
  private applyGaugeDelta(judge: GrooveGaugeJudgeKind): void {
    const previous = this.gaugeState.current;
    applyGrooveGaugeJudge(this.gaugeState, judge);
    const next = this.gaugeState.current;
    if (next > previous) {
      // Gauge increase — stamp timer 42 (1P rise) and schedule a
      // deferred clear at the skin's authored span (or the
      // fallback). Re-stamping is the natural behaviour for back-
      // to-back increases: cancel the in-flight cleanup so the
      // flash restarts cleanly each time.
      if (this.gaugeIncreaseTimeout !== undefined) {
        window.clearTimeout(this.gaugeIncreaseTimeout);
        this.gaugeIncreaseTimeout = undefined;
      }
      this.timerStartedAt.set(42, this.playClock());
      const fadeMs = this.gaugeTimerDurationMs.get(42) ?? GAUGE_INCREASE_FALLBACK_MS;
      this.gaugeIncreaseTimeout = window.setTimeout(() => {
        this.gaugeIncreaseTimeout = undefined;
        if (this.disposed) return;
        this.timerStartedAt.delete(42);
      }, fadeMs);
    }
    if (next >= 100 && previous < 100) {
      // Gauge crossed into max territory — fire timer 44 so any
      // skin-authored "ゲージ MAX" overlay starts cycling.
      this.timerStartedAt.set(44, this.playClock());
    } else if (next < 100 && previous >= 100) {
      // Dropped back below max; the max overlay is no longer
      // applicable. Per LR2 spec the timer should re-fire from
      // t=0 the next time we hit 100 %, which the branch above
      // already handles.
      this.timerStartedAt.delete(44);
    }
  }

  /** Reset runtime DST-op state to a sensible default for a play session. */
  private initializeRuntimeOps(): void {
    this.runtimeOps.clear();
    // CUSTOMOPTION defaults declared by the loaded skin.
    this.options.skin?.customOptions.forEach((option) => this.runtimeOps.add(option.defaultOp));
    // Static-ish play-session ops that are conventionally true while gameplay runs.
    const defaults = [
      5, // selected bar is playable
      34, // ghost off
      // ops 38 / 39 (scoregraph off / on) — set dynamically below
      // from `options.scoreGraph`.
      // ops 40 / 41 (BGA off / on) — set dynamically below from
      // `options.bga` so the runtime gating matches the live setting.
      // ops 42 / 43 (1P normal / 赤 gauge), 44 / 45 (2P) — set
      // dynamically below from `options.gauge`.
      47, // difficulty filter disabled
      50, // offline
      52, // EXTRA MODE OFF — gates wallpaper / decoration elements in
      // the LR2 default skin family. Op 53 is the EXTRA MODE ON
      // variant; we never enable EXTRA MODE in the web build.
      // ops 54 / 55 (autoscratch 1P off / on), 56 / 57 (autoscratch
      // 2P off / on) — set dynamically below from
      // `options.autoScratch1P / 2P`.
      61, // score saveable
      81, // load complete
      82, // replay off
      174, // attached text absent
      178, // RANDOM absent
      182, // judge normal
      196, // replay absent
    ];
    defaults.forEach((op) => this.runtimeOps.add(op));
    // Autoscratch 1P / 2P (54 / 55, 56 / 57).
    this.runtimeOps.add(this.options.autoScratch1P ? 55 : 54);
    this.runtimeOps.add(this.options.autoScratch2P ? 57 : 56);
    // Gauge type — HARD / DEATH map to the LR2 "red" gauge ops
    // (43 / 45); GROOVE / EASY share the normal branch (42 / 44).
    const isRedGaugeOp = this.options.gauge === 'HARD' || this.options.gauge === 'DEATH';
    this.runtimeOps.add(isRedGaugeOp ? 43 : 42);
    this.runtimeOps.add(isRedGaugeOp ? 45 : 44);
    // Score graph (38 / 39).
    this.runtimeOps.add(this.options.scoreGraph ? 39 : 38);
    // BGA on/off (40 / 41). With AUTOPLAY_ONLY we mirror LR2: the
    // BGA is "on" only when autoplay is also engaged.
    const bgaMode = this.options.bga ?? 'ON';
    const bgaActive = bgaMode === 'ON' || (bgaMode === 'AUTOPLAY_ONLY' && this.options.autoPlay);
    this.runtimeOps.add(bgaActive ? 41 : 40);
    // op 32 = autoplay off, op 33 = autoplay on (mutually exclusive).
    this.runtimeOps.add(this.options.autoPlay ? 33 : 32);
    // Keymode op (160=7keys / 161=5keys / 162=14keys / 163=10keys / 164=9keys)
    // — derived from the chart's actual lane usage so 5K-only charts get
    // the LR2 default skin's "DISABLE LANE" overlay on keys 6 & 7.
    this.runtimeOps.add(this.resolveKeymodeOp());
    // Long-note presence flag (172 = absent, 173 = present).
    const hasLongNotes = this.notes.some((note) => note.endBeat !== undefined);
    this.runtimeOps.add(hasLongNotes ? 173 : 172);
    // BPM change presence flag (176 = absent, 177 = present).
    const hasBpmChanges = (this.timingResolver?.tempoPoints.length ?? 0) > 1;
    this.runtimeOps.add(hasBpmChanges ? 177 : 176);
    // BGA presence flag (170 = absent, 171 = present). Drives the LR2
    // default skin's BGA-frame visibility — without 171 the borders and
    // per-side gating fail to switch on.
    this.runtimeOps.add(this.hasBga ? 171 : 170);
    // Resource-presence flags (per LR2 spec — see `dst_option` table
    // in `docs/LR2SkinHelp.md`):
    //   190 / 191 = STAGEFILE absent / present
    //   192 / 193 = BANNER    absent / present
    //   194 / 195 = BACKBMP   absent / present
    // The previous revision swapped these — it set 191 (=present) any
    // time a chart was loaded, regardless of whether `#STAGEFILE` was
    // actually defined, while leaving 190 (=absent) unset. Drive both
    // halves dynamically from the chart's metadata so skin elements
    // gated on either branch render correctly.
    const meta = this.song?.chart.metadata;
    this.runtimeOps.add(meta?.stageFile ? 191 : 190);
    this.runtimeOps.add(meta?.banner ? 193 : 192);
    this.runtimeOps.add(meta?.backBmp ? 195 : 194);
    // BGA size: op 30 = normal, op 31 = extend. Defer to the
    // CUSTOMOPTION default if the skin already declared one (rare —
    // most skins leave this to the runtime); otherwise pick from
    // `options.bgaSize` so the LR2 panel-1 BGA size toggle
    // (`#SRC_BUTTON,type=73`) is honoured.
    if (!this.runtimeOps.has(30) && !this.runtimeOps.has(31)) {
      this.runtimeOps.add(this.options.bgaSize === 'EXTEND' ? 31 : 30);
    }
  }

  /**
   * Detects the chart's effective LR2 keymode op from its lane usage and
   * the player option. Mirrors `resolveChartPlayVariant`'s mapping
   * (which already drives skin selection) but emits the LR2
   * `dst_option` numbers instead of the string variant id:
   *
   *   - PMS / 9 KEY → 164
   *   - DP 14 KEY  → 162
   *   - DP 10 KEY  → 163
   *   - SP 7 KEY   → 160
   *   - SP 5 KEY   → 161
   */
  private resolveKeymodeOp(): number {
    if (this.chartPlayVariant === '9') {
      return 164; // 9keys (Pop'n / PMS)
    }
    const usesPlayer2 = this.laneChannels.some((channel) => channel.startsWith('2'));
    const uses6or7 = this.laneChannels.some(
      (channel) => channel === '18' || channel === '19' || channel === '28' || channel === '29',
    );
    if (usesPlayer2) {
      return uses6or7 ? 162 : 163; // 14keys vs 10keys
    }
    return uses6or7 ? 160 : 161; // 7keys vs 5keys
  }

  private isOpActive(op: number): boolean {
    if (op === 0) {
      return true;
    }
    if (op === 999) {
      return false;
    }
    return this.runtimeOps.has(op);
  }

  private evaluateOps(ops: ReadonlyArray<number>): boolean {
    for (const op of ops) {
      if (op > 0) {
        if (!this.isOpActive(op)) {
          return false;
        }
      } else if (this.isOpActive(-op)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Returns whether the given LR2 timer id is "running" right now.
   *
   * LR2 attaches every `#DST_*` to a base timer (`timer=N` argument) and the
   * destination is only meant to be visible while that timer is actively
   * counting up. During gameplay only a small subset of timers run -- in
   * particular `0` (main, scene start) and `41` (play start). Result/fadeout/
   * close timers (`2`, `3`, `90`, `91`, ...) are dormant and their attached
   * DSTs (e.g. "STAGE FAILED" plates) should not appear on the play field.
   */
  /**
   * Milliseconds elapsed since the given LR2 timer started counting. Used to
   * advance both `cycle`-based SRC animations and `loop`-based DST keyframe
   * playback. For "always-on" timers (0, 40, 41) we anchor to the play
   * session start; for explicit timers (50–69, 100–119) we use the recorded
   * `timerStartedAt` time.
   */
  private elapsedSinceTimer(timer: number): number {
    // Judge timers (46 = 1P, 47 = 2P) restart on every judgement so the
    // attached NOWJUDGE / NOWCOMBO keyframe chain replays per hit. We use
    // the recorded timestamp when present, falling back to scene start so
    // the slot doesn't go invisible before the first judgement happens.
    if (timer === 46 || timer === 47) {
      const judgedAt = this.timerStartedAt.get(timer);
      const now = this.playClock();
      if (judgedAt !== undefined) {
        return Math.max(0, now - judgedAt);
      }
      return Math.max(0, now - this.sceneStartTime);
    }
    // Timer 140 — リズムタイマー (rhythm timer). Per the LR2 skin
    // help: 「一拍を1000としたときのタイマーです」 — one beat
    // remaps to 1000 logical ms regardless of BPM. The LR2 default
    // 7-keys skin's lane-bottom aura keyframes (`#SRC_IMAGE,...,
    // y=2007` at `#DST_IMAGE,...,33,286,194,29,...,0,140,...`) ride
    // this timer so the glow pulses bright on every beat boundary
    // and fades over the rest of the beat. We map the chart's
    // current beat fractional part to that 0..1000 window so the
    // pulse stays beat-locked under soflan, hi-speed change, and
    // STOP — anything that bends the seconds→beats relationship is
    // already absorbed by `currentBeat`.
    if (timer === 140) {
      if (!this.song) return 0;
      const beat = this.currentBeat(this.currentSeconds());
      if (!Number.isFinite(beat) || beat < 0) return 0;
      const fraction = beat - Math.floor(beat);
      return fraction * 1000;
    }
    // Explicit seed wins. `mount()` seeds the LR2 scene-stage
    // timers (0 / 1 / 40 / 41) based on the skin's
    // `#STARTINPUT` / `#LOADSTART` / `#LOADEND` / `#PLAYSTART`
    // directives, so anchored keyframes animate from the right
    // moment. NO fallback for unsigned 40 / 41 here: a
    // pre-fire fallback would make the title plate / loading
    // ring (anchored to timer 40 in the LR2 default skin) start
    // ticking from scene mount instead of from `READY`, jumping
    // backwards once the deferred seed lands and producing the
    // "title appears at the wrong time" symptom. Timer 0 is
    // always seeded immediately at mount, so it doesn't need a
    // fallback either.
    const started = this.timerStartedAt.get(timer);
    if (started !== undefined) {
      return Math.max(0, this.playClock() - started);
    }
    return 0;
  }

  private isTimerActive(timer: number): boolean {
    // Explicit seed = active. Scene-stage timers (0 / 1 / 40 /
    // 41) are seeded by `mount()` based on the skin's LR2
    // timing directives, so checking `timerStartedAt` here
    // honours their actual fire moment — e.g. timer 40
    // (READY) stays inactive until `#LOADSTART + #LOADEND` ms
    // have elapsed, and the LR2 default skin's title plate +
    // loading ring (anchored to timer 40) only paint from
    // that moment onward, just as the LR2 reference video
    // shows them appearing mid-intro rather than at scene
    // mount.
    if (this.timerStartedAt.has(timer)) {
      return true;
    }
    // Judgement display timers (1P/2P). LR2 fires these on every judgement so
    // the attached NOWJUDGE/NOWCOMBO destinations animate from time=0. We don't
    // model the timer instant directly -- our `lastJudge` window already gates
    // the rendering -- so we simply mark them as always active and rely on the
    // higher-level renderer to draw only while a judgement is fresh.
    if (timer === 46 || timer === 47) {
      return true;
    }
    // Timer 140 — リズムタイマー. Beat-locked, but suppressed
    // during the LR2 LOADING → DONE intro window so the lane-
    // bottom aura keyframes stay invisible until notes actually
    // start scrolling. Without this gate the glow would already
    // be pulsing in the empty playfield while the title plate /
    // ring chrome is still sliding in. `isIntroPlaying()` is the
    // same gate that hides falling notes / measure lines, so
    // pinning the aura to it lines up with the "the chart has
    // started" moment users perceive.
    if (timer === 140) {
      return this.song !== undefined && !this.isIntroPlaying();
    }
    // Bomb (50-69) and key-on (100-119) timers are tracked explicitly via
    // `timerStartedAt`. They become active the moment we record a start time
    // and stay active until `releaseKeyOnTimer`'s deferred clean-up retires
    // the entry (key-on) or the bomb's animation cycle finishes (bomb).
    //
    // Full-combo timers (48 = 1P, 49 = 2P) are tracked the same way:
    // `maybeFireFullCombo` stamps them once when the player's combo
    // hits the chart's note count, and elements anchored to those
    // timers (the `Play/fullcombo/...` skin graphic) read the
    // running elapsed time afterward to slide in / fade out per the
    // skin's keyframe chain.
    if (
      (timer >= 42 && timer <= 45) ||
      timer === 48 ||
      timer === 49 ||
      (timer >= 50 && timer <= 69) ||
      (timer >= 70 && timer <= 89) ||
      (timer >= 100 && timer <= 119)
    ) {
      // All explicitly-seeded timer ranges share the same gating:
      // active iff `timerStartedAt` has an entry. Gauge rise /
      // max (42..45) are stamped by `applyGaugeDelta`, LN-hold
      // (70..89) by `startLnHoldTimer`, bombs (50..69) /
      // key-on (100..119) by their own helpers, FC (48 / 49) by
      // `maybeFireFullCombo`. Without an entry the slot stays
      // hidden.
      return this.timerStartedAt.has(timer);
    }
    return false;
  }

  private isDestinationVisible(destination: Lr2DestinationRect): boolean {
    if (!this.isTimerActive(destination.timer)) {
      return false;
    }
    return this.evaluateOps(destination.ops);
  }

  private async prepareSkin(): Promise<void> {
    if (!this.options.skin) {
      return;
    }
    const skin = this.options.skin;
    // Load LR2 bitmap fonts in parallel with the texture preload —
    // they go through their own loader, so we don't need to await
    // the result here. The renderer falls back to the system font
    // for any font index that isn't ready yet.
    void loadSkinBitmapFonts(skin.lr2FontPaths, skin.files).then((loaded) => {
      if (this.disposed || this.options.skin !== skin) return;
      this.bitmapFonts = loaded;
    });
    // Compute the FC animation duration from the skin's keyframes.
    // Walk every element type that can be anchored to a timer and
    // pick the longest keyframe time across those whose `timer` is
    // 48 (1P FC) or 49 (2P FC). `cleanupFullComboTimer` later uses
    // this value to retire timer 48 / 49 once the animation has
    // played out, matching the bomb-cleanup pattern.
    this.fullComboDurationMs = computeFullComboDurationMs(skin);
    // Pre-compute lane-laser release fade durations from the
    // skin's key-on (`100..117`) keyframes so `releaseKeyOnTimer`
    // / `renderSkinImage` decay each lane at its authored speed
    // instead of a hard-coded 120 ms.
    this.keyOnFadeDurationMs.clear();
    for (const [timerId, span] of computeKeyOnFadeDurationsMs(skin)) {
      this.keyOnFadeDurationMs.set(timerId, span);
    }
    // Same idea for the bomb-explosion timers (50..69).
    // `cleanupBombTimers` retires the active bomb entries once the
    // skin's authored keyframe span has elapsed, so charts that
    // ship a longer (or shorter) explosion animation match.
    this.bombDurationMs.clear();
    for (const [timerId, span] of computeBombDurationsMs(skin)) {
      this.bombDurationMs.set(timerId, span);
    }
    // LN-hold-effect timer (70-89) keyframe spans — `releaseLnHoldTimer`
    // uses these to fade authored sustain-glow visuals out at the
    // skin's pace when the hold ends.
    this.lnHoldFadeDurationMs.clear();
    for (const [timerId, span] of computeLnHoldDurationsMs(skin)) {
      this.lnHoldFadeDurationMs.set(timerId, span);
    }
    // Gauge rise / max timers (42..45). The "rise" entries drive
    // `applyGaugeDelta`'s flash retirement; the "max" entries are
    // kept just for symmetry with the other timer-derived maps.
    this.gaugeTimerDurationMs.clear();
    for (const [timerId, span] of computeGaugeTimerDurationsMs(skin)) {
      this.gaugeTimerDurationMs.set(timerId, span);
    }
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
        if (this.disposed) {
          return;
        }
        // LR2 special graphics (`gr=100..111`) point at runtime-bound
        // textures, not files in the skin bundle. Skip them here and
        // load them via `prepareChartGraphics()` below.
        if (isLr2SpecialGraphic(path)) {
          return;
        }
        const texture = await this.loadSkinAssetTexture(skin, path);
        if (texture) {
          if (this.disposed) {
            texture.destroy(true);
            return;
          }
          this.textures.set(path, texture);
        }
      }),
    );
    if (this.disposed) {
      return;
    }
    const bombFile = skin.customFiles.find((file) => file.name === 'BOMB');
    if (bombFile) {
      const texture = await this.loadSkinAssetTexture(skin, bombFile.path);
      if (this.disposed) {
        texture?.destroy(true);
        return;
      }
      this.bombTexture = texture;
    }
    // Invisible-note overlay sprite. Pulls index 3 from the
    // dedicated `invisibleNoteSkin` (Pop'n's green wide note in
    // the LR2 default `play_9.lr2skin` POP layout) and asks
    // *that* skin's bundled file map for the bytes — for LR2
    // default themes this resolves to the same `frame.tga` the
    // active skin already uses, so the texture cache key is
    // shared. Themes that ship a per-variant atlas instead get
    // an extra entry under a distinct key.
    const invisibleNoteSrc = this.options.invisibleNoteSkin?.notes.note?.[3];
    if (invisibleNoteSrc?.imagePath && !this.textures.has(invisibleNoteSrc.imagePath)) {
      const texture = await this.loadSkinAssetTexture(this.options.invisibleNoteSkin!, invisibleNoteSrc.imagePath);
      if (this.disposed) {
        texture?.destroy(true);
        return;
      }
      if (texture) {
        this.textures.set(invisibleNoteSrc.imagePath, texture);
      }
    }
    if (this.disposed) {
      return;
    }
    // Chart-side `#STAGEFILE` / `#BACKBMP` / `#BANNER`. These are
    // referenced by skin elements via `gr=100/101/102`; they live in
    // the chart bundle (next to the .bms file), not the skin bundle.
    await this.prepareChartGraphics();
  }

  /**
   * Loads the chart's `#STAGEFILE` / `#BACKBMP` / `#BANNER` images
   * into the skin texture map under their LR2 sentinel paths so the
   * existing `renderSkinImage` flow picks them up when a skin element
   * uses `gr=100`/`101`/`102`. Skipped for charts that don't declare
   * the corresponding metadata field (the runtime ops also flip to
   * `190`/`192`/`194` in that case so the skin's "absent" branch
   * handles the missing-asset path).
   */
  private async prepareChartGraphics(): Promise<void> {
    const song = this.song;
    const source = this.source;
    if (!song || !source) {
      return;
    }
    const meta = song.chart.metadata;
    const candidates: Array<{ key: Lr2SpecialGraphic; assetPath: string }> = [];
    if (meta.stageFile) {
      candidates.push({ key: LR2_SPECIAL_GRAPHIC.STAGEFILE, assetPath: meta.stageFile });
    }
    if (meta.backBmp) {
      candidates.push({ key: LR2_SPECIAL_GRAPHIC.BACKBMP, assetPath: meta.backBmp });
    }
    if (meta.banner) {
      candidates.push({ key: LR2_SPECIAL_GRAPHIC.BANNER, assetPath: meta.banner });
    }
    await Promise.all(
      candidates.map(async ({ key, assetPath }) => {
        // Song-bundle assets are stored as lazy `File` references
        // (only the theme bundle keeps eager bytes). Read on
        // demand so the at-rest heap stays at "parsed chart
        // metadata only" until the user actually starts a song.
        // Image-aware resolver so STAGEFILE / BANNER / BACKBMP
        // entries that ship the actual graphic with a different
        // extension (e.g. declared `.bmp` but bundled as `.png`)
        // still resolve.
        const entry = resolveChartImageAsset(source, song.chartPath, assetPath);
        const bytes = await loadAssetBytes(entry);
        if (!bytes) return;
        try {
          const texture = await loadTextureFromBytes(assetPath, bytes);
          if (texture) {
            if (this.disposed) {
              texture.destroy(true);
              return;
            }
            this.textures.set(key, texture);
          }
        } catch {
          // Decode failures are silently skipped — the skin's
          // "asset absent" branch (gated on op 190/192/194) takes over.
        }
      }),
    );
  }

  private loadSkinAssetTexture(skin: Lr2Skin, path: string): Promise<Texture | undefined> {
    // Delegates to the shared loader in `lr2-textures.ts`. For `.tga`
    // assets it routes through the bundled TGA decoder; everything else
    // goes via `createImageBitmap`. Honours the skin's `#TRANSCOLOR`.
    return loadSkinAssetTexture(skin, path);
  }

  private async prepareAudio(): Promise<void> {
    if (!this.source || !this.song) {
      return;
    }
    // `latencyHint: 'interactive'` asks the browser for the lowest
    // round-trip latency it can offer — at the cost of CPU
    // efficiency vs `'playback'`. For a rhythm game the trade-off
    // is right: keypress → sample audible delay is the player's
    // primary perception of "responsiveness", and we'd rather
    // burn a few extra cycles than land samples on a 20–30 ms
    // late. Browsers that don't honour the hint silently ignore it.
    this.audioContext = new AudioContext({ latencyHint: 'interactive' });
    // AudioContext starts in `suspended` state on most browsers
    // until a user gesture, and the *first* `node.start()` call on
    // a still-suspended context can sit in the queue for ~30ms while
    // the browser ramps the audio graph up. Calling `resume()` here
    // — we're inside the user-gesture chain that started the play
    // session — pre-warms it so the very first sample fires at
    // baseline latency. Errors (no-gesture / already-running) are
    // swallowed because both are harmless.
    void this.audioContext.resume().catch(() => undefined);
    // Surface the device-reported latency so the player has visibility
    // into how much "free" delay the audio stack is adding before our
    // schedule even begins. `baseLatency` is "how late the audio
    // graph commits a buffer" (driver / hardware buffer headroom);
    // `outputLatency` (when populated) tracks the OS audio queue.
    // Combined they form the floor of "press → hear" latency we
    // can't optimise away from JS.
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
    // Build the audio bus. See `audio-bus.ts` for the full
    // architecture; in short:
    //
    //   key sources    → keyMixer → keyComp ↘
    //                                          masterComp → makeup → destination   ('split')
    //   BGM sources    → bgmMixer → bgmComp ↗
    //
    // 'legacy' collapses both buses onto a single compressor; 'off'
    // bypasses every compressor stage. Sample sources always feed
    // `keyMixer` / `bgmMixer`, never directly to the destination,
    // so a mode switch never has to reconnect in-flight
    // `BufferSourceNode`s — important because hundreds of one-shots
    // come and go per second on dense charts.
    this.audioCompressorMode = this.options.audioCompressorMode ?? 'split';
    const initialMode: CompressorMode = this.options.audioCompressor === false ? 'off' : this.audioCompressorMode;
    this.audioBus = buildAudioBus(this.audioContext, initialMode, {
      initialStages: this.options.audioCompressorStages,
    });
    // Use the control-flow-resolved chart so #IF-gated #WAVxx
    // declarations match the chosen #RANDOM branch.
    const chart = this.resolvedChart ?? this.song.chart;
    // BMS spec — `#VOLWAV <0..ZZ>` declares the chart's master
    // volume scaling (100 = unity, 80 = 80 % loud, > 100 boosts).
    // Applying it here means every sample triggered for THIS chart
    // (key bus, BGM bus, every compressor mode) flows through the
    // single dedicated stage in the bus and the recorder captures
    // the post-`#VOLWAV` signal, matching the CLI renderer's
    // `resolveChartVolWavGain` behaviour. Charts that omit
    // `#VOLWAV` parse to `undefined` and are left at unity.
    const volWavRaw = chart.bms.volWav;
    if (typeof volWavRaw === 'number' && Number.isFinite(volWavRaw) && volWavRaw >= 0) {
      this.audioBus.setMasterGain(volWavRaw / 100);
    }
    // BMS spec: `#WAVxx` slot index is base-36 (`00..ZZ`), so a chart
    // can declare up to 1296 unique samples. An earlier revision
    // capped this preload at the first 256 entries, which silently
    // dropped audio for any sample referenced by a slot 100+ on
    // dense charts (a typical "Lunatic Crave"-tier chart easily
    // hits 500+ unique WAVs). The parser already enforces the
    // spec ceiling, so iterating every declared path here is safe;
    // memory on a fully-populated chart is at most ~1300 decoded
    // buffers, dominated by the underlying PCM rather than any
    // per-entry overhead.
    const wavPaths = Object.values(chart.resources.wav).filter((path): path is string => typeof path === 'string');
    // BMS spec — `#PATH_WAV <prefix>` declares a sub-directory
    // the chart's WAVs live under. The audio asset resolver
    // walks the prefixed form first when set so a chart
    // authored as `wav/` + bare `kick.wav` references resolves
    // the file as `wav/kick.wav`.
    const pathWavPrefix = typeof chart.bms.pathWav === 'string' ? chart.bms.pathWav : undefined;
    await Promise.all(
      wavPaths.map(async (path) => {
        if (this.disposed || !this.source || !this.song || !this.audioContext) return;
        // Audio-aware asset lookup: charts almost universally declare
        // `.wav` paths but archives often ship `.ogg` / `.mp3`. Try
        // the codec fallback chain (opus → ogg → mp3 → wav → original).
        // Audio entries are stored as lazy `File` references in
        // the source map (the drop pipeline defers their byte
        // load to keep gigabytes of WAV samples out of memory),
        // so `loadAssetBytes` is the unwrap step that actually
        // calls `arrayBuffer()` on demand for THIS chart.
        const entry = resolveChartAudioAsset(this.source, this.song.chartPath, path, {
          pathPrefix: pathWavPrefix,
        });
        const bytes = await loadAssetBytes(entry);
        if (this.disposed || !this.audioContext) return;
        if (!bytes) {
          return;
        }
        try {
          // Cache key is the chart-declared path (not the actually
          // loaded codec path) so `playSampleByKey` / `playSample`
          // continue to look up by the chart's `#WAV` value.
          const decoded = await this.audioContext.decodeAudioData(bytes.slice().buffer);
          if (this.disposed) return;
          this.decodedSamples.set(normalizePath(path).toLowerCase(), decoded);
        } catch {
          // Browsers vary in codec support; unsupported samples are skipped.
          // `decodeAudioData` also rejects when the AudioContext is
          // closed mid-decode (e.g. ESC pressed during loading) — the
          // catch swallows that as well so dispose can complete cleanly.
        }
      }),
    );
  }

  /**
   * Decodes every BMP resource referenced by the chart's BGA timelines
   * into a Pixi `Texture`, keyed by the same string the timeline cues
   * reference. Loads run in parallel so a long preamble doesn't gate the
   * playfield, and unsupported formats (video) are silently skipped.
   */
  private async prepareBga(): Promise<void> {
    const song = this.song;
    const source = this.source;
    if (!song || !source || !this.hasBga) {
      return;
    }
    // Partition the referenced BMP keys by which track(s) they appear in.
    // The base + POOR tracks share decode settings (no chroma key, since
    // they sit at the bottom of the BGA composite); the layer track gets
    // a black→transparent decode so the foreground can punch through.
    // Mirrors the per-mode load split in `packages/player/src/bga.ts`
    // (`baseKeys` / `poorKeys` use `mode: 'base'`; `layerKeys` /
    // `layer2Keys` use `mode: 'layer'`).
    const baseTrackKeys = new Set<string>();
    const layerTrackKeys = new Set<string>();
    for (const cue of [...this.bgaTimeline.base, ...this.bgaTimeline.poor]) {
      if (cue.bmpKey) baseTrackKeys.add(cue.bmpKey);
    }
    for (const cue of this.bgaTimeline.layer) {
      if (cue.bmpKey) layerTrackKeys.add(cue.bmpKey);
    }
    // Preload the BMP00 POOR fallback alongside the regular
    // POOR cues so the very first miss shows the placeholder
    // instantly instead of waiting for an on-demand decode.
    if (this.poorBgaFallbackKey) {
      baseTrackKeys.add(this.poorBgaFallbackKey);
    }
    // Build a map of `bmpKey → file path` covering both BMS-style ids and
    // bmson `bga.header[].name`s. The bmson header carries the actual
    // resource name; the id-keyed `resources.bmp` map is fed from BMS
    // `#BMPxx` directives (and ignored for bmson charts).
    const refs = new Map<string, string>();
    const referencedKeys = new Set<string>([...baseTrackKeys, ...layerTrackKeys]);
    // Use the control-flow-resolved chart so #IF-gated BMP / bga
    // header declarations match the chosen #RANDOM branch.
    const chart = this.resolvedChart ?? song.chart;
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
    await Promise.all(
      [...refs.entries()].map(async ([key, path]) => {
        if (this.disposed) return;
        // BMP / video assets are stored as lazy `File` references
        // in the song bundle. Read on demand so memory stays low
        // while browsing — the bytes only land in the heap for
        // BGA assets actually referenced by the focused chart.
        // Use the image-aware resolver so charts that declare
        // `#BMPxx foo.bmp` but ship `foo.png` (or `.jpg` / `.gif`)
        // still find the asset; video extensions fall through to
        // the original path verbatim.
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
            // Video BGA — wraps a `<video>` element in a Pixi texture.
            // The same texture handle is used on both tracks (no
            // chroma-key on layer; black-keying a moving video looks
            // worse than just letting the artist's blacks show).
            const handle = await loadVideoTextureFromBytes(path, bytes, {
              maxLongEdgePx: this.options.bgaTranscodeMaxLongEdgePx,
              useWebCodecs: this.options.bgaTranscodeUseWebCodecs,
            });
            if (!handle) return;
            // Late-arriving video decode after the player ESC'd
            // back to the song select — drop the texture / video
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
            // BMS' layer track (`#xxx07`) chroma-keys pure black
            // pixels by convention so the foreground composites
            // over the base BGA. The bmson 1.0.0 spec breaks
            // explicitly with that: "Unlike BMS Layer Channel
            // #xxx07, black pixels will not be made transparent."
            // Bmson layer authors deliver pre-multiplied / alpha-
            // channel artwork and expect blacks to render as
            // black. Gate the chroma-key on chart source so
            // BMS-derived layers keep the historical blend while
            // bmson layers come through untouched.
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
          // Decode failures (corrupt files, unsupported encodings) are
          // skipped silently so the rest of the chart still renders.
        }
      }),
    );
  }

  /**
   * Auto-pause when the document tab / window goes to the background and
   * auto-resume when it comes back to the foreground (matching the LR2
   * desktop client behaviour). The user can still toggle manually with
   * Space without conflicting with this listener — `togglePause` is a
   * symmetric flip, and we only fire it when the visibility state actually
   * changes.
   */
  private readonly handleVisibilityChange = (): void => {
    log.info('visibilitychange', {
      visibilityState: document.visibilityState,
      hidden: document.hidden,
      paused: this.paused,
      autoPaused: this.autoPaused,
      autoPauseOnBlur: this.autoPauseOnBlur,
    });
    // Auto-pause when the tab goes hidden (only if the host opted
    // in). The auto-RESUME path stays unconditional — if we
    // previously auto-paused, we must auto-resume regardless of
    // the toggle's current value, otherwise turning the toggle
    // off mid-blur would strand gameplay in a paused state with
    // no obvious way out.
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
   * Whether `visibilitychange` / `blur` / `pagehide` should
   * auto-pause gameplay. Seeded from `options.autoPauseOnBlur`
   * (default `false`). The host can flip it at runtime via
   * {@link setAutoPauseOnBlur} — useful for a lil-gui toggle that
   * lets the user opt into the LR2-desktop-style "pause when I
   * Cmd-Tab away" behaviour.
   */
  private autoPauseOnBlur = false;
  /** Last sampled `document.hidden`, used by the polling safety net. */
  private lastHidden = false;
  /** Last sampled `document.hasFocus()`, used by the polling safety net. */
  private lastFocus = true;
  /** `setInterval` handle for the visibility/focus poll loop. */
  private visibilityPollHandle: number | undefined;
  /**
   * `setTimeout` handle for the LR2 op 80 → 81 transition (load
   * incomplete → load complete). Cleared on dispose so the
   * deferred state mutation doesn't fire onto a torn-down scene.
   */
  private loadCompleteTimerHandle: number | undefined;

  /**
   * Resolves when {@link prepareBga} has loaded every BGA texture.
   * Set in {@link prepare} (without `await`) so the PLAY scene can
   * be revealed immediately and the LR2 LOADING phase keeps
   * painting while a long-running ffmpeg.wasm video transcode
   * finishes in the background. {@link start} gates the LOAD END
   * timer / chart-start scheduling on this promise so the chart
   * itself doesn't begin until the BGA is actually ready.
   */
  private bgaReadyPromise: Promise<void> | undefined;

  /**
   * Window-level blur/focus fallback for the auto-pause behaviour. Some
   * platforms (notably macOS with Chrome) keep the document `visible`
   * across Cmd-Tab app switches, so `visibilitychange` alone misses those
   * cases. We treat `blur` / `focus` the same way as `visibilitychange`,
   * gated on the same `autoPaused` flag so the two listeners cooperate.
   */
  private readonly handleWindowBlur = (): void => {
    log.info('window blur', {
      paused: this.paused,
      autoPaused: this.autoPaused,
      autoPauseOnBlur: this.autoPauseOnBlur,
    });
    // Same opt-in policy as `handleVisibilityChange` — only blur-
    // pause when the host enabled it; auto-resume on focus stays
    // unconditional so flipping the toggle mid-pause can't strand
    // us in a paused state.
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

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      // Run the LR2 #FADEOUT → #CLOSE timeline before handing
      // control back so the skin's exit chrome (fade overlay,
      // STAGE FAILED plate) gets a chance to animate. Idempotent
      // when fired repeatedly.
      this.beginExitSequence(() => this.options.onExit?.());
      return;
    }
    if (event.code === 'F5') {
      // Restart: convention follows beatoraja / LR2's F5-restart key.
      // `preventDefault` blocks the browser-reload default; if the
      // host hasn't supplied an `onRestart` handler we fall through
      // to a no-op (still preventing the reload).
      event.preventDefault();
      this.options.onRestart?.();
      return;
    }
    if (event.code === 'Space') {
      event.preventDefault();
      this.togglePause();
      return;
    }
    if (event.code === 'ArrowUp') {
      event.preventDefault();
      this.adjustHiSpeed(HISPEED_STEP);
      return;
    }
    if (event.code === 'ArrowDown') {
      event.preventDefault();
      this.adjustHiSpeed(-HISPEED_STEP);
      return;
    }
    const channel = resolveKeyChannel(event, this.laneChannels);
    if (!channel || this.paused) {
      return;
    }
    // Auto-scratch suppresses the player's scratch input — otherwise
    // the user's stray Shift press would trigger an EMPTY_POOR judge
    // (scratch note already auto-hit + cleared by `autoScratchJudge`).
    if (isScratch(channel)) {
      const autoSide = channel === '16' ? this.options.autoScratch1P : this.options.autoScratch2P;
      if (autoSide) return;
    }
    event.preventDefault();
    if (!event.repeat) {
      this.pressedChannels.add(channel);
      // Start the LR2 key-on timer for this lane so skin elements gated on
      // timer 100..107 (lane lasers etc.) become visible while the key is
      // held down.
      this.startKeyOnTimer(channel);
      // Spin the turntable on every scratch press, even an empty
      // one — a DJ scratch with no note still rotates the disc.
      // No-op for non-scratch channels.
      this.applyTurntableImpulse(channel);
      if (!this.options.autoPlay) {
        // Bomb is triggered inside judge() when the press lands on a note --
        // empty presses (no note in window) do not produce a bomb flash.
        this.judge(channel, this.currentSeconds());
      }
    }
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    const channel = resolveKeyChannel(event, this.laneChannels);
    if (channel) {
      this.pressedChannels.delete(channel);
      // Same render-time alpha taper as the auto-judged LN release
      // path so manual key-ups also decay smoothly instead of
      // popping off. `releaseKeyOnTimer` schedules the timer's
      // delete after `KEY_ON_FADE_OUT_MS`.
      this.releaseKeyOnTimer(channel);
      // Don't delete bombStartedAt here -- let renderBombs decide when the
      // animation has finished. Otherwise releasing the key cuts off the
      // bomb flash mid-animation.
      // Manual play: a release on a channel currently holding an LN
      // is the trigger to finalize the tail judgement. Auto-play
      // never reaches this branch (the auto-judge path handles its
      // own LN end timing).
      if (!this.options.autoPlay) {
        this.finalizeActiveLongNote(channel, this.currentSeconds());
      }
    }
  };

  /**
   * Adjust the visual hi-speed and clamp to [HISPEED_MIN, HISPEED_MAX].
   * Snap to a 1/1000 grid so accumulated press deltas don't drift
   * off the natural 0.1 grid through float-rounding noise — `0.1`
   * has no exact IEEE-754 representation, so adding it 13 times in
   * a row would otherwise produce `1.5000000000000002` and then
   * `1.6000000000000003` etc., visibly off-by-one in the digit
   * panel. The 1/1000 snap absorbs that without breaking even
   * finer steps if HISPEED_STEP shrinks again later.
   */
  private adjustHiSpeed(delta: number): void {
    const next = Math.round((this.hiSpeed + delta) * 1000) / 1000;
    this.hiSpeed = Math.max(HISPEED_MIN, Math.min(HISPEED_MAX, next));
  }

  /**
   * Applies the LR2 HS-FIX multiplier to {@link hiSpeed} once
   * `prepareSong` has installed the timing resolver. Pegs the
   * user's chosen HS to a chosen BPM so the visual scroll feels
   * uniform across BPM changes:
   *
   * - `OFF`     — leave HS as-is.
   * - `MAXBPM`  — scale by `mainBPM / maxBPM` (slow sections feel
   *   proportionally slower).
   * - `MINBPM`  — scale by `mainBPM / minBPM` (fast sections feel
   *   proportionally faster).
   * - `AVERAGE` — scale by `mainBPM / avgBPM` where avgBPM is the
   *   time-weighted mean.
   * - `CONSTANT` — true per-frame "constant scroll" needs a render-
   *   pipeline change that hasn't landed; falls through to the
   *   `AVERAGE` multiplier so the option still produces a sensible
   *   shift instead of doing nothing.
   *
   * Skipped when there are no tempo points (defensive — the
   * resolver can be constructed empty during edge-case mounts) or
   * the chart has no BPM info.
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
        // Time-weighted average — each tempo segment runs from
        // `point.seconds` to the next point's `seconds` (or the
        // chart's last note for the final segment). Using a flat
        // arithmetic mean would over-weight a tiny BPM-change
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
    // 9 KEY (Pop'n) uses lane slots 1..9 — the 7-cap below would
    // otherwise drop slots 8 / 9. Other modes top out at slot 7.
    const maxSlot = this.chartPlayVariant === '9' ? 9 : 7;
    if (laneIndex < 0 || laneIndex > maxSlot) {
      return undefined;
    }
    // LR2 spec: timer 100 = 1P SC, 101..107 = 1P key1..7;
    //          timer 110 = 2P SC, 111..117 = 2P key1..7.
    // PMS / 9 KEY is single-side so every lane (whether the chart
    // sources it from `1X` or `2X`) routes through the 1P-side
    // base; the resolver already collapses both layouts onto
    // slots 1..9.
    const isPlayer2 = this.chartPlayVariant !== '9' && channel.startsWith('2');
    const base = isPlayer2 ? LR2_2P_KEYON_TIMER_BASE : LR2_1P_KEYON_TIMER_BASE;
    return base + laneIndex;
  }

  /**
   * LR2 LN-hold-effect timer id for the given chart channel
   * (`70..79` for 1P SC + key1..9, `80..89` for 2P). Mirrors
   * {@link resolveKeyOnTimerId}; returned only when the channel
   * maps onto a known lane index.
   */
  private resolveLnHoldTimerId(channel: string): number | undefined {
    const laneIndex = resolveSideRelativeLaneIndex(channel, this.chartPlayVariant);
    if (laneIndex < 0 || laneIndex > 9) {
      return undefined;
    }
    // PMS / 9 KEY collapses onto the 1P-side `70..79` bank.
    const isPlayer2 = this.chartPlayVariant !== '9' && channel.startsWith('2');
    const base = isPlayer2 ? LR2_2P_LN_HOLD_TIMER_BASE : LR2_1P_LN_HOLD_TIMER_BASE;
    return base + laneIndex;
  }

  private startKeyOnTimer(channel: string): void {
    const timerId = this.resolveKeyOnTimerId(channel);
    if (timerId === undefined) {
      return;
    }
    this.timerStartedAt.set(timerId, this.playClock());
    // A fresh press cancels any in-flight release fade on the
    // same lane; the laser is fully on again from this instant.
    this.keyOnFadeOutStart.delete(timerId);
  }

  /**
   * Stamps the LR2 LN-hold-effect timer (70..89) for the given
   * channel — fires at the head of an LN, paired with
   * {@link releaseLnHoldTimer} at LN end. Skin elements gated on
   * these timers (sustain glow, hold sparkles, etc.) become
   * visible while the timer is active and fade through their
   * keyframe sequence on release. A no-op if the channel doesn't
   * map onto a known LN-hold slot.
   */
  private startLnHoldTimer(channel: string): void {
    const timerId = this.resolveLnHoldTimerId(channel);
    if (timerId === undefined) return;
    this.timerStartedAt.set(timerId, this.playClock());
    this.lnHoldFadeOutStart.delete(timerId);
  }

  /**
   * Mirrors {@link releaseKeyOnTimer} but for the LN-hold-effect
   * timer (70..89). Stamps the play-clock at which the fade
   * began, schedules the timer's deferred delete, and lets
   * `renderSkinImage` taper any LN-hold-anchored sprite alpha to
   * 0 over the same skin-derived span as the key-on lasers (we
   * reuse the per-timer duration map populated in `prepareSkin`,
   * with `KEY_ON_FADE_OUT_MS` as the fallback).
   */
  private releaseLnHoldTimer(channel: string): void {
    const timerId = this.resolveLnHoldTimerId(channel);
    if (timerId === undefined) return;
    if (!this.timerStartedAt.has(timerId)) return;
    this.lnHoldFadeOutStart.set(timerId, this.playClock());
    const fadeMs = this.lnHoldFadeDurationMs.get(timerId) ?? KEY_ON_FADE_OUT_MS;
    const timeout = window.setTimeout(() => {
      this.keyFlashTimeouts.delete(timeout);
      if (this.disposed) return;
      // Don't retire the timer if a fresh LN head landed on the
      // same lane during the fade window — that re-press has its
      // own start/release lifecycle.
      if (!this.activeLongNotes.has(channel)) {
        this.timerStartedAt.delete(timerId);
      }
      this.lnHoldFadeOutStart.delete(timerId);
    }, fadeMs);
    this.keyFlashTimeouts.add(timeout);
  }

  /**
   * Smoothly extinguishes the lane laser when a key (or auto LN
   * head) releases: the LR2 key-on timer (100..117) stays in its
   * currently-active state for {@link KEY_ON_FADE_OUT_MS} ms while
   * a render-time alpha taper drives the visible amplitude down to
   * 0, then the timer entry itself is deleted. Anchored on
   * `playClock` so the fade pauses cleanly with the rest of the
   * scene.
   *
   * The taper is what makes manual key-ups, auto-judged short
   * notes (via {@link flashKeyOnTimer}), and auto-LN releases all
   * decay at the same speed without restarting the key-on
   * keyframe (which would blink the LR2 default skin's lane laser
   * back to its fade-in origin before the decay).
   */
  private releaseKeyOnTimer(channel: string): void {
    const timerId = this.resolveKeyOnTimerId(channel);
    if (timerId === undefined) return;
    if (!this.timerStartedAt.has(timerId)) return;
    this.keyOnFadeOutStart.set(timerId, this.playClock());
    const fadeMs = this.keyOnFadeDurationMs.get(timerId) ?? KEY_ON_FADE_OUT_MS;
    const timeout = window.setTimeout(() => {
      this.keyFlashTimeouts.delete(timeout);
      if (this.disposed) return;
      // If the player (or autoplay) re-pressed the same lane during
      // the fade window, leave the timer running and skip the
      // delete — the new press has its own lifecycle.
      if (!this.pressedChannels.has(channel) && !this.activeLongNotes.has(channel)) {
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
  }

  /**
   * Pause-aware monotonic clock used by every "time since X"
   * animation in the play scene (LR2 timer keyframes, scratch-disc
   * rotation, bomb / FC / POOR-BGA windows, NOWJUDGE / NOWCOMBO
   * decay, …). Returns wall clock minus the accumulated pause
   * duration, and freezes at `pauseTime - pauseTotal` while the
   * scene is paused. Seed sites that drive these animations store
   * `playClock()` values, and the read sites compute
   * `playClock() - seed` — so animations resume exactly where they
   * left off rather than jumping forward by the pause duration.
   */
  private playClock(): number {
    if (this.paused) {
      return this.pauseTime - this.pauseTotal;
    }
    return performance.now() - this.pauseTotal;
  }

  /**
   * Pauses every BGA video element in the chart's video pool. The
   * `<video>` element doesn't honour the audio-context suspend, so
   * without this the video keeps playing during a pause overlay.
   */
  private pauseAllBgaVideos(): void {
    for (const handle of this.bgaVideos.values()) {
      if (!handle.video.paused) {
        handle.video.pause();
      }
    }
  }

  /**
   * Resumes only the videos tied to currently-active base / layer
   * cues. Avoids touching videos that were paused for a different
   * reason (e.g. an earlier cue switched away from them in
   * `syncBgaVideo`).
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
   * Sample key the BMS spec reserves for landmine "explosion"
   * audio. Charts that author a `#WAV 00` register the explosion
   * sound there and we play it on every mine hit; charts without
   * a `#WAV 00` get silent mine hits (still scored / damaged).
   */
  private static readonly LANDMINE_EXPLOSION_SAMPLE_KEY = '00';

  /**
   * Hit-tests `mineNotes` for an un-judged landmine on `channel`
   * within ±`badSeconds` of `seconds`. Returns `true` when a mine
   * was consumed (caller must skip the regular note path), false
   * otherwise.
   *
   * Mirrors the CLI engine's `mine-hit` branch
   * (`packages/player/src/core/engine.ts:resolveLandmineGaugeEffect`):
   *
   *   - mark the mine as `hit` so it doesn't re-fire,
   *   - apply a BAD verdict to the score summary (BAD count up,
   *     combo reset, no EX-score / IIDX-score change since BAD
   *     scores zero on both ladders anyway),
   *   - drain the gauge — the chart-encoded damage value gets
   *     parsed from the BMS object value (`<value>/2` in base-36)
   *     and floored at `DEFAULT_LANDMINE_GAUGE_DAMAGE` (= 4) when
   *     the value is missing / unparseable. We map that down onto
   *     `applyGaugeDelta('BAD')` so the gauge type's normal BAD
   *     penalty still applies (HARD / DEATH stay punishing) and
   *     leave per-mine custom damage as a future refinement,
   *   - play `#WAV 00` if the chart shipped one,
   *   - publish a BAD judge event so the skin's NOWJUDGE plate
   *     flashes "BAD" and the bomb / lane-flash chrome reacts.
   */
  private tryHitMine(channel: string, seconds: number, badSeconds: number): boolean {
    if (this.mineNotes.length === 0) return false;
    const firstIndex = findFirstIndexAtOrAfter(this.mineNotes, seconds - badSeconds, (mine) => mine.seconds);
    const target = findClosestCandidateInWindow(this.mineNotes, {
      channel,
      nowSec: seconds,
      judgeWindowSec: badSeconds,
      startIndex: firstIndex,
      sortedBySeconds: true,
      isConsumed: (mine) => mine.hit,
    });
    if (!target) return false;
    target.hit = true;
    // BAD verdict — combo reset + bad++. Same path the
    // playable-note BAD branch uses, so the score panel ladder
    // (PERFECT/GREAT/GOOD/BAD/POOR) reads consistently whether
    // the BAD came from mistiming a real note or stepping on a
    // mine.
    applyJudgeToSummary(this.score, 'BAD', this.tracker);
    this.applyGaugeDelta('BAD');
    if (this.tracker.combo > this.maxCombo) {
      this.maxCombo = this.tracker.combo;
    }
    this.publishJudge('BAD', seconds, channel);
    // Mine explosion sample — `#WAV 00` if the chart authored
    // one. Silent mines (no #WAV 00) just don't play anything.
    this.playSampleByKey(PixiGameplayView.LANDMINE_EXPLOSION_SAMPLE_KEY, target.seconds);
    // Bomb / key-on visuals fire so the lane flashes the same
    // way it would on a real BAD hit. The skin's mine-specific
    // explosion sprite (when authored) is gated by the regular
    // bomb timer — LR2 doesn't carry a separate "mine explosion"
    // timer, so reusing 50-69 matches the reference behaviour.
    this.triggerBomb(channel);
    return true;
  }

  private judge(channel: string, seconds: number): void {
    const windows = resolveJudgeWindowsMs(this.song!.chart);
    const badSeconds = windows.bad / 1000;
    // Landmine pre-check — a press inside the BAD window of an
    // un-judged mine on this lane explodes the mine FIRST,
    // skipping the regular note search. Mirrors LR2's behaviour
    // (`engine.ts:resolveLandmineGaugeEffect` in `packages/player`):
    // BAD verdict, combo reset to 0, gauge drained by the
    // chart-encoded damage value (default 4), and the mine's
    // explosion sample (`#WAV 00`) plays. The playable-note loop
    // below is skipped — the mine consumes the press.
    if (this.tryHitMine(channel, seconds, badSeconds)) {
      return;
    }
    const firstCandidateIndex = findFirstIndexAtOrAfter(this.notes, seconds - badSeconds, (note) => note.seconds);
    const note = findClosestCandidateInWindow(this.notes, {
      channel,
      nowSec: seconds,
      judgeWindowSec: badSeconds,
      startIndex: firstCandidateIndex,
      sortedBySeconds: true,
      isConsumed: (candidate) => candidate.hit,
    });
    if (!note) {
      // Empty press (no note in the BAD window for this lane) —
      // LR2-compatible 空POOR (empty POOR). Per the LR2 reference:
      //
      // - Gauge: penalty per gauge type (see
      //   `applyGrooveGaugeJudge('EMPTY_POOR')`): GROOVE / HARD -2,
      //   EASY -1, DEATH -100. So NORMAL / EASY are nearly
      //   harmless; HARD / DEATH actually drain.
      // - Combo: NOT broken (`tracker.combo` unchanged).
      // - Score: NOT updated — `summary.poor` / EX-SCORE / IIDX
      //   score all untouched, so phantom presses don't hurt the
      //   final tally.
      // - POOR BGA: triggered just like a real POOR — `publishJudge`
      //   stamps `lastPoorAt` for the BGA-swap window.
      // - Judge plate: flashes "POOR" for ~600 ms (NOWJUDGE timer 46
      //   restart, `lastJudge` set). LR2 distinguishes index 0 (空)
      //   vs 1 (見逃し) at the skin level via op 246 / 245, but both
      //   map to the same `'poor'` kind in our skin model so the
      //   rendered sprite is identical — close enough for now.
      this.applyGaugeDelta('EMPTY_POOR');
      this.publishJudge('POOR', seconds, channel);
      return;
    }
    this.markNoteHit(note);
    // Signed delta (ms): positive = player late, negative = player
    // early. Used for FAST/SLOW classification on GREAT / GOOD
    // judgements (PERFECT is "on time" by definition).
    const signedDeltaMs = (seconds - note.seconds) * 1000;
    const delta = Math.abs(signedDeltaMs);
    const judge: JudgeKind =
      delta <= windows.pgreat ? 'PERFECT' : delta <= windows.great ? 'GREAT' : delta <= windows.good ? 'GOOD' : 'BAD';
    // Always play the keysound on press so the player gets
    // immediate audio feedback even though the score commit might
    // be deferred for an LN.
    this.playSample(note);
    if (judge === 'PERFECT' || judge === 'GREAT') {
      // LR2 bomb (timer 50-69) fires on GREAT-or-better only —
      // GOOD / BAD / POOR don't earn the lane explosion, so the
      // animation reads as positive feedback for clean hits.
      this.triggerBomb(channel);
    }
    if (isLongNote(note)) {
      // LN: defer scoreboard / gauge / publish until the tail is
      // finalized in `finalizeActiveLongNote`. The note is marked
      // `hit = true` so subsequent presses on this channel target
      // the next note rather than re-judging the same head.
      this.activeLongNotes.set(channel, { note, headJudge: judge, headSignedDeltaMs: signedDeltaMs });
      // Fire the LR2 LN-hold-effect timer (70-89) so authored
      // sustain visuals (sparkle / glow) become visible during
      // the hold. Released in `finalizeActiveLongNote` /
      // `autoFinalizeLongNotes` / `finalizeOverheldLongNotes`.
      this.startLnHoldTimer(channel);
      return;
    }
    this.commitFinalJudge(judge, signedDeltaMs, seconds, channel);
  }

  /**
   * Commits a finalized note judgement to every downstream sink:
   * scoreboard counter, FAST/SLOW classifier, gauge delta, and the
   * per-judge UI signal (`publishJudge`). Used by both the regular
   * single-note path and the LN finalize-on-release path so the
   * commit semantics stay consistent regardless of how the verdict
   * was reached.
   */
  private commitFinalJudge(judge: JudgeKind, signedDeltaMs: number, seconds: number, channel: string): void {
    applyJudgeToSummary(this.score, judge, this.tracker);
    if (judge === 'GREAT' || judge === 'GOOD') {
      if (signedDeltaMs < 0) this.fastCount += 1;
      else if (signedDeltaMs > 0) this.slowCount += 1;
    }
    this.applyGaugeDelta(judge);
    this.publishJudge(judge, seconds, channel);
  }

  /**
   * Finalizes the LN currently held on `channel` (if any) using the
   * release timing relative to the note's `endSeconds`. Behaviour
   * branches on `note.longNoteMode`:
   *
   * - **Mode 1** (BMS `#LNOBJ` default) — tail auto-completes on
   *   release within the bad-window of `endSeconds`. Releasing
   *   significantly early downgrades the verdict to BAD. Late
   *   release after `endSeconds` is fine; the head verdict stands.
   * - **Mode 2 / 3** — tail timing matters. Release delta vs
   *   `endSeconds` produces a tail judgement on the same window
   *   table the head uses; the final commit is the worst severity
   *   between head and tail (LR2 standard).
   *
   * If the matching LN was already finalized (e.g. by chart-end
   * timeout via {@link finalizeOverheldLongNotes}) this is a no-op.
   */
  private finalizeActiveLongNote(channel: string, seconds: number): void {
    const active = this.activeLongNotes.get(channel);
    if (!active || !this.song) {
      return;
    }
    this.activeLongNotes.delete(channel);
    // Sustain visuals on the LR2 LN-hold-effect timer fade out
    // here so the skin's release keyframes get a chance to play
    // before the slot retires.
    this.releaseLnHoldTimer(channel);
    const { note, headJudge, headSignedDeltaMs } = active;
    const endSeconds = note.endSeconds!;
    const windows = resolveJudgeWindowsMs(this.song.chart);
    const mode: 1 | 2 | 3 = note.longNoteMode ?? 1;
    if (mode === 1) {
      // Mode 1: tail auto-completes — only penalise *significant*
      // early release. Within the bad window of `endSeconds` (or
      // any time after) the head verdict carries.
      const earlyByMs = (endSeconds - seconds) * 1000;
      if (earlyByMs > windows.bad) {
        this.commitFinalJudge('BAD', headSignedDeltaMs, seconds, channel);
      } else {
        this.commitFinalJudge(headJudge, headSignedDeltaMs, seconds, channel);
        this.triggerBombOnNonMiss(channel, headJudge);
      }
      return;
    }
    // Mode 2 / 3: tail judgement based on release-vs-end delta.
    const tailSignedDeltaMs = (seconds - endSeconds) * 1000;
    const tailDelta = Math.abs(tailSignedDeltaMs);
    const tailJudge: JudgeKind =
      tailDelta <= windows.pgreat
        ? 'PERFECT'
        : tailDelta <= windows.great
          ? 'GREAT'
          : tailDelta <= windows.good
            ? 'GOOD'
            : tailDelta <= windows.bad
              ? 'BAD'
              : 'POOR';
    // Combine: pick the worst severity (LR2 convention). On a tie
    // we prefer the verdict whose delta is larger so FAST/SLOW
    // classification reflects the genuinely-off side of the hold.
    const finalJudge = judgeSeverity(headJudge) >= judgeSeverity(tailJudge) ? headJudge : tailJudge;
    const finalSignedDeltaMs = finalJudge === headJudge ? headSignedDeltaMs : tailSignedDeltaMs;
    this.commitFinalJudge(finalJudge, finalSignedDeltaMs, seconds, channel);
    this.triggerBombOnNonMiss(channel, finalJudge);
  }

  /**
   * Fires a lane bomb only when the verdict is "clean enough"
   * (PERFECT / GREAT). GOOD / BAD / POOR are deliberately excluded
   * so the lane explosion stays a positive-feedback cue for
   * accurate hits. Single-note presses already gate inline at the
   * call-site (`if (judge === 'PERFECT' || judge === 'GREAT')`);
   * the LN finalize paths funnel through this helper instead so
   * all four commit sites — single-note, manual LN release,
   * manual auto-over-hold, auto LN tail — share the same gate
   * without duplicating the predicate.
   */
  private triggerBombOnNonMiss(channel: string, judge: JudgeKind): void {
    if (judge !== 'PERFECT' && judge !== 'GREAT') return;
    this.triggerBomb(channel);
  }

  /**
   * Auto-finalizes any active LN whose `endSeconds + bad-window`
   * has passed without a release event. Maps to "user kept holding
   * past the end" which LR2 treats as a clean tail (head verdict
   * carries) so the chart can complete cleanly. Without this the
   * `checkChartEnd` "every note hit" guard would be satisfied (the
   * head set `hit = true`) but the LN's score would never reach
   * the scoreboard.
   */
  private finalizeOverheldLongNotes(seconds: number): void {
    if (this.activeLongNotes.size === 0 || !this.song) {
      return;
    }
    const windows = resolveJudgeWindowsMs(this.song.chart);
    const graceSec = windows.bad / 1000;
    for (const [channel, active] of this.activeLongNotes) {
      if (active.note.endSeconds! + graceSec < seconds) {
        this.activeLongNotes.delete(channel);
        this.commitFinalJudge(active.headJudge, active.headSignedDeltaMs, seconds, channel);
        this.triggerBombOnNonMiss(channel, active.headJudge);
        this.releaseLnHoldTimer(channel);
      }
    }
  }

  private triggerBomb(channel: string): void {
    const now = this.playClock();
    this.bombStartedAt.set(channel, now);
    // LR2 bomb timer (50+sideLaneIndex / 60+sideLaneIndex). The LR2
    // default 7keys skin attaches its bomb sprite to `timer=50..57`
    // (1P), so we mirror that here. The timer auto-clears once
    // `renderBombs` completes the animation. Side-relative lane index
    // is used so 2P SC fires timer 60 (not 60+8).
    const laneIndex = resolveSideRelativeLaneIndex(channel, this.chartPlayVariant);
    // PMS / 9 KEY routes every lane through the 1P-side bank
    // (50..58) regardless of which side the chart sourced it from.
    const isPlayer2 = this.chartPlayVariant !== '9' && channel.startsWith('2');
    const base = isPlayer2 ? LR2_2P_BOMB_TIMER_BASE : LR2_1P_BOMB_TIMER_BASE;
    this.timerStartedAt.set(base + laneIndex, now);
  }

  /**
   * Snaps the turntable velocity on a scratch press. Called
   * on every scratch-channel press (manual `Shift` keydown,
   * full autoplay, or auto-scratch mode).
   *
   * - First press of an isolated event: brake (`v = −delta`,
   *   pure reverse rotation).
   * - Subsequent presses inside {@link TURNTABLE_STREAK_GAP_MS}:
   *   alternate sign each press, so a rapid scratch run paints
   *   a back-and-forth motion (forward / reverse / forward /
   *   reverse) at equal magnitudes. After a quiet gap, the
   *   sign resets so the next isolated press brakes again
   *   rather than spinning forward unprompted.
   *
   * Snap is centred on zero (not baseline) deliberately. The
   * baseline is the *idle* spin; while the user is actively
   * scratching, the disc should behave as if the hand is on it
   * — pure forward / pure reverse motion. The integrator in
   * {@link updateTurntable} suppresses the baseline-recovery
   * pull during the streak window so the snapped velocity
   * actually persists between presses.
   *
   * Channels other than `16` / `26` are no-ops, so this can be
   * called unconditionally from generic note-hit paths.
   */
  private applyTurntableImpulse(channel: string): void {
    if (channel !== '16' && channel !== '26') return;
    const side = channel === '16' ? '1' : '2';
    const now = this.playClock();
    const gap = now - this.turntableLastImpulseAt[side];
    // Reset the alternation streak when the gap is long. Bare
    // `>` (not `>=`) treats any back-to-back press as part of
    // the same streak; the threshold has no useful "boundary"
    // case.
    if (gap > PixiGameplayView.TURNTABLE_STREAK_GAP_MS) {
      this.turntableNextSign[side] = -1;
    }
    const sign = this.turntableNextSign[side];
    const delta = PixiGameplayView.TURNTABLE_PRESS_DELTA_RAD_PER_SEC;
    this.turntableVelocity[side] = sign * delta;
    // Flip for next press. Re-typed via the conditional so TS
    // narrows back to the `-1 | 1` literal; a plain `-sign`
    // widens to `number` and breaks the field's type.
    this.turntableNextSign[side] = sign === -1 ? 1 : -1;
    this.turntableLastImpulseAt[side] = now;
  }

  /**
   * Integrates the turntable physics one tick. Called from
   * {@link tick} just before render so the rendered angle
   * reflects this frame's elapsed time rather than the
   * previous frame's.
   *
   * Two regimes, gated on the streak window:
   *
   * - **In streak** (within {@link TURNTABLE_STREAK_GAP_MS} of
   *   the last press): the snapped velocity is preserved as
   *   the user "holds" the disc. Each press flips the sign,
   *   so the angle traces a back-and-forth motion at constant
   *   ±delta speed — the visual analogue of a hand on the
   *   platter rocking it forward / back.
   * - **Out of streak**: velocity exponentially relaxes
   *   toward the baseline `v += (baseline − v) · (1 −
   *   exp(−recovery·dt))`. Steady-state is the baseline
   *   forward spin, so the disc resumes its idle cadence on
   *   its own once the player stops pressing.
   *
   * Pause skips integration so the disc holds its current
   * angle until the user resumes — matches what gameplay pause
   * does for every other animated element.
   */
  private updateTurntable(now: number): void {
    if (this.turntableLastUpdateAt === 0) {
      this.turntableLastUpdateAt = now;
      return;
    }
    // Hold the disc still during the LR2 intro chrome (LOADING /
    // DONE banner, fade-in, etc.). The chart isn't playing yet,
    // so a spinning disc would read as "the song is already
    // running" — exactly the wrong cue. Reset the timestamp so
    // the first post-intro tick produces a small dt (rather than
    // the cumulative wall-clock since the intro began, which
    // would integrate to a huge angle jump on the first frame).
    if (this.isIntroPlaying()) {
      this.turntableLastUpdateAt = now;
      return;
    }
    const dt = Math.max(0, (now - this.turntableLastUpdateAt) / 1000);
    this.turntableLastUpdateAt = now;
    if (this.paused || dt <= 0) return;
    const baseline = PixiGameplayView.TURNTABLE_BASELINE_RAD_PER_SEC;
    const recovery = 1 - Math.exp(-PixiGameplayView.TURNTABLE_RECOVERY_PER_SEC * dt);
    for (const side of ['1', '2'] as const) {
      this.turntableAngle[side] += this.turntableVelocity[side] * dt;
      // Suppress baseline pull while the user is still inside
      // the streak window. The disc holds the snapped velocity
      // so consecutive presses carry the angle through visible
      // forward / reverse arcs without the spring snapping it
      // back toward baseline between presses.
      const inStreak = now - this.turntableLastImpulseAt[side] < PixiGameplayView.TURNTABLE_STREAK_GAP_MS;
      if (inStreak) continue;
      this.turntableVelocity[side] += (baseline - this.turntableVelocity[side]) * recovery;
    }
  }

  /**
   * Updates the gauge peak-hold indicator. Mirrors how an audio
   * level meter's peak indicator behaves:
   *
   * - Peak follows the gauge value up instantly (peak ≥ current).
   * - When the gauge starts dropping the peak holds briefly
   *   ({@link GAUGE_PEAK_HOLD_MS}) so the recent maximum stays
   *   visible — that's the whole point of "peak hold".
   * - After the hold expires the peak slides back toward the
   *   current value at {@link GAUGE_PEAK_DECAY_PCT_PER_SEC} %
   *   per second, never dropping below the current.
   *
   * Pause skips the tick so the meter freezes alongside every
   * other animated element. The early `lastTickAt` seed avoids
   * a giant first-frame `dt` integrating against the entire
   * scene-mount window.
   */
  private updateGaugePeak(now: number): void {
    if (this.gaugePeakLastTickAt === 0) {
      this.gaugePeakLastTickAt = now;
      return;
    }
    if (this.paused) {
      this.gaugePeakLastTickAt = now;
      return;
    }
    const dt = Math.max(0, (now - this.gaugePeakLastTickAt) / 1000);
    this.gaugePeakLastTickAt = now;
    const current = this.gaugeState.current;
    if (current >= this.gaugePeak) {
      this.gaugePeak = current;
      this.gaugePeakUpdatedAt = now;
      return;
    }
    if (now - this.gaugePeakUpdatedAt <= PixiGameplayView.GAUGE_PEAK_HOLD_MS) {
      return;
    }
    const decay = PixiGameplayView.GAUGE_PEAK_DECAY_PCT_PER_SEC * dt;
    this.gaugePeak = Math.max(current, this.gaugePeak - decay);
  }

  private tick = (): void => {
    // Belt-and-suspenders for the rAF-after-dispose race. Even with
    // `app.stop()` removing the renderer's tick listener, our own
    // `cancelAnimationFrame` can lose to a tick that's already
    // mid-flight when ESC fires. Bailing here keeps `render()` from
    // touching destroyed Pixi state.
    if (this.disposed) {
      return;
    }
    this.perf.beginTick();
    const seconds = this.currentSeconds();
    if (!this.paused) {
      this.perf.time('autoJudge', () => {
        if (this.options.autoPlay) {
          this.autoJudge(seconds);
          // Drain LN holds whose tail timing has been reached. Fires
          // the deferred PERFECT verdict + combo increment + lane
          // laser release exactly at `endSeconds` so the visual
          // completion lines up with the score event.
          this.autoFinalizeLongNotes(seconds);
        } else {
          // Auto-scratch runs BEFORE the regular miss sweep so
          // un-pressed scratch notes within the auto-side never
          // reach `autoMiss` (and therefore never POOR-out).
          if (this.options.autoScratch1P || this.options.autoScratch2P) {
            this.autoScratchJudge(seconds);
            // Scratch LNs may have been seeded into `activeLongNotes`
            // by the auto-judge above — finalise their tails the
            // same way the full-autoplay path does.
            this.autoFinalizeLongNotes(seconds);
          }
          this.autoMiss(seconds);
          // Manual play safety net: auto-finalise LNs the user
          // forgot to release. Uses the head verdict (treats
          // continued hold past end as a clean tail).
          this.finalizeOverheldLongNotes(seconds);
        }
      });
      this.perf.time('autoSamples', () => this.scheduleAutoSamples(seconds));
      this.perf.time('checkChartEnd', () => this.checkChartEnd(seconds));
    }
    this.perf.time('updateFps', () => this.updateFps());
    this.perf.time('updateScores', () => {
      this.updateDisplayedScore();
      this.updateRankOps();
      this.updateGaugeOps();
    });
    // Integrate turntable physics before render so the disc's
    // angle reflects this frame's elapsed time. Cheap (constant
    // work per side) so it doesn't need its own perf bucket.
    this.updateTurntable(this.playClock());
    // Tick the gauge peak-hold meter so the ghost indicator
    // tracks the gauge bar regardless of whether a judge fired
    // this frame (decay needs to run continuously between
    // hits).
    this.updateGaugePeak(this.playClock());
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
      // High-volume (~every sampled frame) — keep on the
      // verbose-only `debug` level so it doesn't drown out
      // the host's Info console with per-frame counts.
      log.debug('perf', report);
    }
    this.frame = requestAnimationFrame(this.tick);
  };

  /**
   * Sample frame rate over a sliding 1-second window. The published value
   * drives the LR2 RATE NUMBER panel (which we re-purpose as a frame-rate
   * read-out per the user's request).
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
   * Lerps the displayed score toward the real score so the SCORE panel
   * rolls up after each judgement instead of jumping. Speed is tuned so
   * a single PERFECT (~1000 score) catches up in ~6 frames at 60 fps.
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
   * Sets the LR2 1P rank ops (200=AAA, 201=AA, …, 207=F) based on the
   * current EX-score rate so the corresponding rank graphic in the skin
   * (e.g. the "AAA" indicator above the gauge percentage) lights up.
   */
  private updateRankOps(): void {
    // Clear the entire rank slot first; only one of these should be active.
    for (let op = 200; op <= 207; op += 1) {
      this.runtimeOps.delete(op);
    }
    const rank = computeRankOp(this.score);
    if (rank !== undefined) {
      this.runtimeOps.add(rank);
    }
  }

  /**
   * Drives the LR2 1P gauge state ops:
   *   - **230–240**: 10 %-bucket flags (230 = 0–9 %, 231 = 10–19 %, …,
   *     240 = 100 %). Skin elements like the "WARNING" overlay light up by
   *     gating on these buckets.
   *   - **42 / 43**: NORMAL (gauge-up animation) vs HARD (red-zone) flag.
   *     The NORMAL gauge fires 42; we don't currently model HARD/EX.
   */
  private updateGaugeOps(): void {
    for (let op = 230; op <= 240; op += 1) {
      this.runtimeOps.delete(op);
    }
    const bucket = Math.min(10, Math.max(0, Math.floor(this.gaugeState.current / 10)));
    this.runtimeOps.add(230 + bucket);
    // NORMAL gauge is the default play-session gauge type; keep op 42 set
    // so the matching frame plate (`#IF op42`) remains visible.
    this.runtimeOps.add(42);
    // op 43 = 1P HARD/EX (not modelled yet — leave clear).
    this.runtimeOps.delete(43);
  }

  /**
   * Detects when the chart has finished playing — every playable note has
   * been processed *and* the playhead is past the last note (with a small
   * tail buffer for cymbal/sample decay) — and invokes the host's chart-end
   * hook so the demo shell can transition out of gameplay. `onChartFinished`
   * fires when supplied (host wants the result screen); otherwise we fall
   * back to `onExit` for backwards compatibility (no-result-screen demos).
   * We guard with `chartEnded` so the callback fires at most once.
   */
  private chartEnded = false;
  private checkChartEnd(seconds: number): void {
    if (this.chartEnded || !this.song) {
      return;
    }
    const endAt = this.songDurationSeconds + 3;
    if (seconds < endAt) {
      return;
    }
    if (this.remainingNotes > 0) {
      // Manual play may still be working through trailing notes; only end
      // once they are all judged or auto-missed.
      return;
    }
    this.chartEnded = true;
    // Snapshot before we defer — the gameplay state may keep changing
    // for a few frames and we want the result data captured at the
    // moment the chart "ended" (last note judged + tail buffer).
    const result = this.getResultData();
    // Defer one frame so the final render (with last judgement plate) is
    // committed before we tear down — without this the user would see the
    // playfield blank-flash to whatever scene comes next.
    this.chartEndTimeout = window.setTimeout(() => {
      this.chartEndTimeout = undefined;
      if (this.disposed) {
        return;
      }
      this.beginExitSequence(() => {
        if (this.options.onChartFinished && result) {
          this.options.onChartFinished(result);
          return;
        }
        this.options.onExit?.();
      });
    }, 50);
  }

  /**
   * Drives the LR2 scene-exit timeline (`#FADEOUT` → `#CLOSE`)
   * before handing control back to the host. Seeds timer 2 at
   * call time so skin elements gated on "FADEOUT" (typically a
   * full-screen alpha overlay) play their authored fade-out
   * keyframes; when `#FADEOUT` ms have passed it seeds timer 3
   * so "CLOSE"-gated chrome (the LR2 default 7-keys
   * STAGE FAILED / CLEARED plate) plays before the actual
   * transition fires.
   *
   * Idempotent — re-entry while a fade is in flight is a no-op,
   * so a frantic second ESC press doesn't double-fire the host
   * callback. Skins with no `#FADEOUT` / `#CLOSE` directives
   * collapse to immediate dispatch (no behavioural change for
   * skinless / non-LR2 demos).
   */
  /**
   * Drives the global "fade everything to black" tween while
   * {@link beginExitSequence} is in flight. The skin's authored
   * `#FADEOUT` overlay (if any) only covers whatever the skin
   * artist drew — gameplay-side layers (notes, lane chrome, BGA,
   * shutters, bombs, overlay text) sit *above* `skinLayer` in
   * `root` and would otherwise stay fully visible until the
   * scene is torn down. Fading `root` itself dims every layer
   * uniformly; `viewportBackground` is a sibling of `root` (under
   * `sceneRoot`), so the page reveals the same `BG` (near-black)
   * the playfield sat against, giving a clean fade-to-black
   * appearance regardless of which lanes are still painting.
   *
   * Called every frame from {@link render}; cheap when the exit
   * sequence isn't running (`root.alpha` is set back to 1 only
   * when it diverges from 1, so steady-state has no GPU cost).
   */
  private applyExitFadeAlpha(): void {
    if (!this.exiting) {
      if (this.root.alpha !== 1) this.root.alpha = 1;
      return;
    }
    const fadeOutMs = Math.max(0, this.options.skin?.timing?.fadeOut ?? 0);
    const fadeStart = this.timerStartedAt.get(2);
    if (fadeStart === undefined || fadeOutMs <= 0) {
      // Fade hasn't been seeded (or skin has no `#FADEOUT`); leave
      // root at full alpha. CLOSE-only skins keep the scene
      // visible until the host transitions us out.
      if (this.root.alpha !== 1) this.root.alpha = 1;
      return;
    }
    const elapsed = this.playClock() - fadeStart;
    this.root.alpha = Math.max(0, Math.min(1, 1 - elapsed / fadeOutMs));
  }

  private beginExitSequence(callback: () => void): void {
    if (this.exiting || this.disposed) {
      callback();
      return;
    }
    this.exiting = true;
    const timing = this.options.skin?.timing ?? {};
    const fadeOutMs = Math.max(0, timing.fadeOut ?? 0);
    const closeMs = Math.max(0, timing.close ?? 0);
    if (fadeOutMs <= 0 && closeMs <= 0) {
      callback();
      return;
    }
    this.timerStartedAt.set(2, this.playClock());
    const fireClose = (): void => {
      this.timerStartedAt.set(3, this.playClock());
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
   * Captures the current play session as a {@link PixiGameplayResultData}
   * snapshot. Returns `undefined` when no song is mounted (defensive —
   * normal flow only calls this after `prepareSong` has run). The
   * snapshot is a plain object so the host can hand it to a result
   * scene that outlives this view.
   */
  public getResultData(): PixiGameplayResultData | undefined {
    if (!this.song) {
      return undefined;
    }
    // Append a final "current values @ now" sample so the polyline
    // reaches the right edge of the chart area even when the last
    // judge fired well before the chart's natural end (e.g. AUTO
    // PERFECTs the final note 5 s before the audio tail clears).
    const totalSeconds = this.resolveSongDurationSeconds();
    const finalProgress = totalSeconds > 0 ? Math.max(0, Math.min(1, this.currentSeconds() / totalSeconds)) : 1;
    const gaugeHistory = [...this.gaugeHistory, { progress: finalProgress, value: this.gaugeState.current }];
    const scoreHistory = [...this.scoreHistory, { progress: finalProgress, exScore: this.score.exScore }];
    return {
      // Shallow-clone the score so a downstream consumer mutating
      // their copy doesn't accidentally rewrite our live state.
      score: { ...this.score },
      maxCombo: this.maxCombo,
      gauge: this.gaugeState.current,
      // Pass threshold for the LR2 NORMAL gauge is 80 %. Until
      // gauge-type selection lands, every chart is treated as
      // NORMAL — see `applyGrooveGaugeJudge` for the same default.
      cleared: this.gaugeState.current >= 80,
      playSeconds: this.currentSeconds(),
      song: this.song,
      gaugeHistory,
      scoreHistory,
    };
  }

  /**
   * Auto-play loop: when enabled, every playable note is judged as PERFECT
   * exactly at its scheduled time. Background lane sounds (`scheduleAutoSamples`)
   * still handle non-input channels separately.
   *
   * Long notes are NOT judged on the head; instead the head time
   * marks the LN as actively held (sample + bomb + sustained
   * key-on timer for the visual lane laser) and the actual
   * scoreboard / gauge / combo commit is deferred to
   * {@link autoFinalizeLongNotes} when chart-time crosses
   * `endSeconds`. This mirrors what real LR2 does (and what
   * `@be-music/player`'s engine does via `pendingAutoLongNotes`):
   * one judgement event per LN, fired at the tail timing so the
   * combo pulse aligns with the LN visually completing rather
   * than at its start.
   */
  private autoJudge(seconds: number): void {
    while (this.autoJudgeCursor < this.notes.length) {
      const note = this.notes[this.autoJudgeCursor]!;
      if (note.seconds > seconds) {
        break;
      }
      this.autoJudgeCursor += 1;
      if (note.hit) {
        continue;
      }
      if (!isPlayableInputChannel(note.channel)) {
        // Non-playable lanes (BGM-style notes that snuck into the playable
        // collection, e.g. landmines) are not scored here; mark them consumed
        // so chart-end bookkeeping does not keep revisiting them.
        this.markNoteHit(note);
        continue;
      }
      this.markNoteHit(note);
      this.playSample(note);
      this.triggerBomb(note.channel);
      // Full-autoplay scratch hits drive the turntable too —
      // otherwise the disc would sit motionless during a watch-
      // mode replay even though the chart is being scratched.
      this.applyTurntableImpulse(note.channel);
      if (isLongNote(note)) {
        // Defer the verdict — the tail timing is what the player
        // actually sees as the LN body finishing. Hold the lane
        // laser on (sustained key-on timer, no auto-fade) until
        // `autoFinalizeLongNotes` releases it at endSeconds.
        this.activeLongNotes.set(note.channel, {
          note,
          headJudge: 'PERFECT',
          headSignedDeltaMs: 0,
        });
        this.startKeyOnTimer(note.channel);
        this.startLnHoldTimer(note.channel);
        continue;
      }
      this.commitFinalJudge('PERFECT', 0, seconds, note.channel);
      this.flashKeyOnTimer(note.channel);
    }
  }

  /**
   * Drains active LN holds whose tail timing has been reached
   * during autoplay. Each finalization commits PERFECT (head
   * PERFECT + tail PERFECT, signedDelta 0 because auto-release
   * is sample-accurate), increments the combo by one, and
   * releases the lane laser. Mirrors `pendingAutoLongNotes` /
   * `drainPendingAutoLongNotes` in the standalone engine.
   *
   * Distinct from {@link finalizeOverheldLongNotes}: that one
   * fires only after the bad-window grace expires (manual-play
   * safety net) and uses the **head** verdict; here we fire
   * exactly at endSeconds with a clean PERFECT.
   */
  /**
   * Auto-judges scratch notes on whichever side(s) have
   * autoscratch enabled. Notes on the keyboard lanes pass through
   * unchanged — only channel `16` (1P scratch) and `26`
   * (2P scratch) are touched. Mirrors the {@link autoJudge}
   * structure (PERFECT verdict, sample play, bomb trigger, LN
   * head seeding) but skips advancing `autoJudgeCursor` so the
   * full-autoplay path stays unaffected.
   *
   * Cost: one O(n) scan from `autoMissCursor` per frame, bounded
   * by `bad-window seconds × note density`. Real charts have a
   * handful of scratch notes within any miss window, so this is
   * negligible.
   */
  private autoScratchJudge(seconds: number): void {
    for (let index = this.autoMissCursor; index < this.notes.length; index += 1) {
      const note = this.notes[index]!;
      if (note.seconds > seconds) break;
      if (note.hit) continue;
      if (!isScratch(note.channel)) continue;
      const enabled = note.channel === '16' ? this.options.autoScratch1P : this.options.autoScratch2P;
      if (!enabled) continue;
      this.markNoteHit(note);
      this.playSample(note);
      this.triggerBomb(note.channel);
      // Auto-scratch is by definition the disc rotating itself.
      // Pump an impulse here so the turntable visibly spins for
      // each scratch note even when the player isn't pressing
      // anything.
      this.applyTurntableImpulse(note.channel);
      if (isLongNote(note)) {
        this.activeLongNotes.set(note.channel, {
          note,
          headJudge: 'PERFECT',
          headSignedDeltaMs: 0,
        });
        this.startKeyOnTimer(note.channel);
        this.startLnHoldTimer(note.channel);
        continue;
      }
      this.commitFinalJudge('PERFECT', 0, seconds, note.channel);
      this.flashKeyOnTimer(note.channel);
    }
  }

  private autoFinalizeLongNotes(seconds: number): void {
    if (this.activeLongNotes.size === 0) {
      return;
    }
    for (const [channel, active] of this.activeLongNotes) {
      const endSeconds = active.note.endSeconds!;
      if (endSeconds <= seconds) {
        this.activeLongNotes.delete(channel);
        this.commitFinalJudge('PERFECT', 0, endSeconds, channel);
        this.triggerBombOnNonMiss(channel, 'PERFECT');
        // Same alpha-taper release as manual key-ups and auto-
        // judged short notes (via `flashKeyOnTimer`) so the LN
        // tail decays at the same speed without re-stamping the
        // key-on timer. Pair with the LN-hold-effect release so
        // any sustain visuals fade alongside the lane laser.
        this.releaseKeyOnTimer(channel);
        this.releaseLnHoldTimer(channel);
      }
    }
  }

  /**
   * Brief key-on flash. We start the per-lane LR2 key-on timer (100..107 /
   * 110..117) and schedule it to clear after a short interval so the laser
   * fades like a real keystroke. Used by autoplay (no real keyboard event)
   * so the player still sees the lane / key visuals react.
   */
  /**
   * Auto-judged short notes simulate a "press + release" in one
   * tick: the lane laser lights up immediately (timer set to
   * `playClock()` so the LR2 key-on keyframe begins) and stays
   * at peak alpha for {@link KEY_ON_FLASH_HOLD_MS} before
   * handing off to the release-fade path. Without that brief
   * hold the sprite would taper from full to invisible across
   * the first 1–2 render frames and the press would read as a
   * single-frame blink rather than a deliberate flash.
   */
  private flashKeyOnTimer(channel: string): void {
    this.startKeyOnTimer(channel);
    const timeout = window.setTimeout(() => {
      this.keyFlashTimeouts.delete(timeout);
      if (this.disposed) return;
      // A real press / sustained LN took over during the hold —
      // skip the auto-release, the manual lifecycle is in charge.
      if (this.pressedChannels.has(channel) || this.activeLongNotes.has(channel)) {
        return;
      }
      this.releaseKeyOnTimer(channel);
    }, KEY_ON_FLASH_HOLD_MS);
    this.keyFlashTimeouts.add(timeout);
  }

  /**
   * Chart-time seconds since the first beat, derived from the audio
   * context clock so it stays *bit-exact* with scheduled `node.start()`
   * times across pause / resume cycles. The wall-clock approach we used
   * previously (`performance.now() - pauseTotal`) drifted out of sync
   * with the audio context on every pause because `suspend()` and
   * `resume()` are asynchronous: the audio clock paused a few ms after
   * we recorded `pauseTime` and resumed a few ms before we credited
   * `pauseTotal`, so each toggle slid the two clocks apart by ~10–30 ms.
   *
   * Anchoring everything on `audioContext.currentTime` removes that
   * accumulating drift entirely. For environments where the audio
   * context isn't ready yet we fall back to the wall-clock model.
   */
  private currentSeconds(): number {
    if (this.audioContext && this.audioContextStartTime > 0) {
      return Math.max(0, this.audioContext.currentTime - this.audioContextStartTime);
    }
    if (this.paused) {
      return Math.max(0, (this.pauseTime - this.startTime - this.pauseTotal) / 1000);
    }
    return Math.max(0, (performance.now() - this.startTime - this.pauseTotal) / 1000);
  }

  private autoMiss(seconds: number): void {
    const bad = resolveJudgeWindowsMs(this.song!.chart).bad / 1000;
    while (this.autoMissCursor < this.notes.length) {
      const note = this.notes[this.autoMissCursor]!;
      if (seconds - note.seconds <= bad) {
        break;
      }
      this.autoMissCursor += 1;
      if (note.hit) {
        continue;
      }
      this.markNoteHit(note);
      applyJudgeToSummary(this.score, 'POOR', this.tracker);
      this.applyGaugeDelta('POOR');
      this.publishJudge('POOR', seconds, note.channel);
    }
  }

  private markNoteHit(note: RuntimeNote): void {
    if (note.hit) {
      return;
    }
    note.hit = true;
    if (this.remainingNotes > 0) {
      this.remainingNotes -= 1;
    }
  }

  private publishJudge(judge: JudgeKind, seconds: number, channel?: string): void {
    const until = seconds + 0.6;
    this.lastJudge = judge;
    this.lastJudgeUntil = until;
    // LR2 spec: timer 46 (1P judge) / 47 (2P judge) restarts on every
    // judgement on its respective side so the attached
    // `#DST_NOWJUDGE` / `#DST_NOWCOMBO` chains animate from time=0
    // per hit. Without this the keyframe playhead drifts hours into
    // the song and the post-hit fade-out keyframes have long since
    // passed. When `channel` isn't supplied (legacy callers) we
    // default to the 1P timer. PMS / 9 KEY is single-side so every
    // judgement collapses onto the 1P timer regardless of the
    // sourcing channel — the LR2 9-key skin authors only the 1P
    // judge plate (channels 22..25 belong to the central / right
    // half of the Pop'n nine-lane bank, not the second player).
    const isPlayer2 = this.chartPlayVariant !== '9' && typeof channel === 'string' && channel.startsWith('2');
    const side: '1P' | '2P' = isPlayer2 ? '2P' : '1P';
    this.timerStartedAt.set(isPlayer2 ? 47 : 46, this.playClock());
    // Snapshot the verdict + combo for this side so DP rendering
    // shows each lane group's *own* combo number — frozen at the
    // moment that side last hit a note — rather than mirroring
    // the global running combo on both sides.
    this.judgeSideState[side] = {
      judge,
      until,
      combo: this.tracker.combo,
    };
    // POOR / BAD judgements briefly swap the base BGA for the chart's
    // POOR BGA. We trigger the same window for `BAD` because the LR2
    // spec doesn't distinguish the two for the BGA channel.
    if (judge === 'POOR' || judge === 'BAD') {
      this.lastPoorAt = this.playClock();
    }
    // Mirror the running combo into our high-water mark. `tracker.combo`
    // resets on every BAD/POOR, so this captures the longest unbroken
    // GREAT-or-better streak the player has reached so far. Used as the
    // "MAX COMBO" readout for the result screen — see `getResultData`.
    if (this.tracker.combo > this.maxCombo) {
      this.maxCombo = this.tracker.combo;
    }
    // Append a sample to the result-screen polyline histories. We do
    // this in `publishJudge` (rather than at each judge call site)
    // because every gauge / EX-score change funnels through the same
    // judgement path — adding the sample once here keeps the three
    // judge sites (manual hit, auto-PERFECT, auto-miss) symmetric.
    const totalSeconds = this.resolveSongDurationSeconds();
    const progress = totalSeconds > 0 ? Math.max(0, Math.min(1, seconds / totalSeconds)) : 0;
    this.gaugeHistory.push({ progress, value: this.gaugeState.current });
    this.scoreHistory.push({ progress, exScore: this.score.exScore });
    this.maybeFireFullCombo();
  }

  /**
   * Fires the LR2 full-combo timers (48 = 1P, 49 = 2P) the moment
   * the player's running combo equals the chart's playable note
   * count — i.e. every note has been hit GREAT-or-better and the
   * chain never broke. Latches `fullComboFired` so subsequent
   * judges don't re-trigger the timer (which would replay the
   * skin's FC slide-in animation from time=0).
   *
   * AUTO mode also reaches this state on the very last note (every
   * judge is auto-PERFECT, so combo === total at the end) — the
   * player specifically asked for the FC presentation to fire in
   * AUTO too, which falls out for free since the path is the same
   * `applyJudgeToSummary` → `publishJudge` chain manual play uses.
   *
   * Both 48 and 49 are stamped at the same `performance.now()`
   * because we don't yet model per-side combos. For DP this is
   * correct (one player, one combo). Battle mode would split.
   */
  private maybeFireFullCombo(): void {
    if (this.fullComboFired) return;
    if (this.score.bad > 0 || this.score.poor > 0) return;
    if (this.score.total <= 0) return;
    if (this.tracker.combo < this.score.total) return;
    this.fullComboFired = true;
    const now = this.playClock();
    this.timerStartedAt.set(48, now);
    this.timerStartedAt.set(49, now);
    log.info('FULL COMBO');
  }

  /**
   * Pre-schedules every background sample whose chart-time is within the next
   * `lookAhead` seconds. We hand each sample a precise audio-context start time
   * (`audioContextStartTime + trigger.seconds`) so the Web Audio engine can fire
   * it sample-accurately, independent of when this method is next polled. The
   * ~0.5s look-ahead is large enough to absorb GC/stutters in the JS frame loop
   * yet small enough that pause/resume timing remains responsive.
   */
  private scheduleAutoSamples(seconds: number): void {
    // Hold off until the chart-start gate has fired and
    // `audioContextStartTime` is anchored to the audio clock —
    // until then `playSampleByKey` would clamp every queued
    // chart-second to "now" and start playing the BGM during
    // the LR2 LOADING phase.
    if (this.audioContextStartTime === 0) {
      return;
    }
    const lookAhead = 0.5;
    while (this.autoTriggerNextIndex < this.autoSampleTriggers.length) {
      const trigger = this.autoSampleTriggers[this.autoTriggerNextIndex]!;
      if (trigger.seconds > seconds + lookAhead) {
        break;
      }
      this.autoTriggerNextIndex += 1;
      this.playSampleByKey(trigger.sampleKey, trigger.seconds, {
        continuationFlag: trigger.event.bmson?.c === true,
        offsetSeconds: trigger.sampleOffsetSeconds,
        durationSeconds: trigger.sampleDurationSeconds,
      });
    }
    this.scheduleVolumeChanges(seconds, lookAhead);
  }

  /**
   * Drains pending BMS dynamic-volume events (channels `97` /
   * `98`) up to `chartSeconds + lookAhead` and writes their
   * authored 0..1 gain to the appropriate audio bus mixer at
   * the corresponding audio-context time. Mirrors the CLI's
   * realtime-volume scheduling so a chart that quiets the BGM
   * during a vocal break (or boosts the key bus for a
   * climactic drop) sounds the same on the web side.
   *
   * The scheduled `setValueAtTime` calls overwrite each other —
   * BMS volume events are absolute, not multiplicative — so a
   * later `setValueAtTime(0.5, t2)` cleanly replaces an earlier
   * `setValueAtTime(0.2, t1)` regardless of fire order.
   */
  private scheduleVolumeChanges(chartSeconds: number, lookAheadSeconds: number): void {
    if (!this.audioContext || this.volumeChangeEvents.length === 0) {
      return;
    }
    const horizon = chartSeconds + lookAheadSeconds;
    while (this.volumeChangeCursor < this.volumeChangeEvents.length) {
      const event = this.volumeChangeEvents[this.volumeChangeCursor]!;
      if (event.seconds > horizon) {
        break;
      }
      this.volumeChangeCursor += 1;
      const mixer = event.bus === 'key' ? this.audioBus?.keyMixer : this.audioBus?.bgmMixer;
      if (!mixer) continue;
      const startAt = Math.max(this.audioContext.currentTime, this.audioContextStartTime + event.seconds);
      // Web Audio raises an exception if `setValueAtTime` is
      // handed a non-finite value — `parseBmsDynamicVolumeGain`
      // already filtered those, so we just clamp into [0, 1]
      // for safety.
      const gain = Math.max(0, Math.min(1, event.gain));
      try {
        mixer.gain.setValueAtTime(gain, startAt);
      } catch {
        // Sealed AudioParam (extremely rare — only happens if
        // the bus has been disposed mid-flight). Drop the event
        // silently; the next play prepare resets the cursor.
      }
    }
  }

  /**
   * Plays a WAV sample by its `#WAV` key. When `scheduledChartSeconds` is given,
   * the buffer is *scheduled* to start at the corresponding audio-context
   * timestamp (precise Web Audio timing). Without it, the buffer starts
   * immediately -- used for input-driven hit sounds, where the player's key
   * press defines the start time.
   *
   * **Bus routing**: this is the auto-trigger path (`scheduleAutoSamples`
   * is the only caller), so the sample is the BMS BGM bed and routes
   * through `bgmMixer`. The split-bus compressor handles BGM and key
   * sounds independently — see `audio-bus.ts` for why.
   */
  private playSampleByKey(
    sampleKey: string,
    scheduledChartSeconds?: number,
    options: { continuationFlag?: boolean; offsetSeconds?: number; durationSeconds?: number } = {},
  ): void {
    if (!this.audioContext || !this.song) {
      return;
    }
    const path = (this.resolvedChart ?? this.song.chart).resources.wav[sampleKey];
    if (!path) {
      return;
    }
    if (options.continuationFlag === true && this.activeSampleNodes.has(sampleKey)) {
      // bmson `note.c = true` — a previous trigger of the same
      // sample is still emitting, so skip the retrigger and let
      // the sustained playback ride through. Mirrors the
      // playable-note path in `playSample`.
      return;
    }
    const buffer = this.decodedSamples.get(normalizePath(path).toLowerCase());
    if (!buffer) {
      return;
    }
    const node = this.audioContext.createBufferSource();
    node.buffer = buffer;
    node.onended = () => {
      try {
        node.disconnect();
      } catch {
        // Already disconnected or context closed.
      }
      // Drop the active-node tracking entry once the sample
      // finishes naturally so the next bmson `c=true` lookup
      // sees an empty slot and triggers a fresh start.
      if (this.activeSampleNodes.get(sampleKey) === node) {
        this.activeSampleNodes.delete(sampleKey);
      }
    };
    // BGM bus. Falls back to direct destination if `prepareAudio`
    // hasn't run yet (defensive — in practice the bus is always
    // built before any `play*` call).
    node.connect(this.audioBus?.bgmMixer ?? this.audioContext.destination);
    // bmson slicing — `offsetSeconds` seeks into the sound-channel
    // WAV and `durationSeconds` caps how long this slice plays.
    // Both are clamped against the buffer duration so a chart
    // that mis-authors them (or that sourced its slice positions
    // from a longer take) still produces audible output instead
    // of an instant abort. BMS / json paths leave both fields
    // undefined and play the whole WAV from t=0 — the historical
    // behaviour.
    const offsetSeconds = clampSampleOffset(options.offsetSeconds, buffer.duration);
    const durationSeconds = clampSampleDuration(options.durationSeconds, buffer.duration, offsetSeconds);
    if (scheduledChartSeconds !== undefined) {
      // Map chart seconds → audio-context time. Clamp to "now" so a slightly
      // late trigger (look-ahead just elapsed) still fires immediately rather
      // than throwing for a past timestamp.
      const startAt = Math.max(this.audioContext.currentTime, this.audioContextStartTime + scheduledChartSeconds);
      startSampleNode(node, startAt, offsetSeconds, durationSeconds);
    } else {
      startSampleNode(node, undefined, offsetSeconds, durationSeconds);
    }
    this.activeSampleNodes.set(sampleKey, node);
  }

  /**
   * Plays the keysound attached to a judged input note. Routes
   * through `keyMixer` so the key-bus compressor (split mode) sees
   * the input transient stream independently of the BGM.
   *
   * Honours the bmson 1.0.0 `note.c` (continuation flag): when
   * `c === true`, a still-playing instance of the same sample
   * suppresses the new trigger so the audio plays through
   * uninterrupted. Per the spec ("c=true → don't restart audio"),
   * this lets chart authors hold one sample across a chord /
   * burst of repeated notes without each hit re-attacking the
   * envelope. Notes without `c` (BMS-derived events, plain
   * bmson notes) keep the historical "every press triggers a
   * fresh playback" behaviour.
   */
  private playSample(note: RuntimeNote): void {
    if (!this.audioContext || !this.song) {
      return;
    }
    // `event.value` is already normalised under the chart's
    // authored base (36 = case-folded, 62 = case-preserved). Look
    // it up via `normalizeObjectKey(value, base)` rather than a
    // hard-coded `toUpperCase()` so a `#BASE 62` chart's lowercase
    // sample IDs (`#WAV0a`) hit their correct slot instead of
    // collapsing onto the uppercase variant.
    const chart = this.resolvedChart ?? this.song.chart;
    const sampleKey = normalizeObjectKey(note.event.value, resolveBmsBase(chart));
    const path = chart.resources.wav[sampleKey];
    if (!path) {
      return;
    }
    if (note.event.bmson?.c === true && this.activeSampleNodes.has(sampleKey)) {
      // bmson continuation flag — previous instance of this
      // sample is still playing, so do not retrigger.
      return;
    }
    const buffer = this.decodedSamples.get(normalizePath(path).toLowerCase());
    if (!buffer) {
      return;
    }
    const node = this.audioContext.createBufferSource();
    node.buffer = buffer;
    node.onended = () => {
      try {
        node.disconnect();
      } catch {
        // Already disconnected or context closed.
      }
      // Drop the active-node tracking entry once the sample
      // finishes naturally so the next bmson `c=true` lookup
      // sees an empty slot and triggers a fresh start.
      if (this.activeSampleNodes.get(sampleKey) === node) {
        this.activeSampleNodes.delete(sampleKey);
      }
    };
    // Key bus. Falls back to direct destination if `prepareAudio`
    // hasn't run yet (defensive — in practice the bus is always
    // built before any `play*` call).
    node.connect(this.audioBus?.keyMixer ?? this.audioContext.destination);
    // bmson slicing — for bmson charts, the playback map carries
    // the per-event `(offsetSeconds, durationSeconds)` tuple
    // produced by `createBmsonSamplePlaybackMap`. Honouring it
    // here means a chart that splits one long WAV across many
    // notes plays each note's intended slice instead of replaying
    // the whole file from t=0 on every hit. BMS / json charts
    // never populate `bmsonSlicePlayback` (slicing is a bmson-
    // only concept), so the lookup misses and the historical
    // play-from-zero behaviour kicks in.
    const slice = this.bmsonSlicePlayback?.get(note.event);
    const offsetSeconds = clampSampleOffset(slice?.offsetSeconds, buffer.duration);
    const durationSeconds = clampSampleDuration(slice?.durationSeconds, buffer.duration, offsetSeconds);
    startSampleNode(node, undefined, offsetSeconds, durationSeconds);
    this.activeSampleNodes.set(sampleKey, node);
  }

  private render(seconds: number): void {
    const screenWidth = this.app.screen.width;
    const screenHeight = this.app.screen.height;
    const viewport = resolveScaledViewport(screenWidth, screenHeight, DESIGN_WIDTH, DESIGN_HEIGHT);
    // Only rebuild the static rect graphics when their backing
    // dimensions actually change. The previous unconditional
    // `.clear().rect().fill()` chain ran on every rAF tick and
    // rebuilt the GraphicsContext for each — Pixi v8 has no
    // change-detection built in.
    if (this.cachedScreenWidth !== screenWidth || this.cachedScreenHeight !== screenHeight) {
      this.viewportBackground.clear().rect(0, 0, screenWidth, screenHeight).fill(BG);
      this.cachedScreenWidth = screenWidth;
      this.cachedScreenHeight = screenHeight;
    }
    this.root.position.set(viewport.x, viewport.y);
    this.root.scale.set(viewport.scale);
    this.applyExitFadeAlpha();
    this.perf.time('renderSkin', () => this.renderSkin(DESIGN_WIDTH, DESIGN_HEIGHT));
    this.perf.time('renderBga', () => this.renderBga(seconds));
    this.perf.time('renderLanes', () => this.renderLanes(DESIGN_WIDTH, DESIGN_HEIGHT));
    this.perf.time('renderNotes', () => this.renderNotes(seconds, DESIGN_HEIGHT));
    this.perf.time('renderShutter', () => this.renderShutter());
    this.perf.time('renderBombs', () => this.renderBombs());
    // Retire timer 48 / 49 once the FC animation has played out.
    // Same pattern as bomb-timer cleanup: without this the skin's
    // `loop = -1` FC graphic stays clamped to its final frame for
    // the remainder of the play session. Cheap O(1) lookup so we
    // can run it unconditionally every frame.
    this.cleanupFullComboTimer();
    this.perf.time('renderText', () => this.renderText(DESIGN_WIDTH, DESIGN_HEIGHT, seconds));
  }

  /**
   * One-shot full-combo timer cleanup. Same pattern as
   * {@link cleanupBombTimers}: once the FC animation's full
   * keyframe-time window has elapsed, retire timer 48 / 49 from
   * `timerStartedAt` so the skin's FC graphic (`loop = -1` "play
   * once and clamp" by convention) doesn't stay frozen on its
   * final frame for the rest of the play session. Idempotent —
   * the lookups are O(1) and the second call after retirement is
   * a no-op.
   */
  private cleanupFullComboTimer(): void {
    const startedAt = this.timerStartedAt.get(48);
    if (startedAt === undefined) {
      return;
    }
    if (this.playClock() - startedAt < this.fullComboDurationMs) {
      return;
    }
    this.timerStartedAt.delete(48);
    this.timerStartedAt.delete(49);
  }

  /**
   * One-shot bomb timer cleanup. Runs every frame so the LR2 bomb
   * timers (50–69) stop being "active" once the skin's authored
   * explosion keyframes have played out. The per-timer duration is
   * pre-computed in {@link prepareSkin} via `computeBombDurationsMs`
   * (longest `time` keyframe across elements gated on each timer),
   * with `BOMB_CLEANUP_FALLBACK_MS` covering skinless / unauthored
   * slots. Without this retirement, the skin's `#DST_IMAGE`
   * (typically `loop=-1` "play once and clamp") would keep
   * displaying the last frame of the explosion forever.
   */
  private cleanupBombTimers(): void {
    if (this.bombStartedAt.size === 0) {
      return;
    }
    const now = this.playClock();
    for (const [channel, startedAt] of Array.from(this.bombStartedAt.entries())) {
      const laneIndex = resolveSideRelativeLaneIndex(channel, this.chartPlayVariant);
      const isPlayer2 = this.chartPlayVariant !== '9' && channel.startsWith('2');
      const timerId = (isPlayer2 ? LR2_2P_BOMB_TIMER_BASE : LR2_1P_BOMB_TIMER_BASE) + laneIndex;
      // Per-bomb-timer cleanup duration — derived from the loaded
      // skin's keyframes in `prepareSkin` so each lane's explosion
      // retires at its authored cycle length, with the LR2-default
      // 150 ms fallback for skinless / unauthored slots.
      const cleanupAtMs = this.bombDurationMs.get(timerId) ?? BOMB_CLEANUP_FALLBACK_MS;
      if (now - startedAt < cleanupAtMs) {
        continue;
      }
      this.bombStartedAt.delete(channel);
      this.timerStartedAt.delete(timerId);
    }
  }

  /**
   * Draws the LR2 HIDDEN / SUDDEN / HID+SUD masks over the
   * playfield. Pulls the union of all lanes' top/bottom from
   * `laneX` so the mask exactly covers the lane area regardless
   * of how the skin laid the lanes out (single-side, DP, etc.).
   *
   * `playOptions.shutter` (0..1) controls the fraction of the
   * playfield each active mask covers. With HID+SUD that fraction
   * applies to BOTH ends, so 0.5 leaves a thin slit in the middle.
   */
  private renderShutter(): void {
    this.shutterLayer.clear();
    // LANE COVER (`button_type 46`) is the master ON/OFF switch
    // for the playfield mask. With it OFF, no shutter renders
    // even if HIDDEN / SUDDEN / HID+SUD is selected — matches
    // LR2's behaviour where the user toggles LANE COVER off to
    // hide the cover without losing the height they had dialled
    // in. The HIDDEN / SUDDEN cycle picks WHERE the mask sits
    // (top / bottom / both); this gate decides WHETHER it shows.
    if (this.options.laneCover === false) return;
    if (this.laneX.size === 0) return;
    const shutter = Math.max(0, Math.min(1, this.options.shutter ?? 0.25));
    if (shutter <= 0) return;
    const mode1P = this.options.hiddenSudden1P ?? 'OFF';
    const mode2P = this.options.hiddenSudden2P ?? 'OFF';
    if (mode1P === 'OFF' && mode2P === 'OFF') return;
    // Per-side mask: collect each side's lane bounding box from
    // `laneX`. Channels 11..16, 18, 19 are 1P (keyboard + scratch +
    // start/select); 21..26, 28, 29 are 2P. SP charts only have 1P
    // lanes registered, so the 2P loop will yield an empty bbox
    // and skip rendering — drawing the 1P mask covers the whole
    // playfield in that case, exactly as before.
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
      // SUDDEN — opaque rect at the TOP of the playfield. Notes
      // emerge below it.
      this.shutterLayer.rect(bounds.left, bounds.top, width, maskHeight).fill({ color: 0x000000, alpha: 0.92 });
    }
    if (mode === 'HIDDEN' || mode === 'HID+SUD') {
      // HIDDEN — opaque rect at the BOTTOM of the playfield, just
      // above the judge line (lanes' `bottom` is the judge line
      // bottom edge — the mask itself ends there).
      this.shutterLayer
        .rect(bounds.left, bounds.bottom - maskHeight, width, maskHeight)
        .fill({ color: 0x000000, alpha: 0.92 });
    }
  }

  private renderBombs(): void {
    // Pixi v8 holds renderer-side state (Graphics contexts, glyph
    // atlas tiles) for every detached child until each one is
    // explicitly destroyed. `disposeChildren` does both — see
    // `pixi-utils.ts` for why a bare `removeChildren()` was the
    // root cause of the post-chart browser hang.
    disposeChildren(this.bombLayer);
    this.cleanupBombTimers();
    // When an LR2 skin is loaded the bomb sprite is already part of the
    // skin's `#DST_IMAGE` set (one entry per lane, gated on bomb timer
    // 50–57 / 60–67). Drawing our own copy on top would double-render the
    // explosion, so this fallback only fires for the default (skinless)
    // demo experience.
    if (this.options.skin !== undefined || !this.bombTexture || this.bombStartedAt.size === 0) {
      return;
    }
    const naturalRatio = this.bombTexture.frame.width / Math.max(1, this.bombTexture.frame.height);
    const lr2Layout = naturalRatio >= 6;
    const divx = lr2Layout ? 9 : BOMB_DIVX;
    const divy = lr2Layout ? 1 : BOMB_DIVY;
    const totalFrames = divx * divy;
    const cellWidth = this.bombTexture.frame.width / divx;
    const cellHeight = this.bombTexture.frame.height / divy;
    const cycle = lr2Layout ? 150 / totalFrames : BOMB_CYCLE_MS;
    const now = this.playClock();
    for (const [channel, startedAt] of Array.from(this.bombStartedAt.entries())) {
      const elapsed = now - startedAt;
      const lane = this.laneX.get(channel);
      if (!lane) {
        continue;
      }
      // Frame is clamped — never wraps — so the explosion plays exactly once.
      const frameIndex = Math.min(totalFrames - 1, Math.max(0, Math.floor(elapsed / cycle)));
      const cellX = frameIndex % divx;
      const cellY = Math.floor(frameIndex / divx);
      const cropped = createCroppedTexture(this.bombTexture, {
        x: cellWidth * cellX,
        y: cellHeight * cellY,
        w: cellWidth,
        h: cellHeight,
      });
      if (!cropped) {
        continue;
      }
      const sprite = new Sprite(cropped);
      sprite.label = `bomb[ch=${channel},frame=${frameIndex}]`;
      const displayWidth = Math.max(cellWidth * 0.6, lane.w * (lr2Layout ? 4.5 : 3));
      const displayHeight = displayWidth * (cellHeight / cellWidth);
      sprite.position.set(lane.x + lane.w / 2 - displayWidth / 2, lane.bottom - displayHeight * 0.45);
      sprite.width = displayWidth;
      sprite.height = displayHeight;
      sprite.blendMode = 'add';
      this.bombLayer.addChild(sprite);
    }
  }

  /**
   * Composites the chart's BGA into the LR2 skin's `#DST_BGA` rectangle.
   * Three layers stack from back to front: base (channel 04 / bmson
   * `bga.events`), layer (channel 07 / 0A / bmson `layerEvents`), and a
   * POOR override (channel 06 / `poorEvents`) that briefly replaces the
   * base while the player is in a 2-second POOR-judgement window.
   *
   * The renderer is idempotent per frame — it tears down any existing
   * sprites and rebuilds from the active cues, so cue switches show up
   * the next frame without explicit dirty tracking.
   */
  private renderBga(seconds: number): void {
    disposeChildren(this.bgaLayer);
    // Honour the LR2 panel-1 BGA toggle (`#SRC_BUTTON,type=72`).
    // - `'OFF'`            → never render
    // - `'AUTOPLAY_ONLY'`  → render only when autoplay is on
    // - `'ON'` (default)   → render whenever the chart has BGA
    const bgaMode = this.options.bga ?? 'ON';
    if (bgaMode === 'OFF') return;
    if (bgaMode === 'AUTOPLAY_ONLY' && !this.options.autoPlay) return;
    const skin = this.options.skin;
    if (!skin || !this.hasBga || skin.bgas.length === 0) {
      return;
    }
    // Render ALL `#DST_BGA` rectangles whose op gating is true.
    // For SP charts the LR2 default skin authors two — op 30
    // ("BGA NORMAL") and op 31 ("BGA EXTEND") — and only one
    // is visible at a time, so the loop produces a single
    // sprite. For DP (`14keys/14_LR0.csv` line 78+) the skin
    // authors *three* rects: one big op-31 EXTEND square plus
    // a pair of op-30 NORMAL panels stacked vertically on the
    // right side. The previous `find(...)` short-circuited at
    // the first match and clipped the second NORMAL panel, so
    // DP charts under "BGA NORMAL" mode showed only the top
    // panel and left the bottom one blank.
    const visibleBgas = skin.bgas.filter((entry) => this.isDestinationVisible(entry.destination));
    if (visibleBgas.length === 0) {
      return;
    }
    // Drive video BGA playback once per frame (not per-rect)
    // — base / layer cues are global to the chart, every rect
    // shows the same source video. Picking the first visible
    // entry's `noBase` / `noLayer` flags as the controlling
    // ones is fine in practice: the LR2 default skin uses
    // identical flags on every rect, and a future skin that
    // mixes them per-rect would still get a consistent global
    // playback state from this single sync point.
    const controllingBga = visibleBgas[0]!;
    const baseCue = controllingBga.noBase ? undefined : pickActiveBgaCue(this.bgaTimeline.base, seconds);
    const layerCue = controllingBga.noLayer ? undefined : pickActiveBgaCue(this.bgaTimeline.layer, seconds);
    const baseKey = baseCue?.bmpKey;
    const layerKey = layerCue?.bmpKey;
    const poorWindowMs = 2000;
    const inPoorWindow =
      !controllingBga.noPoor && this.lastPoorAt > 0 && this.playClock() - this.lastPoorAt < poorWindowMs;
    let poorKey = inPoorWindow ? pickActiveBgaKey(this.bgaTimeline.poor, seconds) : undefined;
    // BMP00 fallback: when no explicit POOR cue is active but the
    // chart left `#POORBGA` blank with a `#BMP00` defined, paint
    // BMP00 during the miss window. Capped at the first authored
    // POOR cue's chart-time so a chart that does eventually
    // author POOR isn't permanently stuck on the placeholder.
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
      const dst = this.evaluateElementDst(bga);
      const { x, y, w, h } = normaliseRect(dst);
      if (w <= 0 || h <= 0) continue;
      const drawLayer = (key: string | undefined, textures: ReadonlyMap<string, Texture>, layerName: string): void => {
        if (!key) return;
        const texture = textures.get(key);
        if (!texture) return;
        // Stretch the BGA texture to fill this rect exactly. The
        // previous version routed through a BMS 256×256 spec
        // canvas which left non-256 sources covering only part
        // of the DST and produced visible "letterbox" gaps. LR2
        // stretches straight to the skin rect, matching here.
        const sprite = new Sprite(texture);
        sprite.label = `bga/${layerName}[key=${key}]`;
        sprite.position.set(x, y);
        sprite.width = w;
        sprite.height = h;
        applyDestinationToSprite(sprite, dst);
        this.bgaLayer.addChild(sprite);
      };
      if (poorKey) {
        // POOR uses base-mode decoding (no chroma key) since it
        // replaces the entire base+layer composite during its
        // window.
        drawLayer(poorKey, this.bgaTextures, 'poor');
      } else {
        drawLayer(baseKey, this.bgaTextures, 'base');
        // Layer track is composited on top with black→transparent
        // so the base track shows through where the foreground BMP
        // is empty.
        drawLayer(layerKey, this.bgaLayerTextures, 'layer');
      }
    }
  }

  /**
   * Drives playback of a video BGA on a single track (`base` or
   * `layer`). When the cue's key matches a known video:
   *   - first time it fires, `play()` from the cue's start offset
   *   - re-firing the same cue is a no-op (video keeps playing)
   *   - switching keys pauses the previous video, then plays the new
   *
   * Static (non-video) cues just clear the active-video record so
   * the next video transition starts fresh. The seek offset uses
   * `seconds - cue.seconds` directly because BMS BGA semantics are
   * "start playing this video from t=0 the moment the cue fires".
   */
  private syncBgaVideo(track: 'base' | 'layer', cue: BgaCue | undefined, seconds: number): void {
    // Hold off on every video state mutation until the chart-start
    // gate has fired and `audioContextStartTime` is anchored to the
    // audio clock. Without this guard `renderBga` (which runs every
    // tick from the moment `start()` reveals the scene) picks up
    // the t=0 BGA cue while we're still in the LR2 LOADING phase
    // and `play()`s the video — the user sees the BGA running
    // behind the LOADING / DONE chrome. By short-circuiting we
    // also avoid populating `bgaActiveVideos[track]`, so when
    // PLAY START fires the next sync call still sees `previous =
    // undefined` and re-enters the "first cue" branch with the
    // correct seek offset.
    if (this.audioContextStartTime === 0) {
      return;
    }
    const previous = this.bgaActiveVideos[track];
    const key = cue?.bmpKey;
    const handle = key ? this.bgaVideos.get(key) : undefined;
    if (!handle) {
      // Cue points at a still image (or nothing). If we were
      // playing a video, pause it.
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
      // Same cue still active — nothing to do; the video plays
      // forward on its own and the Pixi VideoSource pulls fresh
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
      // Some browsers throw on currentTime assignment before the
      // video has its initial buffer. Best-effort — play() below
      // will retry once the buffer arrives.
    }
    void handle.video.play().catch(() => {
      // Autoplay policy / codec rejections — silently swallow so
      // the still-image fallback keeps working.
    });
  }

  private renderSkin(width: number, height: number): void {
    disposeChildren(this.skinLayer);
    disposeChildren(this.overlayLayer);
    const skin = this.options.skin;
    if (!skin) {
      // Pass live runtime values into the fallback chrome so its
      // text overlays (score / combo / BPM / hi-speed / judge
      // counter / rank) render real chart numbers — same as the
      // LR2 default skin would via `#DST_NUMBER` digit cells.
      const total = this.score.total > 0 ? this.score.total : 0;
      const exScoreMax = total * 2;
      renderFallbackLr2Frame(this.skinLayer, {
        songTitle: this.song?.title,
        songArtist: this.song?.artist,
        bpm: this.song?.bpm,
        hiSpeed: this.hiSpeed,
        score: this.score.score,
        exScore: this.score.exScore,
        exScoreMax,
        combo: this.tracker.combo,
        maxCombo: this.maxCombo,
        perfect: this.score.perfect,
        great: this.score.great,
        good: this.score.good,
        bad: this.score.bad,
        poor: this.score.poor,
        lastJudge: this.lastJudge,
        rank: total <= 0 ? '—' : resolveIidxRankLabel(this.score.exScore, total),
        autoplay: this.options.autoPlay === true,
      });
      return;
    }
    const scale = Math.min(width / skin.width, height / skin.height);
    this.skinLayer.scale.set(scale);
    this.skinLayer.position.set((width - skin.width * scale) / 2, (height - skin.height * scale) / 2);
    // Mirror the skin transform onto the overlay AND BGA layers so they
    // share the same design-pixel coordinate system as `renderSkin`.
    this.overlayLayer.scale.set(scale);
    this.overlayLayer.position.copyFrom(this.skinLayer.position);
    this.bgaLayer.scale.set(scale);
    this.bgaLayer.position.copyFrom(this.skinLayer.position);
    // Two-pass image render so the judgement line lands at the right
    // z-depth: drawn AFTER the static frame / lane background (so the red
    // bar isn't covered by the lane area) but BEFORE on-top overlays —
    // bombs (timer 50–69), LN holds (70–89), key-on lasers (100–139) — so
    // those visually punch through the line.
    for (const image of skin.images) {
      if (isLr2OverlayImage(image)) {
        continue;
      }
      this.renderSkinImage(image);
    }
    for (const judgeLine of skin.judgeLines) {
      // Render every side's judgement line. DP charts authored with
      // both `#DST_JUDGELINE,0,...` (1P) and `#DST_JUDGELINE,1,...`
      // (2P) get both bars drawn at their respective playfield
      // positions. SP charts only have one entry, so this is a
      // no-cost loop in the common case.
      this.renderJudgeLineElement(judgeLine);
    }
    for (const image of skin.images) {
      if (!isLr2OverlayImage(image)) {
        continue;
      }
      this.renderSkinImage(image);
    }
    for (const number of skin.numbers) {
      if (!this.isDestinationVisible(number.destination)) {
        continue;
      }
      const value = resolveNumberValue(
        number.source.num,
        this.score,
        this.song,
        this.gaugeState.current,
        this.tracker.combo,
        this.hiSpeed,
        this.currentSeconds(),
        this.displayedScore,
        this.fps,
        this.timingResolver?.bpmAtBeat(this.currentBeat(this.currentSeconds())),
        this.resolveSongDurationSeconds(),
        this.maxCombo,
      );
      if (value === undefined) {
        continue;
      }
      renderNumberElement(this.skinLayer, number, value, this.textures, this.evaluateElementDst(number), {
        // Groove-gauge percentage is naturally variable-length; LR2 default
        // skins specify keta=3 which would print "020" / "100". Suppress
        // leading zeros so the displayed value reads like a normal integer.
        suppressLeadingZeros: number.source.num === 107,
      });
    }
    for (const gauge of skin.grooveGauges) {
      if (gauge.index !== 0) {
        // 1P only for now -- 2P side requires battle/dp wiring.
        continue;
      }
      if (!this.isDestinationVisible(gauge.destination)) {
        continue;
      }
      renderGrooveGaugeElement(
        this.skinLayer,
        gauge,
        this.gaugeState.current,
        this.textures,
        this.evaluateElementDst(gauge),
        {
          peakPercent: this.gaugePeak,
          // Drives the LR2 4-cell × N-frame animation cycle
          // (lit-tip highlight scan). Anchored to the SRC's
          // timer per spec — `0` is "scene start" which is
          // what most skins use for the gauge.
          elapsedMs: this.elapsedSinceTimer(gauge.source.timer),
        },
      );
    }
    for (const bargraph of skin.bargraphs) {
      if (!this.isDestinationVisible(bargraph.destination)) {
        continue;
      }
      this.renderBarGraphElement(bargraph);
    }
    for (const slider of skin.sliders) {
      if (!this.isDestinationVisible(slider.destination)) {
        continue;
      }
      this.renderSliderElement(slider);
    }
    for (const text of skin.texts) {
      if (!this.isDestinationVisible(text.destination)) {
        continue;
      }
      this.renderTextElement(text);
    }
    this.renderJudgeAndComboOnOverlay(skin);
  }

  /**
   * Renders a single LR2 `#SRC_IMAGE` + `#DST_IMAGE` element to the skin
   * layer. Factored out so the caller can interleave `judgeLines` between
   * the static frame images and the timer-driven overlays (bombs, lasers,
   * key-on flashes) — see `renderSkin`.
   */
  private renderSkinImage(image: Lr2ImageElement): void {
    if (!this.isDestinationVisible(image.destination)) {
      return;
    }
    // Interpolate the destination keyframes against the timer-anchored
    // elapsed time so multi-keyframe `#DST_IMAGE` sequences animate smoothly.
    const elapsed = this.elapsedSinceTimer(image.destination.timer);
    const dst = image.keyframes.length > 1 ? evaluateKeyframes(image.keyframes, elapsed) : image.destination;
    // LR2: a DST with explicit w=0 or h=0 is effectively a no-op. Negative
    // w/h is valid (grow-in-opposite-direction); only zero is hidden.
    if (dst.w === 0 || dst.h === 0) {
      return;
    }
    const baseTexture = this.textures.get(image.source.imagePath);
    if (!baseTexture) {
      return;
    }
    // For LR2 special-graphic slots (`gr=100..111`) the chart's actual
    // STAGEFILE / BACKBMP / BANNER is loaded under the sentinel path
    // and is the WHOLE image — not a cell of a divx*divy grid. Skip
    // the cell crop and use the live texture as-is so its native
    // dimensions are preserved (the DST rectangle still scales it
    // into the skin's intended slot).
    let texture: Texture | undefined;
    if (isLr2SpecialGraphic(image.source.imagePath)) {
      texture = baseTexture;
    } else {
      // Pick the current SRC cell from the divx*divy animation grid; a `loop=-1`
      // destination clamps SRC frames at the last cell (one-shot effects).
      // Pass the texture extents so LR2's `w=0` / `h=0` "use native size"
      // shorthand resolves correctly — without it, `w=0` produces a
      // zero-width cell and we'd skip rendering the element entirely.
      // SRC cycling and DST keyframe looping are independent in LR2.
      // Pass `dst.loop` to `pickAnimatedCell` ONLY for the one-shot
      // overlay timers (FC 48/49, bombs 50–69) so their explosion
      // plays through the SRC cells exactly once and then clamps at
      // the last frame for the brief moment before the timer's own
      // cleanup retires the element. Every other element — most
      // critically the LR2 default skin's "DONE" plate (timer 40 +
      // op 81 + dst.loop=-1) — relies on continuous SRC cycling for
      // its blink animation, so we pass `undefined` and let
      // `pickAnimatedCell` use its default looping behaviour.
      const dstTimer = image.destination.timer;
      const isOneShotOverlayTimer = dstTimer === 48 || dstTimer === 49 || (dstTimer >= 50 && dstTimer <= 69);
      const srcLoop = isOneShotOverlayTimer ? dst.loop : undefined;
      const cellRect = pickAnimatedCell(image.source, this.elapsedSinceTimer(image.source.timer), srcLoop, {
        width: baseTexture.width,
        height: baseTexture.height,
      });
      if (cellRect.w <= 0 || cellRect.h <= 0) {
        return;
      }
      texture = createCroppedTexture(baseTexture, cellRect);
    }
    if (!texture) {
      return;
    }
    const sprite = new Sprite(texture);
    sprite.label = `image[${image.source.imagePath}]`;
    const { x, y, w, h } = normaliseRect(dst);
    // op4=1 / op4=2 are the LR2 scratch-turntable spin markers
    // (1P / 2P side respectively). We drive the sprite from
    // {@link turntableAngle}, which {@link updateTurntable}
    // integrates from per-press impulses with exponential decay
    // — pressing scratch kicks the disc, releasing lets it spin
    // down. Anchor at the centre so the rotation pivots through
    // the visible disc rather than spinning around the top-left
    // corner; PixiJS's y-down coords make positive `rotation`
    // turn the disc clockwise on screen.
    if (dst.op4 === 1 || dst.op4 === 2) {
      const side = dst.op4 === 1 ? '1' : '2';
      sprite.anchor.set(0.5, 0.5);
      sprite.position.set(x + w / 2, y + h / 2);
      sprite.rotation = this.turntableAngle[side];
    } else {
      sprite.position.set(x, y);
    }
    sprite.width = w;
    sprite.height = h;
    applyDestinationToSprite(sprite, dst);
    // Lane-laser release fade. When `releaseKeyOnTimer` has marked
    // a key-on slot (timer 100..117) as fading, OVERRIDE the
    // sprite's alpha with a linear 1 → 0 taper over
    // `KEY_ON_FADE_OUT_MS`. We override (rather than multiply)
    // because the LR2 default skin's key-on keyframe[0] is the
    // fade-in origin (alpha = 0) — multiplying that by our taper
    // would keep the laser invisible the whole time. Position /
    // size / colour from the keyframe still apply via the rest of
    // `applyDestinationToSprite`.
    const keyOnFadeStart = this.keyOnFadeOutStart.get(image.destination.timer);
    if (keyOnFadeStart !== undefined) {
      const elapsed = this.playClock() - keyOnFadeStart;
      const fadeMs = this.keyOnFadeDurationMs.get(image.destination.timer) ?? KEY_ON_FADE_OUT_MS;
      sprite.alpha = Math.max(0, 1 - elapsed / fadeMs);
    }
    // Same alpha taper for LN-hold-effect timers (70..89). Authored
    // hold sprites stay visible while the timer is active and
    // decay through this taper after `releaseLnHoldTimer` records
    // the fade origin.
    const lnHoldFadeStart = this.lnHoldFadeOutStart.get(image.destination.timer);
    if (lnHoldFadeStart !== undefined) {
      const elapsed = this.playClock() - lnHoldFadeStart;
      const fadeMs = this.lnHoldFadeDurationMs.get(image.destination.timer) ?? KEY_ON_FADE_OUT_MS;
      sprite.alpha = Math.max(0, 1 - elapsed / fadeMs);
    }
    // The AUTOPLAY label (any image gated on op 33) belongs in the same
    // visual layer as the judgement plate — i.e. above the falling notes.
    // All other skin images stay in the regular skin layer.
    const targetLayer = image.destination.ops.includes(33) ? this.overlayLayer : this.skinLayer;
    targetLayer.addChild(sprite);
  }

  /**
   * Renders the LR2 `#DST_JUDGELINE` sprite (the horizontal bar at the
   * judgement line, typically a thin red strip in the LR2 default 7-keys
   * skin). The skin's source frame already encodes the colour; we only need
   * to honour the destination rectangle.
   */
  private renderJudgeLineElement(judgeLine: Lr2JudgeLineElement): void {
    if (!this.isDestinationVisible(judgeLine.destination)) {
      return;
    }
    const dst = this.evaluateElementDst(judgeLine);
    if (dst.w === 0 || dst.h === 0) {
      return;
    }
    const baseTexture = this.textures.get(judgeLine.source.imagePath);
    if (!baseTexture) {
      return;
    }
    const texture = createCroppedTexture(baseTexture, judgeLine.source);
    if (!texture) {
      return;
    }
    const sprite = new Sprite(texture);
    sprite.label = `judgeline[idx=${judgeLine.index}]`;
    sprite.position.set(dst.x, dst.y);
    sprite.width = dst.w;
    sprite.height = dst.h;
    applyDestinationToSprite(sprite, dst);
    this.skinLayer.addChild(sprite);
  }

  /**
   * Picks the current destination rect for any element type. When the
   * element has a multi-keyframe DST chain, interpolates against the
   * timer-anchored elapsed time. Otherwise returns the static destination.
   */
  private evaluateElementDst(element: {
    destination: Lr2DestinationRect;
    keyframes: Lr2DestinationRect[];
  }): Lr2DestinationRect {
    if (element.keyframes.length > 1) {
      return evaluateKeyframes(element.keyframes, this.elapsedSinceTimer(element.destination.timer));
    }
    return element.destination;
  }

  /**
   * Renders an LR2 `#DST_TEXT` element. We currently use a system font (no
   * `#LR2FONT` bitmap-font support yet), which means custom-styled labels in
   * the LR2 skin will look generic. The string content for each `st` code is
   * resolved from the loaded chart metadata.
   */
  private renderTextElement(text: Lr2TextElement): void {
    const interpolated = this.evaluateElementDst(text);
    const { x, y, w, h } = normaliseRect(interpolated);
    // `w === 0` is an LR2-spec "no width constraint" hint (the field
    // shrinks to fit the rendered string), so we must NOT bail just
    // because of it — skipping would hide every auto-sized label,
    // including the centered song-title display in the LR2 default
    // play skin. Only `h === 0` is fatal (no glyph height to size on).
    if (h === 0) {
      return;
    }
    const value = this.resolveTextValue(text.st);
    if (!value) {
      return;
    }
    // Bitmap-font path — when the host loaded the matching
    // `#LR2FONT`, paint glyphs from its sprite sheet so the text
    // matches the skin's pixel-art aesthetic. Falls through to the
    // system-font path below when the font index isn't loaded.
    const loaded = this.bitmapFonts.get(text.font);
    if (loaded) {
      this.skinLayer.addChild(makeLr2BitmapTextSprite(value, text, interpolated, loaded));
      return;
    }
    // Match the LR2 destination height as the font size; this gives roughly
    // the right size for system fonts even though the original skin used a
    // bitmap font that pre-baked size and glyph spacing.
    const fontSize = Math.max(8, Math.min(64, h * 0.8));
    const tint = (interpolated.r << 16) | (interpolated.g << 8) | interpolated.b;
    const node = new Text({
      text: value,
      style: new TextStyle({
        fill: tint,
        fontSize,
        fontWeight: '600',
        fontFamily: 'system-ui, sans-serif',
      }),
    });
    node.label = `text[st=${text.st}]`;
    node.alpha = interpolated.alpha;
    // LR2 #SRC_TEXT spec (`docs/LR2SkinHelp.md` lines 1350+):
    //   align=0 → DST x is the LEFT edge of the rendered string
    //   align=1 → DST x is the CENTER of the rendered string
    //   align=2 → DST x is the RIGHT edge of the rendered string
    if (text.alignment === 'center') {
      node.anchor.set(0.5, 0.5);
    } else if (text.alignment === 'right') {
      node.anchor.set(1, 0.5);
    } else {
      node.anchor.set(0, 0.5);
    }
    node.position.set(x, y + h / 2);
    // LR2 shrink-to-fit (LR2SkinHelp line 1343): the rendered
    // string is auto-compressed horizontally when its width
    // exceeds the DST's `w`. We squeeze via `scale.x`; the scale
    // applies around the text's anchor, so the alignment edge
    // stays pinned (right-aligned text squeezes toward its right
    // edge, centred text stays centred, …).
    if (w > 0 && node.width > w) {
      node.scale.x = w / node.width;
    }
    this.skinLayer.addChild(node);
  }

  /**
   * Resolves the string content for an `#SRC_TEXT,st=…` slot. This is a
   * minimal subset focused on values that are meaningful during a play
   * session — title / subtitle / artist / genre / difficulty.
   */
  private resolveTextValue(st: number): string | undefined {
    const song = this.song;
    if (!song) {
      return undefined;
    }
    const subartists = song.chart.bmson.info?.subartists?.join(' / ');
    switch (st) {
      case 1:
        // Target / rival name. We don't have a multiplayer rival, so just
        // show "TARGET" as a placeholder so the slot isn't visually missing.
        return 'TARGET';
      case 2:
        return 'PLAYER';
      case 10:
      case 20:
        return song.title;
      case 11:
      case 21:
        return song.subtitle ?? '';
      case 12:
      case 22:
        return [song.title, song.subtitle].filter((value): value is string => Boolean(value)).join(' ');
      case 13:
      case 23:
        return song.genre ?? '';
      case 14:
      case 24:
        return song.artist ?? '';
      case 15:
      case 25:
        return subartists ?? '';
      case 17:
      case 27:
        return song.playLevel?.toString() ?? '';
      case 18:
      case 28:
        return resolveDifficultyName(song.chart.metadata.difficulty);
      default:
        return undefined;
    }
  }

  /**
   * Renders an LR2 `#SRC_BARGRAPH` element. The bar is drawn by clipping the
   * destination rect to a `progress`-fraction of its width (or height for
   * vertical bars). Only the most common types — gauge, score graph, song
   * progress — are wired; others fall back to a 0-progress (hidden) draw.
   */
  private renderBarGraphElement(bargraph: Lr2BarGraphElement): void {
    const interpolated = this.evaluateElementDst(bargraph);
    const { x, y, w, h } = normaliseRect(interpolated);
    if (w === 0 || h === 0) {
      return;
    }
    const baseTexture = this.textures.get(bargraph.source.imagePath);
    if (!baseTexture) {
      return;
    }
    const progress = this.resolveBarGraphProgress(bargraph.type);
    if (progress <= 0) {
      return;
    }
    // Stretch the SRC rect over the (clipped) DST rect. For horizontal bars
    // we shrink the width by `progress`; for vertical bars we shrink height
    // and shift the top edge down so the bar fills upward.
    const cropTexture = createCroppedTexture(baseTexture, bargraph.source);
    if (!cropTexture) {
      return;
    }
    const sprite = new Sprite(cropTexture);
    sprite.label = `bargraph[type=${bargraph.type}]`;
    if (bargraph.muki === 'vertical') {
      const filledHeight = Math.round(h * progress);
      sprite.position.set(x, y + (h - filledHeight));
      sprite.width = w;
      sprite.height = filledHeight;
    } else {
      sprite.position.set(x, y);
      sprite.width = Math.round(w * progress);
      sprite.height = h;
    }
    applyDestinationToSprite(sprite, interpolated);
    this.skinLayer.addChild(sprite);
  }

  /**
   * Returns the 0..1 progress fraction for a given LR2 bargraph `type`. See
   * `lr2skinhelp/bargraph.txt` for the full enum; the play screen mostly
   * uses 1 (song progress) and 10/11 (1P EX score).
   */
  private resolveBarGraphProgress(type: number): number {
    switch (type) {
      case 1: {
        // 曲進行状態: ratio of currentSeconds to total chart duration.
        const total = this.resolveSongDurationSeconds();
        if (total <= 0) {
          return 0;
        }
        return Math.max(0, Math.min(1, this.currentSeconds() / total));
      }
      case 2:
        // ロード状態 — we always finish loading before play, so 1.
        return 1;
      case 10:
      case 11:
      case 12:
      case 13: {
        // 1P EX-score (current / predicted / highscore current/final).
        // We don't yet track predicted/highscore; reuse the live EX rate.
        return computeScoreRate(this.score);
      }
      default:
        return 0;
    }
  }

  /** Approximate total duration of the loaded chart in seconds. */
  private resolveSongDurationSeconds(): number {
    if (!this.song) {
      return 0;
    }
    return this.songDurationSeconds;
  }

  /**
   * Renders an LR2 `#SRC_SLIDER` element. We treat sliders as static
   * "knob" sprites positioned along the `range` axis according to the
   * runtime value. Most play-screen sliders (hi-speed, song progress) read
   * back nicely from existing state.
   */
  private renderSliderElement(slider: Lr2SliderElement): void {
    const interpolated = this.evaluateElementDst(slider);
    const { x, y, w, h } = normaliseRect(interpolated);
    if (w === 0 || h === 0) {
      return;
    }
    const baseTexture = this.textures.get(slider.source.imagePath);
    if (!baseTexture) {
      return;
    }
    const cropTexture = createCroppedTexture(baseTexture, slider.source);
    if (!cropTexture) {
      return;
    }
    const value = this.resolveSliderValue(slider.type); // 0..1
    const offset = slider.range * value;
    let drawX = x;
    let drawY = y;
    switch (slider.muki) {
      case 'down':
        drawY = y + offset;
        break;
      case 'up':
        drawY = y - offset;
        break;
      case 'right':
        drawX = x + offset;
        break;
      case 'left':
        drawX = x - offset;
        break;
    }
    const sprite = new Sprite(cropTexture);
    sprite.label = `slider[type=${slider.type}]`;
    sprite.position.set(drawX, drawY);
    sprite.width = w;
    sprite.height = h;
    applyDestinationToSprite(sprite, interpolated);
    this.skinLayer.addChild(sprite);
  }

  /** Returns the 0..1 value for a slider type. */
  private resolveSliderValue(type: number): number {
    switch (type) {
      case 2: {
        // ハイスピ1P: map the multiplier into [0..1] over the supported range.
        const span = HISPEED_MAX - HISPEED_MIN;
        return span <= 0 ? 0 : Math.max(0, Math.min(1, (this.hiSpeed - HISPEED_MIN) / span));
      }
      case 6: {
        // 曲進行度
        const total = this.resolveSongDurationSeconds();
        return total <= 0 ? 0 : Math.max(0, Math.min(1, this.currentSeconds() / total));
      }
      default:
        return 0;
    }
  }

  /**
   * Renders the judgement plate + NOWCOMBO digits as a single horizontally
   * centred assembly. The two are drawn together so the relative gap stays
   * stable while the whole group slides left/right to centre on the lane
   * area as the combo gets longer.
   *
   * Called from `renderSkin` and emits to `overlayLayer` so the assembly
   * sits *above* falling notes — matching the LR2 reference where the
   * "GREAT 158" text punches through the note stream.
   */
  private renderJudgeAndComboOnOverlay(skin: Lr2Skin): void {
    // DP charts paint judge + combo on BOTH sides simultaneously,
    // but each side reads its own *snapshot* state so the combo
    // number on each side reflects that side's most recent hit
    // (and stays still while only the other side fires). SP
    // charts only ever populate the 1P slot.
    this.renderJudgeAndComboForSide(skin, '1P');
    // 9 KEY (PMS) charts can store their lane data on the 2x channel block but
    // they're still *single-side* — only DP (variant 10/14) actually wants a
    // second judge/combo plate painted on the 2P lane.
    const usesPlayer2 = this.chartPlayVariant !== '9' && this.laneChannels.some((channel) => channel.startsWith('2'));
    if (usesPlayer2) {
      this.renderJudgeAndComboForSide(skin, '2P');
    }
  }

  /**
   * Renders one side's judge plate + NOWCOMBO assembly. Picks
   * the side-specific elements (`skin.judges2P` / matching
   * `skin.nowCombos.side === '2P'`), falling back to the 1P
   * slots when the skin omitted the 2P pair — matches LR2's
   * "DP-aware skins author both sides; SP-only skins reuse the
   * 1P rect for any 2P hit" convention. The verdict text +
   * combo number come from the per-side snapshot in
   * {@link judgeSideState} so the 1P / 2P assemblies tick
   * independently.
   */
  private renderJudgeAndComboForSide(skin: Lr2Skin, side: '1P' | '2P'): void {
    const state = this.judgeSideState[side];
    const seconds = this.currentSeconds();
    if (!state.judge || seconds > state.until) {
      return;
    }
    const judgeKind = resolveJudgeSkinKind(state.judge);
    if (!judgeKind) return;
    const comboKind = lastJudgeToNowComboKind(state.judge);
    const sideJudgeMap = side === '2P' ? skin.judges2P : skin.judges;
    const judgeElements = sideJudgeMap[judgeKind] ?? skin.judges[judgeKind];
    const judgeAnchor = judgeElements?.[0]?.destination;
    if (!judgeElements?.length || !judgeAnchor) {
      return;
    }
    const comboElement = comboKind
      ? (skin.nowCombos.find(
          (entry) => entry.kind === comboKind && entry.side === side && this.isDestinationVisible(entry.destination),
        ) ?? skin.nowCombos.find((entry) => entry.kind === comboKind && this.isDestinationVisible(entry.destination)))
      : undefined;
    const visibleCombo = comboKind && state.combo > 0 ? state.combo : 0;
    // Compute centring offset so that judge plate + combo sits centred on
    // this side's lane area. Without this the assembly was anchored at
    // LR2's static x=73 / x=185 coordinates, biased ~10px to the left of
    // the lane centre and drifting further as the combo grew.
    const laneCenter = this.resolveLaneCenter(skin, side);
    const judgeRight = judgeAnchor.x + judgeAnchor.w;
    let assemblyRight = judgeRight;
    if (comboElement && visibleCombo > 0) {
      const totalDigits = visibleCombo.toString().length;
      const comboLeft = judgeAnchor.x + comboElement.destination.x;
      assemblyRight = Math.max(judgeRight, comboLeft + comboElement.destination.w * totalDigits);
    }
    const offsetX = laneCenter - (judgeAnchor.x + assemblyRight) / 2;

    // 1) Judge plate. The full keyframe chain animates against
    // timer 46 (1P) / 47 (2P), both restarted on the matching
    // side's hit in `publishJudge`. We pick the side-specific
    // timer so the fade-in / fade-out keyframes land in sync
    // with the verdict that triggered them.
    const judgeElapsed = this.elapsedSinceTimer(side === '2P' ? 47 : 46);
    for (const element of judgeElements) {
      if (!this.isDestinationVisible(element.destination)) {
        continue;
      }
      const dst = this.evaluateElementDst(element);
      if (dst.w === 0 || dst.h === 0) {
        continue;
      }
      const baseTexture = this.textures.get(element.source.imagePath);
      if (!baseTexture) {
        continue;
      }
      const cellRect = pickAnimatedCell(element.source, judgeElapsed);
      const texture = createCroppedTexture(baseTexture, cellRect);
      if (!texture) {
        continue;
      }
      const sprite = new Sprite(texture);
      sprite.label = `nowjudge[side=${side},kind=${judgeKind}]`;
      sprite.position.set(dst.x + offsetX, dst.y);
      sprite.width = dst.w;
      sprite.height = dst.h;
      applyDestinationToSprite(sprite, dst);
      this.overlayLayer.addChild(sprite);
    }

    // 2) Combo digits (animated for PERFECT — divx*divy with cycle).
    if (comboElement && visibleCombo > 0) {
      renderNowComboElement(
        this.overlayLayer,
        comboElement,
        visibleCombo,
        judgeAnchor,
        this.textures,
        judgeElapsed,
        offsetX,
        this.evaluateElementDst(comboElement),
      );
    }
  }

  /**
   * Returns the horizontal centre of one side's play-field area
   * (in design pixels) derived from the LR2 skin's `#DST_NOTE`
   * rectangles. `side` filters the lane set: `1P` keeps indices
   * 0..9, `2P` keeps indices 10..19 (per `resolveLr2LaneIndex`'s
   * mapping). Falls back to the fallback playfield constant
   * when no skin is loaded or the requested side has no lanes.
   */
  private resolveLaneCenter(skin: Lr2Skin, side: '1P' | '2P' = '1P'): number {
    const sideLanes: Lr2DestinationRect[] = [];
    skin.laneRects.forEach((rect, index) => {
      if (!rect) return;
      const isPlayer2Index = index >= 10;
      if (side === '2P' && !isPlayer2Index) return;
      if (side === '1P' && isPlayer2Index) return;
      sideLanes.push(rect);
    });
    if (sideLanes.length === 0) {
      return PLAYFIELD.x + PLAYFIELD.w / 2;
    }
    const leftmost = sideLanes.reduce((acc, lane) => Math.min(acc, lane.x), sideLanes[0]!.x);
    const rightmost = sideLanes.reduce(
      (acc, lane) => Math.max(acc, lane.x + lane.w),
      sideLanes[0]!.x + sideLanes[0]!.w,
    );
    return (leftmost + rightmost) / 2;
  }

  private renderLanes(width: number, height: number): void {
    this.laneLayer.clear();
    this.laneX.clear();
    const skin = this.options.skin;
    const scale = skin ? Math.min(width / skin.width, height / skin.height) : 1;
    const skinX = skin ? (width - skin.width * scale) / 2 : 0;
    const skinY = skin ? (height - skin.height * scale) / 2 : 0;
    const fallbackTop = PLAYFIELD.y;
    const fallbackBottom = PLAYFIELD.judgementY;
    const laneWidth = PLAYFIELD.w / Math.max(1, this.laneChannels.length);
    const startX = PLAYFIELD.x;

    this.laneChannels.forEach((channel, index) => {
      // Skin's `#DST_NOTE,index,...` puts 1P-side rects at 0..9 and
      // 2P-side rects at 10..19. We index with the LR2-spec lane id
      // (channel-derived) so a DP chart's 2P notes land on the
      // 2P-side rects the skin actually authored — not on whatever
      // happens to sit at iteration position 8..15 in `laneRects`.
      const lr2Lane = skin?.laneRects[resolveLr2LaneIndex(channel, this.chartPlayVariant)];
      const x = lr2Lane ? skinX + lr2Lane.x * scale : startX + index * laneWidth;
      const w = lr2Lane ? Math.max(4, lr2Lane.w * scale) : laneWidth - 2;
      const top = lr2Lane ? skinY : fallbackTop;
      // `lr2Lane.y` is the TOP of the judgement-line bar (LR2 #DST_NOTE
      // convention); the just-timing reference is the BOTTOM edge of that
      // bar, which is `y + h`. For the LR2 default 7-keys skin (y=315,
      // h=6) that puts the just line at y=321 — exactly where the white
      // piano keys begin and notes "land" visually.
      const lr2JudgeBottom = lr2Lane ? lr2Lane.y + Math.abs(lr2Lane.h) : 0;
      const bottom = lr2Lane ? skinY + lr2JudgeBottom * scale : fallbackBottom;
      this.laneX.set(channel, { x, w, top, bottom });

      if (skin) {
        // With an LR2 skin loaded, the playfield background, judgement line
        // and key lasers are all rendered by the skin itself (driven by
        // `#DST_IMAGE` + key-on / judgement timers). Drawing our own coloured
        // rectangles on top of that just paints over the skin -- which is
        // exactly the "scratch lane is too red" / "judgement line is white"
        // problem we want to avoid. Skip the fallback overlays here.
        return;
      }

      this.laneLayer
        .rect(x, top, w, Math.max(1, bottom - top))
        .fill({ color: isScratch(channel) ? RED : PANEL, alpha: isScratch(channel) ? 0.72 : 0.62 });
      if (this.pressedChannels.has(channel)) {
        this.laneLayer
          .rect(x, top, w, Math.max(1, bottom - top))
          .fill({ color: isScratch(channel) ? YELLOW : WHITE, alpha: 0.45 });
      }
      this.laneLayer.rect(x, bottom - 4, w, 6).fill(isScratch(channel) ? RED : WHITE);
      this.laneLayer.rect(x, bottom + 2, w, 4).fill(YELLOW);
    });
  }

  private renderNotes(seconds: number, _height: number): void {
    disposeChildren(this.noteLayer);
    if (this.isIntroPlaying()) {
      // Intro period — the LR2 skin is sliding its frame chrome in. Notes
      // and measure lines stay off-screen until the playhead is live.
      return;
    }
    const currentBeat = this.currentBeat(seconds);
    const skin = this.options.skin;
    const pixelsPerBeat = PIXELS_PER_BEAT * this.hiSpeed;
    this.renderMeasureLines(currentBeat, pixelsPerBeat);
    // Note: the lane-bottom beat-pulse glow is drawn by the LR2
    // skin itself — the "リズムタイマー" `#DST_IMAGE` at SRC
    // y=2007 in the default 7-keys skin, anchored to timer 140.
    // `elapsedSinceTimer(140)` remaps the chart's current
    // fractional beat to the 0..1000 ms keyframe window the LR2
    // skin's keyframe chain authored, so the glow flashes on
    // every beat regardless of BPM. The custom `renderBeatAura`
    // we used to call here was duplicate visual noise and has
    // been removed.
    // Distance integrator. With `#SCROLL` / `#SPEED` events present
    // we let the mapper compute the integrated distance; otherwise
    // we fall back to a flat `(beat - currentBeat)` to skip the
    // segment-walking overhead.
    const beatDistance = this.scrollMapper
      ? (toBeat: number): number => this.scrollMapper!.distanceBetween(currentBeat, toBeat)
      : (toBeat: number): number => toBeat - currentBeat;
    let laneHeight = 1;
    for (const lane of this.laneX.values()) {
      laneHeight = Math.max(laneHeight, lane.bottom - lane.top);
    }
    const maxVisibleBeat = currentBeat + (laneHeight + 48) / Math.max(1, pixelsPerBeat);
    // Debug visualisation — paint invisible / keysound notes
    // FIRST so playable notes + mines paint over them. Skipped
    // entirely (and the array stays empty) when the option is
    // off.
    if (this.options.showInvisibleNotes && this.invisibleNotes.length > 0) {
      // Resolve the green-note sprite once per frame. `notes.note[3]`
      // is the Pop'n green wide note in the LR2 default
      // `play_9.lr2skin` POP layout — the convention the user-
      // facing host (`PixiGameplayView` consumer) opts into by
      // passing the loaded 9-keys play variant as
      // {@link PixiGameplayViewOptions.invisibleNoteSkin}. When
      // unavailable (no 9-keys variant in the loaded theme, or
      // its texture failed to load) we fall through to a flat
      // green rectangle so the overlay still reads.
      const greenNoteSrc = this.options.invisibleNoteSkin?.notes.note?.[3];
      const greenBaseTexture = greenNoteSrc ? this.textures.get(greenNoteSrc.imagePath) : undefined;
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
        if (greenNoteSrc && greenBaseTexture) {
          const cell = pickAnimatedCell(greenNoteSrc, this.elapsedSinceTimer(greenNoteSrc.timer));
          const texture = createCroppedTexture(greenBaseTexture, cell);
          if (texture) {
            const sprite = new Sprite(texture);
            sprite.label = `invisible-note[ch=${invisible.channel}]`;
            sprite.x = lane.x + (lane.w - cell.w) / 2;
            sprite.y = y - cell.h;
            sprite.width = cell.w;
            sprite.height = cell.h;
            this.noteLayer.addChild(sprite);
            continue;
          }
        }
        const graphic = new Graphics();
        graphic.label = `invisible-note-fallback[ch=${invisible.channel}]`;
        graphic.rect(lane.x + 2, y - 4, Math.max(4, lane.w - 4), 4).fill({ color: 0x33dd66, alpha: 0.7 });
        this.noteLayer.addChild(graphic);
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
      // Judged notes (hit / auto-missed) intentionally stay on screen and
      // continue scrolling — only their *position* governs visibility.
      const lane = this.laneX.get(note.channel);
      if (!lane) {
        continue;
      }
      const y = lane.bottom - beatDistance(note.beat) * pixelsPerBeat;
      // Use the LR2-spec lane index for skin SRC lookups (`#SRC_NOTE,...,index`):
      // 2P side notes need to read `skin.notes[kind][10..17]`, not
      // the position-based `[8..15]` that `resolveLaneIndex` would
      // give.
      const laneIndex = resolveLr2LaneIndex(note.channel, this.chartPlayVariant);
      // Long-note render: draw LN_BODY between start and end beats, capped
      // with LN_START / LN_END sprites. Falls through to single-note render
      // if the chart has no long-note end-beat for this entry.
      if (note.endBeat !== undefined) {
        const yEnd = lane.bottom - beatDistance(note.endBeat) * pixelsPerBeat;
        // yEnd is *above* y (smaller value, since beats grow upward
        // visually). Hide the LN once its tail (yEnd) has visually crossed
        // the judgement-line bottom — at that point every part of the long
        // note is below the line and shouldn't paint over the keys area.
        // Also clip when the head is still off-screen above the playfield.
        if (yEnd > lane.bottom || y < lane.top - 48) {
          continue;
        }
        this.renderLongNote(skin, laneIndex, note.channel, lane, y, yEnd);
        continue;
      }
      // Single notes hide the moment their bottom edge passes the
      // judgement-line bottom (= `lane.bottom`). Until then the note's
      // visibility depends on `judgedNoteDisplay`:
      // - `'HIDE'` (default) — judged notes disappear the instant
      //   they were judged (LR2 / beatoraja default behaviour).
      // - `'KEEP_SCROLLING'` — judged notes keep scrolling until
      //   their position passes the line (≈ beatoraja's
      //   LANEEFFECT ON).
      if (y < lane.top - 48 || y > lane.bottom) {
        continue;
      }
      if (note.hit && this.options.judgedNoteDisplay !== 'KEEP_SCROLLING') {
        continue;
      }
      this.renderSingleNote(skin, laneIndex, note.channel, lane, y);
    }
    // Landmine notes — same scroll math, separate sprite. Drawn
    // after regular notes so a mine sitting at the same beat as a
    // playable note paints on top (LR2 default skin's mine
    // sprites carry their own outline so the visual hierarchy
    // reads correctly).
    const firstMineIndex = this.scrollMapper
      ? 0
      : findFirstIndexAtOrAfter(this.mineNotes, currentBeat, (note) => note.beat);
    for (let mineIndex = firstMineIndex; mineIndex < this.mineNotes.length; mineIndex += 1) {
      const mine = this.mineNotes[mineIndex]!;
      if (!this.scrollMapper && mine.beat > maxVisibleBeat) {
        break;
      }
      if (mine.hit) continue;
      const lane = this.laneX.get(mine.channel);
      if (!lane) continue;
      const y = lane.bottom - beatDistance(mine.beat) * pixelsPerBeat;
      if (y < lane.top - 48 || y > lane.bottom) continue;
      const laneIndex = resolveLr2LaneIndex(mine.channel, this.chartPlayVariant);
      this.renderMineNote(skin, laneIndex, mine.channel, lane, y);
    }
  }

  /**
   * Renders one landmine sprite. Tries the LR2 skin's
   * `#SRC_NOTE` `mine` slot first (the skin's authored mine
   * graphic, animated per its `divX/divY/cycle`); falls back to
   * a red rectangle with a yellow caution stripe so the no-skin
   * path still flags the hazard distinctly from playable notes.
   */
  private renderMineNote(
    skin: Lr2Skin | undefined,
    laneIndex: number,
    channel: string,
    lane: { x: number; w: number; top: number; bottom: number },
    y: number,
  ): void {
    const skinMine = this.resolveNoteSource(skin, 'mine', laneIndex);
    const baseTexture = skinMine ? this.textures.get(skinMine.imagePath) : undefined;
    if (skinMine && baseTexture) {
      const cell = pickAnimatedCell(skinMine, this.elapsedSinceTimer(skinMine.timer));
      const texture = createCroppedTexture(baseTexture, cell);
      if (texture) {
        const sprite = new Sprite(texture);
        sprite.label = `mine[lane=${laneIndex},ch=${channel}]`;
        sprite.x = lane.x + (lane.w - cell.w) / 2;
        sprite.y = y - cell.h;
        sprite.width = cell.w;
        sprite.height = cell.h;
        this.noteLayer.addChild(sprite);
        return;
      }
    }
    const graphic = new Graphics();
    graphic.label = `mine-fallback[lane=${laneIndex},ch=${channel}]`;
    graphic
      .roundRect(lane.x + 2, y - 12, Math.max(4, lane.w - 4), 12, 3)
      .fill(0x8a1a1a)
      .stroke({ color: 0xffd166, width: 2 });
    this.noteLayer.addChild(graphic);
  }

  /**
   * Cached cumulative beats at each measure boundary, keyed by song
   * identity. Computed on first access so we don't walk the measure list
   * every frame. Each entry is the beat count at the *start* of the measure
   * with that index (measure 0 starts at beat 0).
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
    // BMS measure length is the relative size of the measure, where 1.0 is a
    // full 4/4 measure (= 4 beats). Walk the chart's measure list and record
    // the beat at the start of each measure.
    // Use the resolved chart so #IF-gated #xx02 (measure-length)
    // declarations match the chosen #RANDOM branch.
    const chart = this.resolvedChart ?? song.chart;
    // bmson 1.0.0 spec — `lines: []` (explicit empty array) is
    // the author opting out of barlines entirely (the "100 %
    // minimoo-G effect"). Honour the suppress flag the parser
    // sets and short-circuit before we'd otherwise derive
    // 4/4-default barlines from the event stream.
    if (chart.bmson.barlinesSuppressed === true) {
      this.measureBeatCache = { songId: song.id, beats };
      return beats;
    }
    const measures = chart.measures;
    // The chart's `measures` array only carries measures with an
    // EXPLICIT length declaration (`#xx02`). A typical 4/4-only
    // chart has no entries at all, so falling out at "length === 0"
    // skipped every measure line for those songs. Derive the
    // chart's last measure from event data instead — measure lines
    // need to render at every measure boundary regardless of
    // whether the author bothered to declare the time signature.
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
      // Default length 1 = full 4/4 measure. Only declared
      // measures override this.
      const length = lengthByIndex.get(i) ?? 1;
      cumulative += length * 4;
    }
    this.measureBeatCache = { songId: song.id, beats };
    return beats;
  }

  /**
   * Draws horizontal measure lines on the playfield at every `#MEASURE`
   * boundary. When the LR2 skin defines `#SRC_LINE` / `#DST_LINE`, we use
   * its texture & geometry; otherwise we fall back to a thin white bar
   * spanning the lane area.
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
    const skin = this.options.skin;
    const firstBeatIndex = this.scrollMapper
      ? 0
      : findFirstIndexNumberAtOrAfter(beats, currentBeat - 1 / Math.max(1, pixelsPerBeat));
    const maxBeat = this.scrollMapper
      ? Number.POSITIVE_INFINITY
      : currentBeat + (bottom - top + 1) / Math.max(1, pixelsPerBeat);
    // Prefer the LR2 skin's `#DST_LINE` (e.g. the LR2 default 7-keys skin's
    // 1-px white strip at y=320) when present. The DST encodes per-side x/w
    // and texture; we replicate it at every measure boundary, scrolled.
    // Iterate every `#DST_LINE,index,...` the skin authored. SP
    // charts only have `index === 0` so this is a one-line loop;
    // DP charts add `index === 1` for the 2P-side strip and we
    // draw both at the same beat boundaries.
    const skinLines = (skin?.measureLines ?? []).filter((entry) => this.textures.has(entry.source.imagePath));
    if (skinLines.length > 0) {
      const beatDistance = this.scrollMapper
        ? (toBeat: number): number => this.scrollMapper!.distanceBetween(currentBeat, toBeat)
        : (toBeat: number): number => toBeat - currentBeat;
      for (const skinLine of skinLines) {
        const baseTexture = this.textures.get(skinLine.source.imagePath);
        if (!baseTexture) continue;
        const lineDst = this.evaluateElementDst(skinLine);
        const cell = pickAnimatedCell(skinLine.source, this.elapsedSinceTimer(skinLine.source.timer));
        const cropped = createCroppedTexture(baseTexture, cell);
        if (!cropped) continue;
        for (let beatIndex = firstBeatIndex; beatIndex < beats.length; beatIndex += 1) {
          const beat = beats[beatIndex]!;
          if (!this.scrollMapper && beat > maxBeat) {
            break;
          }
          const y = bottom - beatDistance(beat) * pixelsPerBeat;
          if (y < top - 1 || y > bottom + 1) {
            continue;
          }
          const sprite = new Sprite(cropped);
          sprite.label = `measure-line[idx=${skinLine.index},beat=${beat}]`;
          sprite.position.set(lineDst.x, Math.round(y));
          sprite.width = lineDst.w;
          sprite.height = Math.max(1, Math.abs(lineDst.h));
          applyDestinationToSprite(sprite, lineDst);
          this.noteLayer.addChild(sprite);
        }
      }
      return;
    }
    // Fallback: simple white strip when no skin or no #SRC_LINE.
    const x0 = left.x;
    const x1 = right.x + right.w;
    const graphic = new Graphics();
    const beatDistance = this.scrollMapper
      ? (toBeat: number): number => this.scrollMapper!.distanceBetween(currentBeat, toBeat)
      : (toBeat: number): number => toBeat - currentBeat;
    for (let beatIndex = firstBeatIndex; beatIndex < beats.length; beatIndex += 1) {
      const beat = beats[beatIndex]!;
      if (!this.scrollMapper && beat > maxBeat) {
        break;
      }
      const y = bottom - beatDistance(beat) * pixelsPerBeat;
      if (y < top - 1 || y > bottom + 1) {
        continue;
      }
      graphic.rect(x0, Math.round(y), x1 - x0, 1).fill({ color: 0xffffff, alpha: 0.65 });
    }
    this.noteLayer.addChild(graphic);
  }

  /**
   * Picks the best note SRC for the given kind + lane index.
   *
   * The LR2 `#SRC_AUTO_*` variants ("dummy notes") are *not* a global
   * "use this when autoplay is on" override — they only kick in for lanes
   * that the per-lane autoscratch / autolane options (op 53/55) handle
   * automatically, with `AUTOPLAY LANE = DUMMY NOTES` (op 915) selected.
   * Full-game autoplay (op 33) keeps the regular note sprite, exactly like
   * the LR2 reference video.
   */
  private resolveNoteSource(
    skin: Lr2Skin | undefined,
    kind: 'note' | 'lnstart' | 'lnend' | 'lnbody' | 'mine',
    laneIndex: number,
  ): Lr2ImageRect | undefined {
    if (!skin) {
      return undefined;
    }
    if (this.isAutoLane(laneIndex) && this.runtimeOps.has(915)) {
      const autoKind = ('auto' + kind) as keyof Lr2Skin['notes'];
      const auto = skin.notes[autoKind];
      const direct = auto?.[laneIndex];
      const fallback = auto?.find((entry): entry is Lr2ImageRect => Boolean(entry));
      const autoSrc = direct ?? fallback;
      if (autoSrc) {
        return autoSrc;
      }
    }
    return skin.notes[kind]?.[laneIndex];
  }

  /**
   * Returns true when the given lane index is currently auto-handled by the
   * per-lane play options — autoscratch on (op 55) → scratch lane auto, or
   * autolane on (op 53) → all lanes auto. Global autoplay (op 33) is
   * deliberately not counted here so notes still render in their normal
   * colour during autoplay demonstrations, matching the LR2 reference.
   */
  private isAutoLane(laneIndex: number): boolean {
    if (this.runtimeOps.has(53)) {
      return true;
    }
    if (laneIndex === 0 && this.runtimeOps.has(55)) {
      return true;
    }
    return false;
  }

  private renderSingleNote(
    skin: Lr2Skin | undefined,
    laneIndex: number,
    channel: string,
    lane: { x: number; w: number; top: number; bottom: number },
    y: number,
  ): void {
    // `y` is where the chart timing intersects the judgement line for this
    // note. We anchor the sprite by its **bottom edge** so the just-timing
    // moment lines up with the bottom edge of the visual note (LR2 / BMS
    // convention) instead of the centre.
    const skinNote = this.resolveNoteSource(skin, 'note', laneIndex);
    const baseTexture = skinNote ? this.textures.get(skinNote.imagePath) : undefined;
    if (skinNote && baseTexture) {
      // Some LR2 skins animate notes (shimmer / pulse). Pick the current
      // SRC cell from divx*divy/cycle. For non-animated notes (cycle=0)
      // this returns cell (0,0) which matches the static behaviour.
      const cell = pickAnimatedCell(skinNote, this.elapsedSinceTimer(skinNote.timer));
      const texture = createCroppedTexture(baseTexture, cell);
      if (texture) {
        const sprite = new Sprite(texture);
        sprite.label = `note[lane=${laneIndex},ch=${channel}]`;
        sprite.x = lane.x + (lane.w - cell.w) / 2;
        sprite.y = y - cell.h;
        sprite.width = cell.w;
        sprite.height = cell.h;
        this.noteLayer.addChild(sprite);
        return;
      }
    }
    const graphic = new Graphics();
    graphic.label = `note-fallback[lane=${laneIndex},ch=${channel}]`;
    graphic.roundRect(lane.x + 2, y - 10, Math.max(4, lane.w - 4), 10, 2).fill(noteFallbackColor(channel, laneIndex));
    this.noteLayer.addChild(graphic);
  }

  /**
   * Renders a long note as a vertical band: LN_BODY tiled (or stretched)
   * between LN_START (lower) and LN_END (upper). The body sprite is taken
   * from the LR2 skin per lane index when available; otherwise we fall back
   * to a tinted rectangle.
   */
  private renderLongNote(
    skin: Lr2Skin | undefined,
    laneIndex: number,
    channel: string,
    lane: { x: number; w: number; top: number; bottom: number },
    yStart: number,
    yEnd: number,
  ): void {
    // `yStart` / `yEnd` are the chart-time intersections with the judgement
    // line. With the bottom-edge anchor convention (matching LR2 / BMS):
    //   - LN_START's *bottom edge* sits at `yStart` (just-timing of the head)
    //   - LN_END's   *bottom edge* sits at `yEnd`   (just-timing of the tail)
    // The body fills the band between them; we clamp the bottom to the
    // judgement-line bottom (= `lane.bottom`) so the body never paints over
    // the keys area below the line — even mid-LN where the head has
    // already passed but the tail is still above.
    const top = Math.max(lane.top - 48, Math.min(yStart, yEnd));
    const bottom = Math.min(lane.bottom, Math.max(yStart, yEnd));
    const startSrc = this.resolveNoteSource(skin, 'lnstart', laneIndex);
    const bodySrc = this.resolveNoteSource(skin, 'lnbody', laneIndex);
    const endSrc = this.resolveNoteSource(skin, 'lnend', laneIndex);
    const bodyBase = bodySrc ? this.textures.get(bodySrc.imagePath) : undefined;
    if (bodySrc && bodyBase) {
      const cell = pickAnimatedCell(bodySrc, this.elapsedSinceTimer(bodySrc.timer));
      const cropped = createCroppedTexture(bodyBase, cell);
      if (cropped) {
        const sprite = new Sprite(cropped);
        sprite.label = `ln-body[lane=${laneIndex},ch=${channel}]`;
        sprite.x = lane.x + (lane.w - cell.w) / 2;
        // Shift the body up by one cell-height so the body's bottom edge
        // aligns with the LN_START's bottom edge (= judgement line at the
        // head's just-timing). Without this, the body sticks out ~half a
        // note below the line at perfect timing.
        sprite.y = top - cell.h;
        sprite.width = cell.w;
        sprite.height = Math.max(1, bottom - top);
        this.noteLayer.addChild(sprite);
      }
    } else {
      const graphic = new Graphics();
      graphic.label = `ln-body-fallback[lane=${laneIndex},ch=${channel}]`;
      graphic
        .rect(lane.x + 2, top - 10, Math.max(4, lane.w - 4), Math.max(1, bottom - top))
        .fill({ color: noteFallbackColor(channel, laneIndex), alpha: 0.6 });
      this.noteLayer.addChild(graphic);
    }
    // LN_END at the top (yEnd), LN_START at the bottom (yStart).
    if (endSrc) {
      const cell = pickAnimatedCell(endSrc, this.elapsedSinceTimer(endSrc.timer));
      const endTexture = createCroppedTexture(this.textures.get(endSrc.imagePath), cell);
      if (endTexture) {
        const sprite = new Sprite(endTexture);
        sprite.label = `ln-end[lane=${laneIndex},ch=${channel}]`;
        sprite.x = lane.x + (lane.w - cell.w) / 2;
        sprite.y = yEnd - cell.h;
        sprite.width = cell.w;
        sprite.height = cell.h;
        this.noteLayer.addChild(sprite);
      }
    }
    // Hide the LN head once it has visually passed the judgement-line
    // bottom. The body+end keep showing until the tail crosses (handled by
    // the caller's `yEnd > lane.bottom` early-out).
    if (startSrc && yStart <= lane.bottom) {
      const cell = pickAnimatedCell(startSrc, this.elapsedSinceTimer(startSrc.timer));
      const startTexture = createCroppedTexture(this.textures.get(startSrc.imagePath), cell);
      if (startTexture) {
        const sprite = new Sprite(startTexture);
        sprite.label = `ln-start[lane=${laneIndex},ch=${channel}]`;
        sprite.x = lane.x + (lane.w - cell.w) / 2;
        sprite.y = yStart - cell.h;
        sprite.width = cell.w;
        sprite.height = cell.h;
        this.noteLayer.addChild(sprite);
      }
    }
  }

  private renderText(width: number, height: number, seconds: number): void {
    disposeChildren(this.textLayer);
    // Bottom-left status (title / time / HS / judge counts) is only
    // useful when there's no LR2 skin painting the same information
    // via NUMBER / TEXT elements. With a skin loaded we'd duplicate
    // every figure on top of the skin's panels, so suppress it.
    if (!this.options.skin) {
      const status = new Text({
        text: `${this.song?.title ?? ''}  ${formatTime(seconds)}  HS×${this.hiSpeed.toFixed(2)}  PG:${this.score.perfect} GR:${this.score.great} GD:${this.score.good} BD:${this.score.bad} PR:${this.score.poor}  F:${this.fastCount} S:${this.slowCount}`,
        style: new TextStyle({ fill: MUTED, fontSize: 10, fontFamily: 'system-ui, sans-serif' }),
      });
      status.label = 'fallback-status';
      status.position.set(18, height - 22);
      this.textLayer.addChild(status);
    }
    if (this.lastJudge && seconds <= this.lastJudgeUntil && !this.hasSkinnedJudge()) {
      const judge = new Text({
        text: this.lastJudge,
        style: new TextStyle({
          fill: BLUE,
          stroke: { color: 0xffffff, width: 2 },
          fontSize: 32,
          fontWeight: '800',
          fontFamily: 'system-ui, sans-serif',
        }),
      });
      judge.label = `fallback-judge[${this.lastJudge}]`;
      judge.anchor.set(0.5);
      // Y aligned with LR2's `#DST_NOWJUDGE_1P,...,73,230,102,30,...`
      // — the default skin parks the judge graphic 91 px above
      // the judgement line. Hard-coded to the LR2 number rather
      // than `judgementY - 91` so the relationship is greppable
      // when comparing to LR2 source.
      judge.position.set(PLAYFIELD.x + PLAYFIELD.w / 2, 230);
      this.textLayer.addChild(judge);
    }
    this.overlay.visible = this.paused;
    this.overlay.text = 'Paused';
    this.overlay.anchor.set(0.5);
    this.overlay.position.set(width / 2, height / 2);
  }

  private hasSkinnedJudge(): boolean {
    const skin = this.options.skin;
    if (!skin) {
      return false;
    }
    const kind = resolveJudgeSkinKind(this.lastJudge);
    if (!kind) return false;
    // Either side authoring the verdict counts — the renderer
    // falls back to 1P when the 2P slot is empty, so the
    // fallback-status text path needs to follow the same
    // either-side rule.
    return Boolean(skin.judges[kind]?.length || skin.judges2P[kind]?.length);
  }
}

/**
 * Returns whether `note` carries a finite long-note tail. Mirrors
 * the engine package's `resolveLongNoteEndSeconds`: a missing /
 * non-finite / non-positive `endSeconds` collapses to "single
 * tap", and the judge / finalize logic falls back to single-note
 * semantics for it.
 */
function isLongNote(note: RuntimeNote): boolean {
  return typeof note.endSeconds === 'number' && Number.isFinite(note.endSeconds) && note.endSeconds > note.seconds;
}

/**
 * Swaps a BMS channel's side digit (1↔2) so a 1P-side channel
 * becomes its 2P-side counterpart and vice versa. Used to apply
 * DP FLIP at chart-prepare time. Non-side channels (BGM, BGA,
 * any single-character channel) pass through unchanged.
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
 * Returns whether a BMS channel string belongs to the given
 * play-side. Used by per-side gameplay overlays (LANE COVER /
 * HIDDEN / SUDDEN masks) so each side can render an
 * independent shutter without leaking onto the other side's
 * lanes on a DP chart.
 *
 * Channel layout (LR2 convention):
 * - 1P keyboard: `11..15` + `18` + `19`; scratch: `16`
 * - 2P keyboard: `21..25` + `28` + `29`; scratch: `26`
 *
 * Anything else (BGM, BGA, BPM, etc.) returns `false` for
 * BOTH sides — those don't appear in `laneX` anyway.
 */
function isChannelOnSide(channel: string, side: '1P' | '2P'): boolean {
  if (channel.length !== 2) return false;
  const head = channel[0];
  if (side === '1P') return head === '1';
  return head === '2';
}

/**
 * 1P / 2P keyboard lane channels in lane-1..lane-7 order.
 * Scratch (channel 16 / 26) is excluded — `applyRandomMode`
 * never touches it, matching LR2 where RANDOM/MIRROR shuffle
 * the keyboard lanes only.
 */
const ONE_P_KEYBOARD_LANES: readonly string[] = ['11', '12', '13', '14', '15', '18', '19'];
const TWO_P_KEYBOARD_LANES: readonly string[] = ['21', '22', '23', '24', '25', '28', '29'];

/**
 * Shuffles `notes` in place per the chosen arrangement mode. Only
 * the keyboard lanes for `side` are touched — scratches and the
 * other side pass through untouched. The `usedLanes` filter trims
 * the permutation domain to the lanes actually present in the
 * chart so 5K charts (lanes 1..5 only) MIRROR / RANDOM cleanly
 * inside that subset.
 *
 * - `MIRROR`   — deterministic reversal of `usedLanes`
 * - `RANDOM`   — single chart-wide permutation (Fisher-Yates with
 *   the supplied RNG)
 * - `S-RANDOM` — per-chord permutation; chord notes share the
 *   beat key, and we re-permute within that group so notes on
 *   the same beat never collide on one lane
 * - `SCATTER`  — currently aliased to `RANDOM`; reserved for a
 *   future per-measure permutation pass
 */
function applyRandomMode(
  notes: Array<{ channel: string }>,
  side: '1' | '2',
  mode: 'OFF' | 'MIRROR' | 'RANDOM' | 'S-RANDOM' | 'SCATTER',
  rng: () => number,
  // Extra channel-bearing arrays (e.g. mine notes) that should
  // follow the same lane shuffle as the playable notes. The
  // `usedLanes` set is computed from `notes` only — secondary
  // entries on a lane that has no playable notes get remapped
  // through the same chart-wide map / chord permutation, so
  // mines stay anchored to the visual lane they were authored
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
    // Group keyboard-lane notes by beat — every note in a chord
    // shares the same `beat` key, so a fresh permutation per group
    // gives each note a distinct lane within that chord. The
    // secondary arrays (mines) get the chord-local map too so an
    // adjacent mine in the same beat ends up beside the
    // re-arranged chord, not floating to a stale lane.
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
 * In-place Fisher-Yates shuffle. Returns the same array for
 * call-chaining — callers usually just discard the return value
 * since the array is mutated.
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

/**
 * 0..4 severity ordering used by `finalizeActiveLongNote` to pick
 * the worst verdict between an LN's head and tail (matches the
 * engine's `resolveJudgeSeverity`). Higher = worse.
 */
function judgeSeverity(judge: JudgeKind): number {
  switch (judge) {
    case 'PERFECT':
      return 0;
    case 'GREAT':
      return 1;
    case 'GOOD':
      return 2;
    case 'BAD':
      return 3;
    case 'POOR':
      return 4;
  }
}

/**
 * Note colour for the no-skin fallback path, mirroring the IIDX /
 * LR2 default convention:
 *
 *   - Scratch (`16` / `26`) — red.
 *   - Odd-numbered keys (1 / 3 / 5 / 7) — white.
 *   - Even-numbered keys (2 / 4 / 6) — blue.
 *
 * `laneIndex` is the LR2 lane id (`resolveLr2LaneIndex`-style):
 * 0 / 10 = scratch, 1..9 = 1P-side keys, 11..19 = 2P-side keys.
 * Modding by 10 strips the side-offset so the same rule applies
 * to both sides.
 */
function noteFallbackColor(channel: string, laneIndex: number): typeof WHITE {
  if (isScratch(channel)) return RED;
  const keyIndex = laneIndex % 10;
  if (keyIndex % 2 === 0) return BLUE;
  return WHITE;
}

/**
 * Clamps a bmson slice offset against the loaded buffer's
 * duration so a misauthored offset (or one that came from a
 * trimmed take) doesn't produce a `start()` call past EOF —
 * Web Audio would silently emit nothing in that case. Any
 * non-finite / negative input collapses to 0 so the historical
 * "play from t=0" behaviour stays the default fallback.
 */
function clampSampleOffset(offsetSeconds: number | undefined, bufferDuration: number): number {
  if (typeof offsetSeconds !== 'number' || !Number.isFinite(offsetSeconds) || offsetSeconds <= 0) {
    return 0;
  }
  if (offsetSeconds >= bufferDuration) {
    return Math.max(0, bufferDuration - 1e-3);
  }
  return offsetSeconds;
}

/**
 * Caps a bmson slice duration against the loaded buffer's
 * tail so the slice playback doesn't overshoot the file.
 * Returns `undefined` when no duration was authored — the
 * caller then lets the buffer source play to its natural end
 * (matching BMS-style "trigger plays the whole sample"
 * semantics).
 */
function clampSampleDuration(
  durationSeconds: number | undefined,
  bufferDuration: number,
  offsetSeconds: number,
): number | undefined {
  if (typeof durationSeconds !== 'number' || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return undefined;
  }
  const remaining = Math.max(0, bufferDuration - offsetSeconds);
  if (remaining <= 0) {
    return undefined;
  }
  return Math.min(durationSeconds, remaining);
}

/**
 * Wraps `AudioBufferSourceNode.start` so the offset / duration
 * arguments only get supplied when meaningful — Web Audio
 * differentiates `start(when)` (whole buffer) from
 * `start(when, offset)` (seek) from `start(when, offset, duration)`
 * (seek + cap), and we want to match the historical behaviour
 * for the two- and three-arg cases when slicing isn't in play.
 *
 * `when` of `undefined` calls `start()` (immediate); a finite
 * value calls `start(when)` (scheduled).
 */
function startSampleNode(
  node: AudioBufferSourceNode,
  when: number | undefined,
  offsetSeconds: number,
  durationSeconds: number | undefined,
): void {
  const hasOffset = offsetSeconds > 0;
  const hasDuration = typeof durationSeconds === 'number';
  if (when !== undefined) {
    if (hasDuration) {
      node.start(when, offsetSeconds, durationSeconds);
    } else if (hasOffset) {
      node.start(when, offsetSeconds);
    } else {
      node.start(when);
    }
    return;
  }
  if (hasDuration) {
    node.start(0, offsetSeconds, durationSeconds);
  } else if (hasOffset) {
    node.start(0, offsetSeconds);
  } else {
    node.start();
  }
}
