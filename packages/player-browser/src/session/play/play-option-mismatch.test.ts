import { describe, expect, test } from 'vite-plus/test';
import type { BeMusicReplay } from '@be-music/player-engine/replay';
import {
  describeChartConvertingOptions,
  PlayOptionMismatchError,
  toPlayOptionMismatch,
} from './play-option-mismatch.ts';

describe('describeChartConvertingOptions', () => {
  test('labels every selected option that converts the chart, as the Debug Menu does', () => {
    expect(
      describeChartConvertingOptions({
        random1P: 'CONVERGE',
        random2P: 'SCATTER',
        battleMode: 'SP-TO-DP',
        lr2ExtraMode: true,
        longNoteModifier: 'ADD_LN',
      }),
    ).toEqual([
      'Random 1P: CONVERGE',
      'Random 2P: SCATTER',
      'Battle: SP-TO-DP',
      'EXTRA MODE (LR2)',
      'Long notes: ADD_LN',
    ]);
  });

  test('leaves out the options that are off', () => {
    expect(
      describeChartConvertingOptions({ random1P: 'OFF', random2P: 'OFF', battleMode: 'OFF', lr2ExtraMode: false }),
    ).toEqual([]);
    expect(describeChartConvertingOptions({})).toEqual([]);
  });
});

describe('toPlayOptionMismatch', () => {
  const cause = new RangeError('beatoraja CONVERGE and playable RANDOM/S-RANDOM are PMS arrangements.');

  test('turns a preparation RangeError into a mismatch naming the selected options', () => {
    const error = toPlayOptionMismatch(cause, { random1P: 'CONVERGE' });
    expect(error).toBeInstanceOf(PlayOptionMismatchError);
    expect(error).toBeInstanceOf(RangeError);
    expect(error?.options).toEqual(['Random 1P: CONVERGE']);
    expect(error?.cause).toBe(cause);
    expect(error?.message).toBe('The selected play options cannot be used with this chart: Random 1P: CONVERGE.');
  });

  test('keeps a mismatch as it is', () => {
    const error = new PlayOptionMismatchError(['Random 1P: CONVERGE'], cause);
    expect(toPlayOptionMismatch(error, {})).toBe(error);
  });

  test('leaves other errors, recorded plays and plays with no converting option alone', () => {
    expect(toPlayOptionMismatch(new Error('decode failed'), { random1P: 'CONVERGE' })).toBeUndefined();
    expect(toPlayOptionMismatch(cause, { random1P: 'OFF' })).toBeUndefined();
    const recorded = {} as BeMusicReplay;
    expect(toPlayOptionMismatch(cause, { random1P: 'CONVERGE', replay: recorded })).toBeUndefined();
    expect(toPlayOptionMismatch(cause, { random1P: 'CONVERGE', fixedArrangement: recorded })).toBeUndefined();
  });
});
