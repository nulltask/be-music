import { normalizeFloatingLaneCover } from '../play-options/floating-hi-speed.ts';
import { createCourseCombo, reduceCourseCombo, type CourseComboState } from '../course-view/course-combo.ts';
import type { HSFix } from '../play-options/options.ts';
import { createHiSpeedState, reduceHiSpeed, type HiSpeedCommand, type HiSpeedState } from './hi-speed.ts';
import { reduceLaneCovers, type LaneCoverCommand, type LaneCoverState } from './lane-cover.ts';
import {
  gaugePercent,
  isJudgmentKind,
  JUDGMENT_KINDS,
  type GaugeHistorySample,
  type JudgmentKind,
  type JudgmentTiming,
  type PlayFrameInput,
  type PlayJudgeInput,
  type PlayScoreInput,
  type PlaySeekSnapshot,
  type ScoreHistorySample,
} from './types.ts';

/** How many of a judgment's timed hits were early (< 0 ms) and late (> 0 ms). */
export interface EarlyLateCount {
  readonly early: number;
  readonly late: number;
}

/**
 * What the player sees of a play apart from what is judged (the glossary's view settings): the hi-speed, the lane
 * covers of each side with lanes, and the HS-FIX the hi-speed is kept with.
 */
export interface PlayViewState {
  readonly hiSpeed: HiSpeedState;
  readonly covers: readonly LaneCoverState[];
  readonly hsFix?: HSFix;
  readonly fixedDisplayArea?: true;
}

/**
 * The state of a play as every screen reads it, fed by the engine's frames and judgments: the running gauge and EX
 * score with their graphs, the combo and max combo (and the course combo of a course stage), every timed judgment with
 * the early / late count of each judgment, and the view. Immutable: {@link reducePlayState} returns a new state, keeping
 * the parts that did not change, and the same state when nothing did.
 */
export interface PlayState {
  /** The chart's length in seconds: chart-time fractions of the graphs are taken over it. */
  readonly totalSeconds: number;
  /** The gauge in percent, as of the last frame. */
  readonly gauge: number;
  readonly gaugeType?: string;
  readonly cleared: boolean;
  /** The EX score, as of the last frame. */
  readonly exScore: number;
  readonly combo: number;
  readonly maxCombo: number;
  /** A course stage's course-wide combo; absent outside a course. */
  readonly courseCombo?: CourseComboState;
  readonly gaugeHistory: readonly GaugeHistorySample[];
  readonly scoreHistory: readonly ScoreHistorySample[];
  /** Every timed judgment, oldest first. */
  readonly judgeTimings: readonly JudgmentTiming[];
  readonly earlyLate: Readonly<Record<JudgmentKind, EarlyLateCount>>;
  /** The signed offset of the latest timed judgment; absent before the first. */
  readonly lastJudgeDeltaMs?: number;
  readonly view: PlayViewState;
}

/** How a play starts. */
export interface PlayStateInit {
  /** The gauge (percent) the play starts at: seeds the graphs at the chart's start. Without it the first frame does. */
  gauge?: number;
  totalSeconds?: number;
  /** For a course stage: the course combo carried in from the previous stage (`{ combo: 0, maxCombo: 0 }` for the first). */
  courseCarryIn?: { combo: number; maxCombo: number };
  /** The view the play starts with; a default hi-speed and no covers when absent. */
  view?: Partial<PlayViewState>;
}

const NO_EARLY_LATE: Readonly<Record<JudgmentKind, EarlyLateCount>> = Object.fromEntries(
  JUDGMENT_KINDS.map((judge) => [judge, { early: 0, late: 0 }]),
) as Record<JudgmentKind, EarlyLateCount>;

