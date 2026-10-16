import { resolveIidxRankIndexFromScore } from '@be-music/player/core/scoring';
import { resolveClearLamp } from '@be-music/player/ruleset';
import type { CourseView, PlayResult } from '@be-music/scene-model';
import { LR2_NUM, LR2_OP, LR2_TEXT } from '../ids/index.ts';
import { resolveLr2ChartText, resolveLr2DifficultyOp, resolveLr2KeyModeOp } from './chart.ts';
import { resolveLr2CourseNumber, resolveLr2CourseOps, resolveLr2CourseText } from './course.ts';
import { resolveLr2LampOp } from './records.ts';
import { resolveLr2RateNumber } from './score.ts';
import type { Lr2SceneState } from './scene-state.ts';

/** What the LR2 result screen shows: a play's result, the course it belongs to, and the skins' facts. */
export interface Lr2ResultInput {
  /** The result of the play (a single play, a course stage, a course run or a NONSTOP run). */
  readonly result: PlayResult;
  /** The course the result belongs to: a stage of a running course (with its `stageIndex`) or a whole course run. */
  readonly course?: CourseView;
  /** Whether the play skin declared `#FLIPRESULT` (op 351; 350 otherwise). */
  readonly flipResult?: boolean;
  /** The result skin's `#CUSTOMOPTION` choices: their ops (900-999). */
  readonly customOps?: Iterable<number>;
}

/** The LR2 result screen's state: a {@link Lr2SceneState} and the fill of each bar graph. */
export interface Lr2ResultState extends Lr2SceneState {
  /** How full a `#SRC_BARGRAPH` of this `type` is, 0..1; `undefined` leaves it undrawn. */
  bargraph(type: number): number | undefined;
}

/**
 * Ops the result screen always lights: no AUTOPLAY, GHOST, score graph, live BGA, difficulty filter, internet ranking,
 * auto scratch, score saving or replay; the normal gauges.
 */
const RESULT_BASE_OPS: readonly number[] = [
  LR2_OP.AUTOPLAY_OFF,
  LR2_OP.GHOST_OFF,
  LR2_OP.SCORE_GRAPH_OFF,
  LR2_OP.BGA_OFF,
  LR2_OP.GAUGE_1P_NORMAL,
  LR2_OP.GAUGE_2P_NORMAL,
  LR2_OP.DIFFICULTY_FILTER_OFF,
  LR2_OP.OFFLINE,
  LR2_OP.AUTO_SCRATCH_1P_OFF,
  LR2_OP.AUTO_SCRATCH_2P_OFF,
  LR2_OP.SCORE_SAVE_OFF,
  LR2_OP.CLEAR_SAVE_OFF,
  LR2_OP.LOADED,
  LR2_OP.REPLAY_OFF,
];

/**
 * The key-config op (400-402) for a key-mode op: 7 / 14 KEYS share 400, 9 KEYS is 401, 5 / 10 KEYS share 402. The
 * stock result skin gates its per-key-mode panels on these.
 */
function keyConfigOp(keyModeOp: number): number {
  if (keyModeOp === LR2_OP.KEYS_9) return LR2_OP.KEY_CONFIG_9;
  if (keyModeOp === LR2_OP.KEYS_5 || keyModeOp === LR2_OP.KEYS_10) return LR2_OP.KEY_CONFIG_5_10;
  return LR2_OP.KEY_CONFIG_7_14;
}

/**
 * The play's rank, 0 AAA … 7 F, by its EX score; AAA for a chart without notes, so the rank panel still draws
 * something.
 */
function rankIndex(result: PlayResult): number {
  return resolveIidxRankIndexFromScore(result.score) ?? 0;
}

