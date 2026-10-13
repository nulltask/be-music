import { describe, expect, test } from 'vite-plus/test';
import { createEmptyJson } from '../../json/src/index.ts';
import { DEFAULT_LANDMINE_DAMAGE, resolveChartLongNoteMode, resolveLandmineDamage } from './index.ts';

describe('note rules', () => {
  test('resolveChartLongNoteMode reads #LNMODE and bmson ln_type, defaulting to LN', () => {
    const bms = createEmptyJson('bms');
    expect(resolveChartLongNoteMode(bms)).toBe(1);
    bms.bms.lnMode = 3;
    expect(resolveChartLongNoteMode(bms)).toBe(3);
    const bmson = createEmptyJson('bmson');
    bmson.bmson.info.lnType = 2;
    expect(resolveChartLongNoteMode(bmson)).toBe(2);
    bmson.bmson.info.lnType = 7;
    expect(resolveChartLongNoteMode(bmson)).toBe(1);
  });

  test('resolveLandmineDamage reads a BMS value as a base-36 percentage', () => {
    expect(resolveLandmineDamage({ value: '0A' })).toBe(10);
    expect(resolveLandmineDamage({ value: 'ZZ' })).toBe(1295);
    expect(resolveLandmineDamage({ value: '00' })).toBe(DEFAULT_LANDMINE_DAMAGE);
    // Base 62 lowercase IDs are not a damage encoding.
    expect(resolveLandmineDamage({ value: 'az' }, 62)).toBe(DEFAULT_LANDMINE_DAMAGE);
  });

  test('resolveLandmineDamage prefers bmson damage and never reads a bmson WAV slot as damage', () => {
    expect(resolveLandmineDamage({ value: '0A', bmson: { damage: 0 } }, 36, 'bmson')).toBe(0);
    expect(resolveLandmineDamage({ value: '0A', bmson: { damage: 25 } }, 36, 'bms')).toBe(25);
    expect(resolveLandmineDamage({ value: '0A' }, 36, 'bmson')).toBe(DEFAULT_LANDMINE_DAMAGE);
  });
});
