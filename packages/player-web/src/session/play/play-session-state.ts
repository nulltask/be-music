/**
 * The state of a play the play session works on, apart from what draws it: the chart and its notes, the audio graph,
 * the engine's handles, the play state (gauge, score, judgements, hi-speed and covers), the lane effects, the BGA's
 * timelines and textures, the pause and the exit timeline. The modules of the play session (`session/play/*`) and the
 * shared playfield read and write it through their own context interfaces; the play views keep their layers apart
 * (`PlayLayers`).
 */
import type { Texture } from 'pixi.js';
import type { PreparedPlaybackChartData, PlayerSummary } from '@be-music/player';
import { createEmptyScore, type JudgeKind, type LongNoteStyle, type ScoreSummary } from '@be-music/player/ruleset';
import type {
  PlayerInputSignalBus,
  PlayerStateSignals,
  PlayerGaugeSummary,
  PlayerUiFramePayload,
  PlayerUiSignalBus,
} from '@be-music/player/signals';
import type { ScrollDistanceMapperLike, TimedPlayableNote } from '@be-music/player/display';
import type { BeMusicPlaylog, PlaylogViewCoalescer } from '@be-music/player/playlog';
import {
  createPlayState,
  DEFAULT_HISPEED,
  HiSpeedTransition,
  type LaneCover,
  type LaneCoverState,
  type LibraryChart,
  type PlaylogViewCursor,
  type PlayState,
} from '@be-music/scene-model';
import type { BrowserSongAssetSource } from '../../collection/types.ts';
import type {
  AudioBusChannel,
  AudioBusHandle,
  CompressorMode,
  CompressorParams,
  TunableCompressor,
} from '../../runtime/audio-bus.ts';
import type { GameplayRecorder } from '../../recording/gameplay-recorder.ts';
import type { PlayTempoRange } from './tempo-range.ts';
import { LongNoteTracker } from './long-note-tracker.ts';
import { createPlaceholderGaugeState } from './placeholder-gauge.ts';
import type { NonstopStageMixer } from '../../runtime/nonstop-audio.ts';
import type { PixiSceneHost } from '../../host/scene-host.ts';
import type { AudioAnalyzer } from '../../runtime/audio-analysis.ts';
import type { WebAudioSession } from '../../runtime/web-audio-session.ts';
import type { PlayAudioHandle } from '../../runtime/audio-service.ts';
import type { BeMusicEvent, BeMusicJson } from '@be-music/json';
import type {
  BmsSwitchingBga,
  RandomDraws,
  ResolvedChart,
  TimedSampleTrigger,
  TimingResolver,
  ChartPlayVariant,
} from '@be-music/chart';
import type { BgaCue, NonstopStageBgaTimeline } from '../../chart/bga-timeline.ts';
import type { BeMusicJudge } from '../../skin/be-music/types.ts';
import type { BeMusicJudgeWindows, BeMusicLaneKind } from '@be-music/skin-sdk';
import type { RuntimeMineNote, RuntimeNote } from '../../view/shared/playfield/context.ts';
import type { PlayfieldLaneRect } from '../../view/types.ts';

