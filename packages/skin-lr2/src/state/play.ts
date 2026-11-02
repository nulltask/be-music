import type { ChartPlayVariant } from '@be-music/chart-model';
import {
  computeScoreRate,
  resolve____RankIndexFromScore,
  type GaugeType,
  type ScoreSummary,
} from '@be-music/player-engine/ruleset';
import type {
  CourseView,
  JudgmentKind,
  LibraryChart,
  PlayOptions,
  PlaySide,
  PlayState,
} from '@be-music/player-scene-model';
import { LR2_LANE_TIMER_BANK_SIZE, LR2_NUM, LR2_OP, LR2_SLIDER, LR2_TEXT, LR2_TIMER } from '../ids/index.ts';
import { resolveLR2ChartText } from './chart.ts';
import { lr2ShowsCourseCombo, resolveLR2CourseNumber, resolveLR2CourseOps, resolveLR2CourseText } from './course.ts';
import { isLR2BGAShown, isLR2RedGauge, lr2HiSpeedSlider, resolveLR2BattleOps } from './options.ts';
import { notesJudged, resolveLR2RateNumber } from './score.ts';
import { lr2TimerUpdate, type LR2SceneState, type LR2TimerUpdate } from './scene-state.ts';

/** The lanes a play is laid out on: its play variant and the lane channels in use. */
export interface LR2PlayLanes {
  readonly playVariant: ChartPlayVariant;
  /** The lane channels the chart plays (`11` … `19`, `21` … `29`). */
  readonly channels: readonly string[];
  /** The play variant of the chart a battle mode converted: LR2's key-mode ops read it, not the converted lanes. */
  readonly battleSourceVariant?: ChartPlayVariant;
}

/** What stays the same for a whole LR2 play: the chart, its lanes and features, the options, the gauge, the course. */
export interface LR2PlaySetup {
  /** The chart played: the chart texts, the start BPM and the STAGEFILE / BANNER / BACKBMP ops. */
  readonly chart?: LibraryChart;
  /** The lanes played: the key-mode op (160-164). */
  readonly lanes: LR2PlayLanes;
  /** What the play has, read off the chart resolved for it: long notes, BPM changes and a BGA (ops 170-177). */
  readonly features: { readonly longNote: boolean; readonly bpmChange: boolean; readonly bga: boolean };
  /** The play options the play runs with. */
  readonly options: Pick<
    PlayOptions,
    'autoPlay' | 'autoScratch1P' | 'autoScratch2P' | 'scoreGraph' | 'bga' | 'bgaSize'
  > &
    Partial<Pick<PlayOptions, 'battleMode' | 'keysFilter' | 'lr2ExtraMode'>>;
  /** The gauge the play runs on (ops 42-45). */
  readonly gauge: GaugeType;
  /** The 2P player's gauge in a two-player BATTLE (ops 43 / 45); `gauge` when absent. */
  readonly gauge2P?: GaugeType;
  /** Whether the play runs on a course's gauge: LR2 reports the course gauge as the red one (OpenLR2 L4613-L4628). */
  readonly courseGauge?: boolean;
  /** Whether the play is a replay played back: REPLAY PLAYING (op 84) in place of REPLAY OFF (op 82). */
  readonly replay?: boolean;
  /** The course the play is a stage of, or the NONSTOP course it stitches, with the stage being played. */
  readonly course?: CourseView;
  /** The skin's `#CUSTOMOPTION` choices: their ops (900-999). A skin that picks the BGA size keeps its pick. */
  readonly customOps?: Iterable<number>;
}

/**
 * The running play as an LR2 skin reads it; a `PlayState` fits: the gauge (percent), the combo and max combo, the
 * course combo of a course stage, the chart's length and the player's hi-speed.
 */
export interface LR2PlayView {
  readonly gauge: PlayState['gauge'];
  readonly combo: PlayState['combo'];
  readonly maxCombo: PlayState['maxCombo'];
  readonly totalSeconds: PlayState['totalSeconds'];
  readonly courseCombo?: { readonly combo: number; readonly maxCombo: number };
  readonly view: { readonly hiSpeed: { readonly player: number } };
}

/** The 2P player of a two-player BATTLE: its running play and its score (numbers 120-136, ops 210-217 and 250-260). */
export interface LR2SecondPlayerFrame {
  readonly play: Pick<LR2PlayView, 'gauge' | 'combo' | 'maxCombo'>;
  readonly score: ScoreSummary;
}

