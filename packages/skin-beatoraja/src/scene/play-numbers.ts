import {
  resolveGreenNumber,
  resolveLaneCover,
  resolveWhiteNumber,
  type LaneCoverState,
} from '@be-music/player-scene-model';
import {
  BEATORAJA_NUM,
  SYNTHETIC_NUM_JUDGE_COMBO_1P,
  SYNTHETIC_NUM_JUDGE_COMBO_2P,
  SYNTHETIC_NUM_JUDGE_COMBO_3P,
} from '../runtime-ids.ts';
import type { BeatorajaWallClock } from './inputs.ts';
import {
  beatorajaNotesJudged,
  beatorajaScoreRate,
  resolveBeatorajaScoreNumber,
  type BeatorajaScoreNumberInput,
} from './score.ts';

/** One tempo change of a chart, in chart time: STOPs read as BPM 0. */
export interface BeatorajaBPMSegment {
  readonly timeMs: number;
  readonly bpm: number;
}

/** What a play skin's numbers read of the chart. */
export interface BeatorajaPlayChartFacts {
  /** The header BPM. */
  readonly bpm: number;
  /** The BPM most notes sit at (beatoraja's MAINBPM); the header BPM when 0 or absent. */
  readonly mainBPM?: number;
  /** The lowest and highest BPM of the tempo map (0 without a chart). */
  readonly minBPM: number;
  readonly maxBPM: number;
  /** The tempo changes in chart-time order, which the BPM at the playhead is read from. */
  readonly bpmSegments?: readonly BeatorajaBPMSegment[];
  /** `#PLAYLEVEL`, as a number or as written. */
  readonly playLevel?: number | string;
}

/** Where the play is: the engine frame's chart time and the chart's length, in seconds. */
export interface BeatorajaPlayClock {
  readonly currentSeconds: number;
  readonly totalSeconds: number;
  /** Chart time of an LR2 negative-BPM reversal, when the chart has one. */
  readonly reversalSeconds?: number;
}

/** What a play skin's numbers read: the score, the view (hi-speed and covers), the chart, the clock. */
export interface BeatorajaPlayNumberInput extends BeatorajaScoreNumberInput {
  /** The hi-speed the notes scroll at. */
  readonly hiSpeed: number;
  /** The 1P lane covers; none when absent. */
  readonly cover?: LaneCoverState;
  readonly chart: BeatorajaPlayChartFacts;
  /** Absent before the engine's first frame. */
  readonly clock?: BeatorajaPlayClock;
  /** The signed offset (ms, > 0 late) of the latest timed judgment. */
  readonly lastJudgeDeltaMs?: number;
  /** The combo each judge plate showed at its latest judgment: 1P, 2P and POPN 9 KEY's third plate. */
  readonly plateCombos?: readonly [number, number, number];
  readonly wallClock?: BeatorajaWallClock;
  /** How long the player has been running, in ms (numbers 27-29). */
  readonly operatingMs?: number;
  /** The frame rate (number 20). */
  readonly fps?: number;
}

/**
 * For each BPM segment, the last positive BPM at or before it (`NaN` before the first one), so the BPM at a time is one
 * binary search away. `undefined` when the segments are not in time order, where only the walk is right.
 */
function bpmLookupFor(segments: readonly BeatorajaBPMSegment[]): Float64Array | undefined {
  if (BPM_LOOKUPS.has(segments)) return BPM_LOOKUPS.get(segments);
  let lookup: Float64Array | undefined = new Float64Array(segments.length);
  let lastPositive = Number.NaN;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!;
    if (index > 0 && segment.timeMs < segments[index - 1]!.timeMs) {
      lookup = undefined;
      break;
    }
    if (segment.bpm > 0) lastPositive = segment.bpm;
    lookup[index] = lastPositive;
  }
  BPM_LOOKUPS.set(segments, lookup);
  return lookup;
}

const BPM_LOOKUPS = new WeakMap<readonly BeatorajaBPMSegment[], Float64Array | undefined>();

/**
 * The BPM in effect at `timeMs` of chart time (beatoraja's `LaneRenderer.nbpm`): the last positive BPM of a segment at
 * or before it. A STOP (BPM 0) holds the BPM before it, as the readout does; before the first positive segment the
 * first segment's BPM, else the header BPM.
 */