export class PlaySessionState {
  /**
   * The host that owns the underlying `Application`. Set by {@link prepare} or {@link enter}, whichever runs first;
   * before that, accessing `this.app` throws. See `PixiSceneHost` for the single-Application architecture rationale.
   */
  host: PixiSceneHost | undefined;
  song: LibraryChart | undefined;
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
   * Populated only when {@link PlaySessionOptions.showInvisibleNotes} is on — this is a debug visualization, not
   * gameplay state. The renderer paints a thin green bar per entry so the chart author's hidden keysound layout is
   * legible alongside the regular note stream.
   */
  invisibleNotes: TimedPlayableNote[] = [];
  maxLongNoteBeatSpan = 0;
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
  laneX: Map<string, PlayfieldLaneRect> = new Map();
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
  /** The play's graph as the host's audio service opened it (`options.audio`); undefined when the play made its own. */
  playAudio: PlayAudioHandle | undefined;
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
  /** The lanes the view's touch fingers hold (touch play, the view's `lane` intents), in the order they went down. */
  readonly touchLanesHeld: Set<string> = new Set<string>();
  /**
   * How many times the play has lifted every finger off the touch lanes (each pause): the view forgets the fingers
   * down before the latest lift, so they press nothing until they touch down again.
   */
  touchLiftCount = 0;
  /** Input token a touch on each lane channel presses, from the chart's lane bindings (built on the first touch). */
  touchTokenByChannel: Map<string, string> | undefined;
  /**
   * Latch flipped on the first non-zero `frame.currentSeconds` from the engine. The view's
   * `audioContextStartTime` is re-anchored at that moment so the renderer's chart-time matches what the engine
   * judges against — without this snap, the engine's `playbackClock` (which anchors at the moment it's
   * constructed inside `manualPlay`'s prepare phase) sits a few ms to a few hundred ms behind the view's
   * PLAYSTART anchor and notes pass the judgment line ahead of the engine's actual judge event.
   */
  sharedEngineClockAnchored = false;
  /**
   * The engine's latest UI frame (its chart time and beat, the chart's length, its summary and gauge), as drained into
   * the play state; `undefined` before the engine's first frame. A view that draws the engine's own clock (the beatoraja
   * play view) reads it.
   */
  engineFrame: Readonly<PlayerUiFramePayload> | undefined;
  decodedSamples: Map<string, AudioBuffer> = new Map<string, AudioBuffer>();
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
  wavCmdVolumeMultipliers: Map<string, number> = new Map<string, number>();
  /**
   * Parsed `#SWBGAxx` directives keyed by slot id. Built once per chart by {@link prepareSong}, looked up on every BGA
   * frame draw — `pickSwitchingBgaFrame(entry, elapsedMs)` resolves the currently-visible source `#BMPxx` key to swap
   * into the layer draw. Slots without a `#SWBGAxx` declaration stay absent so the fast path (single texture lookup)
   * takes over.
   */
  switchingBgas: Map<string, BmsSwitchingBga> = new Map<string, BmsSwitchingBga>();
  /** `#BGAxx` sub-region slot → its authored `dx dy` on the 256x256 BGA canvas. */
  readonly bgaSubRegionOrigins: Map<string, { x: number; y: number }> = new Map<string, { x: number; y: number }>();
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
  /**
   * The engine's judgment counts and scores, as the readouts show them: under LR2 the POOR counter folds the empty POORs
   * in (`resolveDisplayedPoor`).
   */
  score: ScoreSummary = createEmptyScore(0);
  /**
   * The play as every screen reads it (`@be-music/scene-model`): the gauge and EX score with their graphs, the combo,
   * max combo and course combo, the timed judgments with their early / late counts, and the view (the hi-speed with
   * HS-FIX, the lane covers). Fed through `reducePlayState` from the engine's frames, judgments and commands and from
   * the player's hi-speed changes; the result is read off it (`playResultFromPlayState`).
   */
  playState: PlayState = createPlayState();
  /**
   * Play-log assembled by the shared engine right before its play promise settles (`onPlaylogRecorded`). Snapshotted
   * into {@link getResultData} so the result host can offer it as a download.
   */
  playlog: BeMusicPlaylog | undefined;
  /** Callers of {@link waitForPlaylog} waiting for the engine to record the play. */
  readonly playlogWaiters: Array<(playlog: BeMusicPlaylog) => void> = [];
  /** Long-note holds of the current play, fed from the engine's `long-note-start` / `long-note-end` commands. */
  readonly longNotes: LongNoteTracker = new LongNoteTracker();
  /**
   * How the engine's ruleset plays long notes and its judge windows (ms), from `onRulesetResolved` at engine launch.
   * The windows are the ones in force when the chart starts: an LR2 mid-chart `#EXRANKxx` change narrows or widens
   * the engine's windows from then on, but is not reflected here.
   */
  longNoteStyle: LongNoteStyle | undefined;
  judgeWindows: BeMusicJudgeWindows | undefined;
  /** The chart's BPM range, worked out once per {@link prepareSong}. */
  chartBpmRange: PlayTempoRange | undefined;
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
   * The lane covers as drawn ({@link resolveLaneCover} of the play state's covers), handed to skins as
   * `runtime.laneCovers`; rebuilt only when the play state's covers change.
   */
  drawnLaneCovers: { covers: readonly LaneCoverState[]; drawn: LaneCover[] } | undefined;
  /** Folds the live view into the recorded play log's view changes ({@link updatePlaylogView}); unset in a replay. */
  playlogViewCoalescer: PlaylogViewCoalescer | undefined;
  /** A replay's recorded view along the playhead ({@link updatePlaylogView}). */
  replayViewCursor: PlaylogViewCursor | undefined;
  /** Judgement that set off each lane's live bomb, by channel; absent for bombs without one (an autoplayed LN head). */
  readonly bombJudge: Map<string, BeMusicJudge> = new Map<string, BeMusicJudge>();
  /** Play-clock ms of each lane's last key press / release (also autoplay hits), by channel. */
  readonly lanePressedAt: Map<string, number> = new Map<string, number>();
  readonly laneReleasedAt: Map<string, number> = new Map<string, number>();
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
  readonly sceneStageTimeouts: Set<number> = new Set<number>();
  /**
   * True once {@link beginExitSequence} starts the FADEOUT → CLOSE → host-callback chain. Re-entry is suppressed so a
   * frantic second ESC press while the fade is animating doesn't leak a second callback or restart the timeline.
   */
  exiting = false;
  readonly keyFlashTimeouts: Set<number> = new Set();
  readonly pressedChannels: Set<string> = new Set();
  /**
   * By channel, the play-clock timestamp of a key beam's in-flight release fade. When set, the lane's beam (and a
   * skin's key-on sprites) taper from 1 → 0 over the view's key-beam fade starting at the recorded value, so an LN
   * release decays instead of popping off. Releasing a lane (`releaseKeyBeam`) sets it; a fresh press (`startKeyBeam`)
   * clears it.
   */
  readonly keyBeamFadeStartedAt: Map<string, number> = new Map();
  readonly bombStartedAt: Map<string, number> = new Map();
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
   * The scroll factor notes, bar lines and long notes are positioned with: it glides to each new drawn hi-speed (the
   * play state's `view.hiSpeed.drawn`) over `HISPEED_TRANSITION_MS` (wall clock) instead of jumping, while the HUD /
   * readouts show the new target at once. Visual only — judging never reads it.
   */
  readonly scrollHiSpeed: HiSpeedTransition = new HiSpeedTransition(DEFAULT_HISPEED);
  /**
   * By channel, the `playClock()` timestamp at which the lane's key beam came on (a press, an autoplayed note, a long
   * note's hold); removed once the beam has faded out after the key is up. A view maps the channels onto its own
   * timers: the LR2 view onto LR2's key-on bank (100-119).
   */
  readonly keyBeamStartedAt: Map<string, number> = new Map();
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
  bgaTextures: Map<string, Texture> = new Map<string, Texture>();
  /**
   * BMP-resource → decoded `Texture` cache for the **layer** track (`#BMP` channels 07 and 0A). Decoded separately from
   * {@link bgaTextures} with a chroma-key that turns pure-black pixels transparent — mirrors the BMS BGA "layer"
   * convention used by `packages/player/src/bga.ts` so the foreground composites cleanly over the base track. Even when
   * the same BMP id appears on both tracks we keep two textures because `chroma-key` is destructive.
   */
  bgaLayerTextures: Map<string, Texture> = new Map<string, Texture>();
  /**
   * BMP-key → `<video>` element for video BGA cues (`.mp4` / `.webm` / etc.). `renderBga` seeks + plays these on cue
   * transitions; `dispose` revokes their object URLs.
   *
   * Stored separately from {@link bgaTextures} only because the sync logic needs the underlying media element — the
   * texture itself is also added to `bgaTextures` / `bgaLayerTextures` so the existing renderer paths pick it up
   * unchanged.
   */
  bgaVideos: Map<string, { video: HTMLVideoElement; objectUrl: string }> = new Map<
    string,
    { video: HTMLVideoElement; objectUrl: string }
  >();
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
  poorBgaFallbackUntilSeconds: number = Number.POSITIVE_INFINITY;
  /** Whether the chart actually carries any BGA events (drives LR2 op 170/171). */
  hasBga = false;
  /** Smoothed score for the count-up animation. Lerps toward `score.score`. */
  displayedScore = 0;
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
}