/** One frame of an LR2 play. Time comes in here: the resolvers read no clock. */
export interface LR2PlayFrame {
  /** The running play. */
  readonly play: LR2PlayView;
  /** The judgement counts and scores so far. */
  readonly score: ScoreSummary;
  /** Chart time now, in seconds. */
  readonly seconds: number;
  /** Whether the chart has loaded (op 81; op 80 before); loaded when absent. */
  readonly loaded?: boolean;
  /** The stage a stitched NONSTOP play shows (`resolveLR2NonstopStage`): its stage ops and title from the second on. */
  readonly nonstopStage?: number;
  /** The score readout (number 100), easing toward the score; the score when absent. */
  readonly displayedScore?: number;
  /** The BPM now (number 160); the chart's start BPM when absent. */
  readonly bpm?: number;
  /** The frame rate (number 20). */
  readonly fps?: number;
  /** The judge timing the notes are drawn with now (number 12), moved by the automatic adjustment; 0 when absent. */
  readonly judgeTimingMs?: number;
  /** The 2P player of a two-player BATTLE. */
  readonly secondPlayer?: LR2SecondPlayerFrame;
  /** Latest displayed judgment per side; retained after the judge plate fades. */
  readonly judgments?: Readonly<Partial<Record<PlaySide, JudgmentKind | 'EMPTY_POOR'>>>;
  /** The target the play paces against (a replay ghost): numbers 151 / 153 and bar graphs 14 / 15. */
  readonly target?: LR2PlayTarget;
}

/** A target's EX score at this point of the play and over the whole chart (OpenLR2 `targetScore`). */
export interface LR2PlayTarget {
  /** The EX score it holds now. */
  readonly exScore: number;
  /** Its EX score over the whole chart. */
  readonly finalEXScore: number;
}

/** The LR2 play screen's state: a {@link LR2SceneState} and the fill of each bar graph. */
export interface LR2PlayState extends LR2SceneState {
  /** How full a `#SRC_BARGRAPH` of this `type` is, 0..1. */
  bargraph(type: number): number;
}

/** Ops a play always lights: a playable chart, no GHOST, difficulty filter or internet ranking. */
const PLAY_BASE_OPS: readonly number[] = [
  LR2_OP.PLAYABLE_BAR,
  LR2_OP.GHOST_OFF,
  LR2_OP.DIFFICULTY_FILTER_OFF,
  LR2_OP.OFFLINE,
  LR2_OP.SCORE_SAVE_ON,
  LR2_OP.NO_TEXT,
  LR2_OP.NO_RANDOM,
  LR2_OP.JUDGE_NORMAL,
  LR2_OP.NO_REPLAY,
];

/**
 * The key-mode op (160-164) of the lanes a play is laid out on: 9 KEYS for a PMS variant; else 10 or 14 KEYS when 2P
 * lanes are in use and 5 or 7 KEYS otherwise, by whether keys 6 / 7 are. So a 5-key chart lights 5 KEYS and gets the
 * LR2 default skin's DISABLE LANE overlay on keys 6 and 7.
 */
export function resolveLR2PlayKeyModeOp(lanes: LR2PlayLanes): number {
  if (lanes.playVariant === '9') return LR2_OP.KEYS_9;
  const usesPlayer2 = lanes.channels.some((channel) => channel.startsWith('2'));
  const uses6or7 = lanes.channels.some(
    (channel) => channel === '18' || channel === '19' || channel === '28' || channel === '29',
  );
  if (usesPlayer2) return uses6or7 ? LR2_OP.KEYS_14 : LR2_OP.KEYS_10;
  return uses6or7 ? LR2_OP.KEYS_7 : LR2_OP.KEYS_5;
}

const SOURCE_KEY_MODE_OPS: Partial<Record<ChartPlayVariant, number>> = {
  '5': LR2_OP.KEYS_5,
  '7': LR2_OP.KEYS_7,
  '9': LR2_OP.KEYS_9,
  '10': LR2_OP.KEYS_10,
  '14': LR2_OP.KEYS_14,
};

/**
 * The key-mode ops of a play (OpenLR2 `GetOptionFlag_dst` L5024-L5040): LR2 reads the selected chart's key mode, so a
 * battle mode keeps the source's op — BATTLE on a 7KEY chart lights 7 KEYS — and D-BATTLE / SP TO DP on a 5/7KEY chart
 * light 10 / 14 KEYS beside it. Without a battle mode, the lanes' {@link resolveLR2PlayKeyModeOp}.
 */
