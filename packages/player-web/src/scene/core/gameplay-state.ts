/**
 * The state of a play on the built-in and LR2 gameplay scenes: the scene graph and its pools, the chart and its notes,
 * the audio graph, the engine's handles, the score, gauge, judgements and lane effects, the hi-speed and covers, the
 * BGA and the exit timeline. `CoreGameplayView` extends it. The modules the scene's parts live in (`session/play/*`,
 * `view/*`) take the scene as their context and read and write this state through their own interfaces, so it is
 * public; it is not part of the scene's API.
 */
import { Container, Graphics, Text, TextStyle, Texture } from 'pixi.js';
import type { TimedSampleTrigger, TimingResolver } from '@be-music/audio-renderer/triggers';
import { createScoreTracker, type ScoreTracker } from '@be-music/player/core/scoring';
import type { PreparedPlaybackChartData, PlayerSummary } from '@be-music/player/core/engine';
import { createEmptyScore, type JudgeKind, type ScoreSummary } from '@be-music/player/ruleset';
import type { LongNoteStyle } from '@be-music/player/core/engine';
import type { ChartPlayVariant } from '@be-music/player/core/lane-layout';
import type { PlayerInputSignalBus } from '@be-music/player/core/input-signal-bus';
import type { PlayerStateSignals } from '@be-music/player/state-signals';
import type { PlayerGaugeSummary, PlayerUiSignalBus } from '@be-music/player/core/ui-signal-bus';
import type { ScrollDistanceMapperLike } from '@be-music/player/core/scroll-distance';
import { type TimedLandmineNote, type TimedPlayableNote } from '@be-music/player/playable-notes';
import type { BeMusicPlaylog, PlaylogLaneCover, PlaylogViewCoalescer } from '@be-music/player/playlog';
import { GoneDrawObjects } from './note-draw-window.ts';
import type { BrowserSongAssetSource, BrowserSongEntry } from '../../collection/types.ts';
import type {
  AudioBusChannel,
  AudioBusHandle,
  CompressorMode,
  CompressorParams,
  TunableCompressor,
} from '../../runtime/audio-bus.ts';
import { GameplayRecorder } from '../../recording/gameplay-recorder.ts';
import type { ChartBpmRange } from './gameplay-bpm-range.ts';
import { JudgeTimingLog } from './judge-timing-log.ts';
import { LongNoteTracker } from './long-note-tracker.ts';
import type { CourseComboState } from './course-combo.ts';
import { createPlaceholderGaugeState } from './placeholder-gauge.ts';
import type { NonstopStageMixer } from '../../runtime/nonstop-audio.ts';
import { PlaylogViewCursor } from '../playlog-view.ts';
import type { SideLaneRun } from '../../view/shared/playfield/measure-line-runs.ts';
import { PerfTracker } from '../perf.ts';
import type { PixiSceneHost } from '../host.ts';
import { ChildPool } from '../pixi-utils.ts';
import { AudioAnalyzer, type AudioFeatures } from '../../runtime/audio-analysis.ts';
import type { WebAudioSession } from '../../runtime/web-audio-session.ts';
import type { BeMusicEvent, BeMusicJson } from '@be-music/json';
import type { BmsSwitchingBga, RandomDraws, ResolvedChart } from '@be-music/chart';
import { HiSpeedTransition } from '../hi-speed.ts';
import type { BgaCue, NonstopStageBgaTimeline } from './gameplay-bga.ts';
import { CORE_TEXT_FONT } from './fonts.ts';
import type { BeMusicGameplayLayout, BeMusicJudge, BeMusicLaneCover, BeMusicStage } from '../../skin/be-music/types.ts';
import { resolveGameplayLaneGeometry, type BeMusicJudgeWindows, type BeMusicLaneKind } from '@be-music/skin-sdk';
import { BeMusicGameplayBinding } from '../../skin/be-music/binding.ts';
import { SongImageCache } from '../../skin/be-music/song-images.ts';
import { TouchLaneTracker } from './touch-lanes.ts';
import type { RuntimeMineNote, RuntimeNote } from '../../view/shared/playfield/context.ts';
import type { GameplayBgaTarget, GameplayLaneRect } from './gameplay-theme.ts';

