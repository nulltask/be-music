/**
 * Chart preparation for a play (`PlaySession`), whichever family draws it: resolves the chart's `#RANDOM` / `#SWITCH`
 * control flow, prepares the notes the engine judges and the view draws (one shared `PreparedPlaybackChartData`),
 * applies the lane options (DP FLIP, RANDOM / MIRROR / S-RANDOM) or a replay's recorded arrangement, and
 * resets the play's state for the new chart.
 *
 * `prepareChart` reads and writes the play's state through {@link PlayChartContext}; the play session passes itself.
 */

import { resolveRandomModes, type RandomMode } from '@be-music/player-scene-model';
import {
  resolvePoorBGAMode,
  PLAY_MODE_LAYOUTS,
  parseBMSSwBGA,
  resolveChart,
  resolveChartReferenceBPM,
  type BMSSwitchingBGA,
  type RandomDraws,
  type ResolvedChart,
  createBmsonSamplePlaybackMap,
  type TimedSampleTrigger,
  type TimingResolver,
  type ChartPlayVariant,
  createBeatAtSecondsResolverFromTimingResolver,
} from '@be-music/chart-model';
import { resolveBMSBase, type BeMusicEvent, type BeMusicJSON } from '@be-music/chart-source';
import { preparePlaybackChart, resolvePlayChart, type PreparedPlaybackChartData } from '@be-music/player-engine';
import {
  isPlayableInputChannel,
  randomizeSRandomNotes,
  randomizeLR2ConvergeNotes,
  randomizeHRandomNotes,
  randomizeAllScratchNotes,
  randomizePMSConvergeNotes,
  randomizeSpiralNotes,
  resolveLaneOptionChannels,
  resolvePlayVariantLaneChannels,
} from '@be-music/player-engine/lanes';
import {
  createScrollDistanceMapper,
  type ScrollDistanceMapperLike,
  type TimedLandmineNote,
  type TimedPlayableNote,
} from '@be-music/player-engine/display';
import type { PlayerGaugeSummary } from '@be-music/player-engine/signals';
import {
  createEmptyScore,
  type GaugeType,
  type RulesetId,
  type JudgmentKind,
  type ScoreSummary,
} from '@be-music/player-engine/ruleset';
import { collectChartVolumeMultipliers } from '../../chart/play-audio.ts';
import { resolvePoorBGAFallbackKey } from '../../chart/play-bga.ts';
import { applyReplayArrangement } from '../../chart/replay-arrangement.ts';
import {
  splitNonstopBGATimeline,
  toBrowserBGATimeline,
  type BGACue,
  type NonstopStageBGATimeline,
} from '../../chart/bga-timeline.ts';
import { resolvePlayTempoRange, type PlayTempoRange } from './tempo-range.ts';
import type { PlaySessionOptions } from './play-options.ts';
import type { LongNoteTracker } from './long-note-tracker.ts';
import { changesScrollRate, collectResolvedLaneTimelineBeats } from '../../chart/note-draw-window.ts';
import { createPlaceholderGaugeState } from './placeholder-gauge.ts';
import {
  createHiSpeedState,
  createPlayState,
  gaugePercent,
  laneCoversFromPlayOptions,
  reducePlayState,
  resolveHSFixMultiplier,
  resolveLibraryChartPlayVariant,
  SHUTTER_DEFAULT,
  type HiSpeedTransition,
  type LaneCoverState,
  type LibraryChart,
  type PlayState,
} from '@be-music/player-scene-model';
import { resolveLaneSides } from '../../chart/lane-sides.ts';

