import { resolveLaneCover, type LaneCoverState } from '@be-music/scene-model';
import { BEATORAJA_OP, type BeatorajaSide } from '../runtime-ids.ts';

/**
 * What a chart has, for the ops that show or hide chrome by it. A trait left out lights neither of its ops (the select
 * screen reads no `#TEXT`, the play screen no `#RANDOM`).
 */
export interface BeatorajaChartTraits {
  readonly longNote?: boolean;
  readonly bpmChange?: boolean;
  /** STOPs: `HAS_BPMSTOP` (1177) has no "none" op. */
  readonly stop?: boolean;
  readonly text?: boolean;
  readonly bga?: boolean;
  readonly random?: boolean;
  readonly stageFile?: boolean;
  readonly banner?: boolean;
  readonly backBmp?: boolean;
}

function pick(ops: number[], value: boolean | undefined, has: number, none: number | undefined): void {
  if (value === true) ops.push(has);
  else if (value === false && none !== undefined) ops.push(none);
}

/**
 * The chart-trait ops (`HAS_LN` / `NO_LN`, `HAS_BPMCHANGE` / `NO_BPMCHANGE`, `HAS_BPMSTOP`, `HAS_TEXT` / `NO_TEXT`,
 * `HAS_BGA` / `NO_BGA`, `HAS_RANDOMSEQUENCE` / `NO_RANDOMSEQUENCE`, and the STAGEFILE / BANNER / BACKBMP pairs) for the
 * traits given.
 */
export function resolveBeatorajaChartTraitOps(traits: BeatorajaChartTraits): number[] {
  const ops: number[] = [];
  pick(ops, traits.longNote, BEATORAJA_OP.HAS_LN, BEATORAJA_OP.NO_LN);
  pick(ops, traits.bpmChange, BEATORAJA_OP.HAS_BPMCHANGE, BEATORAJA_OP.NO_BPMCHANGE);
  pick(ops, traits.stop, BEATORAJA_OP.HAS_BPMSTOP, undefined);
  pick(ops, traits.text, BEATORAJA_OP.HAS_TEXT, BEATORAJA_OP.NO_TEXT);
  pick(ops, traits.bga, BEATORAJA_OP.HAS_BGA, BEATORAJA_OP.NO_BGA);
  pick(ops, traits.random, BEATORAJA_OP.HAS_RANDOMSEQUENCE, BEATORAJA_OP.NO_RANDOMSEQUENCE);
  pick(ops, traits.stageFile, BEATORAJA_OP.HAS_STAGEFILE, BEATORAJA_OP.NO_STAGEFILE);
  pick(ops, traits.banner, BEATORAJA_OP.HAS_BANNER, BEATORAJA_OP.NO_BANNER);
  pick(ops, traits.backBmp, BEATORAJA_OP.HAS_BACKBMP, BEATORAJA_OP.NO_BACKBMP);
  return ops;
}

/** The key-mode op (`KEYSONG_*`: 160-164, 1160 / 1161) of a play variant (`'7'`, `'14'`, `'24'`, `'48'`, …). */
export function beatorajaKeysongOp(playVariant: string | undefined): number | undefined {
  switch (playVariant) {
    case '5':
      return BEATORAJA_OP.KEYSONG_5K;
    case '7':
      return BEATORAJA_OP.KEYSONG_7K;
    case '9':
      return BEATORAJA_OP.KEYSONG_9K;
    case '10':
      return BEATORAJA_OP.KEYSONG_10K;
    case '14':
      return BEATORAJA_OP.KEYSONG_14K;
    case '24':
      return BEATORAJA_OP.KEYSONG_24K;
    case '48':
      return BEATORAJA_OP.KEYSONG_24K_DP;
    default:
      return undefined;
  }
}

/** How a play starts on a play skin. */
export interface BeatorajaPlayStartInput {
  readonly playVariant: string;
  readonly autoPlay: boolean;
  /** The chart's traits; none lit without a chart. */
  readonly traits?: BeatorajaChartTraits;
}

/**
 * The ops a play skin starts a play with, before the engine's first frame: the autoplay op (`AUTOPLAY_ON` or
 * `AUTOPLAY_OFF`), `NOW_LOADING`, `GAUGE_GROOVE`, the key-mode op and the chart-trait ops. `NOW_LOADING` gives way to
 * `LOADED` when playback starts ({@link BEATORAJA_PLAY_STARTED_OPS}).
 */
export function resolveBeatorajaPlayStartOps(input: BeatorajaPlayStartInput): number[] {
  const ops: number[] = [
    input.autoPlay ? BEATORAJA_OP.AUTOPLAY_ON : BEATORAJA_OP.AUTOPLAY_OFF,
    BEATORAJA_OP.NOW_LOADING,
    BEATORAJA_OP.GAUGE_GROOVE,
  ];
  const keysong = beatorajaKeysongOp(input.playVariant);
  if (keysong !== undefined) ops.push(keysong);
  if (input.traits !== undefined) ops.push(...resolveBeatorajaChartTraitOps(input.traits));
  return ops;
}

/** The op playback starting lights (`LOADED`), in place of `NOW_LOADING`. */
export const BEATORAJA_PLAY_STARTED_OPS: { readonly on: number; readonly off: number } = {
  on: BEATORAJA_OP.LOADED,
  off: BEATORAJA_OP.NOW_LOADING,
};

/** The lane cover ops a play skin keeps up to date (`LANECOVER1_CHANGING`, `LANECOVER1_ON`, `LIFT1_ON`). */
export const BEATORAJA_COVER_OPS: readonly number[] = [
  BEATORAJA_OP.LANECOVER1_CHANGING,
  BEATORAJA_OP.LANECOVER1_ON,
  BEATORAJA_OP.LIFT1_ON,
];

/**
 * The lane cover ops lit for the 1P covers: `LANECOVER1_ON` (271) while the lane cover is drawn, `LIFT1_ON` (272) while
 * the LIFT is raised, and `LANECOVER1_CHANGING` (270) while `changing` (the player moved a cover a moment ago; skins
 * gate the cover's percentage popup on it).
 */
export function resolveBeatorajaCoverOps(cover: LaneCoverState | undefined, changing: boolean): number[] {
  const ops: number[] = [];
  if (changing) ops.push(BEATORAJA_OP.LANECOVER1_CHANGING);
  if (cover !== undefined) {
    const drawn = resolveLaneCover(cover);
    if (drawn.sudden > 0) ops.push(BEATORAJA_OP.LANECOVER1_ON);
    if (drawn.lift > 0) ops.push(BEATORAJA_OP.LIFT1_ON);
  }
  return ops;
}

/**
 * The FAST / SLOW op of a judge plate for a timed judgment (`_1p_early` 1242 / `_1p_late` 1243, 1262 / 1263 for 2P,
 * 1362 / 1363 for POPN 9 KEY's third plate): early below 0 ms, late above. `undefined` on time (0 ms).
 */
export function beatorajaFastSlowOp(plate: BeatorajaSide, deltaMs: number): number | undefined {
  if (deltaMs === 0) return undefined;
  const isEarly = deltaMs < 0;
  if (plate === 1) return isEarly ? BEATORAJA_OP.P1_JUDGE_EARLY : BEATORAJA_OP.P1_JUDGE_LATE;
  if (plate === 2) return isEarly ? BEATORAJA_OP.P2_JUDGE_EARLY : BEATORAJA_OP.P2_JUDGE_LATE;
  return isEarly ? BEATORAJA_OP.P3_JUDGE_EARLY : BEATORAJA_OP.P3_JUDGE_LATE;
}
