import { Application, Container, Graphics, Sprite, Text, TextStyle, Texture } from 'pixi.js';
import {
  collectSampleTriggers,
  createTimingResolver,
  type TimedSampleTrigger,
} from '@be-music/audio-renderer/triggers';
import {
  createScoreTracker,
  applyJudgeToSummary,
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
import { extractTimedNotes, type TimedPlayableNote } from '@be-music/player/playable-notes';
import type { BrowserSongAssetSource, BrowserSongEntry } from './types.ts';
import { normalizePath, resolveChartAsset, resolveChartAudioAsset } from './library.ts';
import {
  type Lr2BarGraphElement,
  type Lr2DestinationRect,
  type Lr2JudgeLineElement,
  type Lr2Skin,
  type Lr2SliderElement,
  type Lr2SpecialGraphic,
  type Lr2TextElement,
  LR2_SPECIAL_GRAPHIC,
  isLr2SpecialGraphic,
} from './lr2-skin.ts';
import { loadSkinAssetTexture, loadTextureFromBytes, loadVideoTextureFromBytes } from './lr2-textures.ts';
import {
  applyDestinationToSprite,
  createCroppedTexture,
  evaluateKeyframes,
  normaliseRect,
  pickAnimatedCell,
  renderNumberElement,
} from './lr2-render.ts';
import {
  type AudioBusHandle,
  type CompressorMode,
  type CompressorStage,
  buildAudioBus,
} from './audio-bus.ts';
import { PerfTracker } from './pixi-perf.ts';
import { type PixiSceneHost } from './pixi-scene-host.ts';
import type { BeMusicJson } from '@be-music/json';
import { resolveBmsControlFlow } from '@be-music/parser';
import { createBeatResolver } from '@be-music/chart';
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
  INTRO_DELAY_MS,
  LR2_1P_BOMB_TIMER_BASE,
  LR2_1P_KEYON_TIMER_BASE,
  LR2_2P_BOMB_TIMER_BASE,
  LR2_2P_KEYON_TIMER_BASE,
  MUTED,
  PANEL,
  PIXELS_PER_BEAT,
  PLAYFIELD,
  RED,
  SPEC_BGA_CANVAS_SIZE,
  WHITE,
  YELLOW,
} from './pixi-gameplay-constants.ts';
import {
  buildBgaTimeline,
  fitTextureWithinSpecCanvas,
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
  computeFullComboDurationMs,
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
import { renderFallbackLr2Frame, resolveScaledViewport } from './pixi-gameplay-fallback.ts';

interface RuntimeNote extends TimedPlayableNote {
  hit: boolean;
}

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
  private laneChannels: string[] = [];
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
  private decodedSamples = new Map<string, AudioBuffer>();
  private scheduled = new Set<RuntimeNote>();
  private autoSampleTriggers: TimedSampleTrigger[] = [];
  private autoTriggerNextIndex = 0;
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
  private frame: number | undefined;
  private readonly pressedChannels = new Set<string>();
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
   */
  private hiSpeed = 1.5;
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

  public constructor(private readonly options: PixiGameplayViewOptions = {}) {}

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

  public async mount(host: PixiSceneHost, song: BrowserSongEntry, source?: BrowserSongAssetSource): Promise<void> {
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
    this.root.addChild(
      this.background,
      this.bgaLayer,
      this.skinLayer,
      this.laneLayer,
      this.noteLayer,
      this.bombLayer,
      this.overlayLayer,
      this.textLayer,
      this.overlay,
    );
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
        // eslint-disable-next-line no-console
        console.log('[gameplay] poll detected hidden change', { hidden: hiddenNow });
        if (hiddenNow) {
          this.handleWindowBlur();
        } else {
          this.handleWindowFocus();
        }
      } else if (focusNow !== this.lastFocus) {
        this.lastFocus = focusNow;
        // eslint-disable-next-line no-console
        console.log('[gameplay] poll detected focus change', { focus: focusNow });
        if (!focusNow) {
          this.handleWindowBlur();
        } else {
          this.handleWindowFocus();
        }
      }
    }, 250);
    // eslint-disable-next-line no-console
    console.log('[gameplay] listeners attached', {
      visibilityState: document.visibilityState,
      hidden: document.hidden,
      hasFocus: typeof document.hasFocus === 'function' ? document.hasFocus() : 'n/a',
    });
    this.prepareSong(song);
    await this.prepareSkin();
    if (this.disposed) return;
    await this.prepareAudio();
    if (this.disposed) return;
    // BGA preload runs concurrently after audio so the playfield can mount
    // immediately; missing or slow-loading bitmaps fade in mid-play.
    void this.prepareBga();
    // Hold notes off the playfield until the LR2 intro animation finishes.
    // The default 7-keys skin's slide-ins terminate around t=2000–3000ms;
    // we use 3 seconds to leave a small breathing room before the first
    // chart event fires.
    this.sceneStartTime = performance.now();
    this.startTime = this.sceneStartTime + INTRO_DELAY_MS;
    // Anchor the chart's seconds=0 to the same precise audio-context
    // timestamp so background samples and visual notes share one clock.
    if (this.audioContext) {
      this.audioContextStartTime = this.audioContext.currentTime + INTRO_DELAY_MS / 1000;
    }
    this.app.canvas.focus();
    this.tick();
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
    // eslint-disable-next-line no-console
    console.log('[gameplay] listeners detached');
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
      for (const texture of this.textures.values()) {
        texture.destroy(true);
      }
      this.textures.clear();
      for (const texture of this.bgaTextures.values()) {
        texture.destroy(true);
      }
      this.bgaTextures.clear();
      for (const texture of this.bgaLayerTextures.values()) {
        texture.destroy(true);
      }
      this.bgaLayerTextures.clear();
      this.bombTexture?.destroy(true);
      this.bombTexture = undefined;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[gameplay] texture cleanup threw', error);
    }
    // Destroy our scene-graph subtree. With the shared host pattern
    // we never call `app.destroy` here — that would nuke the canvas
    // and the select scene would lose its rendering target.
    try {
      this.sceneRoot.destroy({ children: true });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[gameplay] sceneRoot.destroy threw', error);
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
    const extracted = extractTimedNotes(resolved, { includeLandmine: true, inferBmsLnTypeWhenMissing: true });
    this.notes = extracted.playableNotes.map((note) => ({ ...note, hit: false }));
    // Drop any held LN state from a previous song / restart. Without
    // this the next chart's first release on a cleared channel would
    // try to finalize the prior chart's hold and double-commit.
    this.activeLongNotes.clear();
    this.laneChannels = resolveLaneChannels(this.notes);
    this.score = createEmptyScore(this.notes.filter((note) => isPlayableInputChannel(note.channel)).length);
    this.tracker = createScoreTracker();
    // Reset the result-screen "MAX COMBO" tracker whenever a fresh
    // chart is prepared — restart (R), song-pick from select, etc.
    // Otherwise the previous play's max would leak into the new one.
    this.maxCombo = 0;
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
    // Initialize gauge with the actual playable-note count and the
    // chart's #TOTAL value so PG/GR gain matches LR2: a long chart
    // with TOTAL=300 and 1000 notes gets +0.3 per PG/GR, while a
    // short TOTAL=160 100-note chart gets +1.6 per PG/GR.
    const playableNoteCount = this.notes.filter((note) => isPlayableInputChannel(note.channel)).length;
    this.gaugeState = createGrooveGaugeState(playableNoteCount, resolved.metadata.total);
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
   */
  private applyGaugeDelta(judge: GrooveGaugeJudgeKind): void {
    applyGrooveGaugeJudge(this.gaugeState, judge);
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
      38, // scoregraph off
      40, // BGA off
      42, // 1P normal gauge
      44, // 2P normal gauge
      47, // difficulty filter disabled
      50, // offline
      54,
      56, // autoscratch off (1P/2P)
      61, // score saveable
      81, // load complete
      82, // replay off
      174, // attached text absent
      178, // RANDOM absent
      182, // judge normal
      196, // replay absent
    ];
    defaults.forEach((op) => this.runtimeOps.add(op));
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
    // BGA size: op 30 = normal, op 31 = large. We expose the user's
    // preference via `customOptions` defaults; here we pick "normal" as
    // a sane fallback so the default `#DST_BGA` (op 30) is selected.
    if (!this.runtimeOps.has(30) && !this.runtimeOps.has(31)) {
      this.runtimeOps.add(30);
    }
  }

  /**
   * Detects the chart's effective LR2 keymode op from its lane usage and
   * the player option. We treat any chart that puts notes on key 6 or 7
   * as a 7-keys chart and the rest as 5-keys; double-play modes are not
   * yet wired and fall back to the single-side defaults.
   */
  private resolveKeymodeOp(): number {
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
      if (judgedAt !== undefined) {
        return Math.max(0, performance.now() - judgedAt);
      }
      return Math.max(0, performance.now() - this.sceneStartTime);
    }
    // Scene-anchored timers (scene start / READY / play start) start
    // ticking at `sceneStartTime` — the moment the gameplay view mounted
    // — so LR2 intro slide-ins, the scratch turntable rotation, and the
    // AUTOPLAY label all animate during the pre-play window. This is
    // intentionally separate from `startTime`, which only ticks once
    // notes/audio actually begin (after the 3 s intro delay).
    if (timer === 0 || timer === 40 || timer === 41) {
      return Math.max(0, performance.now() - this.sceneStartTime);
    }
    const started = this.timerStartedAt.get(timer);
    if (started === undefined) {
      return 0;
    }
    return Math.max(0, performance.now() - started);
  }

  private isTimerActive(timer: number): boolean {
    if (timer === 0 || timer === 40 || timer === 41) {
      // 0  = scene main, 40 = READY (post-LOADEND), 41 = play start.
      // For a play session in progress, all three are active.
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
    // Bomb (50-69) and key-on (100-119) timers are tracked explicitly via
    // `timerStartedAt`. They become active the moment we record a start time
    // and stay active until `stopKeyOnTimer` removes the entry (key-on) or
    // the bomb's animation cycle finishes (bomb).
    //
    // Full-combo timers (48 = 1P, 49 = 2P) are tracked the same way:
    // `maybeFireFullCombo` stamps them once when the player's combo
    // hits the chart's note count, and elements anchored to those
    // timers (the `Play/fullcombo/...` skin graphic) read the
    // running elapsed time afterward to slide in / fade out per the
    // skin's keyframe chain.
    if (timer === 48 || timer === 49 || (timer >= 50 && timer <= 69) || (timer >= 100 && timer <= 119)) {
      return this.timerStartedAt.has(timer);
    }
    // Long-note hold timers (70-89) are not yet driven; treat as inactive so
    // skin elements gated on them stay hidden rather than always visible.
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
    // Compute the FC animation duration from the skin's keyframes.
    // Walk every element type that can be anchored to a timer and
    // pick the longest keyframe time across those whose `timer` is
    // 48 (1P FC) or 49 (2P FC). `cleanupFullComboTimer` later uses
    // this value to retire timer 48 / 49 once the animation has
    // played out, matching the bomb-cleanup pattern.
    this.fullComboDurationMs = computeFullComboDurationMs(skin);
    const imagePaths = new Set<string>();
    skin.images.forEach((image) => imagePaths.add(image.source.imagePath));
    Object.values(skin.notes).forEach((group) => group?.forEach((note) => imagePaths.add(note.imagePath)));
    Object.values(skin.judges).forEach((group) => group?.forEach((judge) => imagePaths.add(judge.source.imagePath)));
    skin.numbers.forEach((number) => imagePaths.add(number.source.imagePath));
    skin.grooveGauges.forEach((gauge) => imagePaths.add(gauge.source.imagePath));
    skin.nowCombos.forEach((combo) => imagePaths.add(combo.source.imagePath));
    await Promise.all(
      [...imagePaths].map(async (path) => {
        // LR2 special graphics (`gr=100..111`) point at runtime-bound
        // textures, not files in the skin bundle. Skip them here and
        // load them via `prepareChartGraphics()` below.
        if (isLr2SpecialGraphic(path)) {
          return;
        }
        const texture = await this.loadSkinAssetTexture(skin, path);
        if (texture) {
          this.textures.set(path, texture);
        }
      }),
    );
    const bombFile = skin.customFiles.find((file) => file.name === 'BOMB');
    if (bombFile) {
      this.bombTexture = await this.loadSkinAssetTexture(skin, bombFile.path);
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
        const bytes = resolveChartAsset(source, song.chartPath, assetPath);
        if (!bytes) return;
        try {
          const texture = await loadTextureFromBytes(assetPath, bytes);
          if (texture) {
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
    // eslint-disable-next-line no-console
    console.log('[gameplay] AudioContext ready', {
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
    await Promise.all(
      wavPaths.map(async (path) => {
        if (this.disposed || !this.source || !this.song || !this.audioContext) return;
        // Audio-aware asset lookup: charts almost universally declare
        // `.wav` paths but archives often ship `.ogg` / `.mp3`. Try
        // the codec fallback chain (opus → ogg → mp3 → wav → original).
        const bytes = resolveChartAudioAsset(this.source, this.song.chartPath, path);
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
        const bytes = resolveChartAsset(source, song.chartPath, path);
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
            const handle = await loadVideoTextureFromBytes(path, bytes);
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
            const texture = await loadTextureFromBytes(path, bytes, { keyOutBlack: true });
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
    // eslint-disable-next-line no-console
    console.log('[gameplay] visibilitychange', {
      visibilityState: document.visibilityState,
      hidden: document.hidden,
      paused: this.paused,
      autoPaused: this.autoPaused,
    });
    if (document.hidden) {
      if (!this.paused) {
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
  /** Last sampled `document.hidden`, used by the polling safety net. */
  private lastHidden = false;
  /** Last sampled `document.hasFocus()`, used by the polling safety net. */
  private lastFocus = true;
  /** `setInterval` handle for the visibility/focus poll loop. */
  private visibilityPollHandle: number | undefined;

  /**
   * Window-level blur/focus fallback for the auto-pause behaviour. Some
   * platforms (notably macOS with Chrome) keep the document `visible`
   * across Cmd-Tab app switches, so `visibilitychange` alone misses those
   * cases. We treat `blur` / `focus` the same way as `visibilitychange`,
   * gated on the same `autoPaused` flag so the two listeners cooperate.
   */
  private readonly handleWindowBlur = (): void => {
    // eslint-disable-next-line no-console
    console.log('[gameplay] window blur', { paused: this.paused, autoPaused: this.autoPaused });
    if (!this.paused) {
      this.togglePause();
      this.autoPaused = true;
    }
  };

  private readonly handleWindowFocus = (): void => {
    // eslint-disable-next-line no-console
    console.log('[gameplay] window focus', { paused: this.paused, autoPaused: this.autoPaused });
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
      this.options.onExit?.();
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
    event.preventDefault();
    if (!event.repeat) {
      this.pressedChannels.add(channel);
      // Start the LR2 key-on timer for this lane so skin elements gated on
      // timer 100..107 (lane lasers etc.) become visible while the key is
      // held down.
      this.startKeyOnTimer(channel);
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
      this.stopKeyOnTimer(channel);
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
   * Snap to a 1/1000 grid so values like 0.125 + 0.125 stay exact (the
   * 1/100 grid we used previously would round 0.125 → 0.13 every press).
   */
  private adjustHiSpeed(delta: number): void {
    const next = Math.round((this.hiSpeed + delta) * 1000) / 1000;
    this.hiSpeed = Math.max(HISPEED_MIN, Math.min(HISPEED_MAX, next));
  }

  private resolveKeyOnTimerId(channel: string): number | undefined {
    const laneIndex = resolveSideRelativeLaneIndex(channel);
    if (laneIndex < 0 || laneIndex > 7) {
      return undefined;
    }
    // LR2 spec: timer 100 = 1P SC, 101..107 = 1P key1..7;
    //          timer 110 = 2P SC, 111..117 = 2P key1..7.
    // Side-relative lane index keeps the offset 0..7 within each
    // side, so adding it to the per-side base lands on the correct
    // timer id even for 2P channels (which would otherwise yield
    // timer 100+8 = 108 from a position-based laneIndex).
    const isPlayer2 = channel.startsWith('2');
    const base = isPlayer2 ? LR2_2P_KEYON_TIMER_BASE : LR2_1P_KEYON_TIMER_BASE;
    return base + laneIndex;
  }

  private startKeyOnTimer(channel: string): void {
    const timerId = this.resolveKeyOnTimerId(channel);
    if (timerId === undefined) {
      return;
    }
    this.timerStartedAt.set(timerId, performance.now());
  }

  private stopKeyOnTimer(channel: string): void {
    const timerId = this.resolveKeyOnTimerId(channel);
    if (timerId === undefined) {
      return;
    }
    this.timerStartedAt.delete(timerId);
  }

  private togglePause(): void {
    if (this.paused) {
      this.paused = false;
      this.pauseTotal += performance.now() - this.pauseTime;
      void this.audioContext?.resume();
    } else {
      this.paused = true;
      this.pauseTime = performance.now();
      void this.audioContext?.suspend();
    }
  }

  private judge(channel: string, seconds: number): void {
    const windows = resolveJudgeWindowsMs(this.song!.chart);
    const note = this.notes
      .filter((candidate) => !candidate.hit && candidate.channel === channel)
      .sort((left, right) => Math.abs(left.seconds - seconds) - Math.abs(right.seconds - seconds))[0];
    if (!note || Math.abs(note.seconds - seconds) * 1000 > windows.bad) {
      // Empty press (no note in the BAD window for this lane) — apply
      // LR2's "空プア" gauge penalty (-2) without breaking combo or
      // counting against the score summary. Matches the per-press
      // gauge behaviour seen in the LR2 reference.
      this.applyGaugeDelta('EMPTY_POOR');
      return;
    }
    note.hit = true;
    // Signed delta (ms): positive = player late, negative = player
    // early. Used for FAST/SLOW classification on GREAT / GOOD
    // judgements (PERFECT is "on time" by definition).
    const signedDeltaMs = (seconds - note.seconds) * 1000;
    const delta = Math.abs(signedDeltaMs);
    const judge: JudgeKind =
      delta <= windows.pgreat ? 'PERFECT' : delta <= windows.great ? 'GREAT' : delta <= windows.good ? 'GOOD' : 'BAD';
    // Always play the keysound + bomb-flash on press so the player
    // gets immediate audio / visual feedback even though the score
    // commit might be deferred for an LN.
    this.playSample(note);
    if (judge !== 'BAD') {
      // LR2 bomb timer (50-69) fires on GREAT-or-better. Treat any non-BAD as
      // a "good enough" judgement and trigger the bomb animation on the lane.
      this.triggerBomb(channel);
    }
    if (isLongNote(note)) {
      // LN: defer scoreboard / gauge / publish until the tail is
      // finalized in `finalizeActiveLongNote`. The note is marked
      // `hit = true` so subsequent presses on this channel target
      // the next note rather than re-judging the same head.
      this.activeLongNotes.set(channel, { note, headJudge: judge, headSignedDeltaMs: signedDeltaMs });
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
    const finalJudge =
      judgeSeverity(headJudge) >= judgeSeverity(tailJudge)
        ? headJudge
        : tailJudge;
    const finalSignedDeltaMs = finalJudge === headJudge ? headSignedDeltaMs : tailSignedDeltaMs;
    this.commitFinalJudge(finalJudge, finalSignedDeltaMs, seconds, channel);
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
      }
    }
  }

  private triggerBomb(channel: string): void {
    const now = performance.now();
    this.bombStartedAt.set(channel, now);
    // LR2 bomb timer (50+sideLaneIndex / 60+sideLaneIndex). The LR2
    // default 7keys skin attaches its bomb sprite to `timer=50..57`
    // (1P), so we mirror that here. The timer auto-clears once
    // `renderBombs` completes the animation. Side-relative lane index
    // is used so 2P SC fires timer 60 (not 60+8).
    const laneIndex = resolveSideRelativeLaneIndex(channel);
    const isPlayer2 = channel.startsWith('2');
    const base = isPlayer2 ? LR2_2P_BOMB_TIMER_BASE : LR2_1P_BOMB_TIMER_BASE;
    this.timerStartedAt.set(base + laneIndex, now);
  }

  /** Forced-clear utility used by `flashKeyOnTimer` after the fade window. */
  private clearKeyOnTimerIfNotHeld(channel: string): void {
    if (this.pressedChannels.has(channel)) {
      return;
    }
    this.stopKeyOnTimer(channel);
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
      // eslint-disable-next-line no-console
      console.log(report);
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
    const lastNoteEnd = this.notes.reduce((acc, note) => Math.max(acc, note.endSeconds ?? note.seconds), 0);
    const lastTrigger = this.autoSampleTriggers.at(-1)?.seconds ?? 0;
    const endAt = Math.max(lastNoteEnd, lastTrigger) + 3;
    if (seconds < endAt) {
      return;
    }
    if (!this.notes.every((note) => note.hit)) {
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
    window.setTimeout(() => {
      if (this.options.onChartFinished && result) {
        this.options.onChartFinished(result);
        return;
      }
      this.options.onExit?.();
    }, 50);
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
    for (const note of this.notes) {
      if (note.hit) {
        continue;
      }
      if (note.seconds > seconds) {
        continue;
      }
      if (!isPlayableInputChannel(note.channel)) {
        // Non-playable lanes (BGM-style notes that snuck into the playable
        // collection, e.g. landmines) are left to autoMiss / scheduleAutoSamples.
        continue;
      }
      note.hit = true;
      this.playSample(note);
      this.triggerBomb(note.channel);
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
  private autoFinalizeLongNotes(seconds: number): void {
    if (this.activeLongNotes.size === 0) {
      return;
    }
    for (const [channel, active] of this.activeLongNotes) {
      const endSeconds = active.note.endSeconds!;
      if (endSeconds <= seconds) {
        this.activeLongNotes.delete(channel);
        this.commitFinalJudge('PERFECT', 0, endSeconds, channel);
        this.stopKeyOnTimer(channel);
      }
    }
  }

  /**
   * Brief key-on flash. We start the per-lane LR2 key-on timer (100..107 /
   * 110..117) and schedule it to clear after a short interval so the laser
   * fades like a real keystroke. Used by autoplay (no real keyboard event)
   * so the player still sees the lane / key visuals react.
   */
  private flashKeyOnTimer(channel: string): void {
    const timerId = this.resolveKeyOnTimerId(channel);
    if (timerId === undefined) {
      return;
    }
    this.timerStartedAt.set(timerId, performance.now());
    // Clear after ~120 ms — long enough for the LR2 laser sprite to fade in
    // and back out without lingering through subsequent notes.
    const flashDurationMs = 120;
    window.setTimeout(() => {
      // Only drop the timer if no real keypress overrode it during the flash.
      if (!this.pressedChannels.has(channel)) {
        this.timerStartedAt.delete(timerId);
      }
    }, flashDurationMs);
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
    for (const note of this.notes) {
      if (!note.hit && seconds - note.seconds > bad) {
        note.hit = true;
        applyJudgeToSummary(this.score, 'POOR', this.tracker);
        this.applyGaugeDelta('POOR');
        this.publishJudge('POOR', seconds, note.channel);
      }
    }
  }

  private publishJudge(judge: JudgeKind, seconds: number, channel?: string): void {
    this.lastJudge = judge;
    this.lastJudgeUntil = seconds + 0.6;
    // LR2 spec: timer 46 (1P judge) / 47 (2P judge) restarts on every
    // judgement on its respective side so the attached
    // `#DST_NOWJUDGE` / `#DST_NOWCOMBO` chains animate from time=0
    // per hit. Without this the keyframe playhead drifts hours into
    // the song and the post-hit fade-out keyframes have long since
    // passed. When `channel` isn't supplied (legacy callers) we
    // default to the 1P timer.
    const isPlayer2 = typeof channel === 'string' && channel.startsWith('2');
    this.timerStartedAt.set(isPlayer2 ? 47 : 46, performance.now());
    // POOR / BAD judgements briefly swap the base BGA for the chart's
    // POOR BGA. We trigger the same window for `BAD` because the LR2
    // spec doesn't distinguish the two for the BGA channel.
    if (judge === 'POOR' || judge === 'BAD') {
      this.lastPoorAt = performance.now();
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
    const now = performance.now();
    this.timerStartedAt.set(48, now);
    this.timerStartedAt.set(49, now);
    // eslint-disable-next-line no-console
    console.log('[gameplay] FULL COMBO');
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
    const lookAhead = 0.5;
    while (this.autoTriggerNextIndex < this.autoSampleTriggers.length) {
      const trigger = this.autoSampleTriggers[this.autoTriggerNextIndex]!;
      if (trigger.seconds > seconds + lookAhead) {
        break;
      }
      this.autoTriggerNextIndex += 1;
      this.playSampleByKey(trigger.sampleKey, trigger.seconds);
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
  private playSampleByKey(sampleKey: string, scheduledChartSeconds?: number): void {
    if (!this.audioContext || !this.song) {
      return;
    }
    const path = (this.resolvedChart ?? this.song.chart).resources.wav[sampleKey];
    if (!path) {
      return;
    }
    const buffer = this.decodedSamples.get(normalizePath(path).toLowerCase());
    if (!buffer) {
      return;
    }
    const node = this.audioContext.createBufferSource();
    node.buffer = buffer;
    // BGM bus. Falls back to direct destination if `prepareAudio`
    // hasn't run yet (defensive — in practice the bus is always
    // built before any `play*` call).
    node.connect(this.audioBus?.bgmMixer ?? this.audioContext.destination);
    if (scheduledChartSeconds !== undefined) {
      // Map chart seconds → audio-context time. Clamp to "now" so a slightly
      // late trigger (look-ahead just elapsed) still fires immediately rather
      // than throwing for a past timestamp.
      const startAt = Math.max(this.audioContext.currentTime, this.audioContextStartTime + scheduledChartSeconds);
      node.start(startAt);
    } else {
      node.start();
    }
  }

  /**
   * Plays the keysound attached to a judged input note. Routes
   * through `keyMixer` so the key-bus compressor (split mode) sees
   * the input transient stream independently of the BGM.
   */
  private playSample(note: RuntimeNote): void {
    if (!this.audioContext || !this.song) {
      return;
    }
    const path = (this.resolvedChart ?? this.song.chart).resources.wav[note.event.value.toUpperCase()];
    if (!path) {
      return;
    }
    const buffer = this.decodedSamples.get(normalizePath(path).toLowerCase());
    if (!buffer) {
      return;
    }
    const node = this.audioContext.createBufferSource();
    node.buffer = buffer;
    // Key bus. Falls back to direct destination if `prepareAudio`
    // hasn't run yet (defensive — in practice the bus is always
    // built before any `play*` call).
    node.connect(this.audioBus?.keyMixer ?? this.audioContext.destination);
    node.start();
  }

  private render(seconds: number): void {
    const screenWidth = this.app.screen.width;
    const screenHeight = this.app.screen.height;
    const viewport = resolveScaledViewport(screenWidth, screenHeight);
    this.viewportBackground.clear().rect(0, 0, screenWidth, screenHeight).fill(BG);
    this.root.position.set(viewport.x, viewport.y);
    this.root.scale.set(viewport.scale);
    this.background.clear().rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill(BG);
    this.perf.time('renderSkin', () => this.renderSkin(DESIGN_WIDTH, DESIGN_HEIGHT));
    this.perf.time('renderBga', () => this.renderBga(seconds));
    this.perf.time('renderLanes', () => this.renderLanes(DESIGN_WIDTH, DESIGN_HEIGHT));
    this.perf.time('renderNotes', () => this.renderNotes(seconds, DESIGN_HEIGHT));
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
    if (performance.now() - startedAt < this.fullComboDurationMs) {
      return;
    }
    this.timerStartedAt.delete(48);
    this.timerStartedAt.delete(49);
  }

  /**
   * One-shot bomb timer cleanup. Runs every frame regardless of whether
   * we own a bomb texture, so the LR2 timer 50–69 stops being "active"
   * once the explosion's natural duration (150 ms) has elapsed. Without
   * this, the skin's `#DST_IMAGE` (which is gated on those timers and
   * has `loop=-1` "play once and clamp") would keep displaying the last
   * frame of the explosion forever.
   */
  private cleanupBombTimers(): void {
    if (this.bombStartedAt.size === 0) {
      return;
    }
    const now = performance.now();
    const totalDurationMs = 150; // LR2 default bomb cycle.
    for (const [channel, startedAt] of Array.from(this.bombStartedAt.entries())) {
      if (now - startedAt < totalDurationMs) {
        continue;
      }
      this.bombStartedAt.delete(channel);
      const laneIndex = resolveSideRelativeLaneIndex(channel);
      const base = channel.startsWith('2') ? LR2_2P_BOMB_TIMER_BASE : LR2_1P_BOMB_TIMER_BASE;
      this.timerStartedAt.delete(base + laneIndex);
    }
  }

  private renderBombs(): void {
    // Just orphan old children — `child.destroy()` per child each
    // frame had measurable overhead and isn't necessary: orphaned
    // sprites are GC-eligible and their textures stay owned by the
    // view-level texture map.
    this.bombLayer.removeChildren();
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
    const now = performance.now();
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
    this.bgaLayer.removeChildren();
    const skin = this.options.skin;
    if (!skin || !this.hasBga || skin.bgas.length === 0) {
      return;
    }
    // Pick the first DST_BGA whose op gating is currently true (e.g. the
    // LR2 default skin defines two — op 30 = "normal size", op 31 =
    // "large" — and we set op 30 by default so the normal one wins).
    const bga = skin.bgas.find((entry) => this.isDestinationVisible(entry.destination));
    if (!bga) {
      return;
    }
    const dst = this.evaluateElementDst(bga);
    const { x, y, w, h } = normaliseRect(dst);
    if (w <= 0 || h <= 0) {
      return;
    }
    const baseCue = bga.noBase ? undefined : pickActiveBgaCue(this.bgaTimeline.base, seconds);
    const layerCue = bga.noLayer ? undefined : pickActiveBgaCue(this.bgaTimeline.layer, seconds);
    const baseKey = baseCue?.bmpKey;
    const layerKey = layerCue?.bmpKey;
    // POOR override: show the POOR BGA for a short window after a missed
    // / BAD judgement, then revert to the base+layer composite.
    const poorWindowMs = 2000;
    const inPoorWindow = !bga.noPoor && this.lastPoorAt > 0 && performance.now() - this.lastPoorAt < poorWindowMs;
    const poorKey = inPoorWindow ? pickActiveBgaKey(this.bgaTimeline.poor, seconds) : undefined;
    // Drive video BGA playback: when the active cue points at a
    // video, seek it to (currentSeconds - cueSeconds) and resume
    // playback. When the cue switches away from a previous video,
    // pause it. Tracked per-track because base / layer can run
    // independent videos.
    this.syncBgaVideo('base', baseCue, seconds);
    this.syncBgaVideo('layer', layerCue, seconds);

    const drawLayer = (key: string | undefined, textures: ReadonlyMap<string, Texture>, layerName: string): void => {
      if (!key) {
        return;
      }
      const texture = textures.get(key);
      if (!texture) {
        return;
      }
      // Aspect-preserving fit: emulate the BMS 256x256 spec canvas
      // (`packages/player/src/bga.ts`'s `convertImageToSpecFrame` /
      // `fitSizeWithinSpecCanvas`). The source image is centered
      // horizontally and top-aligned within the spec square (no
      // upscaling), then the whole square is stretched to the skin's
      // `#DST_BGA` rectangle (w, h).
      const fit = fitTextureWithinSpecCanvas(texture.width, texture.height);
      const scaleX = w / SPEC_BGA_CANVAS_SIZE;
      const scaleY = h / SPEC_BGA_CANVAS_SIZE;
      const sprite = new Sprite(texture);
      sprite.label = `bga/${layerName}[key=${key}]`;
      sprite.position.set(x + fit.offsetX * scaleX, y + fit.offsetY * scaleY);
      sprite.width = fit.width * scaleX;
      sprite.height = fit.height * scaleY;
      applyDestinationToSprite(sprite, dst);
      this.bgaLayer.addChild(sprite);
    };

    if (poorKey) {
      // POOR uses base-mode decoding (no chroma key) since it replaces
      // the entire base+layer composite during its window.
      drawLayer(poorKey, this.bgaTextures, 'poor');
    } else {
      drawLayer(baseKey, this.bgaTextures, 'base');
      // Layer track is composited on top with black→transparent so the
      // base track shows through where the foreground BMP is empty.
      drawLayer(layerKey, this.bgaLayerTextures, 'layer');
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
    this.skinLayer.removeChildren();
    this.overlayLayer.removeChildren();
    const skin = this.options.skin;
    if (!skin) {
      renderFallbackLr2Frame(this.skinLayer);
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
  private renderSkinImage(image: import('./lr2-skin.ts').Lr2ImageElement): void {
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
      const cellRect = pickAnimatedCell(image.source, this.elapsedSinceTimer(image.source.timer), dst.loop);
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
    // op4=1 on the destination is the LR2 scratch-turntable spin marker.
    // We rotate the sprite around its own centre at a fixed cadence so the
    // disc visibly turns regardless of input. The rotation is anchored at
    // `sceneStartTime` (scene mount), not `startTime` (notes start), so
    // the disc spins continuously — including during the intro window.
    // PixiJS uses a y-down coordinate system, so positive `rotation`
    // values produce a clockwise spin visually.
    if (dst.op4 === 1) {
      sprite.anchor.set(0.5, 0.5);
      sprite.position.set(x + w / 2, y + h / 2);
      const rps = 0.5;
      const elapsedMs = Math.max(0, performance.now() - this.sceneStartTime);
      sprite.rotation = (elapsedMs / 1000) * rps * Math.PI * 2;
    } else {
      sprite.position.set(x, y);
    }
    sprite.width = w;
    sprite.height = h;
    applyDestinationToSprite(sprite, dst);
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
    // `w` is intentionally unread — LR2 uses it as a max-width /
    // shrink-to-fit hint for the rendered glyphs, not for anchor
    // positioning. We anchor at `(x, y)` per the alignment field below.
    const { x, y, h } = normaliseRect(interpolated);
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
    // `w` is a max-width / shrink-to-fit constraint, not part of the
    // anchor calculation (the previous code added `w` to `x` for
    // right-aligned text which pushed the title / artist / genre
    // labels into the bar-list area on the right side of the screen).
    if (text.alignment === 'center') {
      node.anchor.set(0.5, 0.5);
    } else if (text.alignment === 'right') {
      node.anchor.set(1, 0.5);
    } else {
      node.anchor.set(0, 0.5);
    }
    node.position.set(x, y + h / 2);
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
        if (this.score.total <= 0) {
          return 0;
        }
        return Math.max(0, Math.min(1, this.score.exScore / (this.score.total * 2)));
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
    const triggerEnd = this.autoSampleTriggers.at(-1)?.seconds ?? 0;
    const noteEnd = this.notes.reduce((acc, note) => Math.max(acc, note.endSeconds ?? note.seconds), 0);
    return Math.max(triggerEnd, noteEnd);
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
    const seconds = this.currentSeconds();
    if (!this.lastJudge || seconds > this.lastJudgeUntil) {
      return;
    }
    const judgeKind = resolveJudgeSkinKind(this.lastJudge);
    const judgeElements = judgeKind ? skin.judges[judgeKind] : undefined;
    const judgeAnchor = judgeElements?.[0]?.destination;
    if (!judgeElements?.length || !judgeAnchor) {
      return;
    }
    const comboKind = lastJudgeToNowComboKind(this.lastJudge);
    const combo = this.tracker.combo;
    const visibleCombo = comboKind && combo > 0 ? combo : 0;
    const comboElement = comboKind
      ? skin.nowCombos.find((entry) => entry.kind === comboKind && this.isDestinationVisible(entry.destination))
      : undefined;
    // Compute centring offset so that judge plate + combo sits centred on
    // the lane area. Without this the assembly was anchored at LR2's static
    // x=73 / x=185 coordinates, biased ~10px to the left of the lane centre
    // and drifting further as the combo grew.
    const laneCenter = this.resolveLaneCenter(skin);
    const judgeRight = judgeAnchor.x + judgeAnchor.w;
    let assemblyRight = judgeRight;
    if (comboElement && visibleCombo > 0) {
      const totalDigits = visibleCombo.toString().length;
      const comboLeft = judgeAnchor.x + comboElement.destination.x;
      assemblyRight = Math.max(judgeRight, comboLeft + comboElement.destination.w * totalDigits);
    }
    const offsetX = laneCenter - (judgeAnchor.x + assemblyRight) / 2;

    // 1) Judge plate. The full keyframe chain animates against timer 46
    // (which we restart on every judgement in `publishJudge`), so the LR2
    // default fade-in / fade-out timing comes through naturally.
    const judgeElapsed = this.elapsedSinceTimer(46);
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
      sprite.label = `nowjudge[kind=${judgeKind ?? 'unknown'}]`;
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
   * Returns the horizontal centre of the play-field (in design pixels)
   * derived from the LR2 skin's `#DST_NOTE` rectangles. Falls back to the
   * fallback playfield constant when no skin is loaded.
   */
  private resolveLaneCenter(skin: Lr2Skin): number {
    const lanes = skin.laneRects.filter((rect): rect is Lr2DestinationRect => Boolean(rect));
    if (lanes.length === 0) {
      return PLAYFIELD.x + PLAYFIELD.w / 2;
    }
    const leftmost = lanes.reduce((acc, lane) => Math.min(acc, lane.x), lanes[0]!.x);
    const rightmost = lanes.reduce((acc, lane) => Math.max(acc, lane.x + lane.w), lanes[0]!.x + lanes[0]!.w);
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
      const lr2Lane = skin?.laneRects[resolveLr2LaneIndex(channel)];
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
    this.noteLayer.removeChildren();
    if (this.isIntroPlaying()) {
      // Intro period — the LR2 skin is sliding its frame chrome in. Notes
      // and measure lines stay off-screen until the playhead is live.
      return;
    }
    const currentBeat = this.currentBeat(seconds);
    const skin = this.options.skin;
    const pixelsPerBeat = PIXELS_PER_BEAT * this.hiSpeed;
    this.renderMeasureLines(currentBeat, pixelsPerBeat);
    // Note: the BPM-linked judgement-line glow is drawn by the LR2 skin
    // itself (the "判定グロー" `#DST_IMAGE` at SRC y=2007 in the default
    // 7-keys skin). The custom `renderBeatAura` we used to call here was
    // duplicate visual noise and has been removed.
    // Distance integrator. With `#SCROLL` / `#SPEED` events present
    // we let the mapper compute the integrated distance; otherwise
    // we fall back to a flat `(beat - currentBeat)` to skip the
    // segment-walking overhead.
    const beatDistance = this.scrollMapper
      ? (toBeat: number): number => this.scrollMapper!.distanceBetween(currentBeat, toBeat)
      : (toBeat: number): number => toBeat - currentBeat;
    for (const note of this.notes) {
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
      const laneIndex = resolveLr2LaneIndex(note.channel);
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
      // judgement-line bottom (= `lane.bottom`). Until then the note is
      // free to scroll through the line normally — judged or not.
      if (y < lane.top - 48 || y > lane.bottom) {
        continue;
      }
      this.renderSingleNote(skin, laneIndex, note.channel, lane, y);
    }
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
    const measures = (this.resolvedChart ?? song.chart).measures;
    if (measures.length === 0) {
      this.measureBeatCache = { songId: song.id, beats };
      return beats;
    }
    const maxIndex = Math.max(...measures.map((m) => m.index));
    const lengthByIndex = new Map(measures.map((m) => [m.index, m.length]));
    for (let i = 0; i <= maxIndex + 1; i += 1) {
      beats.push(cumulative);
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
        for (const beat of beats) {
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
    for (const beat of beats) {
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
  ): import('./lr2-skin.ts').Lr2ImageRect | undefined {
    if (!skin) {
      return undefined;
    }
    if (this.isAutoLane(laneIndex) && this.runtimeOps.has(915)) {
      const autoKind = ('auto' + kind) as keyof Lr2Skin['notes'];
      const auto = skin.notes[autoKind];
      const direct = auto?.[laneIndex];
      const fallback = auto?.find((entry): entry is import('./lr2-skin.ts').Lr2ImageRect => Boolean(entry));
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
    graphic.roundRect(lane.x + 2, y - 10, Math.max(4, lane.w - 4), 10, 2).fill(isScratch(channel) ? RED : WHITE);
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
        .fill({ color: isScratch(channel) ? RED : YELLOW, alpha: 0.6 });
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
    this.textLayer.removeChildren();
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
      judge.position.set(PLAYFIELD.x + PLAYFIELD.w / 2, 246);
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
    const elements = kind ? skin.judges[kind] : undefined;
    return Boolean(elements?.length);
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
