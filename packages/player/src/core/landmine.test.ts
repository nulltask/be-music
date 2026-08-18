import { describe, expect, test } from 'vitest';
import { DEFAULT_LANDMINE_GAUGE_DAMAGE, resolveLandmineGaugeEffect } from './landmine.ts';

describe('landmine', () => {
  test('reads the BMS mine value directly as base-36 gauge damage', () => {
    expect(resolveLandmineGaugeEffect({ value: '0A' })).toEqual({ objectValue: '0A', damage: 10, gaugeDelta: -10 });
    expect(resolveLandmineGaugeEffect({ value: '01' })).toEqual({ objectValue: '01', damage: 1, gaugeDelta: -1 });
    // Lowercase input normalizes under base 36 before decoding.
    expect(resolveLandmineGaugeEffect({ value: '0a' }).damage).toBe(10);
  });

  test('ZZ decodes to 1295 — enough to wipe any gauge', () => {
    expect(resolveLandmineGaugeEffect({ value: 'ZZ' })).toEqual({
      objectValue: 'ZZ',
      damage: 1295,
      gaugeDelta: -1295,
    });
  });

  test('bmson damage wins over the value rule, including an authored 0', () => {
    expect(resolveLandmineGaugeEffect({ value: '0A', bmson: { damage: 25 } })).toEqual({
      objectValue: '0A',
      damage: 25,
      gaugeDelta: -25,
    });

    const decorative = resolveLandmineGaugeEffect({ value: 'ZZ', bmson: { damage: 0 } });
    expect(decorative.damage).toBe(0);
    expect(decorative.gaugeDelta).toBe(-0);
  });

  test('invalid values fall back to the default damage of 4', () => {
    expect(DEFAULT_LANDMINE_GAUGE_DAMAGE).toBe(4);
    expect(resolveLandmineGaugeEffect({ value: '!!' })).toEqual({
      objectValue: '!!',
      damage: DEFAULT_LANDMINE_GAUGE_DAMAGE,
      gaugeDelta: -DEFAULT_LANDMINE_GAUGE_DAMAGE,
    });
    // Parses fine but decodes to 0 — not a usable damage value.
    expect(resolveLandmineGaugeEffect({ value: '00' }).damage).toBe(DEFAULT_LANDMINE_GAUGE_DAMAGE);
    // Base-62 keeps lowercase IDs, which are not base-36 damage encodings.
    expect(resolveLandmineGaugeEffect({ value: '0a' }, 62).damage).toBe(DEFAULT_LANDMINE_GAUGE_DAMAGE);
    // A negative bmson damage is invalid and falls through to the value rule.
    expect(resolveLandmineGaugeEffect({ value: '0A', bmson: { damage: -5 } }).damage).toBe(10);
  });
});
