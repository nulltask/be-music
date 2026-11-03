import { describe, expect, test } from 'vite-plus/test';
import {
  CONTROL_KEY_CONFIG,
  controlButtonsOfKey,
  effectiveControlKey,
  resolveControlButtons,
  resolveControlScheme,
} from './control-buttons.ts';

describe('resolveControlButtons', () => {
  test('the default keys: the 14 KEY lanes, both turntable keys of each side, and START / SELECT on Q W and O P', () => {
    const map = resolveControlButtons();
    const buttons = (code: string) => controlButtonsOfKey({ code }, map);
    expect(['KeyZ', 'KeyS', 'KeyX', 'KeyD', 'KeyC', 'KeyF', 'KeyV'].map(buttons)).toEqual([
      ['1P-key1'],
      ['1P-key2'],
      ['1P-key3'],
      ['1P-key4'],
      ['1P-key5'],
      ['1P-key6'],
      ['1P-key7'],
    ]);
    expect(['KeyB', 'KeyH', 'KeyN', 'KeyJ', 'KeyM', 'KeyK', 'Comma'].map(buttons)).toEqual([
      ['2P-key1'],
      ['2P-key2'],
      ['2P-key3'],
      ['2P-key4'],
      ['2P-key5'],
      ['2P-key6'],
      ['2P-key7'],
    ]);
    expect(buttons('ShiftLeft')).toEqual(['1P-scratch-cw']);
    expect(buttons('ControlLeft')).toEqual(['1P-scratch-ccw']);
    // LR2's default key config turns the 1P turntable down with Space too.
    expect(buttons('Space')).toEqual(['1P-scratch-ccw']);
    expect(buttons('ShiftRight')).toEqual(['2P-scratch-cw']);
    expect(buttons('ControlRight')).toEqual(['2P-scratch-ccw']);
    expect(['KeyQ', 'KeyW', 'KeyO', 'KeyP'].map(buttons)).toEqual([
      ['1P-start'],
      ['1P-select'],
      ['2P-start'],
      ['2P-select'],
    ]);
    expect(buttons('Enter')).toEqual([]);
  });

  test("the player's own keys move the buttons, and a key given to two buttons is both", () => {
    const map = resolveControlButtons({
      laneKeys: { beat: { '11': ['a'], '16': ['tab'] } },
      controlKeys: { '1P-start': ['a'], '1P-select': ['enter'] },
    });
    const buttons = (code: string) => controlButtonsOfKey({ code }, map);
    expect(buttons('KeyA')).toEqual(['1P-key1', '1P-start']);
    expect(buttons('KeyZ')).toEqual([]);
    expect(buttons('Tab')).toEqual(['1P-scratch-cw']);
    // The second key of the turntable stays.
    expect(buttons('ControlLeft')).toEqual(['1P-scratch-ccw']);
    expect(buttons('KeyQ')).toEqual([]);
    expect(buttons('Enter')).toEqual(['1P-select']);
  });
});

test('effectiveControlKey reads the player’s key, or the default', () => {
  expect(effectiveControlKey(undefined, '1P-start')).toBe('q');
  expect(effectiveControlKey({ '1P-start': ['e'] }, '1P-start')).toBe('e');
  expect(CONTROL_KEY_CONFIG.map((entry) => effectiveControlKey({}, entry.id))).toEqual(['q', 'w', 'o', 'p']);
});

test('resolveControlScheme: a skin family reads its own keys; the built-in skins read the one picked, LR2 by default', () => {
  expect(resolveControlScheme('lr2', 'beatoraja')).toBe('lr2');
  expect(resolveControlScheme('beatoraja', 'lr2')).toBe('beatoraja');
  expect(resolveControlScheme('built-in', undefined)).toBe('lr2');
  expect(resolveControlScheme('built-in', 'beatoraja')).toBe('beatoraja');
});
