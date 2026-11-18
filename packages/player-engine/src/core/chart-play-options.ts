import {
  isLegacyChartPlayOptionProgram,
  playerChartPlayOptionsOf,
  withPlayerChartPlayOptions,
  type ChartOptionDiagnostic,
  type ChartPlayOptionProgram,
  type PlayerChartPlayOptions,
} from '@be-music/chart-model';
import { resolveEffectiveChartPlayOptions, type ChartPlayOptionContext } from './chart-notes-options.ts';
import type { MineModifier } from './mine-modifier.ts';

/** Resolve a play's program and identify the effective options contributed by the player. */
export function resolveChartPlayProgram(
  declared: ChartPlayOptionProgram,
  player: PlayerChartPlayOptions | undefined,
  context: ChartPlayOptionContext,
): { program: ChartPlayOptionProgram; diagnostics: ChartOptionDiagnostic[]; playerOptions: PlayerChartPlayOptions } {
  const effective = resolveEffectiveChartPlayOptions(withPlayerChartPlayOptions(declared, player), context);
  return { ...effective, playerOptions: playerChartPlayOptionsOf(declared.options, effective.program.options) };
}

/** The player's arrangement and mine choices a chart's gameplay options can replace. */
export interface ChartPlaySelection {
  random1P?: string;
  random2P?: string;
  randomFixedLane1P?: number;
  randomFixedLane2P?: number;
  lr2RandomScratch1P?: boolean;
  lr2RandomScratch2P?: boolean;
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

/** The mine modifier a chart's ADDMINE runs as: nanasigroove's, or beatoraja's ADD RANDOM for a program before version 3. */
export function resolveChartAddMineModifier(program: ChartPlayOptionProgram): MineModifier {
  return isLegacyChartPlayOptionProgram(program) ? 'ADD_RANDOM' : 'NANASI_ADD';
}

/**
 * Puts a chart's forced arrangement and ADDMINE in place of the player's own options (#844; the chart wins, as the
 * chart author's staging). Mapped onto the existing per-side arrangements:
 *
 * - `MIRROR` → MIRROR on both sides; `RANDOM` → RANDOM on both sides, without the player's fixed lane or M-RAN.
 * - `RANDOM+` → nanasigroove's own lane value `RANDOM+` on both sides (#1244): one shuffle of the side's keys and scratch
 *   lanes. It draws as RANDOM-EX does but is recorded as nanasigroove's, not as beatoraja's RANDOM-EX. Plain RANDOM where
 *   the variant has no scratch, where the two are the same shuffle.
 * - `ALL` / `ALL+` → one shuffle across both sides (`crossSide`), keys only or with scratch; on a one-sided chart they are
 *   `RANDOM` / `RANDOM+`.
 * - `addMine` → nanasigroove's ADDMINE (`NANASI_ADD`); a program recorded before version 3 keeps the ADD_RANDOM mine
 *   modifier it was played with (mines at random blank cells).
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
  if (options.addMine === true) writable.mineModifier = resolveChartAddMineModifier(program!);
  const random = options.random;
  if (random === undefined) return { selection: next };
  const crossSide = layout.doublePlay && (random === 'ALL' || random === 'ALL+');
  const scratch = (random === 'RANDOM+' || random === 'ALL+') && layout.hasScratch;
  const perSide = crossSide ? 'OFF' : random === 'MIRROR' ? 'MIRROR' : scratch ? 'RANDOM+' : 'RANDOM';
  writable.random1P = perSide;
  writable.random2P = perSide;
  // A `delete` of an absent key still costs a runtime call; most selections carry none of these.
  if ('randomFixedLane1P' in writable) delete writable.randomFixedLane1P;
  if ('randomFixedLane2P' in writable) delete writable.randomFixedLane2P;
  if ('lr2RandomScratch1P' in writable) delete writable.lr2RandomScratch1P;
  if ('lr2RandomScratch2P' in writable) delete writable.lr2RandomScratch2P;
  writable.mRan1P = false;
  writable.mRan2P = false;
  return crossSide ? { selection: next, crossSide: { scratch } } : { selection: next };
}
