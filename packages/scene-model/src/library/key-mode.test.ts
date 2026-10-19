import type { BeMusicJSON } from '@be-music/json';
import { describe, expect, test } from 'vite-plus/test';
import { makeChartWith } from '../test-support/library.ts';
import { resolveLibraryChartKeyMode, resolveLibraryChartPlayVariant, seedLibraryChartPlayVariant } from './key-mode.ts';

const chartOn = (chartPath: string, channels: readonly string[], options: { player?: number } = {}) => {
  const entry = makeChartWith('chart', 'Song', { channels, chartPath });
  if (options.player !== undefined) entry.chart.bms.player = options.player;
  return entry;
};

describe('resolveLibraryChartPlayVariant', () => {
  test('classifies SP 5K (channels 11..15 only)', () => {
    expect(resolveLibraryChartPlayVariant(chartOn('Song/main.bms', ['11', '12', '15']))).toBe('5');
  });

  test('classifies SP 7K (channel 18 / 19 present)', () => {
    expect(resolveLibraryChartPlayVariant(chartOn('Song/main.bme', ['11', '15', '18', '19']))).toBe('7');
  });

  test('classifies DP 14K (2P-side keyboard 6 / 7) and DP 10K (no 6 / 7)', () => {
    expect(resolveLibraryChartPlayVariant(chartOn('Song/main.bme', ['11', '18', '21', '28']))).toBe('14');
    expect(resolveLibraryChartPlayVariant(chartOn('Song/main.bms', ['11', '21', '25']))).toBe('10');
  });

  test('a `.bme` chart without a 6 / 7 key column is 5 / 10 KEY, as the engine and CLI read it', () => {
    expect(resolveLibraryChartPlayVariant(chartOn('Song/main.bme', ['11', '21', '25']))).toBe('10');
    expect(resolveLibraryChartPlayVariant(chartOn('Song/main.bme', ['11', '16']))).toBe('5');
  });

  test('classifies the play from the resolved chart when one is given (lanes added by a `#RANDOM` branch count)', () => {
    const entry = chartOn('Song/main.bms', ['11', '15']);
    // Lanes 8 / 9 live only in a `#RANDOM` branch, so the unresolved chart's top-level events are 5 KEY.
    expect(resolveLibraryChartPlayVariant(entry)).toBe('5');
    const resolved = {
      ...entry.chart,
      events: [...entry.chart.events, { measure: 2, channel: '18', position: [0, 1], value: '01' }],
    } as BeMusicJSON;
    expect(resolveLibraryChartPlayVariant(entry, resolved)).toBe('7');
    // The library answer is unaffected (cached per chart object).
    expect(resolveLibraryChartPlayVariant(entry)).toBe('5');
  });

  test('PMS / 9 KEY: the `.pms` extension and the `#PLAYER 3` + channel 17 marker', () => {
    expect(resolveLibraryChartPlayVariant(chartOn('Song/main.pms', ['11', '16', '17', '18', '19']))).toBe('9');
    expect(resolveLibraryChartPlayVariant(chartOn('Song/main.PMS', ['11', '15', '22', '23', '24', '25']))).toBe('9');
    expect(
      resolveLibraryChartPlayVariant(chartOn('Song/main.bms', ['11', '15', '17', '18', '19'], { player: 3 })),
    ).toBe('9');
  });

  test('PMS / 9 KEY: `22..25` without the IIDX 2P channels, and a full `11..19` 1P keyboard', () => {
    expect(resolveLibraryChartPlayVariant(chartOn('Song/main.bms', ['11', '15', '22']))).toBe('9');
    expect(resolveLibraryChartPlayVariant(chartOn('Song/main.bms', ['11', '15', '16', '21', '22', '25', '26']))).toBe(
      '10',
    );
    expect(
      resolveLibraryChartPlayVariant(chartOn('Song/main.bme', ['11', '12', '13', '14', '15', '16', '17', '18', '19'])),
    ).toBe('9');
  });

  test('takes a variant seeded by the library loader instead of resolving the chart again', () => {
    const entry = chartOn('Song/main.bms', ['11', '12']);
    seedLibraryChartPlayVariant(entry, '14');
    expect(resolveLibraryChartPlayVariant(entry)).toBe('14');
    // A seed for another path (the same chart object under another file name) is not used.
    expect(resolveLibraryChartPlayVariant({ ...entry, chartPath: 'Song/other.bms' })).toBe('5');
  });
});

describe('resolveLibraryChartKeyMode', () => {
  test('reads the key mode a bmson mode hint names before the lanes', () => {
    expect(resolveLibraryChartKeyMode(makeChartWith('a', 'x', { channels: ['11'], modeHint: 'beat-7k' }))).toBe(7);
    expect(resolveLibraryChartKeyMode(makeChartWith('b', 'x', { channels: ['11'], modeHint: 'beat-14k' }))).toBe(14);
    expect(resolveLibraryChartKeyMode(makeChartWith('c', 'x', { channels: ['11'], modeHint: 'popn-9k' }))).toBe(9);
    expect(resolveLibraryChartKeyMode(makeChartWith('d', 'x', { channels: ['11'], modeHint: 'beat-10k' }))).toBe(10);
  });

  test('falls back to the play variant, keeping the 24-key modes apart', () => {
    expect(resolveLibraryChartKeyMode(makeChartWith('e', 'x', { channels: ['11', '18'] }))).toBe(7);
    expect(resolveLibraryChartKeyMode(makeChartWith('f', 'x', { channels: ['11', '1A'] }))).toBe(24);
    expect(resolveLibraryChartKeyMode(makeChartWith('g', 'x', { channels: ['11', '1A', '21'] }))).toBe(48);
  });
});
