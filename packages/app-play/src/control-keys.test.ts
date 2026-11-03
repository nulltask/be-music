import { describe, expect, test } from 'vite-plus/test';
import { assignControlKey, parseControlKeys } from './control-keys.ts';

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
