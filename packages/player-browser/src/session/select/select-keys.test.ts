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
    // The white keys take the bar and the black keys back out, as in LR2 and That-Which-Must-Not-Be-Named PC.
    for (const code of ['KeyZ', 'KeyX', 'KeyC', 'KeyV']) {
      expect(resolveSelectKeyAction(down(code), LIST)).toEqual({ type: 'activate' });
    }
    expect(resolveSelectKeyAction(down('KeyS'), LIST)).toEqual({ type: 'back' });
    // Key 4 backs out on a tap and opens the ranking when held (the session times it), and F3 holds the level edit.
    expect(resolveSelectKeyAction(down('KeyD'), LIST)).toEqual({ type: 'ranking' });
    expect(resolveSelectKeyAction(down('F3'), LIST)).toEqual({ type: 'level-edit' });
    // The turntable scrolls: turned down (its second key) to the next bar.
    expect(resolveSelectKeyAction(down('ShiftLeft'), LIST)).toEqual({ type: 'step', direction: -1 });
    expect(resolveSelectKeyAction(down('ControlLeft'), LIST)).toEqual({ type: 'step', direction: 1 });
    expect(resolveSelectKeyAction(down('ArrowRight'), LIST)).toEqual({ type: 'open-folder' });
    expect(resolveSelectKeyAction(down('KeyF'), LIST)).toEqual({ type: 'auto' });
    expect(resolveSelectKeyAction(down('Digit2'), LIST)).toEqual({ type: 'list', option: 'sort' });
    expect(resolveSelectKeyAction(down('Digit3'), LIST)).toEqual({ type: 'list', option: 'keysFilter' });
    expect(resolveSelectKeyAction(down('Digit0'), LIST)).toEqual({ type: 'search' });
    expect(resolveSelectKeyAction(down('Tab'), LIST)).toEqual({ type: 'panel', panel: 1 });
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
    expect(resolveSelectKeyAction(down('KeyZ', 'z'), panel)).toEqual({
      type: 'play-option',
      key: 'keysFilter',
      step: 1,
    });
    expect(resolveSelectKeyAction(down('KeyS', 's'), panel)).toEqual({ type: 'play-option', key: 'random1P', step: 1 });
    expect(resolveSelectKeyAction(down('KeyX', 'x'), panel)).toEqual({
      type: 'play-option',
      key: 'battleMode',
      step: 1,
    });
    // With a double-play filter, key 3 is DP FLIP, as in LR2.
    expect(resolveSelectKeyAction(down('KeyX', 'x'), { ...panel, doublePlayFilter: true })).toEqual({
      type: 'play-option',
      key: 'dpFlip',
      step: 1,
    });
    expect(resolveSelectKeyAction(down('KeyD', 'd'), panel)).toEqual({ type: 'play-option', key: 'gauge1P', step: 1 });
    expect(resolveSelectKeyAction(down('KeyC', 'c'), panel)).toEqual({ type: 'play-option', key: 'hiSpeed', step: -1 });
    expect(resolveSelectKeyAction(down('KeyF', 'f'), panel)).toEqual({
      type: 'play-option',
      key: 'autoScratch1P',
      step: 1,
    });
    expect(resolveSelectKeyAction(down('KeyV', 'v'), panel)).toEqual({ type: 'play-option', key: 'hiSpeed', step: 1 });
    // Another panel leaves the lane keys to the list: key 7 takes the bar.
    expect(resolveSelectKeyAction(down('KeyV', 'v'), { panel: 2, readTextOpen: false })).toEqual({ type: 'activate' });
  });

  it('gives the README dialog the keyboard while it is open', () => {
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
    expect(resolveSelectKeyAction(down('Escape'), open)).toEqual({ type: 'readtext-close' });
    expect(resolveSelectKeyAction(down('KeyA', 'a'), open)).toEqual({ type: 'swallow' });
    // Space still toggles the play-options panel, as it always did.
    expect(resolveSelectKeyAction(down('Space', ' '), open)).toEqual({ type: 'panel', panel: 1 });
  });
});

describe('resolveSelectKeyAction on F2', () => {
  it('opens LR2’s mania options on the LR2 key map and reloads the folders on beatoraja’s', () => {
    const f2 = down('F2');
    expect(resolveSelectKeyAction(f2, LIST, 'lr2')).toEqual({ type: 'mania-options' });
    expect(resolveSelectKeyAction(f2, LIST, 'beatoraja')).toEqual({ type: 'reload' });
  });
});

