import { describe, expect, it } from 'vite-plus/test';
import { resolveBeMusicSkinSettings, validateBeMusicSkinSettings, type BeMusicSkinSetting } from './settings.ts';

const THEME: BeMusicSkinSetting = {
  kind: 'choice',
  id: 'theme',
  label: 'Theme',
  options: [
    { value: 'neon', label: 'Neon' },
    { value: 'mono', label: 'Mono' },
  ],
  default: 'neon',
};
const OFFSET: BeMusicSkinSetting = {
  kind: 'number',
  id: 'judgeOffset',
  label: 'Judgment offset',
  min: -40,
  max: 40,
  step: 2,
  default: 0,
  unit: 'px',
};
const GLOW: BeMusicSkinSetting = { kind: 'toggle', id: 'glow', label: 'Glow', default: true };
const SETTINGS = [THEME, OFFSET, GLOW] as const;

describe('resolveBeMusicSkinSettings', () => {
  it('uses the defaults when nothing is stored', () => {
    expect(resolveBeMusicSkinSettings({ settings: SETTINGS })).toEqual({ theme: 'neon', judgeOffset: 0, glow: true });
  });

  it('is empty for a skin without settings', () => {
    expect(resolveBeMusicSkinSettings({}, { theme: 'mono' })).toEqual({});
  });

  it('keeps valid stored values', () => {
    expect(
      resolveBeMusicSkinSettings({ settings: SETTINGS }, { theme: 'mono', judgeOffset: -12, glow: false }),
    ).toEqual({ theme: 'mono', judgeOffset: -12, glow: false });
  });

  it('clamps stored numbers into the range', () => {
    expect(resolveBeMusicSkinSettings({ settings: SETTINGS }, { judgeOffset: 99 }).judgeOffset).toBe(40);
    expect(resolveBeMusicSkinSettings({ settings: SETTINGS }, { judgeOffset: -99 }).judgeOffset).toBe(-40);
  });

  it('falls back to the default for stale or mistyped values', () => {
    expect(
      resolveBeMusicSkinSettings({ settings: SETTINGS }, { theme: 'retired', judgeOffset: Number.NaN, glow: 'yes' }),
    ).toEqual({ theme: 'neon', judgeOffset: 0, glow: true });
    expect(resolveBeMusicSkinSettings({ settings: SETTINGS }, { theme: 1, judgeOffset: '4', glow: 0 })).toEqual({
      theme: 'neon',
      judgeOffset: 0,
      glow: true,
    });
  });

  it('drops stored keys the schema no longer declares', () => {
    expect(resolveBeMusicSkinSettings({ settings: [GLOW] }, { glow: false, removed: 3 })).toEqual({ glow: false });
  });
});

describe('validateBeMusicSkinSettings', () => {
  it('passes a well-formed schema, and no schema', () => {
    expect(validateBeMusicSkinSettings(SETTINGS)).toEqual([]);
    expect(validateBeMusicSkinSettings(undefined)).toEqual([]);
    expect(validateBeMusicSkinSettings([])).toEqual([]);
  });

  it('reports duplicate and empty ids and empty labels', () => {
    expect(validateBeMusicSkinSettings([GLOW, { ...GLOW, label: 'Glow 2' }])).toEqual([
      'setting "glow": id is used more than once',
    ]);
    expect(validateBeMusicSkinSettings([{ ...GLOW, id: '' }])).toEqual(['settings[0]: id must not be empty']);
    expect(validateBeMusicSkinSettings([{ ...GLOW, label: ' ' }])).toEqual(['setting "glow": label must not be empty']);
  });

  it('checks choice options and defaults', () => {
    expect(validateBeMusicSkinSettings([{ ...THEME, options: [] }] as BeMusicSkinSetting[])).toEqual([
      'setting "theme": options must not be empty',
    ]);
    expect(validateBeMusicSkinSettings([{ ...THEME, default: 'gold' } as BeMusicSkinSetting])).toEqual([
      'setting "theme": default "gold" is not one of the option values',
    ]);
    expect(
      validateBeMusicSkinSettings([
        {
          ...THEME,
          options: [
            { value: 'neon', label: 'Neon' },
            { value: 'neon', label: 'Neon again' },
          ],
        } as BeMusicSkinSetting,
      ]),
    ).toEqual(['setting "theme": option values must be unique']);
  });

  it('checks number ranges, steps, and units', () => {
    expect(validateBeMusicSkinSettings([{ ...OFFSET, default: 50 } as BeMusicSkinSetting])).toEqual([
      'setting "judgeOffset": default 50 is outside -40..40',
    ]);
    expect(validateBeMusicSkinSettings([{ ...OFFSET, min: 10, max: 0 } as BeMusicSkinSetting])).toEqual([
      'setting "judgeOffset": min and max must be finite numbers with min <= max',
    ]);
    expect(validateBeMusicSkinSettings([{ ...OFFSET, step: 0 } as BeMusicSkinSetting])).toEqual([
      'setting "judgeOffset": step must be a positive number',
    ]);
    expect(validateBeMusicSkinSettings([{ ...OFFSET, unit: 'em' } as unknown as BeMusicSkinSetting])).toEqual([
      'setting "judgeOffset": unit "em" must be one of px, ms, %',
    ]);
  });

  it('checks toggle defaults and unknown kinds', () => {
    expect(validateBeMusicSkinSettings([{ ...GLOW, default: 'on' } as unknown as BeMusicSkinSetting])).toEqual([
      'setting "glow": default must be a boolean',
    ]);
    expect(validateBeMusicSkinSettings([{ ...GLOW, kind: 'color' } as unknown as BeMusicSkinSetting])).toEqual([
      'setting "glow": kind "color" must be choice, number, or toggle',
    ]);
  });
});
