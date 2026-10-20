import { describe, expect, test } from 'vite-plus/test';
import { resolveShellState, shellStateKey, type ShellStateInput } from './shell-state.ts';

const onSelect: ShellStateInput = {
  playFamily: undefined,
  paused: false,
  showing: 'select',
  portraitStage: false,
  skinHasBox: false,
};

describe('resolveShellState', () => {
  test('the select screen shows the search field at the foot of the screen', () => {
    expect(resolveShellState(onSelect)).toEqual({
      inGameplay: false,
      touchPlay: false,
      paused: false,
      portraitStage: false,
      searchInSkin: false,
      offSelect: false,
    });
  });

  test('a select skin with its own search box takes the field in place', () => {
    expect(resolveShellState({ ...onSelect, skinHasBox: true })).toMatchObject({
      searchInSkin: true,
      offSelect: false,
    });
  });

  test.each(['decide', 'result'] as const)('the %s screen hides the search field, with or without a box', (showing) => {
    expect(resolveShellState({ ...onSelect, showing })).toMatchObject({ inGameplay: false, offSelect: true });
    expect(resolveShellState({ ...onSelect, showing, skinHasBox: true })).toMatchObject({ offSelect: true });
  });

  test('between scenes the search field stays hidden', () => {
    expect(resolveShellState({ ...onSelect, showing: undefined })).toMatchObject({ offSelect: true });
  });

  test('a play on the built-in or LR2 family takes touch; a beatoraja play does not', () => {
    for (const playFamily of ['built-in', 'lr2']) {
      expect(resolveShellState({ ...onSelect, showing: 'play', playFamily, skinHasBox: true })).toMatchObject({
        inGameplay: true,
        touchPlay: true,
        searchInSkin: false,
        offSelect: true,
      });
    }
    expect(resolveShellState({ ...onSelect, showing: 'play', playFamily: 'beatoraja' })).toMatchObject({
      inGameplay: true,
      touchPlay: false,
    });
  });

  test('a play prepared behind the decide screen counts as gameplay already', () => {
    expect(resolveShellState({ ...onSelect, showing: 'decide', playFamily: 'lr2' })).toMatchObject({
      inGameplay: true,
      offSelect: true,
    });
  });

  test('paused only while there is a play', () => {
    expect(resolveShellState({ ...onSelect, paused: true }).paused).toBe(false);
    expect(resolveShellState({ ...onSelect, showing: 'play', playFamily: 'lr2', paused: true }).paused).toBe(true);
  });
});

describe('shellStateKey', () => {
  test('changes when only the scene on stage changes', () => {
    const select = shellStateKey(resolveShellState(onSelect));
    const result = shellStateKey(resolveShellState({ ...onSelect, showing: 'result' }));
    expect(result).not.toBe(select);
    expect(shellStateKey(resolveShellState({ ...onSelect }))).toBe(select);
  });
});