export function beatorajaBPMAt(segments: readonly BeatorajaBPMSegment[], timeMs: number, headerBPM: number): number {
  if (segments.length === 0) return headerBPM;
  const initial = segments[0]!.bpm > 0 ? segments[0]!.bpm : headerBPM;
  const lookup = bpmLookupFor(segments);
  if (lookup === undefined) {
    let lastPositive = initial;
    for (const segment of segments) {
      if (segment.timeMs > timeMs) break;
      if (segment.bpm > 0) lastPositive = segment.bpm;
    }
    return lastPositive;
  }
  // The last segment at or before `timeMs` (a binary search), and the last positive BPM up to it: what walking the
  // segments in order until one starts after `timeMs` finds, for a readout asked several times a frame.
  let low = 0;
  let high = segments.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (segments[middle]!.timeMs > timeMs) high = middle;
    else low = middle + 1;
  }
  const lastPositive = low === 0 ? Number.NaN : lookup[low - 1]!;
  return Number.isNaN(lastPositive) ? initial : lastPositive;
}

/** The BPM at the playhead: the header BPM before the first frame. */
function playheadBPM(input: BeatorajaPlayNumberInput): number {
  const { clock, chart } = input;
  if (clock === undefined) return chart.bpm;
  return beatorajaBPMAt(chart.bpmSegments ?? [], clock.currentSeconds * 1000, chart.bpm);
}

/**
 * The white number (`LaneRenderer.getCurrentDuration`, ms): a lane of four beats at `bpm` and the hi-speed, less the
 * lane cover when `withCover`. The LIFT does not shorten it. Rounded, 0 for a hi-speed or BPM that is not positive.
 */
function whiteDuration(input: BeatorajaPlayNumberInput, bpm: number, withCover: boolean): number {
  const sudden = withCover && input.cover !== undefined ? resolveLaneCover(input.cover).sudden : 0;
  return Math.round(resolveWhiteNumber({ laneBeats: 4, hiSpeed: input.hiSpeed, sudden, bpm }));
}

function duration(input: BeatorajaPlayNumberInput, bpm: number, withCover: boolean, green: boolean): number {
  const white = whiteDuration(input, bpm, withCover);
  return green ? resolveGreenNumber(white) : white;
}

