import {
  bombTimerId,
  comboTimerId,
  endOfNoteTimerId,
  judgeOpForKind,
  judgeTimerId,
  keyOffTimerId,
  keyOnTimerId,
  lnHoldTimerId,
  TIMER_FADEOUT,
  TIMER_FAILED,
  TIMER_FULLCOMBO_1P,
  TIMER_FULLCOMBO_2P,
  TIMER_GAUGE_INCREASE_1P,
  TIMER_GAUGE_INCREASE_2P,
  TIMER_GAUGE_MAX_1P,
  TIMER_PLAY,
  TIMER_PREVIEW,
  TIMER_READY,
  TIMER_RHYTHM,
  TIMER_SCENE_START,
  TIMER_STARTINPUT,
  type BeatorajaSide,
} from '../runtime-ids.ts';
import { beatorajaFastSlowOp } from './play-ops.ts';

/**
 * Timers a change of the play starts and stops, as data: `start` (re)starts each timer now, `startOnce` starts each one
 * unless it already started during this play (the failure, the end of the notes, the full combo), and
 * `stop` turns each off, hiding what is gated on it.
 */
export interface BeatorajaTimerChanges {
  readonly start: readonly number[];
  readonly startOnce: readonly number[];
  readonly stop: readonly number[];
}

const NO_TIMERS: BeatorajaTimerChanges = { start: [], startOnce: [], stop: [] };

/** Where a lane's notes show on a beatoraja play skin. */
export interface BeatorajaLanePlacement {
  /** The player side whose lane timers and per-lane judgments the lane uses. POPN 9 KEY has one, 1. */
  readonly side: BeatorajaSide;
  /** The judge plate the lane's judgments show on. POPN 9 KEY has three, one per three lanes. */
  readonly plate: BeatorajaSide;
  /** The lane on its side: 0 the scratch, 1 and up the keys; absent for a channel the play variant has no lane for. */
  readonly lane?: number;
}

/**
 * Where a lane channel shows on a beatoraja play skin. `slot` is the channel's lane on its side (`resolveSideKeySlot`:
 * 0 the scratch, 1 and up the keys, -1 none). Side and plate follow the channel's player (`2x` is 2P), except on POPN 9
 * KEY, where every lane uses the 1P lane timers and the judgments go to the plate of their three-lane group
 * (beatoraja `JudgeManager.notifyJudge`: `lane / (lanes / plates)`).
 */
export function resolveBeatorajaLanePlacement(
  channel: string,
  playVariant: string,
  slot: number,
): BeatorajaLanePlacement {
  const lane = slot >= 0 ? slot : undefined;
  if (playVariant === '9') {
    const plate: BeatorajaSide = slot >= 4 && slot <= 6 ? 2 : slot >= 7 && slot <= 9 ? 3 : 1;
    return lane !== undefined ? { side: 1, plate, lane } : { side: 1, plate };
  }
  const side: BeatorajaSide = channel.startsWith('2') ? 2 : 1;
  return lane !== undefined ? { side, plate: side, lane } : { side, plate: side };
}

/** What a player does on a lane, or what the engine does for them. */
export type BeatorajaLaneAction =
  /** A key goes down. */
  | 'press'
  /** A key comes up, ending a long note held on it. */
  | 'release'
  /** The engine pressed for the player (AUTO PLAY), or a press it saw: the key flashes. */
  | 'flash'
  /** The flash ends. */
  | 'flash-end'
  /** A long note is held (its head, or its tail judged: the hold bomb plays again). */
  | 'hold'
  /** The hold bomb a long note's tail played is over. */
  | 'hold-end';

function laneTimer(
  resolve: (side: BeatorajaSide, lane: number) => number | undefined,
  placement: BeatorajaLanePlacement,
): number[] {
  if (placement.lane === undefined) return [];
  const id = resolve(placement.side, placement.lane);
  return id === undefined ? [] : [id];
}

/**
 * The lane timers an action on a lane starts and stops (beatoraja `KeyInputProccessor`, `JudgeManager`): a press starts
 * the key-on timer and stops the key-off one, a release the reverse and also stops the long-note hold timer, a flash
 * starts the key-on timer until its end, and a hold starts the hold timer until its end. A channel with no lane changes
 * nothing.
 */
export function resolveBeatorajaLaneTimers(
  action: BeatorajaLaneAction,
  placement: BeatorajaLanePlacement,
): BeatorajaTimerChanges {
  if (placement.lane === undefined) return NO_TIMERS;
  switch (action) {
    case 'press':
    case 'flash':
      return { start: laneTimer(keyOnTimerId, placement), startOnce: [], stop: laneTimer(keyOffTimerId, placement) };
    case 'release':
      return {
        start: laneTimer(keyOffTimerId, placement),
        startOnce: [],
        stop: [...laneTimer(keyOnTimerId, placement), ...laneTimer(lnHoldTimerId, placement)],
      };
    case 'flash-end':
      return { start: laneTimer(keyOffTimerId, placement), startOnce: [], stop: laneTimer(keyOnTimerId, placement) };
    case 'hold':
      return { start: laneTimer(lnHoldTimerId, placement), startOnce: [], stop: [] };
    case 'hold-end':
      return { start: [], startOnce: [], stop: laneTimer(lnHoldTimerId, placement) };
  }
}

