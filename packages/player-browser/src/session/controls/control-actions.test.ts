import { describe, expect, test } from 'vite-plus/test';
import {
  CONTROL_ACTIONS,
  controlActionKeys,
  resolveControlActions,
  resolveFamilyControlActions,
} from './control-actions.ts';

describe('CONTROL_ACTIONS', () => {
  test('every operation has a unique id, a label and keys on at least one key map', () => {
    const ids = CONTROL_ACTIONS.map((action) => action.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const action of CONTROL_ACTIONS) {
      expect(action.label).not.toBe('');
      expect(Object.keys(action.defaults).length).toBeGreaterThan(0);
    }
  });
});

describe('resolveControlActions', () => {
  test('takes the key map’s default keys, and none of an operation the map lacks', () => {
    const lr2 = resolveControlActions('lr2');
    const beatoraja = resolveControlActions('beatoraja');
    expect(lr2.is('select.back', { code: 'Backspace' })).toBe(true);
    expect(beatoraja.is('select.back', { code: 'Backspace' })).toBe(false);
    expect(beatoraja.is('select.close-folder', { code: 'Backspace' })).toBe(true);
    expect(lr2.is('select.page-down', { code: 'PageDown' })).toBe(false);
    expect(beatoraja.is('select.page-down', { code: 'PageDown' })).toBe(true);
  });

  test('a default button key moves with the player’s buttons', () => {
    const lr2 = resolveControlActions('lr2');
    expect(lr2.is('select.option-panel', { code: 'KeyA', buttons: ['1P-start'] })).toBe(true);
    expect(lr2.is('select.option-panel', { code: 'KeyQ', buttons: [] })).toBe(false);
  });

  test('the player’s keys take the place of the defaults, on the key maps that have the operation', () => {
    const overrides = { 'select.activate': ['KeyE'], 'select.page-down': ['KeyN'] } as const;
    const lr2 = resolveControlActions('lr2', overrides);
    expect(lr2.is('select.activate', { code: 'KeyE' })).toBe(true);
    expect(lr2.is('select.activate', { code: 'Enter' })).toBe(false);
    expect(lr2.codes('select.activate')).toEqual(['KeyE']);
    // LR2 has no ten-bar move, so the player's key for it does nothing there.
    expect(lr2.is('select.page-down', { code: 'KeyN' })).toBe(false);
    expect(controlActionKeys('select.page-down', 'beatoraja', overrides)).toEqual([{ code: 'KeyN' }]);
  });

  test('a bare operation is not taken with Ctrl, Alt or ⌘, and not with Shift when it says so', () => {
    const actions = resolveControlActions('beatoraja');
    expect(actions.is('select.random', { code: 'KeyR' })).toBe(true);
    expect(actions.is('select.random', { code: 'KeyR', ctrlKey: true })).toBe(false);
    expect(actions.is('select.random', { code: 'KeyR', metaKey: true })).toBe(false);
    expect(actions.is('select.random', { code: 'KeyR', shiftKey: true })).toBe(true);
    expect(actions.is('result.retry', { code: 'KeyR', shiftKey: true })).toBe(false);
    // An operation that is not bare takes its key with modifiers.
    expect(actions.is('select.down', { code: 'ArrowDown', ctrlKey: true })).toBe(true);
  });

  test('a navigation key is taken by its value too, as a compact keyboard’s Fn + arrow sends it', () => {
    const actions = resolveControlActions('lr2');
    expect(actions.is('play.sudden-down', { code: 'ArrowDown', key: 'PageDown' })).toBe(true);
    expect(actions.is('play.sudden-down', { code: 'KeyP', key: 'p' })).toBe(false);
  });
});

test('resolveFamilyControlActions reads a family’s key map, and the built-in skins’ picked one', () => {
  expect(resolveFamilyControlActions('beatoraja', { builtInScheme: 'lr2' }).scheme).toBe('beatoraja');
  expect(resolveFamilyControlActions('built-in', undefined).scheme).toBe('lr2');
  expect(resolveFamilyControlActions('built-in', { builtInScheme: 'beatoraja' }).scheme).toBe('beatoraja');
  expect(
    resolveFamilyControlActions('lr2', { actionKeys: { 'decide.continue': ['KeyQ'] } }).is('decide.continue', {
      code: 'KeyQ',
    }),
  ).toBe(true);
});
