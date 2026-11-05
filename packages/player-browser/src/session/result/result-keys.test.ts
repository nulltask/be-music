import { describe, expect, it } from 'vite-plus/test';
import { isResultRetryKey, resolveResultKeyAction, resultReplaySlotKey, type ResultKeyEvent } from './result-keys.ts';
import { resolveControlActions } from '../controls/control-actions.ts';

function press(overrides: Partial<ResultKeyEvent>): ResultKeyEvent {
  return { code: 'KeyR', repeat: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...overrides };
}

describe('isResultRetryKey', () => {
  it('matches a bare R in either case', () => {
    expect(isResultRetryKey(press({}))).toBe(true);
    expect(isResultRetryKey(press({ code: 'KeyR' }))).toBe(true);
  });

  it('ignores R with a modifier held', () => {
    expect(isResultRetryKey(press({ ctrlKey: true }))).toBe(false);
    expect(isResultRetryKey(press({ metaKey: true }))).toBe(false);
    expect(isResultRetryKey(press({ altKey: true }))).toBe(false);
    expect(isResultRetryKey(press({ code: 'KeyR', shiftKey: true }))).toBe(false);
  });

  it('ignores auto-repeats', () => {
    expect(isResultRetryKey(press({ repeat: true }))).toBe(false);
  });

  it('ignores other keys', () => {
    expect(isResultRetryKey(press({ code: 'Enter' }))).toBe(false);
    expect(isResultRetryKey(press({ code: 'Escape' }))).toBe(false);
    expect(isResultRetryKey(press({ code: 'KeyT' }))).toBe(false);
  });
});

describe('resultReplaySlotKey', () => {
  it('maps a bare 1-4 to replay slots 0-3', () => {
    expect(['Digit1', 'Digit2', 'Digit3', 'Digit4'].map((code) => resultReplaySlotKey(press({ code })))).toEqual([
      0, 1, 2, 3,
    ]);
  });

  it('ignores other keys, modified presses and auto-repeats', () => {
    expect(resultReplaySlotKey(press({ code: 'Digit5' }))).toBeUndefined();
    expect(resultReplaySlotKey(press({ code: 'Digit1', ctrlKey: true }))).toBeUndefined();
    expect(resultReplaySlotKey(press({ code: 'Digit1', repeat: true }))).toBeUndefined();
  });
});

describe('resolveResultKeyAction', () => {
  it('takes retry (when offered), leave, next and the replay slots, by the player’s keys', () => {
    expect(resolveResultKeyAction(press({}), true)).toEqual({ type: 'retry' });
    expect(resolveResultKeyAction(press({}), false)).toBeUndefined();
    expect(resolveResultKeyAction(press({ code: 'Escape' }), true)).toEqual({ type: 'leave' });
    expect(resolveResultKeyAction(press({ code: 'Space' }), true)).toEqual({ type: 'continue' });
    expect(resolveResultKeyAction(press({ code: 'Digit2' }), true)).toEqual({ type: 'save-replay', slot: 1 });
    const actions = resolveControlActions('lr2', { 'result.retry': ['F2'], 'result.continue': ['KeyN'] });
    expect(resolveResultKeyAction(press({ code: 'F2' }), true, actions)).toEqual({ type: 'retry' });
    expect(resolveResultKeyAction(press({}), true, actions)).toBeUndefined();
    expect(resolveResultKeyAction(press({ code: 'KeyN' }), true, actions)).toEqual({ type: 'continue' });
  });
});