/** A play state at the start of a play. */
export function createPlayState(init: PlayStateInit = {}): PlayState {
  const gauge = init.gauge ?? 0;
  const seeded = init.gauge !== undefined;
  return {
    totalSeconds: init.totalSeconds ?? 0,
    gauge,
    cleared: false,
    exScore: 0,
    combo: 0,
    maxCombo: 0,
    ...(init.courseCarryIn !== undefined ? { courseCombo: createCourseCombo(init.courseCarryIn) } : {}),
    gaugeHistory: seeded ? [{ progress: 0, value: gauge }] : [],
    scoreHistory: seeded ? [{ progress: 0, exScore: 0 }] : [],
    judgeTimings: [],
    earlyLate: NO_EARLY_LATE,
    view: {
      hiSpeed: init.view?.hiSpeed ?? createHiSpeedState(),
      covers: init.view?.covers ?? [],
      ...(init.view?.fixedDisplayArea ? { fixedDisplayArea: true as const } : {}),
      ...(init.view?.hsFix !== undefined ? { hsFix: init.view.hsFix } : {}),
    },
  };
}

/** What a play state is fed. */
export type PlayEvent =
  /** An engine frame: the running gauge and EX score, and the chart's length. */
  | { type: 'frame'; frame: PlayFrameInput }
  /**
   * A judgment the engine published, at chart time `seconds` and play-clock `atMs`. It moves the combo, records its
   * timing, and samples the graphs.
   */
  | { type: 'judge'; judge: PlayJudgeInput; seconds: number; atMs: number }
  /**
   * An empty POOR (or a miss) at chart time `seconds`: the gauge moved without a judgment of a note, so the graphs are
   * sampled (the engine's `trigger-poor-bga` command; see {@link playEventFromUICommand}).
   */
  | { type: 'empty-poor'; seconds: number }
  /** The play's final judgment counts: a full combo's max combo is every note. */
  | { type: 'finish'; summary: PlayScoreInput }
  /**
   * The play sought to chart second `seconds`, at play-clock `atMs` (chart time running `tempo` times as fast as the play
   * clock, 1 when absent): the state becomes the one `snapshot` describes — its gauge, EX score, combos and judgments,
   * the graphs and timings rebuilt from them — keeping the chart's length, the start of the graphs and the view.
   */
  | { type: 'seek'; snapshot: PlaySeekSnapshot; seconds: number; atMs: number; tempo?: number }
  | HiSpeedCommand
  | LaneCoverCommand;

/** The play event an engine UI command stands for, when it stands for one (`trigger-poor-bga` → `empty-poor`). */
export function playEventFromUICommand(command: { kind: string; seconds?: number }): PlayEvent | undefined {
  return command.kind === 'trigger-poor-bga' && command.seconds !== undefined
    ? { type: 'empty-poor', seconds: command.seconds }
    : undefined;
}

/** The chart-time fraction of `seconds` over the play's chart, 0..1 (0 before the chart's length is known). */
export function playProgress(state: Pick<PlayState, 'totalSeconds'>, seconds: number): number {
  return state.totalSeconds > 0 ? Math.max(0, Math.min(1, seconds / state.totalSeconds)) : 0;
}

/** The play state with one more graph sample, at `seconds`, of the gauge and EX score as of the last frame. */
function sample(state: PlayState, seconds: number): Pick<PlayState, 'gaugeHistory' | 'scoreHistory'> {
  const progress = playProgress(state, seconds);
  return {
    gaugeHistory: [...state.gaugeHistory, { progress, value: state.gauge }],
    scoreHistory: [...state.scoreHistory, { progress, exScore: state.exScore }],
  };
}

