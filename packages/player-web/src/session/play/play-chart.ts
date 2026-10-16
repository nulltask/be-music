/**
 * Chart preparation for a play on the built-in and LR2 gameplay scenes (`CoreGameplayView`): resolves the chart's
 * `#RANDOM` / `#SWITCH` control flow, prepares the notes the engine judges and the playfield draws (one shared
 * `PreparedPlaybackChartData`), applies the lane options (DP FLIP, RANDOM / MIRROR / S-RANDOM / SCATTER) or a replay's
 * recorded arrangement, and resets the play's state for the new chart.
 *
 * `prepareSong` reads and writes the play's state through {@link PlayChartContext}; the scene passes itself.
 */

import {
  createBmsonSamplePlaybackMap,
  type TimedSampleTrigger,
  type TimingResolver,
} from '@be-music/audio-renderer/triggers';
import {
  parseBmsSwBga,
  resolveChart,
  resolveChartMainBpm,
  resolveChartReferenceBpm,
  type BmsSwitchingBga,
  type RandomDraws,
  type ResolvedChart,
} from '@be-music/chart';
import { resolveBmsBase, type BeMusicEvent, type BeMusicJson } from '@be-music/json';
import { preparePlaybackChart, resolvePlayChart, type PreparedPlaybackChartData } from '@be-music/player/core/engine';
import { type ChartPlayVariant, resolveLaneOptionChannels } from '@be-music/player/core/lane-layout';
import { createScrollDistanceMapper, type ScrollDistanceMapperLike } from '@be-music/player/core/scroll-distance';
import { createBeatAtSecondsResolverFromTimingResolver } from '@be-music/player/core/timeline';
import type { PlayerGaugeSummary } from '@be-music/player/core/ui-signal-bus';
import type { TimedLandmineNote, TimedPlayableNote } from '@be-music/player/playable-notes';
import { createEmptyScore, type GaugeType, type JudgeKind, type ScoreSummary } from '@be-music/player/ruleset';
import { collectChartVolumeMultipliers } from '../../chart/play-audio.ts';
import { resolvePoorBgaFallbackKey } from '../../chart/play-bga.ts';
import { applyPlaylogArrangement } from '../../chart/playlog-arrangement.ts';
import { resolveChartPlayVariant } from '../../collection/collection.ts';
import type { BrowserSongEntry } from '../../collection/types.ts';
import {
  splitNonstopBgaTimeline,
  toBrowserBgaTimeline,
  type BgaCue,
  type NonstopStageBgaTimeline,
} from '../../scene/core/gameplay-bga.ts';
import { resolveChartBpmRange, type ChartBpmRange } from '../../scene/core/gameplay-bpm-range.ts';
import type { CoreGameplayViewOptions } from '../../scene/core/gameplay-options.ts';
import type { LongNoteTracker } from '../../scene/core/long-note-tracker.ts';
import { changesScrollRate, collectResolvedLaneTimelineBeats } from '../../scene/core/note-draw-window.ts';
import { createPlaceholderGaugeState } from '../../scene/core/placeholder-gauge.ts';
import { isPlayableInputChannel, resolvePlayVariantLaneChannels } from '../../scene/gameplay-lanes.ts';
import {
  createHiSpeedState,
  createPlayState,
  gaugePercent,
  laneCoversFromPlayOptions,
  reducePlayState,
  resolveHsFixMultiplier,
  SHUTTER_DEFAULT,
  type PlayState,
} from '@be-music/scene-model';
import { resolveLaneSides } from '../../chart/lane-sides.ts';
import type { HiSpeedTransition } from '../../scene/hi-speed.ts';