export function resolveLR2PlayKeyModeOps(
  lanes: LR2PlayLanes,
  battleMode: PlayOptions['battleMode'] | undefined,
): number[] {
  const source = lanes.battleSourceVariant;
  const sourceOp = source === undefined ? undefined : SOURCE_KEY_MODE_OPS[source];
  if (sourceOp === undefined) return [resolveLR2PlayKeyModeOp(lanes)];
  const doubled = battleMode === 'D-BATTLE' || battleMode === 'SP-TO-DP';
  if (doubled && source === '7') return [sourceOp, LR2_OP.KEYS_14];
  if (doubled && source === '5') return [sourceOp, LR2_OP.KEYS_10];
  return [sourceOp];
}

/** The ops of a play that hold from its start to its end. */
function setupOps(setup: LR2PlaySetup): number[] {
  const ops: number[] = [];
  for (const op of setup.customOps ?? []) ops.push(op);
  ops.push(...PLAY_BASE_OPS);
  const { options } = setup;
  ops.push(options.lr2ExtraMode === true ? LR2_OP.EXTRA_MODE_ON : LR2_OP.EXTRA_MODE_OFF);
  ops.push(...resolveLR2BattleOps(options));
  ops.push(options.autoScratch1P === true ? LR2_OP.AUTO_SCRATCH_1P_ON : LR2_OP.AUTO_SCRATCH_1P_OFF);
  ops.push(options.autoScratch2P === true ? LR2_OP.AUTO_SCRATCH_2P_ON : LR2_OP.AUTO_SCRATCH_2P_OFF);
  // The gauge type is fixed for the run; a course stage runs on the course gauge, which LR2 reports as the red one.
  const gaugeOps = resolveLR2GaugeTypeOps(setup.courseGauge === true ? 'HARD' : setup.gauge);
  ops.push(gaugeOps[0], setup.gauge2P === undefined ? gaugeOps[1] : resolveLR2GaugeTypeOps(setup.gauge2P)[1]);
  ops.push(options.scoreGraph === true ? LR2_OP.SCORE_GRAPH_ON : LR2_OP.SCORE_GRAPH_OFF);
  ops.push(isLR2BGAShown(options.bga, options.autoPlay === true) ? LR2_OP.BGA_ON : LR2_OP.BGA_OFF);
  ops.push(options.autoPlay === true ? LR2_OP.AUTOPLAY_ON : LR2_OP.AUTOPLAY_OFF);
  ops.push(setup.replay === true ? LR2_OP.REPLAY_PLAYING : LR2_OP.REPLAY_OFF);
  ops.push(...resolveLR2PlayKeyModeOps(setup.lanes, options.battleMode));
  ops.push(setup.features.longNote ? LR2_OP.HAS_LN : LR2_OP.NO_LN);
  ops.push(setup.features.bpmChange ? LR2_OP.HAS_BPM_CHANGE : LR2_OP.NO_BPM_CHANGE);
  ops.push(setup.features.bga ? LR2_OP.HAS_BGA : LR2_OP.NO_BGA);
  const metadata = setup.chart?.chart.metadata;
  ops.push(metadata?.stageFile ? LR2_OP.HAS_STAGEFILE : LR2_OP.NO_STAGEFILE);
  ops.push(metadata?.banner ? LR2_OP.HAS_BANNER : LR2_OP.NO_BANNER);
  ops.push(metadata?.backBMP ? LR2_OP.HAS_BACKBMP : LR2_OP.NO_BACKBMP);
  // A skin that declares its own BGA size (a `#CUSTOMOPTION` on op 30 / 31) keeps it; else the player's.
  if (!ops.includes(LR2_OP.BGA_NORMAL) && !ops.includes(LR2_OP.BGA_EXTEND)) {
    ops.push(options.bgaSize === 'EXTEND' ? LR2_OP.BGA_EXTEND : LR2_OP.BGA_NORMAL);
  }
  return ops;
}

/**
 * LR2's gauge-type ops for a gauge, as `[1P, 2P]`: HARD and DEATH light the red gauge ops (43 / 45), GROOVE and EASY
 * the normal ones (42 / 44). Skins gate their gauge frame on them.
 */