function applyFrame(state: PlayState, frame: PlayFrameInput): PlayState {
  const gauge = frame.summary.gauge;
  const value = gauge !== undefined ? gaugePercent(gauge) : state.gauge;
  const totalSeconds = frame.totalSeconds > 0 ? frame.totalSeconds : state.totalSeconds;
  const cleared = gauge?.cleared ?? state.cleared;
  const gaugeType = gauge?.type ?? state.gaugeType;
  // The engine's own combos, when the frame carries them, win over what the judgments counted.
  const combo = frame.summary.combo ?? state.combo;
  const maxCombo = frame.summary.maxCombo !== undefined ? Math.max(frame.summary.maxCombo, combo) : state.maxCombo;
  const courseCombo = frameCourseCombo(state.courseCombo, frame.summary.course, combo);
  if (
    value === state.gauge &&
    frame.summary.exScore === state.exScore &&
    totalSeconds === state.totalSeconds &&
    cleared === state.cleared &&
    gaugeType === state.gaugeType &&
    combo === state.combo &&
    maxCombo === state.maxCombo &&
    courseCombo === state.courseCombo
  ) {
    return state;
  }
  const next: PlayState = {
    ...state,
    gauge: value,
    exScore: frame.summary.exScore,
    totalSeconds,
    cleared,
    combo,
    maxCombo,
    ...(gaugeType !== undefined ? { gaugeType } : {}),
    ...(courseCombo !== undefined ? { courseCombo } : {}),
  };
  // The graphs start at the gauge the play starts with; without a starting gauge given, the first frame tells it.
  if (state.gaugeHistory.length === 0 && gauge !== undefined) {
    return { ...next, gaugeHistory: [{ progress: 0, value }], scoreHistory: [{ progress: 0, exScore: 0 }] };
  }
  return next;
}

/**
 * A course stage's course combo after a frame: the engine's course combo and max combo when the frame carries them (the
 * same state when they did not change), else the one counted from the judgments.
 */
function frameCourseCombo(
  state: CourseComboState | undefined,
  course: PlayFrameInput['summary']['course'],
  stageCombo: number,
): CourseComboState | undefined {
  if (state === undefined || course === undefined) return state;
  const maxCombo = Math.max(course.maxCombo, course.combo);
  if (state.combo === course.combo && state.maxCombo === maxCombo && state.stageCombo === stageCombo) return state;
  return { combo: course.combo, maxCombo, stageCombo };
}

function applyJudge(state: PlayState, judge: PlayJudgeInput, seconds: number, atMs: number): PlayState {
  // The engine publishes READY to reset its readouts; it is no judgment.
  if (judge.judge === 'READY') return state;
  const combo = judge.combo;
  const next: { -readonly [K in keyof PlayState]: PlayState[K] } = {
    ...state,
    combo,
    maxCombo: Math.max(state.maxCombo, combo),
    ...sample(state, seconds),
  };
  if (state.courseCombo !== undefined) next.courseCombo = reduceCourseCombo(state.courseCombo, combo);
  const deltaMs = judge.deltaMs;
  if (deltaMs !== undefined && Number.isFinite(deltaMs) && isJudgmentKind(judge.judge)) {
    const timing: JudgmentTiming = { atMs, deltaMs, judge: judge.judge };
    if (judge.channel !== undefined) timing.channel = judge.channel;
    next.judgeTimings = [...state.judgeTimings, timing];
    next.lastJudgeDeltaMs = deltaMs;
    if (deltaMs !== 0) {
      const count = state.earlyLate[judge.judge];
      next.earlyLate = {
        ...state.earlyLate,
        [judge.judge]: deltaMs < 0 ? { ...count, early: count.early + 1 } : { ...count, late: count.late + 1 },
      };
    }
  }
  return next;
}

function applyFinish(state: PlayState, summary: PlayScoreInput): PlayState {
  // Every note judged GOOD or better and none BAD or POOR: the combo never broke, so it reached every note, even where
  // the engine published no combo for some of them (an autoplayed chord).
  const judged = summary.perfect + summary.great + summary.good + summary.bad + summary.poor;
  const fullCombo = summary.total > 0 && judged >= summary.total && summary.bad === 0 && summary.poor === 0;
  if (summary.fullCombo === false || !fullCombo || state.maxCombo >= summary.total) return state;
  const combo = Math.max(state.combo, summary.total);
  return {
    ...state,
    combo,
    maxCombo: summary.total,
    ...(state.courseCombo !== undefined ? { courseCombo: reduceCourseCombo(state.courseCombo, combo) } : {}),
  };
}

