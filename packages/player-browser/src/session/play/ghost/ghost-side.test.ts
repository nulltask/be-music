import { describe, expect, test } from 'vite-plus/test';
import { resolvePlayVariantLaneChannels } from '@be-music/player-engine/lanes';
import { resolveGhostSide, toGhostChannel } from './ghost-side.ts';

const SEVEN_KEY = ['16', '11', '12', '13', '14', '15', '18', '19'];

describe('resolveGhostSide', () => {
  test('lays a 7 KEY play and its ghost out as the two sides of 14 KEY', () => {
    const side = resolveGhostSide(SEVEN_KEY, '7')!;
    expect(side.playVariant).toBe('14');
    expect(side.laneChannels.slice(0, 8)).toEqual(SEVEN_KEY);
    expect(side.laneChannels.slice(8).sort()).toEqual(['21', '22', '23', '24', '25', '26', '28', '29']);
    expect([...side.ghostChannels].sort()).toEqual(['21', '22', '23', '24', '25', '26', '28', '29']);
    // In the order a 14 KEY chart's lanes take, so the two fields lay out as its two sides.
    const doublePlay = [...SEVEN_KEY, '26', '21', '22', '23', '24', '25', '28', '29'];
    expect(side.laneChannels).toEqual(
      resolvePlayVariantLaneChannels(
        doublePlay.map((channel) => ({ channel })),
        '14',
      ),
    );
  });

  test('lays a 5 KEY play out as 10 KEY', () => {
    const side = resolveGhostSide(['16', '11', '12', '13', '14', '15'], '5')!;
    expect(side.playVariant).toBe('10');
    expect(side.laneChannels).toHaveLength(12);
  });

  test('has no room beside a double-play, 9 KEY or keyboard chart', () => {
    expect(resolveGhostSide([...SEVEN_KEY, '21'], '14')).toBeUndefined();
    expect(resolveGhostSide(['11', '12', '13', '14', '15', '22', '23', '24', '25'], '9')).toBeUndefined();
    expect(resolveGhostSide(['11'], '24')).toBeUndefined();
    expect(resolveGhostSide([], '7')).toBeUndefined();
  });
});

describe('toGhostChannel', () => {
  test('moves a 1P lane to its 2P lane and leaves anything else alone', () => {
    expect(toGhostChannel('11')).toBe('21');
    expect(toGhostChannel('16')).toBe('26');
    expect(toGhostChannel('19')).toBe('29');
    expect(toGhostChannel('21')).toBe('21');
    expect(toGhostChannel('01')).toBe('01');
  });
});
