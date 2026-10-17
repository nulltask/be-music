import { describe, expect, test } from 'vite-plus/test';
import { isPlayableNormalizedChannel, mapBmsLongNoteNormalizedChannelToPlayable } from './channels.ts';

describe('normalized channel helpers', () => {
  test('isPlayableNormalizedChannel accepts the 1P / 2P lane channels, classic and extended', () => {
    for (const channel of ['11', '19', '21', '29', '1A', '2Z']) {
      expect(isPlayableNormalizedChannel(channel)).toBe(true);
    }
    for (const channel of ['10', '20', '31', '51', '01', 'D1', '1a', '111']) {
      expect(isPlayableNormalizedChannel(channel)).toBe(false);
    }
  });

  test('mapBmsLongNoteNormalizedChannelToPlayable maps 5x / 6x onto the 1x / 2x lane', () => {
    expect(mapBmsLongNoteNormalizedChannelToPlayable('51')).toBe('11');
    expect(mapBmsLongNoteNormalizedChannelToPlayable('5A')).toBe('1A');
    expect(mapBmsLongNoteNormalizedChannelToPlayable('69')).toBe('29');
    expect(mapBmsLongNoteNormalizedChannelToPlayable('11')).toBeUndefined();
    expect(mapBmsLongNoteNormalizedChannelToPlayable('50')).toBeUndefined();
  });
});