/** A judgment the engine published (`PlayerJudgeComboSignalState`). */
export interface BeatorajaJudgeInput {
  readonly judge: string;
  /** The combo after the judgment. */
  readonly combo: number;
  /** The signed offset (ms, > 0 late), when the judgment has a timing. */
  readonly deltaMs?: number;
}

/** What one judgment changes on a play skin. */
export interface BeatorajaJudgeEffect {
  /** The plate's judgment op (`_1p_perfect` …), replacing the plate's previous one; none for a kind the plate lacks. */
  readonly judgeOp?: number;
  /**
   * Present for a timed judgment: the plate's FAST / SLOW op, replacing its previous one (none on time). An untimed
   * judgment (AUTO PLAY, a mine, a miss) leaves the previous one lit.
   */
  readonly timing?: { readonly fastSlowOp?: number };
  readonly timers: BeatorajaTimerChanges;
  /**
   * The judgment's place in beatoraja's order (0 PERFECT … 5 MISS) for the lane's latest-judgment image (refs 500-519),
   * when the judgment is of one.
   */
  readonly laneJudge?: number;
}

/** Whether a judgment keeps the combo going (PERFECT, GREAT, GOOD). */
export function isBeatorajaComboJudge(judge: string): boolean {
  const upper = judge.toUpperCase();
  return upper === 'PERFECT' || upper === 'GREAT' || upper === 'GOOD';
}

/** Whether a judgment is a clean hit that lights the lane's bomb and the gauge sparkle (PERFECT, GREAT). */
export function isBeatorajaCleanHit(judge: string): boolean {
  const upper = judge.toUpperCase();
  return upper === 'PERFECT' || upper === 'GREAT';
}

/** A judgment's place in beatoraja's order: 0 PERFECT, 1 GREAT, 2 GOOD, 3 BAD, 4 POOR, 5 MISS; -1 for anything else. */
export function beatorajaJudgeIndex(judge: string): number {
  switch (judge.toUpperCase()) {
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
    case 'MISS':
      return 5;
    default:
      return -1;
  }
}

/**
 * What one judgment changes on a play skin (beatoraja `JudgeManager.notifyJudge`), on the lane it was on (`placement`;
 * absent for one without a lane): the plate's judgment op and, when timed, its FAST / SLOW op; the plate's judge timer;
 * its combo timer while the combo keeps going; on a clean hit the lane's bomb timer and the side's gauge sparkle; and
 * once the combo reaches every note (`total`), the side's full-combo timer, once. `options.bombs: false` (a chart's
 * `774:CRAZY_DARK2`, #931) leaves the bomb timer out.
 */
export function resolveBeatorajaJudgeEffect(
  judge: BeatorajaJudgeInput,
  placement: BeatorajaLanePlacement | undefined,
  total: number,
  options: { readonly bombs?: boolean } = {},
): BeatorajaJudgeEffect {
  const plate = placement?.plate ?? 1;
  const side = placement?.side ?? 1;
  const start: number[] = [judgeTimerId(plate)];
  if (isBeatorajaComboJudge(judge.judge)) start.push(comboTimerId(plate));
  if (isBeatorajaCleanHit(judge.judge)) {
    if (placement !== undefined && options.bombs !== false) start.push(...laneTimer(bombTimerId, placement));
    start.push(side === 2 ? TIMER_GAUGE_INCREASE_2P : TIMER_GAUGE_INCREASE_1P);
  }
  const startOnce =
    total > 0 && judge.combo >= total ? [side === 2 ? TIMER_FULLCOMBO_2P : TIMER_FULLCOMBO_1P] : ([] as number[]);
  const judgeOp = judgeOpForKind(plate, judge.judge);
  const deltaMs = judge.deltaMs;
  const laneJudge = placement?.lane !== undefined ? beatorajaJudgeIndex(judge.judge) : -1;
  return {
    ...(judgeOp !== undefined ? { judgeOp } : {}),
    ...(typeof deltaMs === 'number' && Number.isFinite(deltaMs)
      ? { timing: withFastSlow(beatorajaFastSlowOp(plate, deltaMs)) }
      : {}),
    timers: { start, startOnce, stop: [] },
    ...(laneJudge >= 0 ? { laneJudge } : {}),
  };
}