export function resolveLR2GaugeTypeOps(gauge: GaugeType): readonly [number, number] {
  return isLR2RedGauge(gauge)
    ? [LR2_OP.GAUGE_1P_RED, LR2_OP.GAUGE_2P_RED]
    : [LR2_OP.GAUGE_1P_NORMAL, LR2_OP.GAUGE_2P_NORMAL];
}

/**
 * LR2's gauge-range op for a gauge in percent: 230 for 0-9 %, 231 for 10-19 %, …, 240 for 100 % on 1P, and 250-260 on
 * 2P.
 */
export function resolveLR2GaugeRangeOp(gaugePercent: number, side: PlaySide = '1P'): number {
  const base = side === '2P' ? LR2_OP.GAUGE_2P_0_9 : LR2_OP.GAUGE_1P_0_9;
  return base + Math.min(10, Math.max(0, Math.floor(gaugePercent / 10)));
}

/**
 * LR2's rank op (200 AAA … 207 F on 1P, 210-217 on 2P): the DJ Rank of the EX score over the notes judged so far, not
 * over every note (OpenLR2 `GetOptionFlag_dst` ranks `exscore × 9 / (note_current × 2)`); none before the first note
 * is judged.
 */
export function resolveLR2RankOp(
  score: Pick<ScoreSummary, 'perfect' | 'great' | 'good' | 'bad' | 'poor' | 'exScore'>,
  side: PlaySide = '1P',
): number | undefined {
  const rankIndex = resolve____RankIndexFromScore({ total: notesJudged(score), exScore: score.exScore });
  if (rankIndex === undefined) return undefined;
  return (side === '2P' ? LR2_OP.RANK_2P_AAA : LR2_OP.RANK_1P_AAA) + rankIndex;
}

/** The course a frame shows: a stitched NONSTOP play's course at the stage it shows from the second stage on. */
function frameCourse(setup: LR2PlaySetup, frame: LR2PlayFrame): CourseView | undefined {
  const course = setup.course;
  if (course === undefined || frame.nonstopStage === undefined || frame.nonstopStage <= 0) return course;
  return { ...course, stageIndex: frame.nonstopStage };
}

/**
 * LR2's distance to the next DJ Rank (numbers 109 / 154, OpenLR2 `SetObjectValue_Num`): the EX score less the next
 * rank's border over every note, `floor(notes × 2 × (rank + 1) / 9)` for the rank `exscore × 9 / (notes × 2)` held
 * between E's border and AAA. So it reads negative until the border is reached, F counts down to E, and AAA to the
 * maximum. 0 at the maximum or before the chart has notes.
 */
function nextRankDiff(score: Pick<ScoreSummary, 'total' | 'exScore'>): number {
  const max = score.total * 2;
  if (score.total <= 0 || score.exScore === max) return 0;
  const rank = Math.min(8, Math.max(1, Math.floor((score.exScore * 9) / max)));
  return score.exScore - Math.floor((max * (rank + 1)) / 9);
}

/** The offset of the 2P player's numbers (120-136) from the 1P player's (100-116). */
const SECOND_PLAYER_NUMBER_OFFSET = LR2_NUM.SCORE_2P - LR2_NUM.SCORE;

/**
 * The 2P player's numbers of a two-player BATTLE (120-136, OpenLR2 `SetObjectValue_Num`): the 1P player's 100-116 read
 * off the 2P score, with 128 the 2P EX score less the 1P player's. `undefined` for any other number.
 */
function secondPlayerNumber(num: number, frame: LR2PlayFrame): number | undefined {
  const second = frame.secondPlayer;
  if (second === undefined || num < LR2_NUM.SCORE_2P || num > LR2_NUM.TOTAL_RATE_AFTERDOT_2P) return undefined;
  const { score, play } = second;
  const own = num - SECOND_PLAYER_NUMBER_OFFSET;
  const rateNumber = resolveLR2RateNumber(own, score);
  if (rateNumber !== undefined) return rateNumber;
  switch (own) {
    case LR2_NUM.SCORE:
      return score.score;
    case LR2_NUM.EXSCORE:
      return score.exScore;
    case LR2_NUM.COMBO:
      return play.combo;
    case LR2_NUM.MAX_COMBO:
      return play.maxCombo;
    case LR2_NUM.NOTES:
      return score.total;
    case LR2_NUM.GAUGE:
      return Math.round(play.gauge);
    case LR2_NUM.EXSCORE_DIFF:
      return score.exScore - frame.score.exScore;
    case LR2_NUM.NEXT_RANK_DIFF:
      return nextRankDiff(score);
    case LR2_NUM.PERFECT:
      return score.perfect;
    case LR2_NUM.GREAT:
      return score.great;
    case LR2_NUM.GOOD:
      return score.good;
    case LR2_NUM.BAD:
      return score.bad;
    case LR2_NUM.POOR:
      return score.poor;
    default:
      return undefined;
  }
}