/** The play state {@link prepareChart} resets and fills for a new chart: the play session's fields of these names. */
export interface PlayChartContext {
  readonly options: Readonly<
    Pick<
      PlaySessionOptions,
      | 'visualConstant'
      | 'hsFix'
      | 'classicHiSpeed'
      | 'normalHiSpeedLevel'
      | 'preResolved'
      | 'hiSpeedLocked'
      | 'hiddenSudden1P'
      | 'hiddenSudden2P'
      | 'lift1P'
      | 'lift2P'
      | 'liftOn1P'
      | 'liftOn2P'
      | 'shutter'
      | 'laneCover'
      | 'coverStart'
      | 'replay'
      | 'dpFlip'
      | 'randomFixedLane1P'
      | 'randomFixedLane2P'
      | 'hRandomThresholdBPM'
      | 'random1P'
      | 'random2P'
      | 'course'
      | 'nonstop'
      | 'judgeRuleset'
      | 'longNoteModifier'
      | 'autoScratch1P'
      | 'autoScratch2P'
    >
  >;
  chart: LibraryChart | undefined;
  resolvedChart: BeMusicJSON | undefined;
  resolvedPlayChart: ResolvedChart | undefined;
  randomDraws: RandomDraws | undefined;
  beatAtSeconds: ((seconds: number) => number) | undefined;
  scrollMapper: ScrollDistanceMapperLike | undefined;
  laneTimelineBeats: Float64Array;
  preparedChart: PreparedPlaybackChartData | undefined;
  notes: TimedPlayableNote[];
  mineNotes: TimedLandmineNote[];
  invisibleNotes: TimedPlayableNote[];
  maxLongNoteBeatSpan: number;
  chartLastNoteEndSeconds: number;
  chartDurationSeconds: number;
  laneChannels: string[];
  chartPlayVariant: ChartPlayVariant;
  touchTokenByChannel: Map<string, string> | undefined;
  wavCmdVolumeMultipliers: Map<string, number>;
  switchingBGAs: Map<string, BMSSwitchingBGA>;
  bmsonSlicePlayback:
    | Map<BeMusicEvent, { offsetSeconds: number; durationSeconds?: number; sliceId: string }>
    | undefined;
  autoSampleTriggers: TimedSampleTrigger[];
  score: ScoreSummary;
  playState: PlayState;
  readonly scrollHiSpeed: HiSpeedTransition;
  readonly longNotes: LongNoteTracker;
  chartBPMRange: PlayTempoRange | undefined;
  autoScratchChannels: ReadonlySet<string>;
  playMoments: {
    failedAtMs?: number;
    allNotesDoneAtMs?: number;
    outroAtMs?: number;
    gaugeRiseAtMs?: number;
    gaugeMaxAtMs?: number;
  };
  readonly lanePressedAt: Map<string, number>;
  readonly laneReleasedAt: Map<string, number>;
  lastJudge: string;
  lastJudgeUntil: number;
  judgeSideState: Record<'1P' | '2P', { judge: JudgmentKind | ''; until: number; combo: number; courseCombo?: number }>;
  gaugeState: PlayerGaugeSummary;
  fastCount: number;
  slowCount: number;
  fullComboFired: boolean;
  timingResolver: TimingResolver | undefined;
  nonstopBGATimelines: NonstopStageBGATimeline[] | undefined;
  bgaTimeline: { base: BGACue[]; layer: BGACue[]; poor: BGACue[] };
  poorBGAMode: 0 | 1 | 2;
  poorBGAFallbackKey: string | undefined;
  poorBGAFallbackUntilSeconds: number;
  hasBGA: boolean;
  displayedScore: number;
  chartEnded: boolean;
  /** The gauge the run plays on (a replay's recorded pick wins). */
  resolveSelectedGauge(): GaugeType;
}

