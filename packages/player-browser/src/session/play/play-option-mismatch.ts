/**
 * A play whose options do not fit its chart. Some lane options and conversions apply to certain charts only (beatoraja
 * CONVERGE and playable RANDOM to PMS, LR2 SCATTER to 9KEY, SP TO DP and EXTRA MODE to BMS, ...), and the chart
 * preparation rejects the rest with a `RangeError`. {@link toPlayOptionMismatch} names the options that convert the
 * chart, so the host can tell the player which ones to change instead of leaving the play screen black.
 */

import { splitOptionSource } from '@be-music/player-engine/ruleset';
import type { PlaySessionOptions } from './play-options.ts';

/** How a source-qualified value reads: `beatoraja:CONVERGE` as `CONVERGE (beatoraja)`, `____:BATTLE` as `BATTLE (????)`. */
function optionLabel(value: string): string {
  const { source, name } = splitOptionSource(value);
  return source === undefined ? value : `${name} (${source === 'lr2' ? 'LR2' : source === '____' ? '????' : source})`;
}

/** The play options that convert the chart, as the Debug Menu labels them. */
export type PlayOptionMismatchSource = Pick<
  PlaySessionOptions,
  'random1P' | 'random2P' | 'battleMode' | 'lr2ExtraMode' | 'longNoteModifier'
>;

/** The chart could not be prepared with the selected play options. */
export class PlayOptionMismatchError extends RangeError {
  /** The selected options that convert the chart (`Random 1P: CONVERGE`, ...). */
  readonly options: readonly string[];

  constructor(options: readonly string[], cause: unknown) {
    super(`The selected play options cannot be used with this chart: ${options.join(', ')}.`, { cause });
    this.name = 'PlayOptionMismatchError';
    this.options = options;
  }
}

/** The selected options that convert the chart, labelled as the Debug Menu shows them. */
export function describeChartConvertingOptions(options: PlayOptionMismatchSource): string[] {
  const labels: string[] = [];
  if (options.random1P !== undefined && options.random1P !== 'OFF')
    labels.push(`Random 1P: ${optionLabel(options.random1P)}`);
  if (options.random2P !== undefined && options.random2P !== 'OFF')
    labels.push(`Random 2P: ${optionLabel(options.random2P)}`);
  if (options.battleMode !== undefined && options.battleMode !== 'OFF')
    labels.push(`Battle: ${optionLabel(options.battleMode)}`);
  if (options.lr2ExtraMode === true) labels.push('EXTRA MODE (LR2)');
  if (options.longNoteModifier !== undefined && options.longNoteModifier !== 'OFF')
    labels.push(`Long notes: ${options.longNoteModifier}`);
  return labels;
}

/**
 * The chart preparation's `error` as a {@link PlayOptionMismatchError}, or `undefined` when it is something else: not a
 * `RangeError`, a replay or a kept arrangement (they play recorded options, not the selected ones), or a play with no
 * chart-converting option selected.
 */
export function toPlayOptionMismatch(
  error: unknown,
  options: PlayOptionMismatchSource & Pick<PlaySessionOptions, 'replay' | 'fixedArrangement'>,
): PlayOptionMismatchError | undefined {
  if (error instanceof PlayOptionMismatchError) return error;
  if (!(error instanceof RangeError)) return undefined;
  if (options.replay !== undefined || options.fixedArrangement !== undefined) return undefined;
  const labels = describeChartConvertingOptions(options);
  return labels.length > 0 ? new PlayOptionMismatchError(labels, error) : undefined;
}
