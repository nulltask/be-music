import { describe, expect, test } from 'vite-plus/test';
import { buildKeyboardGuide, controlButtonName, keyboardKeyName } from './keyboard-guide.ts';

const markOf = (guide: ReturnType<typeof buildKeyboardGuide>, code: string) =>
  guide.marks.find((mark) => mark.code === code);
const rowOf = (guide: ReturnType<typeof buildKeyboardGuide>, id: string) =>
  [...guide.lanes, ...guide.actions].find((row) => row.id === id);

describe('buildKeyboardGuide', () => {
  test('marks the lane keys by what they are, and START / SELECT, with the default keys', () => {
    const guide = buildKeyboardGuide('play', 'lr2', {});
    expect(markOf(guide, 'KeyZ')).toMatchObject({ kind: 'white', tag: '1', title: '1P key 1' });
    expect(markOf(guide, 'KeyS')).toMatchObject({ kind: 'black', tag: '2' });
    expect(markOf(guide, 'ShiftLeft')).toMatchObject({ kind: 'scratch' });
    expect(markOf(guide, 'Space')).toMatchObject({ kind: 'scratch', title: '1P turntable ↺' });
    expect(markOf(guide, 'KeyQ')).toMatchObject({ kind: 'control', tag: 'ST' });
    expect(markOf(guide, 'KeyW')).toMatchObject({ kind: 'control', tag: 'SL' });
    expect(rowOf(guide, '1P-keys')).toMatchObject({ keys: ['Z', 'S', 'X', 'D', 'C', 'F', 'V'] });
    expect(rowOf(guide, '2P-control')).toMatchObject({ keys: ['O', 'P'], codes: ['KeyO', 'KeyP'] });
  });

  test('lists the screen’s operations on the key map with their keys, and marks the keys no lane takes', () => {
    const lr2 = buildKeyboardGuide('play', 'lr2', {});
    expect(rowOf(lr2, 'play.pause')).toMatchObject({ name: 'Pause', keys: ['Pause', 'Tab'], codes: ['Pause', 'Tab'] });
    expect(markOf(lr2, 'Pause')).toMatchObject({ kind: 'action', title: 'Pause' });
    // LR2's ↑ / ↓ step the hi-speed; beatoraja's move the lane cover and have no hi-speed row.
    expect(rowOf(lr2, 'play.hi-speed-up')).toBeDefined();
    const beatoraja = buildKeyboardGuide('play', 'beatoraja', {});
    expect(rowOf(beatoraja, 'play.hi-speed-up')).toBeUndefined();
    expect(beatoraja.actions.every((row) => row.id.startsWith('play.'))).toBe(true);
  });

  test('lights the lane keys of an operation a button takes, and names the button', () => {
    const guide = buildKeyboardGuide('select', 'lr2', {});
    const back = rowOf(guide, 'select.back');
    expect(back?.keys).toContain('1P key 2');
    expect(back?.codes).toContain('KeyS');
    // A lane key keeps its lane mark.
    expect(markOf(guide, 'KeyS')?.kind).toBe('black');
  });

  test('reads the player’s own keys and an operation’s modifiers', () => {
    const guide = buildKeyboardGuide('select', 'beatoraja', {
      laneKeys: { beat: { '11': ['a'] } },
      controlKeys: { '1P-start': ['e'] },
      actionKeys: { 'select.search': ['Slash'] },
    });
    expect(markOf(guide, 'KeyA')).toMatchObject({ kind: 'white', tag: '1' });
    expect(markOf(guide, 'KeyE')).toMatchObject({ kind: 'control', tag: 'ST' });
    expect(rowOf(guide, 'select.search')).toMatchObject({ keys: ['/'], codes: ['Slash'] });
    expect(rowOf(guide, 'select.copy-sha256')?.keys).toEqual(['Ctrl+Shift+F3']);
  });

  test('speaks Japanese', () => {
    const guide = buildKeyboardGuide('result', 'lr2', {}, 'ja');
    expect(rowOf(guide, '1P-keys')?.name).toBe('1P 鍵盤 1〜7');
    expect(rowOf(guide, 'result.retry')?.name).toBe('リトライ');
    expect(controlButtonName('2P-scratch-cw', 'ja')).toBe('2P 皿 ↻');
    expect(keyboardKeyName('ControlRight')).toBe('Right Ctrl');
  });

  test('reads a laptop’s missing keys as their Fn combinations, lights them, and marks a key no combination gives', () => {
    const windows = buildKeyboardGuide('play', 'lr2', {}, 'en', 'windows', 'laptop');
    const lift = windows.actions.find((row) => row.keys.includes('Fn+→'));
    expect(lift?.codes).toEqual(['Fn', 'ArrowRight']);
    expect(rowOf(windows, 'play.pause')?.keys).toEqual(['Pause (no key)', 'Tab']);
    const floating = windows.actions.find((row) => row.keys.includes('Fn+M'));
    expect(floating?.codes).toEqual(['Fn', 'KeyM']);
    const mac = buildKeyboardGuide('play', 'lr2', {}, 'ja', 'mac', 'laptop');
    expect(mac.actions.some((row) => row.keys.includes('Num 0 (キーなし)'))).toBe(true);
    expect(mac.actions.some((row) => row.keys.includes('fn+→'))).toBe(true);
    // A full keyboard names the keys themselves.
    expect(buildKeyboardGuide('play', 'lr2', {}).actions.some((row) => row.keys.includes('End'))).toBe(true);
  });

  test('names the keys as a Mac labels them', () => {
    const guide = buildKeyboardGuide('select', 'beatoraja', {}, 'en', 'mac');
    expect(rowOf(guide, 'select.copy-sha256')?.keys).toEqual(['⌃⇧F3']);
    expect(keyboardKeyName('AltLeft', 'mac')).toBe('Left Option');
    expect(rowOf(buildKeyboardGuide('play', 'lr2', {}, 'en', 'mac'), '1P-scratch')?.keys).toContain('Left Control');
  });
});