export function prepareChart(ctx: PlayChartContext, chartEntry: LibraryChart): void {
  if (ctx.options.replay === undefined && (ctx.options.random1P === 'SCATTER' || ctx.options.random2P === 'SCATTER')) {
    throw new RangeError('SCATTER is disabled until placement and assist policy are implemented.');
  }
  if (ctx.options.replay === undefined) {
    const modes = resolveRandomModes(ctx.options.judgeRuleset ?? 'lr2');
    for (const mode of [ctx.options.random1P, ctx.options.random2P]) {
      if (mode !== undefined && !modes.includes(mode))
        throw new RangeError(`${mode} is unavailable for ${ctx.options.judgeRuleset ?? 'lr2'}.`);
    }
  }
  // Resolve `#RANDOM` / `#SETRANDOM` / `#SWITCH` control flow once, first, so every play-time consumer below and the
  // engine see the same chosen branches. The draws are fresh each play (LR2 re-rolls each play); a replay resolves
  // with the draws its log recorded, so it plays the recorded branches.
  const { chart: resolved, randomDraws } =
    ctx.options.replay === undefined && ctx.options.preResolved !== undefined
      ? ctx.options.preResolved
      : resolvePlayChart(
          chartEntry.chart,
          ctx.options.replay?.play.randomDraws !== undefined
            ? { randomDraws: ctx.options.replay.play.randomDraws }
            : {},
        );
  ctx.resolvedChart = resolved;
  ctx.randomDraws = randomDraws;
  // BMS spec — `#WAVCMD 01 xx vv` and `#EXWAVxx` per-slot volumes, collected once so every sample trigger is a single
  // Map lookup; slots without an entry take the unity-gain fast path.
  ctx.wavCmdVolumeMultipliers = collectChartVolumeMultipliers(resolved);
  // BMS spec — `#SWBGAxx fr:tot:lp:ARGB N1 N2 ...` declares an animated BGA slot. Pre-parse every entry now so
  // per-frame BGA composition stays a single `Map.get` plus `pickSwitchingBGAFrame` (no per-frame regex / split).
  ctx.switchingBGAs.clear();
  const base = resolveBMSBase(resolved);
  for (const [slot, raw] of Object.entries(resolved.bms.swBGA)) {
    const parsed = parseBMSSwBGA(raw, base);
    if (parsed) {
      ctx.switchingBGAs.set(slot, parsed);
    }
  }
  // Build the chart's playable / landmine / invisible note arrays via the engine's own `preparePlaybackChartData`
  // so the renderer holds the exact same `TimedPlayableNote[]` / `TimedLandmineNote[]` instances the engine
  // will judge against. We keep a reference to the entire prepared bundle and forward it through
  // `engineOptions.preparedChart` later, telling the engine to skip its own internal extract pass.
  //
  // This is the structural fix for the whole class of view ↔ engine drift bugs the Phase-4c shared-engine
  // migration kept tripping over: an `inferBmsLNTypeWhenMissing` flag missing on one side, a
  // `bms.controlFlow` array re-resolved on the engine side, a `random1P: 'OFF'` truthy-check evaluating to
  // `false` because `'OFF'` is a non-empty string, a missing `laneModeExtension` mapping PMS to That-Which-Must-Not-Be-Named 10-key
  // DP, … each one shifted the index alignment of the renderer's parallel `this.notes` arrays vs the
  // engine's, and `applyEngineFrame` ended up mirroring `judged` flags onto the wrong note. Sharing the
  // instance means the parallel arrays are no longer parallel — they're the same array, the engine mutates
  // `judged` directly, and the renderer just reads it. There is no second extract that could disagree.
  // Resolve the chart's intended play variant up front so the lane-binding pass sees the host's
  // classification (instead of falling back to the engine's content heuristic). Without this:
  //   - `.bme` POPN-9 charts (full `11..19` on `#PLAYER 1`) classify as `'7'` via the engine's heuristic
  //     and lose the POPN-9 `f/v/g/b` lane bindings on channels `16..19`.
  //   - `.bms` / `.bme` charts that author PMS-STD content (`11..15 + 22..25`, no scratch) classify as
  //     `'10'` (That-Which-Must-Not-Be-Named 5K DP) and route the right-side POPN columns through the That-Which-Must-Not-Be-Named 2P key bindings.
  // `resolveChartPlayVariant` already encodes the right rules for both (see `@be-music/chart-model`); threading
  // the result here gives the engine + adapter + renderer a single source of truth without each one
  // re-running its own heuristic. Classify the RESOLVED chart: lanes that only a chosen `#RANDOM` / `#SWITCH`
  // branch adds are not in `song.chart.events`, and missing them would lay out (and judge) a 7 KEY play as 5 KEY.
  const hostPlayVariant = resolveLibraryChartPlayVariant(chartEntry, resolved);
  if (
    ctx.options.replay === undefined &&
    (ctx.options.random1P === 'CONVERGE' || ctx.options.random2P === 'CONVERGE') &&
    !['5', '7', '9', '10', '14'].includes(hostPlayVariant)
  )
    throw new RangeError('LR2 CONVERGE supports 5/7/9/10/14 KEY charts.');
  if (
    ctx.options.replay === undefined &&
    hostPlayVariant === '9' &&
    [ctx.options.random1P, ctx.options.random2P].some((mode) => mode === 'ALL-SCR' || mode === 'RANDOM-EX')
  )
    throw new RangeError('beatoraja PMS uses its own arrangements; ALL-SCR and RANDOM-EX require scratch lanes.');
  if (
    ctx.options.replay === undefined &&
    ctx.options.judgeRuleset === 'beatoraja' &&
    hostPlayVariant !== '9' &&
    (ctx.options.random1P === 'CONVERGE' || ctx.options.random2P === 'CONVERGE')
  )
    throw new RangeError('beatoraja CONVERGE is a PMS arrangement.');
  const resolvedPlay = resolveChart(resolved, {
    randomDraws,
    playVariant: hostPlayVariant,
    inferBmsLNTypeWhenMissing: true,
  });
  ctx.resolvedPlayChart = resolvedPlay;
  // The invisible / keysound array is always prepared even when the overlay is off — so the Tweakpane toggle can flip
  // the visualization on mid-song without a chart restart; the per-frame render loop is gated on
  // `showInvisibleNotes`. The audio horizon is left at 0: the engine recomputes its own from realtime triggers.
  const prepared = preparePlaybackChart(
    resolvedPlay,
    {
      laneModeExtension: extractChartExtension(ctx.chart?.chartPath),
      longNoteModifier: ctx.options.replay?.play.longNoteModifier ?? ctx.options.longNoteModifier,
    },
    0,
  );
  ctx.preparedChart = prepared;
  ctx.touchTokenByChannel = undefined;
  ctx.notes = prepared.notes;
  ctx.mineNotes = prepared.landmineNotes;
  ctx.invisibleNotes = prepared.invisibleNotes;
  if (ctx.options.replay !== undefined) {
    // Replay playback — the recorded replay carries the FINAL note arrangement (post-flip, post-shuffle), so
    // instead of re-rolling the lane transforms we re-apply the recorded channels onto the freshly prepared
    // notes. A mismatch means the loaded chart is not the one the log was recorded against (different `#RANDOM`
    // roll or a different file) — surface it as a prepare failure rather than replaying garbage.
    const arranged = applyReplayArrangement(ctx.options.replay.chart.notes, prepared);
    if (!arranged.ok) {
      throw new Error(`replay replay chart mismatch: ${arranged.reason}`);
    }
  } else {
    // DP FLIP — swap 1P / 2P channels in place. Cheap O(n) walk because we already iterate `notes` for sorting; SP
    // charts skip every entry (no `2x` channels exist). Mine notes are flipped together so they stay anchored to the
    // same visual lane after the flip.
    if (ctx.options.dpFlip) {
      for (const note of ctx.notes) {
        note.channel = flipDPChannel(note.channel);
      }
      for (const mine of ctx.mineNotes) {
        mine.channel = flipDPChannel(mine.channel);
      }
      for (const invisible of ctx.invisibleNotes) {
        invisible.channel = flipDPChannel(invisible.channel);
      }
    }
    // RANDOM / MIRROR / S-RANDOM — shuffle the 1P / 2P keyboard lanes independently. Scratch (channels 16 /
    // 26) and the 24 / 48 KEY wheel never move (`resolveLaneOptionChannels`). Per LR2 convention, the shuffle is drawn at chart-prepare time so a single play session has a
    // stable arrangement (F5-restart re-rolls it). Mine channels are included in the same shuffle pass so a mine on
    // lane 4 lands wherever the shuffle moved lane 4 — keeping the mine's visual relationship to the surrounding chord
    // intact.
    applyRandomMode(
      ctx.notes as Array<{ channel: string }>,
      resolveLaneOptionChannels('1P', hostPlayVariant, prepared.laneBindings),
      ctx.options.random1P ?? 'OFF',
      Math.random,
      {
        ruleset: ctx.options.judgeRuleset ?? 'lr2',
        hRandomThresholdBPM: ctx.options.hRandomThresholdBPM,
        fixedLane: ctx.options.randomFixedLane1P,
        scratch: hostPlayVariant === '9' ? undefined : '16',
        scratchLanes:
          hostPlayVariant === '9'
            ? []
            : PLAY_MODE_LAYOUTS[hostPlayVariant].lanes
                .filter((lane) => lane.side === '1P' && lane.kind !== 'key')
                .sort((a, b) => a.slot - b.slot)
                .map((lane) => lane.channel),
        doublePlay: hostPlayVariant === '10' || hostPlayVariant === '14' || hostPlayVariant === '48',
        side: '1P',
        playVariant: hostPlayVariant,
      },
      ctx.mineNotes as Array<{ channel: string }>,
      ctx.invisibleNotes as Array<{ channel: string }>,
    );
    applyRandomMode(
      ctx.notes as Array<{ channel: string }>,
      resolveLaneOptionChannels('2P', hostPlayVariant, prepared.laneBindings),
      ctx.options.random2P ?? 'OFF',
      Math.random,
      {
        ruleset: ctx.options.judgeRuleset ?? 'lr2',
        hRandomThresholdBPM: ctx.options.hRandomThresholdBPM,
        fixedLane: ctx.options.randomFixedLane2P,
        scratch: hostPlayVariant === '9' ? undefined : '26',
        scratchLanes:
          hostPlayVariant === '9'
            ? []
            : PLAY_MODE_LAYOUTS[hostPlayVariant].lanes
                .filter((lane) => lane.side === '2P' && lane.kind !== 'key')
                .sort((a, b) => a.slot - b.slot)
                .map((lane) => lane.channel),
        doublePlay: hostPlayVariant === '10' || hostPlayVariant === '14' || hostPlayVariant === '48',
        side: '2P',
        playVariant: hostPlayVariant,
      },
      ctx.mineNotes as Array<{ channel: string }>,
      ctx.invisibleNotes as Array<{ channel: string }>,
    );
  }
  ctx.maxLongNoteBeatSpan = ctx.notes.reduce((max, note) => {
    if (note.endBeat === undefined) {
      return max;
    }
    return Math.max(max, Math.max(0, note.endBeat - note.beat));
  }, 0);
  ctx.chartLastNoteEndSeconds = ctx.notes.reduce((acc, note) => Math.max(acc, note.endSeconds ?? note.seconds), 0);
  ctx.chartDurationSeconds = ctx.chartLastNoteEndSeconds;
  ctx.chartEnded = false;
  // Drop the previous chart's active-sample tracking. Stale entries would otherwise let a `c=true` note on the new
  // chart suppress its own first trigger because a same-key node from the old play looks "still playing" until it
  // ends naturally.

  // Lay out the whole keyboard of the chart's play variant (5 / 7 / 9 / 10 / 14 / 24 / 48 KEY), not just the lanes
  // the chart happens to use, so a sparse chart still plays on full lanes. The variant also decides channel `17`
  // (a lane in 9 KEY, FREE ZONE in That-Which-Must-Not-Be-Named) and the 9 KEY layout the LR2 default 9-keys play skin expects.
  ctx.chartPlayVariant = hostPlayVariant;
  ctx.laneChannels = resolvePlayVariantLaneChannels(ctx.notes, ctx.chartPlayVariant);
  // Initialize from `prepared.scorableNotes.length` so the view's initial `score.total` matches the engine's
  // authoritative `summary.total` (= same `scorableNotes` filter, with Free-Zone channels excluded). Without
  // this, charts that use a Free-Zone channel had a renderer-side total larger than the engine's by the
  // Free-Zone count, and `maybeFireFullCombo`'s `combo === score.total` predicate became
  // unreachable — combo could only ever climb to the engine's smaller scorable count, and the FC cue never
  // fired. `applyEngineFrame` still mirrors `summary.total` defensively each frame, but that's now a no-op
  // on the common path.
  ctx.score = createEmptyScore(prepared.scorableNotes.length);
  // Wipe per-side judge / combo snapshots so a fresh chart doesn't briefly paint the previous play's verdict on its
  // first frame (the `until` chart-time is in the previous chart's coordinate system; comparing it to the new chart's
  // `currentSeconds()` would render stale state until the new play crosses that mark).
  ctx.lastJudge = '';
  ctx.lastJudgeUntil = 0;
  ctx.judgeSideState = {
    '1P': { judge: '', until: 0, combo: 0 },
    '2P': { judge: '', until: 0, combo: 0 },
  };
  const resolver = resolvedPlay.timing;
  ctx.timingResolver = resolver;
  // Build a STOP-aware seconds→beat resolver for `currentBeat`.
  ctx.beatAtSeconds = createBeatAtSecondsResolverFromTimingResolver(resolver);
  // Build the #SCROLL / #SPEED distance integrator. Skipped when the chart has no such events, or only ones at 1, so
  // the common case stays on the plain beat-diff path with no extra cost (and on its ruleset's drawing rules).
  const beatResolver = resolvedPlay.beatResolver;
  const scrollTimeline = resolvedPlay.scroll;
  const speedTimeline = ctx.options.visualConstant ? [] : resolvedPlay.speed;
  ctx.scrollMapper = changesScrollRate(scrollTimeline, speedTimeline)
    ? createScrollDistanceMapper(scrollTimeline, speedTimeline, { invalidDistance: 0 })
    : undefined;
  ctx.laneTimelineBeats = collectResolvedLaneTimelineBeats(resolvedPlay);
  ctx.autoSampleTriggers = resolvedPlay.sampleTriggers
    .filter((trigger) => !isPlayableInputChannel(trigger.channel))
    .sort((left, right) => left.seconds - right.seconds);
  // bmson 1.0.0 slicing — for bmson charts, each `sound_channels[]` entry is a single audio file that gets sliced at
  // every distinct pulse where any of its notes fire, and each note plays its assigned slice (`audio_offset` ..
  // `audio_offset + slice_duration`) instead of the whole WAV from t=0. `@be-music/chart-model` computes the per-event
  // slice playback table; we wire it up here so the `WebAudioSession` can look up the offset / duration by event
  // identity at trigger time. BMS / json charts skip the build (the map stays undefined)
  // since they have no slicing semantics — every note plays its WAV from the start.
  ctx.bmsonSlicePlayback =
    resolved.sourceFormat === 'bmson'
      ? createBmsonSamplePlaybackMap(
          resolved,
          resolver,
          // Include both playable notes and the auto-trigger BGM events so the {@link WebAudioSession} can resolve
          // slice metadata for both code paths through a single Map lookup. Without the trigger events here, the
          // session's `scheduleEvent` would fall back to "play whole WAV" for every BGM cue, regressing bmson
          // sliced-WAV authoring intent (each note's `audio_offset` / `slice_duration` window).
          [
            ...ctx.notes.map((note) => note.event),
            ...ctx.mineNotes.map((note) => note.event),
            ...ctx.invisibleNotes.map((note) => note.event),
            ...ctx.autoSampleTriggers.map((trigger) => trigger.event),
          ],
          beatResolver,
        )
      : undefined;
  ctx.chartDurationSeconds = Math.max(ctx.chartLastNoteEndSeconds, ctx.autoSampleTriggers.at(-1)?.seconds ?? 0);
  // Initialize gauge with the actual playable-note count and the chart's #TOTAL value so PG/GR gain matches LR2: a
  // long chart with TOTAL=300 and 1000 notes gets +0.3 per PG/GR, while a short TOTAL=160 100-note chart gets +1.6
  // per PG/GR.
  ctx.gaugeState = createPlaceholderGaugeState(ctx.resolveSelectedGauge(), resolveCourseStartGaugeInput(ctx));
  // The one BPM range of the play: HS-FIX, the HUD and the replay's visible time all take the main BPM from it.
  ctx.chartBPMRange = resolvePlayTempoRange(
    resolvedPlay,
    resolved.metadata.bpm > 0 ? resolved.metadata.bpm : ctx.chart?.bpm,
  );
  ctx.playState = createChartPlayState(ctx, resolver, resolveChartReferenceBPM(resolved, ctx.chart?.bpm));
  // Chart setup, before the notes are on screen — no glide.
  ctx.scrollHiSpeed.jump(ctx.playState.view.hiSpeed.drawn);
  ctx.fastCount = 0;
  ctx.slowCount = 0;
  ctx.fullComboFired = false;
  ctx.displayedScore = 0;
  ctx.longNotes.clear();
  ctx.playMoments = {};
  ctx.lanePressedAt.clear();
  ctx.laneReleasedAt.clear();
  ctx.autoScratchChannels = resolveAutoScratchEnabled(ctx)
    ? new Set(prepared.laneBindings.filter((binding) => binding.isScratch).map((binding) => binding.channel))
    : new Set();
  ctx.bgaTimeline = toBrowserBGATimeline(resolvedPlay.bga);
  ctx.nonstopBGATimelines =
    ctx.options.nonstop !== undefined
      ? splitNonstopBGATimeline(ctx.bgaTimeline, ctx.options.nonstop.stages)
      : undefined;
  // BMS spec — when `#BMP00` exists (and `#POORBGA` is not 2), BMP00 becomes the implicit POOR placeholder until an
  // explicit `#xxx06` cue fires. Mirrors the TUI BGA renderer's `poorFallbackKey` so the web side stops showing a
  // black POOR plate on misses for charts that rely on this convention.
  ctx.poorBGAMode = resolvePoorBGAMode(resolved.bms.poorBGA);
  ctx.poorBGAFallbackKey = resolvePoorBGAFallbackKey(resolved);
  ctx.poorBGAFallbackUntilSeconds = ctx.bgaTimeline.poor[0]?.seconds ?? Number.POSITIVE_INFINITY;
  ctx.hasBGA = ctx.bgaTimeline.base.length > 0 || ctx.bgaTimeline.layer.length > 0 || ctx.bgaTimeline.poor.length > 0;
}

