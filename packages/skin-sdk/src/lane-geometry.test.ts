import { PLAY_MODE_LAYOUTS } from '@be-music/chart';
import { resolveLr2LaneIndex } from '@be-music/player/core/lane-layout';
import { describe, expect, test } from 'vite-plus/test';
import { resolveBeMusicLaneKind } from './lane-geometry.ts';

describe('resolveBeMusicLaneKind', () => {
  test('agrees with the play-mode table for every lane of every layout', () => {
    for (const layout of Object.values(PLAY_MODE_LAYOUTS)) {
      for (const lane of layout.lanes) {
        const expected = lane.kind === 'key' ? lane.tone : lane.kind;
        expect(
          resolveBeMusicLaneKind(lane.channel, resolveLr2LaneIndex(lane.channel, layout.variant), layout.variant),
          `${layout.id} ${lane.channel}`,
        ).toBe(expected);
      }
    }
  });

  test('colours a keyboard lane outside the layout like the key an octave away', () => {
    // `1R` sits past the 24 keys and the wheel; `2B` under 24 KEY SP has no lane, but its key number (11, A#) does.
    expect(resolveBeMusicLaneKind('2B', -1, '24')).toBe('black');
    expect(resolveBeMusicLaneKind('1R', -1, '24')).toBe('white');
  });
});
