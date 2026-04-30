import type { BeMusicEvent } from '@be-music/json';
import { describe, expect, test } from 'vitest';
import { pickLr2PlaySkin, summarizeLr2PlaySkins, type Lr2PlaySkinMap } from './lr2-play-skin.ts';
import type { Lr2Skin } from './lr2-skin.ts';
import type { BrowserSongEntry } from './types.ts';

function skin(name: string): Lr2Skin {
  return { name } as Lr2Skin;
}

function songWithChannels(channels: string[]): BrowserSongEntry {
  return {
    chart: {
      events: channels.map(
        (channel, index): BeMusicEvent => ({ measure: index, channel, position: [0, 1], value: '01' }),
      ),
    },
  } as BrowserSongEntry;
}

describe('LR2 play-skin helpers', () => {
  test('pickLr2PlaySkin picks exact and nearest fallback variants', () => {
    const skins: Lr2PlaySkinMap = {
      '7': skin('7K'),
      '10': skin('10K'),
    };

    expect(pickLr2PlaySkin(skins, songWithChannels(['18']))?.name).toBe('7K');
    expect(pickLr2PlaySkin(skins, songWithChannels(['28']))?.name).toBe('10K');
  });

  test('pickLr2PlaySkin returns undefined when no play skin is available', () => {
    expect(pickLr2PlaySkin({}, songWithChannels(['11']))).toBeUndefined();
  });

  test('summarizeLr2PlaySkins formats loaded variants', () => {
    expect(summarizeLr2PlaySkins({ '7': skin('seven'), '14': skin('double') }, ' / ')).toBe('7K=seven / 14K=double');
  });
});
