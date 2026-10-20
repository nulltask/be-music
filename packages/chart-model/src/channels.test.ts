import { describe, expect, test } from 'vite-plus/test';
import { isPlayableNormalizedChannel, mapBMSLongNoteNormalizedChannelToPlayable } from './channels.ts';

describe('normalized channel helpers', () => {
  test('isPlayableNormalizedChannel accepts the 1P / 2P lane channels, classic and extended', () => {
    for (const channel of ['11', '19', '21', '29', '1A', '2Z']) {
      expect(isPlayableNormalizedChannel(channel)).toBe(true);
    }
    for (const channel of ['10', '20', '31', '51', '01', 'D1', '1a', '111']) {
      expect(isPlayableNormalizedChannel(channel)).toBe(false);
    }
  });

  test('mapBMSLongNoteNormalizedChannelToPlayable maps 5x / 6x onto the 1x / 2x lane', () => {
    expect(mapBMSLongNoteNormalizedChannelToPlayable('51')).toBe('11');
    expect(mapBMSLongNoteNormalizedChannelToPlayable('5A')).toBe('1A');
    expect(mapBMSLongNoteNormalizedChannelToPlayable('69')).toBe('29');
    expect(mapBMSLongNoteNormalizedChannelToPlayable('11')).toBeUndefined();
    expect(mapBMSLongNoteNormalizedChannelToPlayable('50')).toBeUndefined();
  });
});
