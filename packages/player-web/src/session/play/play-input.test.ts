import { describe, expect, test } from 'vite-plus/test';
import { PLAY_SCENE_KEY_CODES, shouldSkipPlayKey } from './play-input.ts';

function keyEvent(code: string, target?: { tagName?: string; isContentEditable?: boolean }): KeyboardEvent {
  return { code, target: target ?? null } as unknown as KeyboardEvent;
}

describe('PLAY_SCENE_KEY_CODES', () => {
  test('lists the keys the play scene handles itself', () => {
    expect([...PLAY_SCENE_KEY_CODES].sort()).toEqual(['ArrowDown', 'ArrowUp', 'Backspace', 'Escape', 'F5', 'Space']);
  });
});

describe('shouldSkipPlayKey', () => {
  test('skips the keys the play scene handles itself', () => {
    for (const code of PLAY_SCENE_KEY_CODES) {
      expect(shouldSkipPlayKey(keyEvent(code))).toBe(true);
    }
  });

  test('lets lane keys through', () => {
    for (const code of ['KeyZ', 'KeyS', 'ShiftLeft', 'Digit1', 'ArrowLeft', 'Enter']) {
      expect(shouldSkipPlayKey(keyEvent(code))).toBe(false);
    }
  });

  test('skips a key typed into a text field', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
      expect(shouldSkipPlayKey(keyEvent('KeyZ', { tagName }))).toBe(true);
    }
    expect(shouldSkipPlayKey(keyEvent('KeyZ', { tagName: 'DIV', isContentEditable: true }))).toBe(true);
    expect(shouldSkipPlayKey(keyEvent('KeyZ', { tagName: 'CANVAS' }))).toBe(false);
  });
});