/**
 * The play state a seek rebuilt (see the `seek` {@link PlayEvent}): the graphs from their start sample on, one sample
 * per judgment with the gauge and EX score right after it, the timed judgments with their early / late counts, and the
 * gauge, EX score and combos of the snapshot.
 */
function applySeek(state: PlayState, event: Extract<PlayEvent, { type: 'seek' }>): PlayState {
  const { snapshot, seconds, atMs } = event;
  const tempo = event.tempo !== undefined && event.tempo > 0 ? event.tempo : 1;
  const { summary } = snapshot;
  const gauge = summary.gauge;
  const startGauge =
    state.gaugeHistory[0]?.value ??
    (gauge?.initial !== undefined ? gaugePercent({ ...gauge, current: gauge.initial }) : undefined);
  const gaugeHistory: GaugeHistorySample[] = startGauge !== undefined ? [{ progress: 0, value: startGauge }] : [];
  const scoreHistory: ScoreHistorySample[] = startGauge !== undefined ? [{ progress: 0, exScore: 0 }] : [];
  const judgeTimings: JudgmentTiming[] = [];
  const earlyLate: Record<JudgmentKind, EarlyLateCount> = { ...NO_EARLY_LATE };
  let lastJudgeDeltaMs: number | undefined;
  let gaugeValue = startGauge ?? 0;
  for (const judgment of snapshot.judgments) {
    if (judgment.judge === 'READY') continue;
    if (judgment.gauge !== undefined && gauge !== undefined)
      gaugeValue = gaugePercent({ current: judgment.gauge, max: gauge.max });
    const progress = playProgress(state, judgment.seconds);
    gaugeHistory.push({ progress, value: gaugeValue });
    scoreHistory.push({ progress, exScore: judgment.exScore });
    const deltaMs = judgment.deltaMs;
    if (deltaMs === undefined || !Number.isFinite(deltaMs) || !isJudgmentKind(judgment.judge)) continue;
    const timing: JudgmentTiming = {
      atMs: atMs - ((seconds - judgment.seconds) * 1000) / tempo,
      deltaMs,
      judge: judgment.judge,
    };
    if (judgment.channel !== undefined) timing.channel = judgment.channel;
    judgeTimings.push(timing);
    lastJudgeDeltaMs = deltaMs;
    if (deltaMs !== 0) {
      const count = earlyLate[judgment.judge];
      earlyLate[judgment.judge] =
        deltaMs < 0 ? { ...count, early: count.early + 1 } : { ...count, late: count.late + 1 };
    }
  }
  const { lastJudgeDeltaMs: _previousDelta, ...kept } = state;
  const gaugeType = gauge?.type ?? state.gaugeType;
  const courseCombo =
    state.courseCombo !== undefined && summary.course !== undefined
      ? {
          combo: summary.course.combo,
          maxCombo: Math.max(summary.course.maxCombo, summary.course.combo),
          stageCombo: snapshot.combo,
        }
      : state.courseCombo;
  return {
    ...kept,
    gauge: gauge !== undefined ? gaugePercent(gauge) : gaugeValue,
    cleared: gauge?.cleared ?? false,
    ...(gaugeType !== undefined ? { gaugeType } : {}),
    exScore: summary.exScore,
    combo: snapshot.combo,
    maxCombo: Math.max(snapshot.maxCombo, snapshot.combo),
    ...(courseCombo !== undefined ? { courseCombo } : {}),
    gaugeHistory,
    scoreHistory,
    judgeTimings,
    earlyLate,
    ...(lastJudgeDeltaMs !== undefined ? { lastJudgeDeltaMs } : {}),
  };
}

/**
 * Applies one event to a play state. Pure: the same state and event give the same result, the state given is never
 * changed, and no clock is read — time comes in with the events.
 */