function playNumber(num: number, setup: LR2PlaySetup, frame: LR2PlayFrame): number | undefined {
  const { score, play } = frame;
  const secondNumber = secondPlayerNumber(num, frame);
  if (secondNumber !== undefined) return secondNumber;
  const course = setup.course;
  if (course !== undefined) {
    const courseNumber = resolveLR2CourseNumber(num, course);
    if (courseNumber !== undefined) return courseNumber;
  }
  const rateNumber = resolveLR2RateNumber(num, score);
  if (rateNumber !== undefined) return rateNumber;
  // In an expert or grade course the combo numbers count the whole course.
  const courseCombo = course !== undefined && lr2ShowsCourseCombo(course.kind) ? play.courseCombo : undefined;
  const remaining = Math.max(0, play.totalSeconds - frame.seconds);
  switch (num) {
    case LR2_NUM.HISPEED_1P:
      return Math.round(play.view.hiSpeed.player * 100);
    case LR2_NUM.JUDGE_TIMING:
      return frame.judgeTimingMs ?? 0;
    case LR2_NUM.FPS:
      return frame.fps !== undefined ? Math.round(frame.fps) : undefined;
    case LR2_NUM.SCORE:
      return Math.round(frame.displayedScore ?? score.score);
    case LR2_NUM.EXSCORE:
      return score.exScore;
    case LR2_NUM.COMBO:
      return courseCombo?.combo ?? play.combo;
    case LR2_NUM.MAX_COMBO:
      return courseCombo?.maxCombo ?? play.maxCombo;
    case LR2_NUM.NOTES:
      return score.total;
    case LR2_NUM.GAUGE:
      return Math.round(play.gauge);
    case LR2_NUM.EXSCORE_DIFF:
      // In a two-player BATTLE the 1P EX score less the 2P player's.
      return frame.secondPlayer === undefined ? 0 : score.exScore - frame.secondPlayer.score.exScore;
    case LR2_NUM.PERFECT:
      return score.perfect;
    case LR2_NUM.GREAT:
      return score.great;
    case LR2_NUM.GOOD:
      return score.good;
    case LR2_NUM.BAD:
      return score.bad;
    case LR2_NUM.POOR:
      return score.poor;
    case LR2_NUM.HIGH_SCORE:
      return 0;
    case LR2_NUM.TARGET_SCORE:
      return frame.target?.exScore ?? 0;
    case LR2_NUM.HIGH_SCORE_DIFF:
      return score.exScore;
    case LR2_NUM.TARGET_SCORE_DIFF:
      return score.exScore - (frame.target?.exScore ?? 0);
    case LR2_NUM.NEXT_RANK_DIFF:
    case LR2_NUM.NEXT_RANK_DIFF_ALT:
      return nextRankDiff(score);
    case LR2_NUM.BPM:
      return frame.bpm ?? setup.chart?.bpm;
    case LR2_NUM.PLAY_MINUTE:
      return Math.floor(frame.seconds / 60);
    case LR2_NUM.PLAY_SECOND:
      return Math.floor(frame.seconds % 60);
    case LR2_NUM.REMAINING_MINUTE:
      return Math.floor(remaining / 60);
    case LR2_NUM.REMAINING_SECOND:
      return Math.floor(remaining % 60);
    case LR2_NUM.LOADING_PROGRESS:
      return 100;
    default:
      return undefined;
  }
}