/** The play state {@link prepareSong} resets and fills for a new chart: `CoreGameplayView`'s fields of these names. */
export interface PlayChartContext {
  readonly options: Readonly<
    Pick<
      CoreGameplayViewOptions,
      | 'hsFix'
      | 'hiSpeedLocked'
      | 'hiddenSudden1P'
      | 'hiddenSudden2P'
      | 'shutter'
      | 'laneCover'
      | 'replay'
      | 'dpFlip'
      | 'random1P'
      | 'random2P'
      | 'course'
      | 'nonstop'
      | 'judgeRuleset'
      | 'autoScratch1P'
      | 'autoScratch2P'
    >
  >;
  song: BrowserSongEntry | undefined;
  resolvedChart: BeMusicJson | undefined;
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
  songDurationSeconds: number;
  laneChannels: string[];
  chartPlayVariant: ChartPlayVariant;
  touchTokenByChannel: Map<string, string> | undefined;
  wavCmdVolumeMultipliers: Map<string, number>;
  switchingBgas: Map<string, BmsSwitchingBga>;
  bmsonSlicePlayback:
    | Map<BeMusicEvent, { offsetSeconds: number; durationSeconds?: number; sliceId: string }>
    | undefined;
  autoSampleTriggers: TimedSampleTrigger[];
  score: ScoreSummary;
  playState: PlayState;
  readonly scrollHiSpeed: HiSpeedTransition;
  readonly longNotes: LongNoteTracker;
  chartBpmRange: ChartBpmRange | undefined;
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
  judgeSideState: Record<'1P' | '2P', { judge: JudgeKind | ''; until: number; combo: number; courseCombo?: number }>;
  gaugeState: PlayerGaugeSummary;
  fastCount: number;
  slowCount: number;
  fullComboFired: boolean;
  timingResolver: TimingResolver | undefined;
  nonstopBgaTimelines: NonstopStageBgaTimeline[] | undefined;
  bgaTimeline: { base: BgaCue[]; layer: BgaCue[]; poor: BgaCue[] };
  poorBgaFallbackKey: string | undefined;
  poorBgaFallbackUntilSeconds: number;
  hasBga: boolean;
  displayedScore: number;
  chartEnded: boolean;
  /** The gauge the run plays on (a replay's recorded pick wins). */
  resolveSelectedGauge(): GaugeType;
}

