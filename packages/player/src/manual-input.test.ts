import { describe, expect, test } from 'vitest';
import { createLaneBindings, resolveLaneDisplayMode } from './manual-input.ts';

describe('manual input', () => {
  test('manual-input: builds full 5-key SP lanes from used channels', () => {
    const bindings = createLaneBindings(['11', '14']);
    expect(bindings.map((binding) => binding.channel)).toEqual(['16', '11', '12', '13', '14', '15']);
    expect(bindings.find((binding) => binding.channel === '16')).toMatchObject({
      keyLabel: 'a',
      inputTokens: ['a'],
      isScratch: true,
    });
  });

  test('manual-input: builds full 7-key SP lanes when 18/19 is used', () => {
    const bindings = createLaneBindings(['11', '18']);
    expect(bindings.map((binding) => binding.channel)).toEqual(['16', '11', '12', '13', '14', '15', '18', '19']);
  });

  test('manual-input: builds full 5-key DP lanes when 2P channels are used', () => {
    const bindings = createLaneBindings(['11', '22']);
    expect(bindings.map((binding) => binding.channel)).toEqual([
      '16',
      '11',
      '12',
      '13',
      '14',
      '15',
      '21',
      '22',
      '23',
      '24',
      '25',
      '26',
    ]);
    expect(bindings.find((binding) => binding.channel === '26')).toMatchObject({
      keyLabel: ']',
      inputTokens: [']'],
      isScratch: true,
    });
  });

  test('manual-input: builds full 14-key DP lanes when 28/29 is used', () => {
    const bindings = createLaneBindings(['11', '21', '29']);
    expect(bindings.map((binding) => binding.channel)).toEqual([
      '16',
      '11',
      '12',
      '13',
      '14',
      '15',
      '18',
      '19',
      '21',
      '22',
      '23',
      '24',
      '25',
      '28',
      '29',
      '26',
    ]);
  });

  test('manual-input: builds full 9-key lanes when channel 17 is used', () => {
    const bindings = createLaneBindings(['11', '17', '19']);
    expect(bindings.map((binding) => binding.channel)).toEqual(['11', '12', '13', '14', '15', '16', '17', '18', '19']);
    expect(bindings.find((binding) => binding.channel === '16')?.keyLabel).toBe('h');
    expect(bindings.find((binding) => binding.channel === '16')?.isScratch).toBe(false);
  });

  test('manual-input: builds full 24-key SP lanes when extended 1P channel is used', () => {
    const bindings = createLaneBindings(['1A']);
    expect(bindings).toHaveLength(24);
    expect(bindings[0]?.channel).toBe('11');
    expect(bindings[23]?.channel).toBe('1O');
    expect(bindings.some((binding) => binding.channel === '21')).toBe(false);
    expect(bindings.find((binding) => binding.channel === '16')?.isScratch).toBe(false);
  });

  test('manual-input: builds full 48-key DP lanes when extended 2P channel is used', () => {
    const bindings = createLaneBindings(['2A']);
    expect(bindings).toHaveLength(48);
    expect(bindings[0]?.channel).toBe('11');
    expect(bindings[23]?.channel).toBe('1O');
    expect(bindings[24]?.channel).toBe('21');
    expect(bindings[47]?.channel).toBe('2O');
    expect(bindings.find((binding) => binding.channel === '26')?.isScratch).toBe(false);
  });

  test('manual-input: appends unknown channels after detected mode lanes', () => {
    const bindings = createLaneBindings(['11', '19', '0A', 'SC']);
    expect(bindings.map((binding) => binding.channel)).toEqual([
      '16',
      '11',
      '12',
      '13',
      '14',
      '15',
      '18',
      '19',
      '0A',
      'SC',
    ]);
    expect(bindings.at(-1)?.side).toBe('OTHER');
  });

  test('manual-input: resolves lane display mode labels', () => {
    expect(resolveLaneDisplayMode(['11'])).toBe('5 KEY SP');
    expect(resolveLaneDisplayMode(['11', '22'])).toBe('5 KEY DP');
    expect(resolveLaneDisplayMode(['11', '19'])).toBe('7 KEY SP');
    expect(resolveLaneDisplayMode(['11', '21', '29'])).toBe('14 KEY DP');
    expect(resolveLaneDisplayMode(['11', '17'])).toBe('9 KEY');
    expect(resolveLaneDisplayMode(['1A'])).toBe('24 KEY SP');
    expect(resolveLaneDisplayMode(['2A'])).toBe('48 KEY DP');
  });
});