function playText(st: number, setup: LR2PlaySetup, frame: LR2PlayFrame): string | undefined {
  const chart = setup.chart;
  if (chart === undefined) return undefined;
  const course = setup.course;
  const courseText = course !== undefined ? resolveLR2CourseText(st, course) : undefined;
  if (courseText !== undefined) return courseText;
  // A stitched NONSTOP play titles the stage LR2 last announced (after a BLANK connection); before that, the course.
  if (st === LR2_TEXT.TITLE && frame.nonstopStage !== undefined && frame.nonstopStage > 0) {
    const title = course?.stages[frame.nonstopStage]?.title;
    if (title !== undefined) return title;
  }
  switch (st) {
    case LR2_TEXT.RIVAL:
      // No rival: a placeholder so the slot is not missing.
      return 'TARGET';
    case LR2_TEXT.PLAYER:
      return 'PLAYER';
  }
  return resolveLR2ChartText(st, chart);
}

function playSlider(type: number, frame: LR2PlayFrame): number {
  switch (type) {
    case LR2_SLIDER.HISPEED_1P:
      return lr2HiSpeedSlider(frame.play.view.hiSpeed.player);
    case LR2_SLIDER.PLAY_PROGRESS:
      return frame.play.totalSeconds <= 0 ? 0 : Math.max(0, Math.min(1, frame.seconds / frame.play.totalSeconds));
    default:
      return 0;
  }
}

/**
 * How full a play bar graph is: 1 the chart's progress, 2 the loading (always done), 10-13 the 1P EX score rate (the
 * predicted and best ones are not kept apart yet). 0 for any other.
 */
function playBargraph(type: number, frame: LR2PlayFrame): number {
  switch (type) {
    case 1:
      return frame.play.totalSeconds <= 0 ? 0 : Math.max(0, Math.min(1, frame.seconds / frame.play.totalSeconds));
    case 2:
      return 1;
    case 10:
    case 11:
    case 12:
    case 13:
      return computeScoreRate(frame.score);
    // The target now and over the whole chart, each over the chart's highest EX score (OpenLR2 L6874-L6909).
    case 14:
      return targetRate(frame, frame.target?.exScore);
    case 15:
      return targetRate(frame, frame.target?.finalEXScore);
    default:
      return 0;
  }
}

function targetRate(frame: LR2PlayFrame, exScore: number | undefined): number {
  const max = frame.score.total * 2;
  return exScore === undefined || max <= 0 ? 0 : Math.max(0, Math.min(1, exScore / max));
}

const JUDGMENT_OPS: Record<JudgmentKind | 'EMPTY_POOR', number> = {
  PERFECT: LR2_OP.JUDGE_1P_PERFECT,
  GREAT: LR2_OP.JUDGE_1P_GREAT,
  GOOD: LR2_OP.JUDGE_1P_GOOD,
  BAD: LR2_OP.JUDGE_1P_BAD,
  POOR: LR2_OP.JUDGE_1P_POOR,
  EMPTY_POOR: LR2_OP.JUDGE_1P_MISS,
};

const SETUP_OPS = new WeakMap<LR2PlaySetup, readonly number[]>();

/**
 * The LR2 play screen's state for a frame: the ops (the play's fixed ops from its setup — options, gauge type, key
 * mode, chart features, course — and the frame's: loading (80 / 81), the rank so far (200-207, 210-217 for a 2P player),
 * the gauge range (230-240, 250-260) and a NONSTOP play's stage), the numbers (the score, combo, gauge, judgement counts,
 * rates, BPM, time, the course's stage levels, a 2P player's 120-136), the texts (the chart's and the course's), the sliders (hi-speed, progress) and the bar graphs. The
 * setup's ops are kept per setup object, so a scene builds its setup once and passes it every frame.
 */
export function resolveLR2PlayState(setup: LR2PlaySetup, frame: LR2PlayFrame): LR2PlayState {
  let fixed = SETUP_OPS.get(setup);
  if (fixed === undefined) {
    fixed = setupOps(setup);
    SETUP_OPS.set(setup, fixed);
  }
  const ops = new Set(fixed);
  ops.add(frame.loaded === false ? LR2_OP.LOADING : LR2_OP.LOADED);
  const rank = resolveLR2RankOp(frame.score);
  if (rank !== undefined) ops.add(rank);
  ops.add(resolveLR2GaugeRangeOp(frame.play.gauge));
  const second = frame.secondPlayer;
  if (second !== undefined) {
    const rank2P = resolveLR2RankOp(second.score, '2P');
    if (rank2P !== undefined) ops.add(rank2P);
    ops.add(resolveLR2GaugeRangeOp(second.play.gauge, '2P'));
  }
  ops.add(JUDGMENT_OPS[frame.judgments?.['1P'] ?? 'EMPTY_POOR']);
  ops.add(JUDGMENT_OPS[frame.judgments?.['2P'] ?? 'EMPTY_POOR'] + 20);
  const course = frameCourse(setup, frame);
  if (course !== undefined) for (const op of resolveLR2CourseOps(course)) ops.add(op);
  return {
    ops,
    number: (num) => playNumber(num, setup, frame),
    text: (st) => playText(st, setup, frame),
    slider: (type) => playSlider(type, frame),
    bargraph: (type) => playBargraph(type, frame),
  };
}

