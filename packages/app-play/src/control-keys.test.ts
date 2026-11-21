import { describe, expect, test } from 'vite-plus/test';
import type { ControlActionOverrides } from '@be-music/player-browser/host';
import { assignControlKey, overwriteActionKeysWithScheme, parseActionKeys, parseControlKeys } from './control-keys.ts';

describe('parseControlKeys', () => {
  test('keeps the known START / SELECT ids with keys, and drops the rest', () => {
    expect(
      parseControlKeys({ '1P-start': ['tab'], '1P-select': [], '2P-start': [3, 'o'], bogus: ['x'], '2P-select': 'p' }),
    ).toEqual({ '1P-start': ['tab'], '2P-start': ['o'] });
    expect(parseControlKeys(null)).toEqual({});
    expect(parseControlKeys(['q'])).toEqual({});
  });
});

describe('assignControlKey', () => {
  test('gives the key, keeping no entry for a key back on its default', () => {
    const keys = assignControlKey({}, '1P-start', 'tab');
    expect(keys).toEqual({ '1P-start': ['tab'] });
    expect(assignControlKey(keys, '1P-start', 'q')).toEqual({});
  });

  test('a key another button has moves over, and that one takes this one’s', () => {
    // SELECT takes Q from START, and START takes W.
    expect(assignControlKey({}, '1P-select', 'q')).toEqual({ '1P-start': ['w'], '1P-select': ['q'] });
  });

  test('an unknown id or an empty key changes nothing', () => {
    expect(assignControlKey({}, 'bogus' as '1P-start', 'tab')).toEqual({});
    expect(assignControlKey({ '1P-start': ['tab'] }, '1P-start', '')).toEqual({ '1P-start': ['tab'] });
  });
});

describe('parseActionKeys', () => {
  test('keeps the known operations with key codes, and drops the rest', () => {
    expect(
      parseActionKeys({
        'select.activate': ['KeyE', 3, ''],
        'play.pause': [],
        'bogus.op': ['KeyX'],
        'play.quit': 'F2',
      }),
    ).toEqual({ 'select.activate': ['KeyE'] });
    expect(parseActionKeys(undefined)).toEqual({});
  });
});

describe('overwriteActionKeysWithScheme', () => {
  test("drops the player's keys for every operation the picked key map has, keeping the other key map's own", () => {
    const keys = {
      'global.fullscreen': ['F11'],
      'select.page-down': ['KeyN'],
      'play.hi-speed-up': ['KeyU'],
    } as ControlActionOverrides;
    // beatoraja has full screen and paging; hi-speed up is LR2's alone.
    expect(overwriteActionKeysWithScheme(keys, 'beatoraja')).toEqual({ 'play.hi-speed-up': ['KeyU'] });
    // LR2 has full screen and hi-speed up; paging is beatoraja's alone.
    expect(overwriteActionKeysWithScheme(keys, 'lr2')).toEqual({ 'select.page-down': ['KeyN'] });
  });

  test('returns the keys themselves when nothing changes', () => {
    const keys = { 'select.page-down': ['KeyN'] } as ControlActionOverrides;
    expect(overwriteActionKeysWithScheme(keys, 'lr2')).toBe(keys);
    const none = {} as ControlActionOverrides;
    expect(overwriteActionKeysWithScheme(none, 'beatoraja')).toBe(none);
  });
});
