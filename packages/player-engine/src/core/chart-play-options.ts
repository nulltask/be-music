import type { ChartPlayOptionProgram } from '@be-music/chart-model';
import type { MineModifier } from './mine-modifier.ts';

/** The player's arrangement and mine choices a chart's gameplay options can replace. */
export interface ChartPlaySelection {
  random1P?: string;
  random2P?: string;
  randomFixedLane1P?: number;
  randomFixedLane2P?: number;
  mRan1P?: boolean;
  mRan2P?: boolean;
  mineModifier?: MineModifier;
}

/** The lane domain of the play variant, which decides how RANDOM+ and ALL map onto it. */
export interface ChartPlayLayout {
  /** Two-sided (10 / 14 / 48 KEY). */
  doublePlay: boolean;
  /** The variant has scratch lanes (not 9 KEY). */
  hasScratch: boolean;
}

export interface ChartPlayArrangement<T extends ChartPlaySelection> {
  /** The selection with the chart's choices in place of the player's. */
  selection: T;
  /**
   * `ALL` / `ALL+` on a two-sided chart: one permutation across both sides' keys (and with `scratch`, both scratch
   * lanes), which per-side lane options cannot express; the host applies it after the per-side options (then `OFF`).
   */
  crossSide?: { scratch: boolean };
}

/**
 * Puts a chart's forced arrangement and ADDMINE in place of the player's own options (#844; the chart wins, as the
 * chart author's staging). Mapped onto the existing per-side arrangements:
 *
 * - `MIRROR` → MIRROR on both sides; `RANDOM` → RANDOM on both sides, without the player's fixed lane or M-RAN.
 * - `RANDOM+` → the scratch-inclusive RANDOM-EX shuffle on both sides (plain RANDOM where the variant has no scratch).
 * - `ALL` / `ALL+` → one shuffle across both sides (`crossSide`), keys only or with scratch; on a one-sided chart they are
 *   `RANDOM` / `RANDOM+`.
 * - `addMine` → the ADD_RANDOM mine modifier (mines at random blank cells).
 *
 * Without a program, or for a replay (whose recorded notes already hold the result), the selection is unchanged.
 */
export function applyChartPlayOptions<T extends ChartPlaySelection>(
  selection: T,
  program: ChartPlayOptionProgram | undefined,
  layout: ChartPlayLayout,
): ChartPlayArrangement<T> {
  const options = program?.options;
  if (options === undefined) return { selection };
  const next: T = { ...selection };
  const writable: ChartPlaySelection = next;
  if (options.addMine === true) writable.mineModifier = 'ADD_RANDOM';
  const random = options.random;
  if (random === undefined) return { selection: next };
  const crossSide = layout.doublePlay && (random === 'ALL' || random === 'ALL+');
  const scratch = (random === 'RANDOM+' || random === 'ALL+') && layout.hasScratch;
  const perSide = crossSide ? 'OFF' : random === 'MIRROR' ? 'MIRROR' : scratch ? 'RANDOM-EX' : 'RANDOM';
  writable.random1P = perSide;
  writable.random2P = perSide;
  delete writable.randomFixedLane1P;
  delete writable.randomFixedLane2P;
  writable.mRan1P = false;
  writable.mRan2P = false;
  return { selection: next, ...(crossSide ? { crossSide: { scratch } } : {}) };
}