/**
 * Whether a lane draws the skin's AUTO note graphics (`#SRC_AUTO_*`, with the skin's own "dummy notes" choice): a lane
 * the player's options play by themselves, the 1P scratch (lane 0) while 1P auto scratch is on (op 55). Full AUTOPLAY
 * (op 33) keeps the regular notes, as in LR2. Op 53 is EXTRA MODE, which plays no lane by itself.
 */
export function isLR2AutoLane(laneIndex: number, ops: ReadonlySet<number>): boolean {
  return laneIndex === 0 && ops.has(LR2_OP.AUTO_SCRATCH_1P_ON);
}

/** A timer bank of the lanes: bombs (50 / 60), long-note holds (70 / 80), key on (100 / 110) and key off (120 / 130). */
export type LR2LaneTimerBank = 'bomb' | 'ln-hold' | 'key-on' | 'key-off';

/** A lane of a play: its chart channel, its index on its side (0 the scratch, keys from 1) and the play variant. */
export interface LR2Lane {
  readonly channel: string;
  readonly laneIndex: number;
  readonly playVariant: ChartPlayVariant;
}

const LANE_BANKS: Readonly<Record<LR2LaneTimerBank, readonly [number, number]>> = {
  bomb: [LR2_TIMER.BOMB_1P, LR2_TIMER.BOMB_2P],
  'ln-hold': [LR2_TIMER.LN_HOLD_1P, LR2_TIMER.LN_HOLD_2P],
  'key-on': [LR2_TIMER.KEY_ON_1P, LR2_TIMER.KEY_ON_2P],
  'key-off': [LR2_TIMER.KEY_OFF_1P, LR2_TIMER.KEY_OFF_2P],
};

/**
 * The LR2 timer of a lane in a timer bank: the side's bank base plus the lane's index (0 the scratch). 9 KEYS (PMS)
 * runs every lane through the 1P bank, whichever side the chart puts it on. A lane past the bank (the 24-key modes'
 * lanes) has no timer: `base + lane` would run into the next bank. The key-on bank addresses keys 1-7 (1-9 for PMS),
 * the others keys 1-9.
 */
export function resolveLR2LaneTimer(bank: LR2LaneTimerBank, lane: LR2Lane): number | undefined {
  const pms = lane.playVariant === '9';
  const maxIndex = bank === 'key-on' && !pms ? 7 : LR2_LANE_TIMER_BANK_SIZE - 1;
  if (lane.laneIndex < 0 || lane.laneIndex > maxIndex) return undefined;
  const [base1P, base2P] = LANE_BANKS[bank];
  return (!pms && lane.channel.startsWith('2') ? base2P : base1P) + lane.laneIndex;
}

/** A moment of the play screen that starts or stops LR2 timers; `at` is on the clock the scene stamps timers with. */
export type LR2PlayTimerEvent =
  /** The scene starts: timer 0. (`#STARTINPUT` and the other skin timings are the scene's to schedule.) */
  | { readonly kind: 'scene-start'; readonly at: number }
  /** The chart has loaded: READY (timer 40). */
  | { readonly kind: 'load-end'; readonly at: number }
  /** The chart starts playing (timer 41). */
  | { readonly kind: 'play-start'; readonly at: number }
  /** The scene fades out (timer 2). */
  | { readonly kind: 'exit-fade-out'; readonly at: number }
  /** The play failed and the scene closes (timer 3). */
  | { readonly kind: 'exit-close'; readonly at: number }
  /** A judgement on a side (timer 46 / 47): it restarts on each one. */
  | { readonly kind: 'judge'; readonly side: PlaySide; readonly at: number }
  /** A full combo (timers 48 and 49: one combo for both sides). */
  | { readonly kind: 'full-combo'; readonly at: number }
  /** The gauge moved from `previous` to `next` percent: up (timer 42), reaching 100 % (timer 44, which stops below). */
  | { readonly kind: 'gauge'; readonly previous: number; readonly next: number; readonly at: number }
  /** A lane's bomb, long-note hold, key on or key off (`resolveLR2LaneTimer`). */
  | { readonly kind: 'lane'; readonly bank: LR2LaneTimerBank; readonly lane: LR2Lane; readonly at: number }
  /**
   * The play sought to another chart second, its gauge `gauge` percent there: what the judgments started is void (see
   * {@link LR2_SEEK_STOPPED_TIMERS}), and the gauge-max timer (44) runs again from `at` when the gauge is full.
   */
  | { readonly kind: 'seek'; readonly gauge: number; readonly at: number };