/**
 * The play state a new chart starts from: the starting gauge (LR2's 20 %, a course stage's carried-in gauge) seeding
 * the graphs at the chart's start, the chart's length the graphs are taken over, a course stage's carried-in combo,
 * and the view — the player's hi-speed (the one in force, so a host's setting before the chart is kept) under the
 * chart's HS-FIX, and each side's lane covers from the play options.
 *
 * HS-FIX keeps the player's hi-speed at the chart's reference BPM (`#BASEBPM`, else the start BPM:
 * `resolveChartReferenceBPM` prefers `#BASEBPM` so a chart whose `#BPM` is its peak or average still calibrates at the
 * speed the author intended) and rescales it at the chart's MAXBPM, MINBPM or main BPM (`resolveHSFixMultiplier`), the
 * main BPM being the play's (`chartBPMRange`), which the replay's visible time reads too.
 */
function createChartPlayState(
  ctx: PlayChartContext,
  resolver: TimingResolver,
  referenceBPM: number | undefined,
): PlayState {
  const hsFix =
    ctx.options.classicHiSpeed || (ctx.options.normalHiSpeedLevel ?? 0) > 0 ? 'OFF' : (ctx.options.hsFix ?? 'OFF');
  const mainBPM = ctx.chartBPMRange?.mainBPM;
  const hiSpeed = createHiSpeedState({
    hiSpeed: ctx.playState.view.hiSpeed.player,
    classic: ctx.options.classicHiSpeed,
    normalLevel: ctx.options.classicHiSpeed ? undefined : ctx.options.normalHiSpeedLevel,
    bpm: resolver.bpmAtBeat(0),
    multiplier: resolveHSFixMultiplier(hsFix, {
      ...(referenceBPM !== undefined ? { referenceBPM } : {}),
      startBPM: ctx.resolvedChart?.metadata.bpm || ctx.chart?.bpm || resolver.tempoPoints[0]?.bpm,
      bpms: resolver.tempoPoints.map((point) => point.bpm),
      ...(mainBPM !== undefined ? { mainBPM } : {}),
    }),
    locked: ctx.options.hiSpeedLocked === true,
  });
  const course = ctx.options.course;
  const started = createPlayState({
    gauge: gaugePercent(ctx.gaugeState),
    totalSeconds: ctx.chartDurationSeconds,
    ...(course !== undefined ? { courseCarryIn: course.carryIn ?? { combo: 0, maxCombo: 0 } } : {}),
    view: {
      hiSpeed,
      covers: resolveStartingCovers(ctx),
      hsFix,
    },
  });
  // The starting gauge's type and verdict, so a play given up before the engine's first frame still names its gauge.
  return reducePlayState(started, {
    type: 'frame',
    frame: { totalSeconds: ctx.chartDurationSeconds, summary: { exScore: 0, gauge: ctx.gaugeState } },
  });
}