function resultOps(input: Lr2ResultInput): number[] {
  const { result } = input;
  const ops = [...RESULT_BASE_OPS];
  for (const op of input.customOps ?? []) ops.push(op);
  ops.push(result.cleared ? LR2_OP.RESULT_CLEAR : LR2_OP.RESULT_FAIL);
  // The result is always on a chart.
  ops.push(LR2_OP.SONG_BAR, LR2_OP.PLAYABLE_BAR);
  // The key mode in both ranges, as skins gate on either.
  const keyModeOp = resolveLr2KeyModeOp(result.song);
  ops.push(keyModeOp, keyConfigOp(keyModeOp));
  // A chart without a difficulty reads NORMAL here: the stock skin ships per-difficulty panels for 152-155 only.
  const difficultyOp = resolveLr2DifficultyOp(result.song.chart.metadata.difficulty);
  ops.push(difficultyOp === LR2_OP.DIFFICULTY_UNDEFINED ? LR2_OP.DIFFICULTY_NORMAL : difficultyOp);
  // The play's lamp, else the one clear-lamp rule over its result.
  const lamp =
    result.lamp ??
    resolveClearLamp({
      cleared: result.cleared,
      score: result.score,
      ...(result.gaugeType !== undefined ? { gauge: result.gaugeType } : {}),
      ...(result.judgeRuleset !== undefined ? { ruleset: result.judgeRuleset } : {}),
    });
  ops.push(resolveLr2LampOp(lamp));
  // The rank now and after the update (300-308 / 340-347); without score history there was no rank before (328) and
  // every play updates the best score, max combo, BP and rank (330-335).
  const rank = rankIndex(result);
  ops.push(LR2_OP.RESULT_RANK_AAA + rank, LR2_OP.UPDATED_RANK_AAA + rank, LR2_OP.PREVIOUS_RANK_0);
  ops.push(LR2_OP.SCORE_UPDATED, LR2_OP.MAX_COMBO_UPDATED, LR2_OP.MIN_BP_UPDATED, LR2_OP.RANK_UPDATED);
  ops.push(input.flipResult === true ? LR2_OP.RESULT_FLIP_ON : LR2_OP.RESULT_FLIP_OFF);
  if (input.course !== undefined) ops.push(...resolveLr2CourseOps(input.course));
  return ops;
}

/**
 * A result's numbers. Without score history the best record's numbers (70-89) read this play's, and before / after
 * (170-184) read nothing before it: 0, or every note BAD for the fewest BAD + POOR, so the difference shows an
 * improvement.
 */
function resultNumber(num: number, result: PlayResult): number | undefined {
  const { score } = result;
  const rateNumber = resolveLr2RateNumber(num, score);
  if (rateNumber !== undefined) return rateNumber;
  const totalNotes = score.total;
  const exMax = totalNotes * 2;
  const minBp = score.bad + score.poor;
  // The best record's rates as LR2 draws them: whole percents, truncated (OpenLR2 `SetObjectValue_Num` 73, 85-89).
  const percentOfNotes = (count: number): number => (totalNotes > 0 ? Math.floor((count * 100) / totalNotes) : 0);
  switch (num) {
    case LR2_NUM.BEST_SCORE:
    case LR2_NUM.SCORE:
      return score.score;
    case LR2_NUM.BEST_EXSCORE:
    case LR2_NUM.EXSCORE:
    case LR2_NUM.RESULT_EXSCORE:
    case LR2_NUM.RESULT_EXSCORE_DIFF:
      return score.exScore;
    case LR2_NUM.EXSCORE_MAX:
      return exMax;
    case LR2_NUM.BEST_RATE:
      return exMax > 0 ? Math.floor((score.exScore * 100) / exMax) : 0;
    case LR2_NUM.TOTAL_NOTES:
    case LR2_NUM.NOTES:
      return totalNotes;
    case LR2_NUM.BEST_MAX_COMBO:
    case LR2_NUM.MAX_COMBO:
    case LR2_NUM.RESULT_MAX_COMBO:
    case LR2_NUM.RESULT_MAX_COMBO_DIFF:
      return result.maxCombo;
    case LR2_NUM.COMBO:
      // No running combo on the result: the stock skin's max-combo panel falls back to number 104.
      return result.maxCombo;
    case LR2_NUM.BEST_MIN_BP:
    case LR2_NUM.RESULT_MIN_BP:
      return minBp;
    case LR2_NUM.PLAY_COUNT:
    case LR2_NUM.CLEAR_COUNT:
    case LR2_NUM.FAIL_COUNT:
    case LR2_NUM.RESULT_EXSCORE_BEFORE:
    case LR2_NUM.RESULT_MAX_COMBO_BEFORE:
    case LR2_NUM.RESULT_RATE_BEFORE:
    case LR2_NUM.RESULT_RATE_BEFORE_AFTERDOT:
      return 0;
    case LR2_NUM.BEST_PERFECT:
    case LR2_NUM.PERFECT:
      return score.perfect;
    case LR2_NUM.BEST_GREAT:
    case LR2_NUM.GREAT:
      return score.great;
    case LR2_NUM.BEST_GOOD:
    case LR2_NUM.GOOD:
      return score.good;
    case LR2_NUM.BEST_BAD:
    case LR2_NUM.BAD:
      return score.bad;
    case LR2_NUM.BEST_POOR:
    case LR2_NUM.POOR:
      return score.poor;
    case LR2_NUM.BEST_PERFECT_RATE:
      return percentOfNotes(score.perfect);
    case LR2_NUM.BEST_GREAT_RATE:
      return percentOfNotes(score.great);
    case LR2_NUM.BEST_GOOD_RATE:
      return percentOfNotes(score.good);
    case LR2_NUM.BEST_BAD_RATE:
      return percentOfNotes(score.bad);
    case LR2_NUM.BEST_POOR_RATE:
      return percentOfNotes(score.poor);
    case LR2_NUM.MAX_BPM:
    case LR2_NUM.MIN_BPM:
      return result.song.bpm ?? result.song.chart.metadata.bpm;
    case LR2_NUM.GAUGE:
      return Math.round(result.gauge);
    case LR2_NUM.PLAY_MINUTE:
      return Math.floor(result.playSeconds / 60);
    case LR2_NUM.PLAY_SECOND:
      return Math.floor(result.playSeconds % 60);
    case LR2_NUM.LOADING_PROGRESS:
      return 100;
    case LR2_NUM.RESULT_MIN_BP_BEFORE:
      return totalNotes;
    case LR2_NUM.RESULT_MIN_BP_DIFF:
      return Math.max(0, totalNotes - minBp);
    default:
      return undefined;
  }
}