export class CoreGameplayState {
  /**
   * The host that owns the underlying `Application`. Set by {@link prepare} or {@link enter}, whichever runs first;
   * before that, accessing `this.app` throws. See `PixiSceneHost` for the single-Application architecture rationale.
   */
  host: PixiSceneHost | undefined;
  /**
   * Top-level Container the scene host attaches to its `app.stage` while gameplay is active. All visible nodes
   * (`viewportBackground` + `designRoot`) live as children of this root, so the host can attach / detach the whole
   * gameplay subtree as one operation.
   */
  public readonly root: Container = new Container();
  readonly designRoot = new Container();
  /**
   * Clip mask for the design rect — sits as a child of `designRoot` so the same `position` / `scale` transform applies
   * to it as the sprites it clips. Pixi uses the mask's world-space bounds to decide what's visible; with the mask
   * drawn at `(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT)` in design space, the post-transform bounds match the on-screen
   * design rectangle exactly, and any sprite that animates in from off-canvas (LR2 default's `#DST_IMAGE,...,758,0,...`
   * slide-ins, etc.) gets clipped at the design edge instead of bleeding into the pillarbox / letterbox of a screen with
   * a different aspect ratio.
   */
  readonly designClipMask = new Graphics();
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
  readonly viewportBackground = new Graphics();
  readonly background = new Graphics();
  /**
   * BGA composite layer. Sits below `skinLayer` so the skin's "BGA frame" decoration draws on top, and above
   * `background` so the BGA is visible inside the play screen. One `Sprite` per layer (base / layer1+2 / POOR override)
   * is reused frame-to-frame to avoid Pixi child churn.
   */
  readonly bgaLayer: Container = new Container();
  readonly skinLayer: Container = new Container();
  readonly laneLayer = new Graphics();
  readonly noteLayer = new Container();
  /**
   * Shutter mask layer. Sits above `noteLayer` so the dark rectangles drawn here cover the scrolling notes underneath
   * but stay below the judgement-line / HUD overlays. Cleared and redrawn every frame from `playOptions.hiddenSudden` +
   * `playOptions.shutter`.
   */
  readonly shutterLayer = new Graphics();
  readonly bombLayer = new Container();
  /**
   * Sits above `noteLayer` / `bombLayer` and below `textLayer`. Holds the chrome that should visually punch through the
   * note stream: the judgement plate, NOWCOMBO digits, and the AUTOPLAY indicator.
   */
  readonly overlayLayer: Container = new Container();
  readonly textLayer = new Container();
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
  textures: Map<string, Texture> = new Map();
  /**
   * `playClock()` value captured at `start()`. Theme animations (LR2 timer 0/40/41 — scene-start / READY / play-start)
   * anchor here so the intro slide-ins, scratch turntable rotation, and similar visuals play from the
   * moment the gameplay view appears, not from the moment notes begin scrolling.
   */
  sceneStartTime = 0;
  /** Intro length scheduled by `start()` (theme `#PLAYSTART` or the fallback), for chrome count-ins. */
  scheduledIntroMs = 0;
  /** Play-clock time of the last judgement / key impulse, for the be-music skin's reactive visuals. */
  lastJudgeAt: number | undefined;
  lastImpulseAt: number | undefined;
  lastImpulseKind: BeMusicLaneKind | undefined;
  startTime = 0;
  /**
   * True while the chart's assets are still loading: from {@link prepare} until audio is decoded and the BGA preload
   * (which may be transcoding video) has settled. Skins show it as NOW LOADING on the lanes.
   */
  assetsLoading = false;
  /**
   * Between {@link enter} and {@link exit}: the input listeners are attached, and a {@link prepare} running meanwhile
   * shows the playfield (in its loading state) instead of loading off stage.
   */
  entered = false;
  /** Whether {@link exit} stopped a running render loop, for the next {@link enter} to resume. */
  resumeAnimationOnEnter = false;
  /**
   * `audioContext.currentTime` value that corresponds to chart-second 0. Used to schedule background samples with
   * sample-accurate Web Audio timing.
   */
  audioContextStartTime = 0;
  /** The stage fades and FIT rates of a stitched NONSTOP chart (`options.nonstop`). */
  nonstopMixer: NonstopStageMixer | undefined;
  paused = false;
  pauseTime = 0;
  pauseTotal = 0;
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
  recorder: GameplayRecorder | undefined;
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
  sharedEnginePromise: Promise<unknown> | undefined;
  /**
   * Forwarded into the engine via `PlayerOptions.signal`. Aborted from {@link dispose} so the engine's
   * `throwIfAborted` checks unwind cleanly instead of leaving the playback loop running on a torn-down audio bus.
   */
  sharedEngineAbortController: AbortController | undefined;
  /**
   * Holds the engine's play open past the chart's end (`holdAfterChart`), so keys keep lighting the lanes through the
   * result delay and the fade-out; aborted when the outro is over, which lets the play end and hand over its summary.
   */
  chartEndHold: AbortController | undefined;
  /** Set while the outro waits for the held play to end: receives its final summary. */
  onHeldPlayEnded: ((summary: Readonly<PlayerSummary>) => void) | undefined;
  /**
   * Latch for the engine's `stateSignals.judgeComboTick`. {@link drainWebUiSignals} compares the current tick
   * value against this latch on every poll and only fires the host's `onJudgeCombo` callback when a fresh
   * judge / combo update has landed since the last drain.
   */
  sharedEngineLastJudgeComboTick = 0;
  /** Bus references handed back from the engine via `onSignalsReady`. Drained per-frame from {@link tick}. */
  sharedEngineSignals: { uiSignals: PlayerUiSignalBus; stateSignals?: PlayerStateSignals } | undefined;
  /**
   * Engine-side `inputSignals` bus captured during the input runtime's `onReady` hook. The view's own
   * \`togglePause\` (Space-key handler + visibility/blur auto-pause) pushes \`{ kind: 'toggle-pause' }\` here so
   * the engine's playback clock pauses in lock-step with the view's \`paused\` flag — without the propagation,
   * the engine would keep advancing chart-time during the pause and fast-forward a burst of judges the moment
   * the view resumed.
   */
  sharedEngineInputSignals: PlayerInputSignalBus | undefined;
  /**
   * The interrupt the view sent the shared engine (ESC / F5 / teardown), once sent. The engine only reads its abort
   * signal at launch, so a play left mid-chart must be interrupted through its input bus: that ends the engine's loop
   * and, for ESC, records the play log as given up (`play.aborted`), which {@link waitForPlaylog} hands the host.
   */
  sharedEngineInterrupt: 'escape' | 'restart' | undefined;
  /** True once the shared engine settled the chart (every note judged) and holds the play open for the outro. */
  sharedEngineChartSettled = false;
  /** Which lane each finger on the canvas holds (touch play). */
  readonly touchLanes = new TouchLaneTracker();
  /** Input token a touch on each lane channel presses, from the chart's lane bindings (built on the first touch). */
  touchTokenByChannel: Map<string, string> | undefined;
  /** The canvas `touch-action` before this scene set it to `none`, restored on dispose. */
  previousCanvasTouchAction: string | undefined;
  /**
   * Latch flipped on the first non-zero `frame.currentSeconds` from the engine. The view's
   * `audioContextStartTime` is re-anchored at that moment so the renderer's chart-time matches what the engine
   * judges against — without this snap, the engine's `playbackClock` (which anchors at the moment it's
   * constructed inside `manualPlay`'s prepare phase) sits a few ms to a few hundred ms behind the view's
   * PLAYSTART anchor and notes pass the judgment line ahead of the engine's actual judge event.
   */
  sharedEngineClockAnchored = false;
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
  playlog: BeMusicPlaylog | undefined;
  /** Callers of {@link waitForPlaylog} waiting for the engine to record the play. */
  readonly playlogWaiters: Array<(playlog: BeMusicPlaylog) => void> = [];
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
  longNoteStyle: LongNoteStyle | undefined;
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
  laneCovers: { channels: readonly string[]; covers: BeMusicLaneCover[] } | undefined;
  /** Folds the live view into the recorded play log's view changes ({@link updatePlaylogView}); unset in a replay. */
  playlogViewCoalescer: PlaylogViewCoalescer | undefined;
  /** A replay's recorded view along the playhead ({@link updatePlaylogView}). */
  replayViewCursor: PlaylogViewCursor | undefined;
  /** The SUDDEN+ / HIDDEN+ per side a replay shows over the viewer's own ({@link resolveLaneCovers}). */
  replayCovers: readonly PlaylogLaneCover[] | undefined;
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
  tickerAttached = false;
  chartEndTimeout: number | undefined;
  /**
   * `setTimeout` handles for the scene-exit sequence (fade-out → close, LR2 timers 2 / 3). Cleared on dispose so the
   * deferred host callback can't fire onto a torn-down view.
   */
  exitFadeOutHandle: number | undefined;
  exitCloseHandle: number | undefined;
  /** `playClock()` at which the exit fade-out began; drives {@link applyExitFadeAlpha}. */
  exitFadeStartedAt: number | undefined;
  /** The fade-out the running exit sequence uses: the theme's, or longer for a failed play. */
  exitFadeOutMs = 0;
  /**
   * Intro / scene-stage timers that gate the load-end / play-start stages (and theme stages such as LR2
   * `#STARTINPUT`). These are independent from
   * input flash timers and can otherwise retain a disposed gameplay scene until their delay elapses.
   */
  readonly sceneStageTimeouts = new Set<number>();
  /**
   * True once {@link beginExitSequence} starts the FADEOUT → CLOSE → host-callback chain. Re-entry is suppressed so a
   * frantic second ESC press while the fade is animating doesn't leak a second callback or restart the timeline.
   */
  exiting = false;
  readonly keyFlashTimeouts: Set<number> = new Set();
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
  hiSpeed = 2.0;
  /**
   * The HS-FIX multiplier {@link applyHsFix} folded into {@link hiSpeed} (1 without HS-FIX), so a hi-speed reported to
   * or set by the host stays on the player's own scale.
   */
  hsFixMultiplier = 1;
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
  fpsFrameCount = 0;
  fpsWindowStart = 0;
  fps = 0;
  /**
   * Per-frame section timing tracker. Logs a console summary every second when enabled (via `?perf` URL flag or
   * `globalThis.__BE_MUSIC_PERF__ = true`). When disabled the wrapper adds no measurable overhead.
   */
  readonly perf = new PerfTracker('gameplay');
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
  /** True iff we paused because the tab/window backgrounded itself. */
  autoPaused = false;
  /**
   * Whether `visibilitychange` / `blur` / `pagehide` should auto-pause gameplay. Seeded from `options.autoPauseOnBlur`
   * (default `false`). The host can flip it at runtime via {@link setAutoPauseOnBlur} — useful for a lil-gui toggle
   * that lets the user opt into the LR2-desktop-style "pause when I Cmd-Tab away" behavior.
   */
  autoPauseOnBlur = false;
  /** Last sampled `document.hidden`, used by the polling safety net. */
  lastHidden = false;
  /** Last sampled `document.hasFocus()`, used by the polling safety net. */
  lastFocus = true;
  /** `setInterval` handle for the visibility/focus poll loop. */
  visibilityPollHandle: number | undefined;
  /**
   * Resolves when {@link prepareBga} has loaded every BGA texture. Set in {@link prepare} (without `await`) so the PLAY
   * scene can be revealed immediately and the LR2 LOADING phase keeps painting while a long-running ffmpeg.wasm video
   * transcode finishes in the background. {@link start} gates the LOAD END timer / chart-start scheduling on this
   * promise so the chart itself doesn't begin until the BGA is actually ready.
   */
  bgaReadyPromise: Promise<void> | undefined;
  /**
   * Latches at the moment the engine's `manualPlay` / `autoPlay` Promise resolves so the `onChartFinished` /
   * `onExit` callback fires at most once. {@link handleSharedEngineChartFinished} is the only writer.
   */
  chartEnded = false;
  skinBindingInstance: BeMusicGameplayBinding | undefined;
  /** Song images handed to the be-music skin (`frame.songImage`), from the playing song's asset source. */
  songImages: SongImageCache | undefined;
  /**
   * Cropped copies of the `#BGAxx` sub-region textures, for a skin that composites the BGA itself (a canvas image can't
   * carry the crop the way a Pixi sub-texture does). `null` while the crop is being made.
   */
  readonly skinBgaCrops = new Map<Texture, ImageBitmap | null>();
  /**
   * Cached cumulative beats at each measure boundary, keyed by song identity. Computed on first access so we don't walk
   * the measure list every frame. Each entry is the beat count at the *start* of the measure with that index (measure 0
   * starts at beat 0).
   */
  measureBeatCache: { songId: string | undefined; beats: number[] } = { songId: undefined, beats: [] };
}