/**
 * The timers a seek stops: the ones the judgments and the lanes start — the gauge rise (42 / 43) and full gauge (44 /
 * 45), the judgements (46 / 47), the full combo (48 / 49) and every lane bank (bombs 50-69, long-note holds 70-89, key
 * on 100-119 and key off 120-139). The scene's timers (0-3, READY 40, play 41) and the rhythm (140) run on; a long note
 * held across the second sought starts its hold timer again as the play announces it.
 */
const LR2_SEEK_STOPPED_TIMERS: readonly number[] = [
  LR2_TIMER.GAUGE_UP_1P,
  LR2_TIMER.GAUGE_UP_2P,
  LR2_TIMER.GAUGE_MAX_1P,
  LR2_TIMER.GAUGE_MAX_2P,
  LR2_TIMER.JUDGE_1P,
  LR2_TIMER.JUDGE_2P,
  LR2_TIMER.FULL_COMBO_1P,
  LR2_TIMER.FULL_COMBO_2P,
  ...[LR2_TIMER.BOMB_1P, LR2_TIMER.BOMB_2P, LR2_TIMER.LN_HOLD_1P, LR2_TIMER.LN_HOLD_2P].flatMap((base) =>
    Array.from({ length: LR2_LANE_TIMER_BANK_SIZE }, (_, lane) => base + lane),
  ),
  ...[LR2_TIMER.KEY_ON_1P, LR2_TIMER.KEY_ON_2P, LR2_TIMER.KEY_OFF_1P, LR2_TIMER.KEY_OFF_2P].flatMap((base) =>
    Array.from({ length: LR2_LANE_TIMER_BANK_SIZE }, (_, lane) => base + lane),
  ),
];

/** The LR2 timers a moment of the play screen starts and stops. */
export function resolveLR2PlayTimers(event: LR2PlayTimerEvent): LR2TimerUpdate {
  switch (event.kind) {
    case 'scene-start':
      return lr2TimerUpdate([LR2_TIMER.SCENE_START], event.at);
    case 'load-end':
      return lr2TimerUpdate([LR2_TIMER.READY], event.at);
    case 'play-start':
      return lr2TimerUpdate([LR2_TIMER.PLAY], event.at);
    case 'exit-fade-out':
      return lr2TimerUpdate([LR2_TIMER.FADE_OUT], event.at);
    case 'exit-close':
      return lr2TimerUpdate([LR2_TIMER.FAILED], event.at);
    case 'judge':
      return lr2TimerUpdate([event.side === '2P' ? LR2_TIMER.JUDGE_2P : LR2_TIMER.JUDGE_1P], event.at);
    case 'full-combo':
      return lr2TimerUpdate([LR2_TIMER.FULL_COMBO_1P, LR2_TIMER.FULL_COMBO_2P], event.at);
    case 'gauge': {
      const start: number[] = [];
      const stop: number[] = [];
      if (event.next > event.previous) start.push(LR2_TIMER.GAUGE_UP_1P);
      if (event.next >= 100 && event.previous < 100) start.push(LR2_TIMER.GAUGE_MAX_1P);
      else if (event.next < 100 && event.previous >= 100) stop.push(LR2_TIMER.GAUGE_MAX_1P);
      return lr2TimerUpdate(start, event.at, stop);
    }
    case 'lane': {
      const timer = resolveLR2LaneTimer(event.bank, event.lane);
      return lr2TimerUpdate(timer !== undefined ? [timer] : [], event.at);
    }
    case 'seek':
      return lr2TimerUpdate(event.gauge >= 100 ? [LR2_TIMER.GAUGE_MAX_1P] : [], event.at, LR2_SEEK_STOPPED_TIMERS);
  }
}