function resultText(st: number, input: Lr2ResultInput): string | undefined {
  const courseText = input.course !== undefined ? resolveLr2CourseText(st, input.course) : undefined;
  if (courseText !== undefined) return courseText;
  switch (st) {
    case LR2_TEXT.RIVAL:
      return 'TARGET';
    case LR2_TEXT.PLAYER:
      return 'PLAYER';
    case LR2_TEXT.TITLE_ALT:
      // LR2 reuses text 20 for the internet ranking's message once a play is saved (OpenLR2 `SaveResult` clears it,
      // `ProcI_Result` sets it): with no internet ranking there is none.
      return '';
    default:
      return resolveLr2ChartText(st, input.result.song);
  }
}

/**
 * How full a result bar graph is: 1 the score over 200000, 2 and 9 the EX score rate, 6 the gauge, 7 the max combo
 * over the notes. `undefined` for any other.
 */
function resultBargraph(type: number, result: PlayResult): number | undefined {
  const exMax = result.score.total * 2;
  switch (type) {
    case 1:
      return Math.max(0, Math.min(1, result.score.score / 200000));
    case 2:
    case 9:
      return exMax > 0 ? result.score.exScore / exMax : 0;
    case 6:
      return Math.max(0, Math.min(1, result.gauge / 100));
    case 7:
      return result.score.total > 0 ? Math.max(0, Math.min(1, result.maxCombo / result.score.total)) : 0;
    default:
      return undefined;
  }
}

/**
 * The LR2 result screen's state for a play's result: the result ops (cleared / failed, the chart's key mode in the
 * select and key-config ranges, its difficulty, the lamp, the ranks and updates, the result flip, the course), the
 * numbers (this play's score, counts, rates, combo, gauge and time, and the best-record and before / after numbers
 * read off it), the chart's and the course's texts, and the bar graphs (the sliders read the bar graphs' values).
 */
export function resolveLr2ResultState(input: Lr2ResultInput): Lr2ResultState {
  const { result, course } = input;
  return {
    ops: new Set(resultOps(input)),
    number: (num) =>
      (course !== undefined ? resolveLr2CourseNumber(num, course) : undefined) ?? resultNumber(num, result),
    text: (st) => resultText(st, input),
    slider: (type) => resultBargraph(type, result),
    bargraph: (type) => resultBargraph(type, result),
  };
}