export function prepareSong(ctx: PlayChartContext, song: BrowserSongEntry): void {
  // Resolve `#RANDOM` / `#SETRANDOM` / `#SWITCH` control flow once, first, so every play-time consumer below and the
  // engine see the same chosen branches. The draws are fresh each play (LR2 re-rolls each play); a replay resolves
  // with the draws its log recorded, so it plays the recorded branches.
  const { chart: resolved, randomDraws } = resolvePlayChart(
    song.chart,
    ctx.options.replay?.play.randomDraws !== undefined ? { randomDraws: ctx.options.replay.play.randomDraws } : {},
  );
  ctx.resolvedChart = resolved;
  ctx.randomDraws = randomDraws;
  // BMS spec — `#WAVCMD 01 xx vv` and `#EXWAVxx` per-slot volumes, collected once so every sample trigger is a single
  // Map lookup; slots without an entry take the unity-gain fast path.
  ctx.wavCmdVolumeMultipliers = collectChartVolumeMultipliers(resolved);
  // BMS spec — `#SWBGAxx fr:tot:lp:ARGB N1 N2 ...` declares an animated BGA slot. Pre-parse every entry now so
  // per-frame BGA composition stays a single `Map.get` plus `pickSwitchingBgaFrame` (no per-frame regex / split).
  ctx.switchingBgas.clear();
  const base = resolveBmsBase(resolved);
  for (const [slot, raw] of Object.entries(resolved.bms.swBga)) {
    const parsed = parseBmsSwBga(raw, base);
    if (parsed) {
      ctx.switchingBgas.set(slot, parsed);
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
  // re-running its own heuristic. Classify the RESOLVED chart: lanes that only a chosen `#RANDOM` / `#SWITCH`
  // branch adds are not in `song.chart.events`, and missing them would lay out (and judge) a 7 KEY play as 5 KEY.
  const hostPlayVariant = resolveChartPlayVariant(song, resolved);
  const resolvedPlay = resolveChart(resolved, {
    randomDraws,
    playVariant: hostPlayVariant,
    inferBmsLnTypeWhenMissing: true,
  });
  ctx.resolvedPlayChart = resolvedPlay;
  // The invisible / keysound array is always prepared even when the overlay is off — so the lil-gui toggle can flip
  // the visualization on mid-song without a chart restart; the per-frame render loop is gated on
  // `showInvisibleNotes`. The audio horizon is left at 0: the engine recomputes its own from realtime triggers.
  const prepared = preparePlaybackChart(
    resolvedPlay,
    { laneModeExtension: extractChartExtension(ctx.song?.chartPath) },
    0,
  );
  ctx.preparedChart = prepared;
  ctx.touchTokenByChannel = undefined;
  ctx.notes = prepared.notes;
  ctx.mineNotes = prepared.landmineNotes;
  ctx.invisibleNotes = prepared.invisibleNotes;
  if (ctx.options.replay !== undefined) {
    // Replay playback — the recorded play-log carries the FINAL note arrangement (post-flip, post-shuffle), so
    // instead of re-rolling the lane transforms we re-apply the recorded channels onto the freshly prepared
    // notes. A mismatch means the loaded chart is not the one the log was recorded against (different `#RANDOM`
    // roll or a different file) — surface it as a prepare failure rather than replaying garbage.
    const arranged = applyPlaylogArrangement(ctx.options.replay.chart.notes, prepared);
    if (!arranged.ok) {
      throw new Error(`play-log replay chart mismatch: ${arranged.reason}`);
    }
  } else {
    // DP FLIP — swap 1P / 2P channels in place. Cheap O(n) walk because we already iterate `notes` for sorting; SP
    // charts skip every entry (no `2x` channels exist). Mine notes are flipped together so they stay anchored to the
    // same visual lane after the flip.
    if (ctx.options.dpFlip) {
      for (const note of ctx.notes) {
        note.channel = flipDpChannel(note.channel);
      }
      for (const mine of ctx.mineNotes) {
        mine.channel = flipDpChannel(mine.channel);
      }
      for (const invisible of ctx.invisibleNotes) {
        invisible.channel = flipDpChannel(invisible.channel);
      }
    }
    // RANDOM / MIRROR / S-RANDOM / SCATTER — shuffle the 1P / 2P keyboard lanes independently. Scratch (channels 16 /
    // 26) and the 24 / 48 KEY wheel never move (`resolveLaneOptionChannels`). Per LR2 convention, the shuffle is drawn at chart-prepare time so a single play session has a
    // stable arrangement (F5-restart re-rolls it). Mine channels are included in the same shuffle pass so a mine on
    // lane 4 lands wherever the shuffle moved lane 4 — keeping the mine's visual relationship to the surrounding chord
    // intact.
    applyRandomMode(
      ctx.notes as Array<{ channel: string }>,
      resolveLaneOptionChannels('1P', hostPlayVariant),
      ctx.options.random1P ?? 'OFF',
      Math.random,
      ctx.mineNotes as Array<{ channel: string }>,
      ctx.invisibleNotes as Array<{ channel: string }>,
    );
    applyRandomMode(
      ctx.notes as Array<{ channel: string }>,
      resolveLaneOptionChannels('2P', hostPlayVariant),
      ctx.options.random2P ?? 'OFF',
      Math.random,
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
  ctx.songDurationSeconds = ctx.chartLastNoteEndSeconds;
  ctx.chartEnded = false;
  // Drop the previous chart's active-sample tracking. Stale entries would otherwise let a `c=true` note on the new
  // chart suppress its own first trigger because a same-key node from the old play looks "still playing" until it
  // ends naturally.

  // Lay out the whole keyboard of the chart's play variant (5 / 7 / 9 / 10 / 14 / 24 / 48 KEY), not just the lanes
  // the chart happens to use, so a sparse chart still plays on full lanes. The variant also decides channel `17`
  // (a lane in 9 KEY, FREE ZONE in IIDX) and the 9 KEY layout the LR2 default 9-keys play skin expects.
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
  const speedTimeline = resolvedPlay.speed;
  ctx.scrollMapper = changesScrollRate(scrollTimeline, speedTimeline)
    ? createScrollDistanceMapper(scrollTimeline, speedTimeline, { invalidDistance: 0 })
    : undefined;
  ctx.laneTimelineBeats = collectResolvedLaneTimelineBeats(resolvedPlay);
  ctx.autoSampleTriggers = resolvedPlay.sampleTriggers
    .filter((trigger) => !isPlayableInputChannel(trigger.channel))
    .sort((left, right) => left.seconds - right.seconds);
  // bmson 1.0.0 slicing — for bmson charts, each `sound_channels[]` entry is a single audio file that gets sliced at
  // every distinct pulse where any of its notes fire, and each note plays its assigned slice (`audio_offset` ..
  // `audio_offset + slice_duration`) instead of the whole WAV from t=0. The audio-renderer already computes the
  // per-event slice playback table; we wire it up here so the playable- note path (`playSample`) can look up the
  // offset / duration by event identity at trigger time. BMS / json charts skip the build (the map stays undefined)
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
  ctx.songDurationSeconds = Math.max(ctx.chartLastNoteEndSeconds, ctx.autoSampleTriggers.at(-1)?.seconds ?? 0);
  // Initialize gauge with the actual playable-note count and the chart's #TOTAL value so PG/GR gain matches LR2: a
  // long chart with TOTAL=300 and 1000 notes gets +0.3 per PG/GR, while a short TOTAL=160 100-note chart gets +1.6
  // per PG/GR.
  ctx.gaugeState = createPlaceholderGaugeState(ctx.resolveSelectedGauge(), resolveCourseStartGaugeInput(ctx));
  ctx.playState = createChartPlayState(ctx, resolver, resolveChartReferenceBpm(resolved, ctx.song?.bpm), resolvedPlay);
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
  ctx.chartBpmRange = resolveChartBpmRange(
    resolver.tempoPoints,
    ctx.songDurationSeconds,
    resolved.metadata.bpm > 0 ? resolved.metadata.bpm : ctx.song?.bpm,
  );
  ctx.autoScratchChannels = resolveAutoScratchEnabled(ctx)
    ? new Set(prepared.laneBindings.filter((binding) => binding.isScratch).map((binding) => binding.channel))
    : new Set();
  ctx.bgaTimeline = toBrowserBgaTimeline(resolvedPlay.bga);
  ctx.nonstopBgaTimelines =
    ctx.options.nonstop !== undefined
      ? splitNonstopBgaTimeline(ctx.bgaTimeline, ctx.options.nonstop.stages)
      : undefined;
  // BMS spec — when `#POORBGA` is unset but `#BMP00` exists, BMP00 becomes the implicit POOR placeholder until an
  // explicit `#xxx06` cue fires. Mirrors the TUI BGA renderer's `poorFallbackKey` so the web side stops showing a
  // black POOR plate on misses for charts that rely on this convention.
  ctx.poorBgaFallbackKey = resolvePoorBgaFallbackKey(resolved);
  ctx.poorBgaFallbackUntilSeconds = ctx.bgaTimeline.poor[0]?.seconds ?? Number.POSITIVE_INFINITY;
  ctx.hasBga = ctx.bgaTimeline.base.length > 0 || ctx.bgaTimeline.layer.length > 0 || ctx.bgaTimeline.poor.length > 0;
}

/**
 * The play state a new chart starts from: the starting gauge (LR2's 20 %, a course stage's carried-in gauge) seeding
 * the graphs at the chart's start, the chart's length the graphs are taken over, a course stage's carried-in combo,
 * and the view — the player's hi-speed (the one in force, so a host's setting before the chart is kept) under the
 * chart's HS-FIX, and each side's lane covers from the play options.
 *
 * HS-FIX keeps the player's hi-speed at the chart's reference BPM (`#BASEBPM`, else the start BPM:
 * `resolveChartReferenceBpm` prefers `#BASEBPM` so a chart whose `#BPM` is its peak or average still calibrates at the
 * speed the author intended) and rescales it at the chart's MAXBPM, MINBPM or main BPM (`resolveHsFixMultiplier`).
 */
function createChartPlayState(
  ctx: PlayChartContext,
  resolver: TimingResolver,
  referenceBpm: number | undefined,
  resolvedPlay: ResolvedChart,
): PlayState {
  const hsFix = ctx.options.hsFix ?? 'OFF';
  const hiSpeed = createHiSpeedState({
    hiSpeed: ctx.playState.view.hiSpeed.player,
    multiplier: resolveHsFixMultiplier(hsFix, {
      ...(referenceBpm !== undefined ? { referenceBpm } : {}),
      bpms: resolver.tempoPoints.map((point) => point.bpm),
      ...withMainBpm(resolveChartMainBpm(resolvedPlay)),
    }),
    locked: ctx.options.hiSpeedLocked === true,
  });
  const course = ctx.options.course;
  const started = createPlayState({
    gauge: gaugePercent(ctx.gaugeState),
    totalSeconds: ctx.songDurationSeconds,
    ...(course !== undefined ? { courseCarryIn: course.carryIn ?? { combo: 0, maxCombo: 0 } } : {}),
    view: {
      hiSpeed,
      covers: laneCoversFromPlayOptions(
        {
          hiddenSudden1P: ctx.options.hiddenSudden1P ?? 'OFF',
          hiddenSudden2P: ctx.options.hiddenSudden2P ?? 'OFF',
          shutter: ctx.options.shutter ?? SHUTTER_DEFAULT,
          laneCover: ctx.options.laneCover !== false,
        },
        resolveLaneSides(ctx.laneChannels),
      ),
      hsFix,
    },
  });
  // The starting gauge's type and verdict, so a play given up before the engine's first frame still names its gauge.
  return reducePlayState(started, {
    type: 'frame',
    frame: { totalSeconds: ctx.songDurationSeconds, summary: { exScore: 0, gauge: ctx.gaugeState } },
  });
}

function withMainBpm(mainBpm: number | undefined): { mainBpm?: number } {
  return mainBpm !== undefined ? { mainBpm } : {};
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
export function flipDpChannel(channel: string): string {
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
 * untouched, matching LR2 / beatoraja where the lane options shuffle the keys only. The `usedLanes` filter trims the permutation domain to the lanes actually
 * present in the chart so 5K charts (lanes 1..5 only) MIRROR / RANDOM cleanly inside that subset.
 *
 * - `MIRROR` — deterministic reversal of `usedLanes`
 * - `RANDOM` — single chart-wide permutation (Fisher-Yates with the supplied RNG)
 * - `S-RANDOM` — per-chord permutation; chord notes share the beat key, and we re-permute within that group so notes on
 *   the same beat never collide on one lane
 * - `SCATTER` — currently aliased to `RANDOM`; reserved for a future per-measure permutation pass
 */
export function applyRandomMode(
  notes: Array<{ channel: string }>,
  allLanes: readonly string[],
  mode: 'OFF' | 'MIRROR' | 'RANDOM' | 'S-RANDOM' | 'SCATTER',
  rng: () => number,
  // Extra channel-bearing arrays (e.g. mine notes) that should follow the same lane shuffle as the playable notes. The
  // `usedLanes` set is computed from `notes` only — secondary entries on a lane that has no playable notes get remapped
  // through the same chart-wide map / chord permutation, so mines stay anchored to the visual lane they were authored
  // on relative to the surrounding chord.
  ...secondary: Array<Array<{ channel: string }>>
): void {
  if (mode === 'OFF') return;
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
export function shuffleArray<T>(array: T[], rng: () => number): T[] {
  for (let index = array.length - 1; index > 0; index -= 1) {
    const target = Math.floor(rng() * (index + 1));
    const swap = array[target]!;
    array[target] = array[index]!;
    array[index] = swap;
  }
  return array;
}