export function reducePlayState(state: PlayState, event: PlayEvent): PlayState {
  switch (event.type) {
    case 'frame':
      return applyFrame(state, event.frame);
    case 'judge':
      return applyJudge(state, event.judge, event.seconds, event.atMs);
    case 'empty-poor':
      return { ...state, ...sample(state, event.seconds) };
    case 'finish':
      return applyFinish(state, event.summary);
    case 'seek':
      return applySeek(state, event);
    case 'floating-speed-mode':
    case 'floating-speed-restore':
    case 'floating-speed-recalculate':
    case 'hi-speed-fine':
    case 'hi-speed-scale':
    case 'hi-speed-step':
    case 'hi-speed-set':
    case 'hi-speed-drawn': {
      if (event.type === 'hi-speed-fine' && state.view.covers.some((cover) => cover.suddenOn || cover.liftOn))
        return state;
      const hiSpeed = reduceHiSpeed(state.view.hiSpeed, event);
      return hiSpeed === state.view.hiSpeed
        ? state
        : {
            ...state,
            view: {
              ...state.view,
              hiSpeed,
              ...(event.type === 'floating-speed-mode' && event.enabled && !state.view.fixedDisplayArea
                ? { covers: state.view.covers.map(normalizeFloatingLaneCover) }
                : {}),
            },
          };
    }
    case 'cover-adjust':
    case 'cover-toggle':
    case 'cover-set': {
      if (state.view.fixedDisplayArea && !(event.type === 'cover-set' && event.recorded)) return state;
      const covers = reduceLaneCovers(
        state.view.covers,
        event,
        state.view.hiSpeed.locked && event.type !== 'cover-set',
      );
      let hiSpeed = state.view.hiSpeed;
      if (hiSpeed.floating && event.type !== 'cover-set' && event.part === 'sudden') {
        const cover = covers.find((cover) => event.side === undefined || cover.side === event.side);
        const previous = state.view.covers.find((cover) => event.side === undefined || cover.side === event.side);
        const liftOn = cover?.liftOn ?? false;
        const recalculate =
          event.type === 'cover-adjust'
            ? cover?.suddenOn
            : liftOn
              ? previous?.suddenOn && !cover?.suddenOn
              : !previous?.suddenOn && cover?.suddenOn;
        const visible = liftOn && previous?.suddenOn && !cover?.suddenOn ? previous : cover;
        if (recalculate && visible)
          hiSpeed = reduceHiSpeed(hiSpeed, {
            type: 'floating-speed-recalculate',
            bpm: event.bpm ?? hiSpeed.floating.bpm,
            visibleFraction: Math.max(0, 1 - visible.sudden - ((visible.liftOn ?? false) ? visible.lift : 0)),
          });
      }
      return covers === state.view.covers && hiSpeed === state.view.hiSpeed
        ? state
        : { ...state, view: { ...state.view, covers, hiSpeed } };
    }
  }
}

/** The latest `count` timed judgments, oldest first (what a live timing meter shows): one array per judgment list. */
export function recentJudgeTimings(
  state: Pick<PlayState, 'judgeTimings'>,
  count: number = RECENT_JUDGE_TIMING_COUNT,
): readonly JudgmentTiming[] {
  const all = state.judgeTimings;
  if (all.length <= count) return all;
  const key = `${count}`;
  let byCount = RECENT_MEMO.get(all);
  if (byCount === undefined) {
    byCount = new Map();
    RECENT_MEMO.set(all, byCount);
  }
  let recent = byCount.get(key);
  if (recent === undefined) {
    recent = all.slice(all.length - count);
    byCount.set(key, recent);
  }
  return recent;
}

/** How many judgments {@link recentJudgeTimings} keeps by default. */
export const RECENT_JUDGE_TIMING_COUNT = 64;

const RECENT_MEMO = new WeakMap<readonly JudgmentTiming[], Map<string, readonly JudgmentTiming[]>>();
