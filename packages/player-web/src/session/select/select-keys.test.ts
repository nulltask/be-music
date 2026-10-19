import { describe, expect, it } from 'vite-plus/test';
import type { SessionKeyEvent } from '../session-scene.ts';
import {
  READTEXT_LINE_SCROLL,
  READTEXT_PAGE_SCROLL,
  resolveSelectKeyAction,
  SELECT_PAGE_BARS,
  type SelectKeyState,
} from './select-keys.ts';

function down(code: string, key = code): SessionKeyEvent {
  return {
    type: 'down',
    code,
    key,
    repeat: false,
    timeStamp: 0,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
  };
}

const LIST: SelectKeyState = { panel: undefined, readTextOpen: false };

describe('resolveSelectKeyAction', () => {
  it('moves, takes and backs out on the list', () => {
    expect(resolveSelectKeyAction(down('ArrowDown'), LIST)).toEqual({ type: 'step', direction: 1 });
    expect(resolveSelectKeyAction(down('ArrowUp'), LIST)).toEqual({ type: 'step', direction: -1 });
    expect(resolveSelectKeyAction(down('Enter'), LIST)).toEqual({ type: 'activate' });
    for (const key of ['Escape', 'Backspace', 'ArrowLeft']) {
      expect(resolveSelectKeyAction(down(key), LIST)).toEqual({ type: 'back' });
    }
    expect(resolveSelectKeyAction(down('KeyZ', 'z'), LIST)).toBeUndefined();
    expect(resolveSelectKeyAction({ ...down('Enter'), type: 'up' }, LIST)).toBeUndefined();
  });

  it('toggles the play-options panel on Space, and closes an open panel on Escape', () => {
    expect(resolveSelectKeyAction(down('Space', ' '), LIST)).toEqual({ type: 'panel', panel: 1 });
    expect(resolveSelectKeyAction(down('Escape'), { panel: 3, readTextOpen: false })).toEqual({
      type: 'panel',
      panel: 3,
    });
  });

  it('steps the play options on the 1P lane keys while the play-options panel is open', () => {
    const panel: SelectKeyState = { panel: 1, readTextOpen: false };
    expect(resolveSelectKeyAction(down('KeyZ', 'z'), panel)).toEqual({ type: 'play-option', key: 'dpFlip', step: 1 });
    expect(resolveSelectKeyAction(down('KeyS', 's'), panel)).toEqual({ type: 'play-option', key: 'random1P', step: 1 });
    expect(resolveSelectKeyAction(down('KeyX', 'x'), panel)).toEqual({ type: 'play-option', key: 'random2P', step: 1 });
    expect(resolveSelectKeyAction(down('KeyD', 'd'), panel)).toEqual({ type: 'play-option', key: 'gauge1P', step: 1 });
    expect(resolveSelectKeyAction(down('KeyC', 'c'), panel)).toEqual({ type: 'play-option', key: 'hiSpeed', step: -1 });
    expect(resolveSelectKeyAction(down('KeyF', 'f'), panel)).toEqual({
      type: 'play-option',
      key: 'autoScratch1P',
      step: 1,
    });
    expect(resolveSelectKeyAction(down('KeyV', 'v'), panel)).toEqual({ type: 'play-option', key: 'hiSpeed', step: 1 });
    // Another panel leaves the lane keys alone.
    expect(resolveSelectKeyAction(down('KeyV', 'v'), { panel: 2, readTextOpen: false })).toBeUndefined();
  });

  it('gives the README overlay the keyboard while it is open', () => {
    const open: SelectKeyState = { panel: undefined, readTextOpen: true };
    expect(resolveSelectKeyAction(down('Enter'), open)).toEqual({ type: 'readtext-close' });
    expect(resolveSelectKeyAction(down('Backspace'), open)).toEqual({ type: 'readtext-close' });
    expect(resolveSelectKeyAction(down('ArrowDown'), open)).toEqual({
      type: 'readtext-scroll',
      delta: READTEXT_LINE_SCROLL,
    });
    expect(resolveSelectKeyAction(down('PageUp'), open)).toEqual({
      type: 'readtext-scroll',
      delta: -READTEXT_PAGE_SCROLL,
    });
    expect(resolveSelectKeyAction(down('End'), open)).toEqual({
      type: 'readtext-scroll',
      delta: Number.MAX_SAFE_INTEGER,
    });
    expect(resolveSelectKeyAction(down('Escape'), open)).toEqual({ type: 'swallow' });
    // Space still toggles the play-options panel, as it always did.
    expect(resolveSelectKeyAction(down('Space', ' '), open)).toEqual({ type: 'panel', panel: 1 });
  });
});

describe('resolveSelectKeyAction on the beatoraja key map', () => {
  const resolve = (event: SessionKeyEvent, state: SelectKeyState = LIST) =>
    resolveSelectKeyAction(event, state, 'beatoraja');

  it('moves a bar or a page, jumps to either end and picks a random bar', () => {
    expect(resolve(down('ArrowDown'))).toEqual({ type: 'step', direction: 1 });
    expect(resolve(down('ArrowUp'))).toEqual({ type: 'step', direction: -1 });
    expect(resolve(down('PageDown'))).toEqual({
      type: 'browse',
      command: { type: 'move', delta: SELECT_PAGE_BARS },
    });
    expect(resolve(down('PageUp'))).toEqual({ type: 'browse', command: { type: 'move', delta: -SELECT_PAGE_BARS } });
    expect(resolve(down('Home'))).toEqual({ type: 'browse', command: { type: 'jump', index: 0 } });
    expect(resolve(down('End'))).toEqual({
      type: 'browse',
      command: { type: 'jump', index: Number.MAX_SAFE_INTEGER },
    });
    expect(resolve(down('KeyR', 'r'))).toEqual({ type: 'random' });
    expect(resolve(down('KeyR', 'R'))).toEqual({ type: 'random' });
    expect(resolve({ ...down('KeyR', 'r'), ctrlKey: true })).toBeUndefined();
  });

  it('takes the bar on Enter, backs out on Escape, and backs out of a folder only on Backspace', () => {
    expect(resolve(down('Enter'))).toEqual({ type: 'activate' });
    expect(resolve(down('Escape'))).toEqual({ type: 'back' });
    expect(resolve(down('Backspace'))).toEqual({ type: 'back', inFolder: true });
    expect(resolve(down('ArrowLeft'))).toBeUndefined();
  });

  it('has no option panel, and gives the README overlay the keyboard while it is open', () => {
    expect(resolve(down('Space', ' '))).toBeUndefined();
    expect(resolve(down('KeyZ', 'z'), { panel: 1, readTextOpen: false })).toBeUndefined();
    const open: SelectKeyState = { panel: undefined, readTextOpen: true };
    expect(resolve(down('Enter'), open)).toEqual({ type: 'readtext-close' });
    expect(resolve(down('PageDown'), open)).toEqual({ type: 'readtext-scroll', delta: READTEXT_PAGE_SCROLL });
    expect(resolve(down('KeyR', 'r'), open)).toEqual({ type: 'swallow' });
  });
});