function clampUnit(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/**
 * beatoraja's lane cover (`PlayConfig.lanecover`): the SUDDEN+ height as a fraction of the part of the lane above the
 * LIFT, kept while the cover is off. be-music keeps SUDDEN+ as a fraction of the whole lane, so the same drawn height
 * is `sudden / (1 - lift)`.
 */
function beatorajaLaneCover(cover: LaneCoverState): number {
  const sudden = clampUnit(cover.sudden);
  const above = 1 - clampUnit(cover.lift);
  return above > 0 ? Math.min(1, sudden / above) : 0;
}

/**
 * `(int) (value * 1000)` on beatoraja's `float`s (`IntegerPropertyFactory` 14 / 314), so a cover moved up ten 0.01
 * steps (0.09999999999999999 as a double) reads 100, not 99.
 */
function beatorajaPerMille(value: number): number {
  return Math.trunc(Math.fround(Math.fround(value) * 1000));
}

function mainBPM(chart: BeatorajaPlayChartFacts): number {
  return chart.mainBPM !== undefined && chart.mainBPM > 0 ? chart.mainBPM : chart.bpm;
}

/** `#PLAYLEVEL` as a whole number: a number truncated, text parsed, 0 without one. */
function playLevelNumber(level: number | string | undefined): number {
  if (typeof level === 'number') return Math.trunc(level);
  if (typeof level === 'string') {
    const parsed = Number.parseInt(level, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/**
 * A play skin's number (`value[].ref`, `IntegerPropertyFactory`) for the play as it is, or `undefined` for an id the
 * play does not show. Besides the score numbers ({@link resolveBeatorajaScoreNumber}):
 *
 * - the score rate (102 / 103) over the notes judged so far, 100 % before the first (beatoraja's `nowrate`; 115 / 116
 *   are over every note);
 * - the hi-speed (310 its integer part, 311 two decimals, 10 times 100, all truncated as beatoraja's `(int)` casts),
 *   the lane cover (of the lane above the LIFT, kept while it is off) and the LIFT in per mille (14, 314);
 * - the white and green numbers (312 / 313, and 1312-1327 at the main, lowest and highest BPM, with and without the
 *   lane cover) from {@link resolveWhiteNumber};
 * - the BPMs (90-92, and 160 at the playhead, held at an LR2 negative-BPM reversal), `#PLAYLEVEL` (96);
 * - the play, remaining and song time (161-164, 1163 / 1164), loading done (165);
 * - the clock (21-26), the time running (27-29) and the frame rate (20) as given;
 * - the max combo also as number 75, the latest judgment's offset (525) and each judge plate's combo for the judge
 *   popup (the synthetic 20101-20103);
 * - 0 for the best record, play counts, target and rival numbers, the play time and the judge timing and HIDDEN+
 *   readouts, which nothing feeds yet.
 */
export function resolveBeatorajaPlayNumber(id: number, input: BeatorajaPlayNumberInput): number | undefined {
  const { chart, clock, hiSpeed } = input;
  switch (id) {
    case BEATORAJA_NUM.SCORE_RATE:
    case BEATORAJA_NUM.SCORE_RATE_AFTERDOT: {
      if (input.score === undefined) return 0;
      const rate = beatorajaScoreRate(input.score.exScore, beatorajaNotesJudged(input.score));
      return id === BEATORAJA_NUM.SCORE_RATE ? rate.whole : rate.afterDot;
    }
    case BEATORAJA_NUM.HISPEED:
      return Math.trunc(hiSpeed);
    case BEATORAJA_NUM.HISPEED_LR2:
      return Math.trunc(hiSpeed * 100);
    case BEATORAJA_NUM.HISPEED_AFTERDOT:
      return Math.trunc(hiSpeed * 100) % 100;
    case BEATORAJA_NUM.LANECOVER1:
      return input.cover !== undefined ? beatorajaPerMille(beatorajaLaneCover(input.cover)) : 0;
    case BEATORAJA_NUM.LIFT1:
      return input.cover !== undefined ? beatorajaPerMille(clampUnit(input.cover.lift)) : 0;
    case BEATORAJA_NUM.JUDGETIMING:
    case BEATORAJA_NUM.HIDDEN1:
      return 0;

    case BEATORAJA_NUM.DURATION:
    case BEATORAJA_NUM.DURATION_LANECOVER_ON:
      return duration(input, playheadBPM(input), true, false);
    case BEATORAJA_NUM.DURATION_GREEN:
    case BEATORAJA_NUM.DURATION_GREEN_LANECOVER_ON:
      return duration(input, playheadBPM(input), true, true);
    case BEATORAJA_NUM.DURATION_LANECOVER_OFF:
      return duration(input, playheadBPM(input), false, false);
    case BEATORAJA_NUM.DURATION_GREEN_LANECOVER_OFF:
      return duration(input, playheadBPM(input), false, true);
    case BEATORAJA_NUM.MAINBPM_DURATION_LANECOVER_ON:
      return duration(input, mainBPM(chart), true, false);
    case BEATORAJA_NUM.MAINBPM_DURATION_GREEN_LANECOVER_ON:
      return duration(input, mainBPM(chart), true, true);
    case BEATORAJA_NUM.MAINBPM_DURATION_LANECOVER_OFF:
      return duration(input, mainBPM(chart), false, false);
    case BEATORAJA_NUM.MAINBPM_DURATION_GREEN_LANECOVER_OFF:
      return duration(input, mainBPM(chart), false, true);
    case BEATORAJA_NUM.MINBPM_DURATION_LANECOVER_ON:
      return duration(input, chart.minBPM, true, false);
    case BEATORAJA_NUM.MINBPM_DURATION_GREEN_LANECOVER_ON:
      return duration(input, chart.minBPM, true, true);
    case BEATORAJA_NUM.MINBPM_DURATION_LANECOVER_OFF:
      return duration(input, chart.minBPM, false, false);
    case BEATORAJA_NUM.MINBPM_DURATION_GREEN_LANECOVER_OFF:
      return duration(input, chart.minBPM, false, true);
    case BEATORAJA_NUM.MAXBPM_DURATION_LANECOVER_ON:
      return duration(input, chart.maxBPM, true, false);
    case BEATORAJA_NUM.MAXBPM_DURATION_GREEN_LANECOVER_ON:
      return duration(input, chart.maxBPM, true, true);
    case BEATORAJA_NUM.MAXBPM_DURATION_LANECOVER_OFF:
      return duration(input, chart.maxBPM, false, false);
    case BEATORAJA_NUM.MAXBPM_DURATION_GREEN_LANECOVER_OFF:
      return duration(input, chart.maxBPM, false, true);

    case BEATORAJA_NUM.TIME_YEAR:
      return input.wallClock?.year;
    case BEATORAJA_NUM.TIME_MONTH:
      return input.wallClock?.month;
    case BEATORAJA_NUM.TIME_DAY:
      return input.wallClock?.day;
    case BEATORAJA_NUM.TIME_HOUR:
      return input.wallClock?.hour;
    case BEATORAJA_NUM.TIME_MINUTE:
      return input.wallClock?.minute;
    case BEATORAJA_NUM.TIME_SECOND:
      return input.wallClock?.second;
    case BEATORAJA_NUM.OPERATING_TIME_HOUR:
      return Math.floor((input.operatingMs ?? 0) / 3_600_000);
    case BEATORAJA_NUM.OPERATING_TIME_MINUTE:
      return Math.floor(((input.operatingMs ?? 0) / 60_000) % 60);
    case BEATORAJA_NUM.OPERATING_TIME_SECOND:
      return Math.floor(((input.operatingMs ?? 0) / 1_000) % 60);
    case BEATORAJA_NUM.CURRENT_FPS:
      return input.fps ?? 0;
    case BEATORAJA_NUM.TOTALPLAYTIME_HOUR:
    case BEATORAJA_NUM.TOTALPLAYTIME_MINUTE:
    case BEATORAJA_NUM.TOTALPLAYTIME_SECOND:
      return 0;

    case BEATORAJA_NUM.BEST_SCORE:
    case BEATORAJA_NUM.BEST_MAXSCORE:
    case BEATORAJA_NUM.BEST_MISSCOUNT:
    case BEATORAJA_NUM.PLAYCOUNT:
    case BEATORAJA_NUM.CLEARCOUNT:
    case BEATORAJA_NUM.FAILCOUNT:
    case BEATORAJA_NUM.BEST_PERFECT:
    case BEATORAJA_NUM.BEST_GREAT:
    case BEATORAJA_NUM.BEST_GOOD:
    case BEATORAJA_NUM.BEST_BAD:
    case BEATORAJA_NUM.BEST_POOR:
    case BEATORAJA_NUM.DIFF_EXSCORE:
    case BEATORAJA_NUM.TARGET_SCORE:
    case BEATORAJA_NUM.TARGET_SCORE_RATE:
    case BEATORAJA_NUM.TARGET_SCORE_RATE_AFTERDOT:
      return 0;
    case BEATORAJA_NUM.BEST_MAXCOMBO:
      return input.maxCombo;

    case BEATORAJA_NUM.MAXBPM:
      return Math.round(chart.maxBPM);
    case BEATORAJA_NUM.MINBPM:
      return Math.round(chart.minBPM);
    case BEATORAJA_NUM.MAINBPM:
      return Math.round(mainBPM(chart));
    case BEATORAJA_NUM.PLAYLEVEL:
      return playLevelNumber(chart.playLevel);

    case SYNTHETIC_NUM_JUDGE_COMBO_1P:
      return input.plateCombos?.[0] ?? 0;
    case SYNTHETIC_NUM_JUDGE_COMBO_2P:
      return input.plateCombos?.[1] ?? 0;
    case SYNTHETIC_NUM_JUDGE_COMBO_3P:
      return input.plateCombos?.[2] ?? 0;
    case BEATORAJA_NUM.JUDGE_1P_OFFSET_MS:
      return input.lastJudgeDeltaMs !== undefined ? Math.trunc(input.lastJudgeDeltaMs) : 0;

    // Past an LR2 negative-BPM reversal the readout holds the value at the reversal: LR2's event pump is frozen there
    // and never applies a later BPM event (the reverse scroll itself keeps following the tempo map).
    case BEATORAJA_NUM.NOWBPM:
      return Math.round(
        clock !== undefined && clock.reversalSeconds !== undefined
          ? beatorajaBPMAt(
              chart.bpmSegments ?? [],
              Math.min(clock.currentSeconds, clock.reversalSeconds) * 1000,
              chart.bpm,
            )
          : playheadBPM(input),
      );
    case BEATORAJA_NUM.PLAYTIME_MINUTE:
      return clock !== undefined ? Math.floor(clock.currentSeconds / 60) : 0;
    case BEATORAJA_NUM.PLAYTIME_SECOND:
      return clock !== undefined ? Math.floor(clock.currentSeconds % 60) : 0;
    case BEATORAJA_NUM.TIMELEFT_MINUTE:
      return clock !== undefined ? Math.floor(Math.max(0, clock.totalSeconds - clock.currentSeconds) / 60) : 0;
    case BEATORAJA_NUM.TIMELEFT_SECOND:
      return clock !== undefined ? Math.floor(Math.max(0, clock.totalSeconds - clock.currentSeconds) % 60) : 0;
    case BEATORAJA_NUM.SONGLENGTH_MINUTE:
      return clock !== undefined ? Math.floor(clock.totalSeconds / 60) : 0;
    case BEATORAJA_NUM.SONGLENGTH_SECOND:
      return clock !== undefined ? Math.floor(clock.totalSeconds % 60) : 0;
    // The play scene mounts once its assets are decoded, so loading is done.
    case BEATORAJA_NUM.LOADING_PROGRESS:
      return 100;
    default:
      return resolveBeatorajaScoreNumber(id, input);
  }
}
