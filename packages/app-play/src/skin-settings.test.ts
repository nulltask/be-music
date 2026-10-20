import { describe, expect, it } from 'vite-plus/test';
import type { BeMusicSkinSetting } from '@be-music/player-skin-sdk';
import {
  describeSkinSettingControllers,
  parseStoredSkinSettings,
  serializeStoredSkinSettings,
  setStoredSkinSetting,
  type StoredSkinSettings,
  type StoredSkinSettingValue,
} from './skin-settings.ts';

const SCHEMA: readonly BeMusicSkinSetting[] = [
  {
    kind: 'choice',
    id: 'theme',
    label: 'Theme',
    options: [
      { value: 'dark', label: 'Dark' },
      { value: 'light', label: 'Light' },
    ],
    default: 'dark',
  },
  { kind: 'number', id: 'offset', label: 'Judgment offset', min: -40, max: 40, step: 2, default: 0, unit: 'px' },
  { kind: 'number', id: 'opacity', label: 'Opacity', min: 0, max: 1, default: 1 },
  { kind: 'toggle', id: 'glow', label: 'Glow', default: true },
];

describe('parseStoredSkinSettings', () => {
  it('round-trips what serializeStoredSkinSettings writes', () => {
    const settings: StoredSkinSettings = new Map<string, Record<string, StoredSkinSettingValue>>([
      ['synesthesia', { theme: 'light', offset: -12, glow: false }],
      ['lattice', {}],
    ]);
    expect(parseStoredSkinSettings(serializeStoredSkinSettings(settings))).toEqual(settings);
  });

  it('stores values per skin id under a versioned map', () => {
    const settings: StoredSkinSettings = new Map<string, Record<string, StoredSkinSettingValue>>([
      ['phantom', { glow: true }],
    ]);
    expect(JSON.parse(serializeStoredSkinSettings(settings))).toEqual({
      version: 1,
      skins: { phantom: { glow: true } },
    });
  });

  it('drops values that are not a string, a finite number, or a boolean', () => {
    const raw = JSON.stringify({
      version: 1,
      skins: { a: { ok: 'x', n: 3, b: false, nested: { x: 1 }, list: [1], nil: null }, broken: 'nope', arr: [1] },
    });
    expect(parseStoredSkinSettings(raw)).toEqual(new Map([['a', { ok: 'x', n: 3, b: false }]]));
  });

  it('yields nothing for missing, malformed, or other-version data', () => {
    expect(parseStoredSkinSettings(null).size).toBe(0);
    expect(parseStoredSkinSettings('{').size).toBe(0);
    expect(parseStoredSkinSettings('"text"').size).toBe(0);
    expect(parseStoredSkinSettings(JSON.stringify({ version: 2, skins: { a: { x: 1 } } })).size).toBe(0);
  });
});

describe('setStoredSkinSetting', () => {
  it('merges one value into the skin entry without touching other skins', () => {
    const settings: StoredSkinSettings = new Map<string, Record<string, StoredSkinSettingValue>>([
      ['a', { theme: 'light' }],
      ['b', { glow: false }],
    ]);
    const before = settings.get('a');
    const values = setStoredSkinSetting(settings, 'a', 'offset', 8);
    expect(values).toEqual({ theme: 'light', offset: 8 });
    expect(settings.get('a')).toBe(values);
    expect(before).toEqual({ theme: 'light' });
    expect(settings.get('b')).toEqual({ glow: false });
  });

  it('starts an entry for a skin with nothing stored', () => {
    const settings: StoredSkinSettings = new Map();
    expect(setStoredSkinSetting(settings, 'new', 'glow', true)).toEqual({ glow: true });
  });
});

describe('describeSkinSettingControllers', () => {
  it('maps each setting kind to its controller, in declaration order', () => {
    expect(describeSkinSettingControllers(SCHEMA)).toEqual([
      { kind: 'dropdown', id: 'theme', name: 'Theme', options: { Dark: 'dark', Light: 'light' } },
      { kind: 'slider', id: 'offset', name: 'Judgment offset (px)', min: -40, max: 40, step: 2 },
      { kind: 'slider', id: 'opacity', name: 'Opacity', min: 0, max: 1, step: undefined },
      { kind: 'checkbox', id: 'glow', name: 'Glow' },
    ]);
  });

  it('keeps options with a repeated label pickable', () => {
    const [controller] = describeSkinSettingControllers([
      {
        kind: 'choice',
        id: 'c',
        label: 'C',
        options: [
          { value: 'a', label: 'Same' },
          { value: 'b', label: 'Same' },
        ],
        default: 'a',
      },
    ]);
    expect(controller).toEqual({ kind: 'dropdown', id: 'c', name: 'C', options: { Same: 'a', 'Same (b)': 'b' } });
  });

  it('describes nothing for a skin without settings', () => {
    expect(describeSkinSettingControllers(undefined)).toEqual([]);
    expect(describeSkinSettingControllers([])).toEqual([]);
  });
});
