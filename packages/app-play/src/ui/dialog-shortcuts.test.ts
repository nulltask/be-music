import { describe, expect, it } from 'vite-plus/test';
import {
  dialogShortcutAria,
  dialogShortcutKeys,
  dialogShortcutOf,
  isApplePlatform,
  type DialogShortcutKey,
} from './dialog-shortcuts.ts';

function press(key: string, modifiers: Partial<DialogShortcutKey> = {}): DialogShortcutKey {
  return { key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...modifiers };
}

describe('isApplePlatform', () => {
  it('names Macs and iPads', () => {
    expect(isApplePlatform('macOS')).toBe(true);
    expect(isApplePlatform('MacIntel')).toBe(true);
    expect(isApplePlatform('iPad')).toBe(true);
  });

  it('leaves the others out', () => {
    expect(isApplePlatform('Windows')).toBe(false);
    expect(isApplePlatform('Linux x86_64')).toBe(false);
    expect(isApplePlatform(undefined)).toBe(false);
  });
});

describe('dialogShortcutOf', () => {
  it('presses the primary button with Cmd+Enter on Apple devices', () => {
    expect(dialogShortcutOf(press('Enter', { metaKey: true }), true)).toBe('primary');
    expect(dialogShortcutOf(press('Enter', { ctrlKey: true }), true)).toBeUndefined();
  });

  it('presses the primary button with Ctrl+Enter elsewhere', () => {
    expect(dialogShortcutOf(press('Enter', { ctrlKey: true }), false)).toBe('primary');
    expect(dialogShortcutOf(press('Enter', { metaKey: true }), false)).toBeUndefined();
  });

  it('leaves a plain Enter to the focused control', () => {
    expect(dialogShortcutOf(press('Enter'), true)).toBeUndefined();
    expect(dialogShortcutOf(press('Enter'), false)).toBeUndefined();
  });

  it('presses the cancel button with a plain Escape', () => {
    expect(dialogShortcutOf(press('Escape'), true)).toBe('cancel');
    expect(dialogShortcutOf(press('Escape'), false)).toBe('cancel');
    expect(dialogShortcutOf(press('Escape', { ctrlKey: true }), false)).toBeUndefined();
  });

  it('ignores presses with Alt or Shift, and IME composition', () => {
    expect(dialogShortcutOf(press('Enter', { metaKey: true, shiftKey: true }), true)).toBeUndefined();
    expect(dialogShortcutOf(press('Enter', { ctrlKey: true, altKey: true }), false)).toBeUndefined();
    expect(dialogShortcutOf(press('Enter', { metaKey: true, isComposing: true }), true)).toBeUndefined();
    expect(dialogShortcutOf(press('Escape', { isComposing: true }), true)).toBeUndefined();
  });

  it('presses a button by its letter, whatever the case', () => {
    expect(dialogShortcutOf(press('w'), true)).toBe('w');
    expect(dialogShortcutOf(press('P'), false)).toBe('p');
  });

  it('leaves a letter to the field being typed in', () => {
    expect(dialogShortcutOf(press('w'), true, true)).toBeUndefined();
  });

  it('leaves a letter with Cmd, Ctrl or Shift to the browser', () => {
    expect(dialogShortcutOf(press('r', { metaKey: true }), true)).toBeUndefined();
    expect(dialogShortcutOf(press('r', { ctrlKey: true }), false)).toBeUndefined();
    expect(dialogShortcutOf(press('R', { shiftKey: true }), false)).toBeUndefined();
  });

  it('ignores other keys', () => {
    expect(dialogShortcutOf(press('1'), true)).toBeUndefined();
    expect(dialogShortcutOf(press('ArrowUp'), true)).toBeUndefined();
    expect(dialogShortcutOf(press(' '), true)).toBeUndefined();
  });
});

describe('dialogShortcutKeys', () => {
  it('draws the platform modifier and the return key for the primary button', () => {
    expect(dialogShortcutKeys('primary', true)).toEqual(['⌘', '↵']);
    expect(dialogShortcutKeys('primary', false)).toEqual(['Ctrl', '↵']);
  });

  it('draws Esc for the cancel button', () => {
    expect(dialogShortcutKeys('cancel', true)).toEqual(['Esc']);
    expect(dialogShortcutKeys('cancel', false)).toEqual(['Esc']);
  });

  it('draws a letter in capitals', () => {
    expect(dialogShortcutKeys('l', true)).toEqual(['L']);
  });
});

describe('dialogShortcutAria', () => {
  it('names the keys as aria-keyshortcuts does', () => {
    expect(dialogShortcutAria('primary', true)).toBe('Meta+Enter');
    expect(dialogShortcutAria('primary', false)).toBe('Control+Enter');
    expect(dialogShortcutAria('cancel', true)).toBe('Escape');
    expect(dialogShortcutAria('b', false)).toBe('B');
  });
});
