import { describe, expect, it } from 'vite-plus/test';
import { isResultRetryKey, type ResultKeyEvent } from './result-keys.ts';

function press(overrides: Partial<ResultKeyEvent>): ResultKeyEvent {
  return { key: 'r', repeat: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...overrides };
}

describe('isResultRetryKey', () => {
  it('matches a bare R in either case', () => {
    expect(isResultRetryKey(press({}))).toBe(true);
    expect(isResultRetryKey(press({ key: 'R' }))).toBe(true);
  });

  it('ignores R with a modifier held', () => {
    expect(isResultRetryKey(press({ ctrlKey: true }))).toBe(false);
    expect(isResultRetryKey(press({ metaKey: true }))).toBe(false);
    expect(isResultRetryKey(press({ altKey: true }))).toBe(false);
    expect(isResultRetryKey(press({ key: 'R', shiftKey: true }))).toBe(false);
  });

  it('ignores auto-repeats', () => {
    expect(isResultRetryKey(press({ repeat: true }))).toBe(false);
  });

  it('ignores other keys', () => {
    expect(isResultRetryKey(press({ key: 'Enter' }))).toBe(false);
    expect(isResultRetryKey(press({ key: 'Escape' }))).toBe(false);
    expect(isResultRetryKey(press({ key: 't' }))).toBe(false);
  });
});