describe('resolveSelectKeyAction on the player’s control buttons', () => {
  const OPEN: SelectKeyState = { panel: 1, readTextOpen: false };

  it('opens the panel on START, Q by default', () => {
    expect(resolveSelectKeyAction(down('KeyQ', 'q'), LIST)).toEqual({ type: 'panel', panel: 1 });
    expect(resolveSelectKeyAction({ ...down('Tab'), buttons: ['1P-start'] }, LIST)).toEqual({
      type: 'panel',
      panel: 1,
    });
  });

  it('steps the panel options on the 1P keys wherever the player put them', () => {
    expect(resolveSelectKeyAction({ ...down('KeyA', 'a'), buttons: ['1P-key2'] }, OPEN)).toEqual({
      type: 'play-option',
      key: 'random1P',
      step: 1,
    });
    // Z moved off key 1, so it steps nothing.
    expect(resolveSelectKeyAction({ ...down('KeyZ', 'z'), buttons: [] }, OPEN)).toBeUndefined();
  });

  it('takes beatoraja’s NEXT_REPLAY and REPLAY from the 1P keys 6 and 7', () => {
    expect(resolveSelectKeyAction({ ...down('KeyJ', 'j'), buttons: ['1P-key6'] }, LIST, 'beatoraja')).toEqual({
      type: 'replay-slot',
      step: 1,
    });
    expect(resolveSelectKeyAction({ ...down('KeyK', 'k'), buttons: ['1P-key7'] }, LIST, 'beatoraja')).toEqual({
      type: 'replay',
    });
    expect(resolveSelectKeyAction({ ...down('KeyV', 'v'), buttons: [] }, LIST, 'beatoraja')).toBeUndefined();
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
    // ← and the black keys close a folder, and the turntable scrolls: turned up (its second key) to the previous bar.
    expect(resolve(down('ArrowLeft'))).toEqual({ type: 'back', inFolder: true });
    expect(resolve(down('KeyS'))).toEqual({ type: 'back', inFolder: true });
    expect(resolve(down('ShiftLeft'))).toEqual({ type: 'step', direction: 1 });
    expect(resolve(down('ControlLeft'))).toEqual({ type: 'step', direction: -1 });
    // Key 1 plays, key 3 opens a folder, key 5 is AUTO; → plays too.
    expect(resolve(down('KeyZ'))).toEqual({ type: 'activate' });
    expect(resolve(down('ArrowRight'))).toEqual({ type: 'activate' });
    expect(resolve(down('KeyX'))).toEqual({ type: 'open-folder' });
    expect(resolve(down('KeyC'))).toEqual({ type: 'auto' });
    expect(resolve(down('Digit1'))).toEqual({ type: 'list', option: 'keysFilter' });
    expect(resolve(down('Digit2'))).toEqual({ type: 'list', option: 'sort' });
    expect(resolve(down('Digit3'))).toEqual({ type: 'ln-mode' });
    // AC 34's numpad 7 and 6, on both key maps.
    expect(resolve(down('Numpad7'))).toEqual({ type: 'battle' });
    expect(resolve(down('Numpad6'))).toEqual({ type: 'm-ran', side: '1P' });
    expect(resolve({ ...down('Numpad6'), shiftKey: true })).toEqual({ type: 'm-ran', side: '2P' });
    expect(resolve(down('F8'))).toEqual({ type: 'favorite', list: 'music' });
    expect(resolve(down('F9'))).toEqual({ type: 'favorite', list: 'charts' });
  });

  it('steps its option panels on the 1P keys, and gives the README dialog the keyboard while it is open', () => {
    // Space is the 1P turntable's second key, which scrolls up here.
    expect(resolve(down('Space', ' '))).toEqual({ type: 'step', direction: -1 });
    // START, SELECT and 5 open beatoraja's panels 1 to 3, whose 1P keys step their options.
    expect(resolve(down('KeyQ', 'q'))).toEqual({ type: 'panel', panel: 1 });
    expect(resolve(down('KeyW', 'w'))).toEqual({ type: 'panel', panel: 2 });
    expect(resolve(down('Digit5', '5'))).toEqual({ type: 'panel', panel: 3 });
    expect(resolve(down('KeyZ', 'z'), { panel: 1, readTextOpen: false })).toEqual({
      type: 'play-option',
      key: 'random1P',
      step: 1,
    });
    expect(resolve(down('KeyS', 's'), { panel: 2, readTextOpen: false })).toEqual({
      type: 'play-option',
      key: 'visualConstant',
      step: 1,
    });
    expect(resolve(down('KeyV', 'v'), { panel: 3, readTextOpen: false })).toEqual({
      type: 'play-option',
      key: 'judgeTimingMs',
      step: 1,
    });
    expect(resolve(down('Escape'), { panel: 2, readTextOpen: false })).toEqual({ type: 'panel', panel: 2 });
    const open: SelectKeyState = { panel: undefined, readTextOpen: true };
    expect(resolve(down('Enter'), open)).toEqual({ type: 'readtext-close' });
    expect(resolve(down('PageDown'), open)).toEqual({ type: 'readtext-scroll', delta: READTEXT_PAGE_SCROLL });
    expect(resolve(down('KeyR', 'r'), open)).toEqual({ type: 'swallow' });
  });
});

describe('resolveSelectKeyAction on beatoraja’s extra keys', () => {
  const resolve = (event: SessionKeyEvent) => resolveSelectKeyAction(event, LIST, 'beatoraja');

  it('copies a hash on Ctrl+F3 / Ctrl+Shift+F3 only, and takes F10, 8 and 9', () => {
    expect(resolve({ ...down('F3'), ctrlKey: true })).toEqual({ type: 'copy-hash', hash: 'md5' });
    expect(resolve({ ...down('F3'), metaKey: true })).toEqual({ type: 'copy-hash', hash: 'md5' });
    expect(resolve({ ...down('F3'), ctrlKey: true, shiftKey: true })).toEqual({ type: 'copy-hash', hash: 'sha256' });
    expect(resolve({ ...down('F3'), shiftKey: true })).toBeUndefined();
    expect(resolve(down('F10'))).toEqual({ type: 'autoplay-folder' });
    expect(resolve(down('Digit8', '8'))).toEqual({ type: 'same-folder' });
    expect(resolve(down('Digit9', '9'))).toEqual({ type: 'readme' });
    // LR2 has none of them.
    expect(resolveSelectKeyAction(down('Digit8', '8'), LIST, 'lr2')).toBeUndefined();
  });
});
