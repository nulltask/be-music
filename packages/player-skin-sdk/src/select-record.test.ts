import { describe, expect, it } from 'vite-plus/test';
import { CLEAR_LAMPS } from '@be-music/player-engine/ruleset';
import {
  CLEAR_LAMP_COLORS,
  CLEAR_LAMP_LABELS,
  CLEAR_LAMP_SHORT_LABELS,
  describeBestRecord,
  FAILED_LAMP_BLINK_MS,
  FULL_COMBO_LAMP_CYCLE_MS,
  resolveClearLampLight,
} from './select-record.ts';

describe('describeBestRecord', () => {
  it('is undefined without a record', () => {
    expect(describeBestRecord(undefined, 1000)).toBeUndefined();
  });

  it('names the lamp and works the rate and DJ Rank out of the best EX score', () => {
    expect(
      describeBestRecord({ lamp: 'HARD', exScore: 1708, maxCombo: 812, missCount: 14, playCount: 9 }, 1000),
    ).toEqual({
      lamp: 'HARD',
      lampLabel: 'HARD CLEAR',
      exScore: 1708,
      maxExScore: 2000,
      rate: 0.854,
      rateLabel: '85.40%',
      rank: 'AA',
      missCount: 14,
      maxCombo: 812,
      playCount: 9,
    });
  });

  it('cuts the rate rather than rounding it up', () => {
    expect(describeBestRecord({ lamp: 'FULL_COMBO', exScore: 1999 }, 1000)?.rateLabel).toBe('99.95%');
    expect(describeBestRecord({ lamp: 'FULL_COMBO', exScore: 2999 }, 1500)?.rateLabel).toBe('99.96%');
    expect(describeBestRecord({ lamp: 'MAX', exScore: 2000 }, 1000)).toMatchObject({
      rateLabel: '100.00%',
      rank: 'AAA',
    });
  });

  it('leaves the rate and rank out when the notes are unknown or the record keeps no score', () => {
    expect(describeBestRecord({ lamp: 'EASY', exScore: 500, playCount: 2 })).toEqual({
      lamp: 'EASY',
      lampLabel: 'EASY CLEAR',
      exScore: 500,
      playCount: 2,
    });
    expect(describeBestRecord({ lamp: 'ASSIST_EASY', playCount: 1 }, 1000)).toEqual({
      lamp: 'ASSIST_EASY',
      lampLabel: 'ASSIST CLEAR',
      playCount: 1,
    });
    expect(describeBestRecord({ lamp: 'FAILED', exScore: 10 }, 0)?.rank).toBeUndefined();
  });
});

describe('clear lamp labels and colours', () => {
  it('names and colours every lamp', () => {
    for (const lamp of CLEAR_LAMPS) {
      expect(CLEAR_LAMP_LABELS[lamp]).toMatch(/\S/);
      expect(CLEAR_LAMP_SHORT_LABELS[lamp]).toMatch(/\S/);
      expect(CLEAR_LAMP_COLORS[lamp]).toBeGreaterThanOrEqual(0);
    }
    expect([CLEAR_LAMP_LABELS.HARD, CLEAR_LAMP_SHORT_LABELS.HARD]).toEqual(['HARD CLEAR', 'HARD']);
  });
});

describe('resolveClearLampLight', () => {
  it('leaves NO PLAY unlit and holds the plain clears', () => {
    expect(resolveClearLampLight('NO_PLAY', 0).alpha).toBe(0);
    expect(resolveClearLampLight('HARD', 0)).toEqual({ color: CLEAR_LAMP_COLORS.HARD, alpha: 1 });
    expect(resolveClearLampLight('EASY', 12345)).toEqual({ color: CLEAR_LAMP_COLORS.EASY, alpha: 1 });
  });

  it('blinks FAILED', () => {
    expect(resolveClearLampLight('FAILED', 0).alpha).toBe(1);
    expect(resolveClearLampLight('FAILED', FAILED_LAMP_BLINK_MS).alpha).toBeLessThan(1);
    expect(resolveClearLampLight('FAILED', FAILED_LAMP_BLINK_MS * 2).alpha).toBe(1);
  });

  it('cycles FULL COMBO through the hues, offset by phase', () => {
    const start = resolveClearLampLight('FULL_COMBO', 0).color;
    expect(resolveClearLampLight('FULL_COMBO', FULL_COMBO_LAMP_CYCLE_MS / 3).color).not.toBe(start);
    expect(resolveClearLampLight('FULL_COMBO', FULL_COMBO_LAMP_CYCLE_MS).color).toBe(start);
    expect(resolveClearLampLight('FULL_COMBO', 0, 1 / 3).color).toBe(
      resolveClearLampLight('FULL_COMBO', FULL_COMBO_LAMP_CYCLE_MS / 3).color,
    );
    expect(resolveClearLampLight('FULL_COMBO', -FULL_COMBO_LAMP_CYCLE_MS / 2).alpha).toBe(1);
  });

  it('washes PERFECT and MAX towards white', () => {
    const channels = (color: number) => [(color >> 16) & 255, (color >> 8) & 255, color & 255];
    const spread = (color: number) => Math.max(...channels(color)) - Math.min(...channels(color));
    expect(spread(resolveClearLampLight('MAX', 0).color)).toBeLessThan(
      spread(resolveClearLampLight('PERFECT', 0).color),
    );
    expect(spread(resolveClearLampLight('PERFECT', 0).color)).toBeLessThan(
      spread(resolveClearLampLight('FULL_COMBO', 0).color),
    );
  });
});