/**
 * Each side's lane covers as the play starts: from the play options (`laneCoversFromPlayOptions`), or every cover at 0
 * and off for a play that starts without them (`coverStart: 'none'`).
 */
function resolveStartingCovers(ctx: PlayChartContext): LaneCoverState[] {
  const sides = resolveLaneSides(ctx.laneChannels);
  if (ctx.options.coverStart === 'none' || ctx.options.hiSpeedLocked === true) {
    return sides.map((side) => ({ side, sudden: 0, suddenOn: false, hidden: 0, hiddenOn: false, lift: 0 }));
  }
  return laneCoversFromPlayOptions(
    {
      hiddenSudden1P: ctx.options.hiddenSudden1P ?? 'OFF',
      hiddenSudden2P: ctx.options.hiddenSudden2P ?? 'OFF',
      shutter: ctx.options.shutter ?? SHUTTER_DEFAULT,
      lift1P: ctx.options.lift1P ?? 0.1,
      lift2P: ctx.options.lift2P ?? 0.1,
      liftOn1P: ctx.options.liftOn1P ?? false,
      liftOn2P: ctx.options.liftOn2P ?? false,

      laneCover: ctx.options.laneCover !== false,
    },
    sides,
  );
}

/** The course stage the play runs (a replay's recorded one wins), with its ruleset, for the placeholder gauge. */
function resolveCourseStartGaugeInput(ctx: PlayChartContext): Parameters<typeof createPlaceholderGaugeState>[1] {
  const stage = ctx.options.replay !== undefined ? ctx.options.replay.play.course : ctx.options.course;
  if (stage === undefined) return undefined;
  const ruleset = ctx.options.replay?.play.judgeRuleset ?? ctx.options.judgeRuleset ?? 'lr2';
  return { stage, ruleset };
}