function withFastSlow(fastSlowOp: number | undefined): { readonly fastSlowOp?: number } {
  return fastSlowOp !== undefined ? { fastSlowOp } : {};
}

/** What a play skin's frame timers read of two engine frames in a row. */
export interface BeatorajaFrameTimerInput {
  /** The chart beat of this frame. */
  readonly beat: number;
  /** The beat of the frame before, if there was one. */
  readonly previousBeat?: number;
  /** The gauge of this frame. */
  readonly gauge?: { readonly current: number; readonly max: number };
  /** The gauge value of the frame before, if it had one. */
  readonly previousGauge?: number;
  /** The beat of each side's last note; a side without notes never ends. */
  readonly lastNoteBeats?: { readonly 1?: number; readonly 2?: number };
}

/**
 * The timers an engine frame starts: the rhythm timer (140) on the first frame and whenever the beat crosses a whole
 * beat either way; once each, the failure timer (3) when the gauge drops from above 0 to 0 (a survival gauge failing
 * mid-play), and each side's end-of-notes timer (143 / 144) once the beat passes its last note. The full-gauge timer
 * (44) starts on each transition to maximum, keeps its age while full and stops below maximum.
 * A non-finite beat starts no beat timer.
 */
export function resolveBeatorajaFrameTimers(input: BeatorajaFrameTimerInput): BeatorajaTimerChanges {
  const start: number[] = [];
  const startOnce: number[] = [];
  const stop: number[] = [];
  const { beat, previousBeat, gauge } = input;
  if (Number.isFinite(beat)) {
    if (previousBeat === undefined || Math.floor(beat) !== Math.floor(previousBeat)) start.push(TIMER_RHYTHM);
    for (const side of [1, 2] as const) {
      const lastBeat = input.lastNoteBeats?.[side];
      if (lastBeat !== undefined && beat >= lastBeat) startOnce.push(endOfNoteTimerId(side));
    }
  }
  if (gauge !== undefined) {
    if (input.previousGauge !== undefined && input.previousGauge > 0 && gauge.current <= 0)
      startOnce.push(TIMER_FAILED);
    if (gauge.max > 0 && gauge.current >= gauge.max) {
      if (input.previousGauge === undefined || input.previousGauge < gauge.max) start.push(TIMER_GAUGE_MAX_1P);
    } else stop.push(TIMER_GAUGE_MAX_1P);
  }
  return start.length === 0 && startOnce.length === 0 && stop.length === 0 ? NO_TIMERS : { start, startOnce, stop };
}

/** The scene's timers, which a seek leaves running: the scene start, input, fade-out, failure, READY, play and preview. */
const BEATORAJA_SCENE_TIMERS: ReadonlySet<number> = new Set([
  TIMER_SCENE_START,
  TIMER_STARTINPUT,
  TIMER_FADEOUT,
  TIMER_FAILED,
  TIMER_READY,
  TIMER_PLAY,
  TIMER_PREVIEW,
]);

/** What a play skin's timers read of a play that sought to another chart second. */
export interface BeatorajaSeekTimerInput {
  /** The timers running now (started and not stopped). */
  readonly started: Iterable<number>;
  /** The chart beat sought. */
  readonly beat: number;
  /** The gauge there. */
  readonly gauge?: { readonly current: number; readonly max: number };
  /** The beat of each side's last note; a side without notes never ends. */
  readonly lastNoteBeats?: { readonly 1?: number; readonly 2?: number };
}

/**
 * The timers a seek changes: every running timer but the scene's stops — the judgments' (judge, combo, bombs, gauge
 * sparkle, full combo), the lanes' (key on and off, long-note holds), the end of the notes and the full gauge — and a
 * host lets the ones that start once per play start again; then the rhythm timer (140) starts, and, once each, the full
 * gauge (44) when the gauge is full and each side's end of the notes (143 / 144) when the beat is past its last note.
 * The long notes held across the second sought start their hold timers again as the play announces them.
 */
export function resolveBeatorajaSeekTimers(input: BeatorajaSeekTimerInput): BeatorajaTimerChanges {
  const stop = [...input.started].filter((timer) => !BEATORAJA_SCENE_TIMERS.has(timer));
  const startOnce: number[] = [];
  const { beat, gauge } = input;
  if (gauge !== undefined && gauge.max > 0 && gauge.current >= gauge.max) startOnce.push(TIMER_GAUGE_MAX_1P);
  if (Number.isFinite(beat)) {
    for (const side of [1, 2] as const) {
      const lastBeat = input.lastNoteBeats?.[side];
      if (lastBeat !== undefined && beat >= lastBeat) startOnce.push(endOfNoteTimerId(side));
    }
  }
  return { start: Number.isFinite(beat) ? [TIMER_RHYTHM] : [], startOnce, stop };
}
