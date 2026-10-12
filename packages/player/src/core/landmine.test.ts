import { describe, expect, test } from 'vite-plus/test';
import { parseChart } from '../../../parser/src/index.ts';
import { extractLandmineNotes } from '../playable-notes.ts';
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

  test('a bmson mine without `damage` deals the default 4, not its WAV slot read as base 36', () => {
    // The parser binds every `key_channels` entry to a WAV slot numbered after the sound channels, so the event value
    // is a resource ID, not a damage encoding.
    expect(resolveLandmineGaugeEffect({ value: '0A' }, 36, 'bmson')).toEqual({
      objectValue: '0A',
      damage: DEFAULT_LANDMINE_GAUGE_DAMAGE,
      gaugeDelta: -DEFAULT_LANDMINE_GAUGE_DAMAGE,
    });
    expect(resolveLandmineGaugeEffect({ value: 'ZZ', bmson: { l: 0 } }, 36, 'bmson').damage).toBe(
      DEFAULT_LANDMINE_GAUGE_DAMAGE,
    );
    // An authored damage still wins, including 0.
    expect(resolveLandmineGaugeEffect({ value: '0A', bmson: { damage: 25 } }, 36, 'bmson').damage).toBe(25);
    expect(resolveLandmineGaugeEffect({ value: '0A', bmson: { damage: 0 } }, 36, 'bmson').damage).toBe(0);
    // BMS keeps its value rule.
    expect(resolveLandmineGaugeEffect({ value: '0A' }, 36, 'bms').damage).toBe(10);
  });

  test("adding sound channels to a bmson chart does not change its mines' damage", () => {
    const bmson = (soundChannelCount: number) =>
      parseChart(
        JSON.stringify({
          version: '1.0.0',
          info: { title: 'mine', init_bpm: 120, resolution: 240, mode_hint: 'beat-7k' },
          sound_channels: Array.from({ length: soundChannelCount }, (_, index) => ({
            name: `s${index}.wav`,
            notes: [{ x: 1, y: 240 * (index + 1), l: 0, c: false }],
          })),
          key_channels: [{ name: 'mine.wav', notes: [{ x: 2, y: 960 }] }],
        }),
        'bmson',
      );
    const damages = [1, 9, 20].map((count) => {
      const json = bmson(count);
      expect(json.sourceFormat).toBe('bmson');
      const [mine] = extractLandmineNotes(json);
      expect(mine).toBeDefined();
      return resolveLandmineGaugeEffect(mine!.event, 36, json.sourceFormat).damage;
    });
    expect(damages).toEqual([
      DEFAULT_LANDMINE_GAUGE_DAMAGE,
      DEFAULT_LANDMINE_GAUGE_DAMAGE,
      DEFAULT_LANDMINE_GAUGE_DAMAGE,
    ]);
  });
});