/**
 * Whether the engine runs with auto-scratch, mirroring the `autoScratch` engine option: a replay's recorded flag, or
 * either side's toggle (the engine has one flag for both scratch lanes).
 */
function resolveAutoScratchEnabled(ctx: PlayChartContext): boolean {
  if (ctx.options.replay !== undefined) return ctx.options.replay.play.autoScratch === true;
  return ctx.options.autoScratch1P === true || ctx.options.autoScratch2P === true;
}

/**
 * Returns the lowercased filename extension (including the leading dot, e.g. `.pms` / `.bme` / `.bms`) of
 * `chartPath`, or `undefined` if the path doesn't include a recognizable suffix. The engine's
 * `resolveLaneMode` consumes this via `laneModeExtension` so PMS / BME / BMS charts route to the right binding
 * family even when the chart's content alone is ambiguous (e.g. PMS charts that don't use channel `17`, or
 * BME charts on `#PLAYER 1` that omit the 6 / 7 keys). Returning `undefined` falls back to the engine's
 * content-based heuristics, matching the pre-fix behavior on chart paths the host doesn't surface.
 */
export function extractChartExtension(chartPath: string | undefined): string | undefined {
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
 * Swaps a BMS channel's side digit (1↔2) so a 1P-side channel becomes its 2P-side counterpart and vice versa. Used to
 * apply DP FLIP at chart-prepare time. Non-side channels (BGM, BGA, any single-character channel) pass through
 * unchanged.
 */
export function flipDPChannel(channel: string): string {
  if (channel.length !== 2) return channel;
  const side = channel[0];
  const lane = channel[1]!;
  if (side === '1') return '2' + lane;
  if (side === '2') return '1' + lane;
  return channel;
}

/**
 * Shuffles `notes` in place per the chosen arrangement mode. Only `allLanes` — one side's keyboard lanes, from
 * `resolveLaneOptionChannels` — are touched; scratches, the keyboard modes' wheel, and the other side pass through
 * untouched. Every supported mode uses the complete mode domain, even on sparse charts.
 *
 * - `MIRROR` — deterministic reversal of the full mode key set
 * - `RANDOM` — chart-wide permutation of the full mode key set (Fisher-Yates with the supplied RNG)
 * - `S-RANDOM` — ruleset-specific pure randomizer with active-LN reservations and beatoraja jack avoidance
 * - `SCATTER` — disabled; new requests fail before any arrangement or recording

 */
export function applyRandomMode(
  notes: Array<{ channel: string }>,
  allLanes: readonly string[],
  mode: RandomMode,
  rng: () => number,
  options: {
    ruleset?: RulesetId;
    hRandomThresholdBPM?: number;
    fixedLane?: number;
    scratch?: string;
    scratchLanes?: readonly string[];
    doublePlay?: boolean;
    side?: '1P' | '2P';
    playVariant?: ChartPlayVariant;
  } = {},
  // Extra channel-bearing arrays: mines first, then invisible notes. Chart permutations share the same lane map;
  // S-RANDOM applies the active ruleset's policy for each event kind.
  ...secondary: Array<Array<{ channel: string }>>
): void {
  if (mode === 'SCATTER')
    throw new RangeError('SCATTER is disabled until placement and assist policy are implemented.');
  if (mode === 'R-RANDOM' && options.ruleset !== 'beatoraja' && options.ruleset !== '____')
    throw new RangeError('R-RANDOM is unavailable for LR2.');
  if (
    (mode === 'SPIRAL' || mode === 'H-RANDOM' || mode === 'ALL-SCR' || mode === 'RANDOM-EX') &&
    options.ruleset !== 'beatoraja'
  )
    throw new RangeError(`${mode} is available only for beatoraja.`);
  if (mode === 'CONVERGE' && options.ruleset === '____')
    throw new RangeError('CONVERGE is unavailable for this ruleset.');
  if (mode === 'CONVERGE' && options.ruleset === 'beatoraja' && options.playVariant !== '9')
    throw new RangeError('beatoraja CONVERGE is a PMS arrangement.');
  if (mode === 'OFF' || allLanes.length === 0) return;
  if (mode === 'S-RANDOM' || mode === 'SPIRAL' || mode === 'H-RANDOM' || mode === 'CONVERGE' || mode === 'ALL-SCR') {
    const entries = [
      ...notes.map((note) => ({ note, kind: 'note' as const })),
      ...secondary.flatMap((arr, index) =>
        arr.map((note) => ({ note, kind: index === 0 ? ('mine' as const) : ('invisible' as const) })),
      ),
    ];
    const timedNotes = entries.map(({ note, kind }) => {
      const timed = note as {
        channel: string;
        seconds?: number;
        endSeconds?: number;
        beat?: number;
        endBeat?: number;
      };
      return {
        channel: timed.channel,
        timeMs: (timed.seconds ?? timed.beat ?? 0) * 1000,
        ...(timed.endSeconds !== undefined || timed.endBeat !== undefined
          ? { endTimeMs: (timed.endSeconds ?? timed.endBeat!) * 1000 }
          : {}),
        kind,
      };
    });
    const channels =
      mode === 'ALL-SCR'
        ? randomizeAllScratchNotes(timedNotes, [...allLanes, ...(options.scratchLanes ?? [])], {
            random: rng,
            scratchLanes: options.scratchLanes ?? [],
            thresholdBPM: options.hRandomThresholdBPM,
            doublePlay: options.doublePlay,
            side: options.side,
          })
        : mode === 'CONVERGE'
          ? options.ruleset === 'beatoraja'
            ? randomizePMSConvergeNotes(timedNotes, allLanes, {
                random: rng,
                thresholdBPM: options.hRandomThresholdBPM,
              })
            : randomizeLR2ConvergeNotes(timedNotes, allLanes, {
                target: allLanes[(options.fixedLane ?? 0) - 1] ?? options.scratch ?? allLanes[4]!,
                scratch: options.scratch,
                random: rng,
              })
          : mode === 'SPIRAL'
            ? randomizeSpiralNotes(timedNotes, allLanes, rng)
            : mode === 'H-RANDOM'
              ? randomizeHRandomNotes(timedNotes, allLanes, { random: rng, thresholdBPM: options.hRandomThresholdBPM })
              : randomizeSRandomNotes(timedNotes, allLanes, { ruleset: options.ruleset ?? 'lr2', random: rng });
    entries.forEach(({ note }, index) => {
      note.channel = channels[index]!;
    });
    return;
  }
  if (mode === 'RANDOM-EX' && (options.scratchLanes?.length ?? 0) === 0)
    throw new RangeError('RANDOM-EX requires scratch lanes.');
  const domainLanes = mode === 'RANDOM-EX' ? [...allLanes, ...options.scratchLanes!] : allLanes;
  if (domainLanes.length < 2) return;

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
    for (let index = 0; index < domainLanes.length; index += 1) {
      map.set(domainLanes[index]!, domainLanes[domainLanes.length - 1 - index]!);
    }
    remapAll(map);
    return;
  }

  if (mode === 'R-RANDOM') {
    // beatoraja 0.8.9 LaneRotateShuffleModifier: destination -> source, excluding
    // identity (forward start 0) and mirror (reverse start N - 1).
    const forward = Math.floor(rng() * 2) === 1;
    const start = Math.floor(rng() * (domainLanes.length - 1)) + (forward ? 1 : 0);
    const map = new Map<string, string>();
    for (let lane = 0; lane < domainLanes.length; lane += 1) {
      const source = (start + (forward ? lane : -lane) + domainLanes.length) % domainLanes.length;
      map.set(domainLanes[source]!, domainLanes[lane]!);
    }
    remapAll(map);
    return;
  }

  if (mode === 'RANDOM' || mode === 'RANDOM-EX') {
    const perm = shuffleArray([...domainLanes], rng);

    const map = new Map<string, string>();
    for (let index = 0; index < domainLanes.length; index += 1) {
      map.set(domainLanes[index]!, perm[index]!);
    }
    remapAll(map);
    return;
  }
}

/**
 * In-place Fisher-Yates shuffle. Returns the same array for call-chaining — callers usually just discard the return
 * value since the array is mutated.
 */
export function shuffleArray<T>(array: T[], rng: () => number): T[] {
  for (let index = array.length - 1; index > 0; index -= 1) {
    const target = Math.floor(rng() * (index + 1));
    const swap = array[target]!;
    array[target] = array[index]!;
    array[index] = swap;
  }
  return array;
}
