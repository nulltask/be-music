import { describe, expect, test } from 'vite-plus/test';
import { isChannelOnSide, resolveLaneSides } from './lane-sides.ts';

describe('isChannelOnSide', () => {
  test('sorts lanes by their side digit', () => {
    expect(isChannelOnSide('11', '1P')).toBe(true);
    expect(isChannelOnSide('16', '1P')).toBe(true);
    expect(isChannelOnSide('21', '1P')).toBe(false);
    expect(isChannelOnSide('26', '2P')).toBe(true);
    expect(isChannelOnSide('11', '2P')).toBe(false);
  });

  test('puts channels that are not lanes on neither side', () => {
    for (const channel of ['01', '1', '111']) {
      expect(isChannelOnSide(channel, '1P')).toBe(false);
      expect(isChannelOnSide(channel, '2P')).toBe(false);
    }
  });
});

describe('resolveLaneSides', () => {
  test('lists the sides with a lane, 1P first', () => {
    expect(resolveLaneSides(['11', '12', '16'])).toEqual(['1P']);
    expect(resolveLaneSides(['26', '21', '11'])).toEqual(['1P', '2P']);
    expect(resolveLaneSides(['21'])).toEqual(['2P']);
  });

  test('a 9 KEY chart lays lanes on both sides of the channel numbering', () => {
    expect(resolveLaneSides(['11', '12', '13', '14', '15', '22', '23', '24', '25'])).toEqual(['1P', '2P']);
  });

  test('no lanes, no sides', () => {
    expect(resolveLaneSides([])).toEqual([]);
    expect(resolveLaneSides(['01'])).toEqual([]);
  });
});
