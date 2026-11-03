import { expect, test } from 'vite-plus/test';
import type { ControlButton } from './control-buttons.ts';
import { createControlButtonTracker } from './button-tracker.ts';

const key = (
  type: 'down' | 'up',
  code: string,
  timeStamp: number,
  buttons: readonly ControlButton[],
  repeat = false,
) => ({ type, code, timeStamp, buttons, repeat });

test('a button is down from its key going down to it coming up, and the up says how long', () => {
  const tracker = createControlButtonTracker();
  expect(tracker.handle(key('down', 'KeyQ', 100, ['1P-start']))).toEqual([
    { button: '1P-start', type: 'down', timeStamp: 100 },
  ]);
  expect(tracker.isDown('1P-start')).toBe(true);
  expect(tracker.heldMs('1P-start', 350)).toBe(250);
  // Auto-repeats change nothing.
  expect(tracker.handle(key('down', 'KeyQ', 200, ['1P-start'], true))).toEqual([]);
  expect(tracker.handle(key('up', 'KeyQ', 400, ['1P-start']))).toEqual([
    { button: '1P-start', type: 'up', timeStamp: 400, heldMs: 300 },
  ]);
  expect(tracker.isDown('1P-start')).toBe(false);
  expect(tracker.heldMs('1P-start', 500)).toBeUndefined();
});

test('a second press says when the button last went down, for a double press', () => {
  const tracker = createControlButtonTracker();
  tracker.handle(key('down', 'KeyQ', 100, ['1P-start']));
  tracker.handle(key('up', 'KeyQ', 150, ['1P-start']));
  expect(tracker.handle(key('down', 'KeyQ', 400, ['1P-start']))).toEqual([
    { button: '1P-start', type: 'down', timeStamp: 400, previousDownAt: 100 },
  ]);
});

test('a button with two keys is down while either is held', () => {
  const tracker = createControlButtonTracker();
  tracker.handle(key('down', 'KeyQ', 100, ['1P-start']));
  expect(tracker.handle(key('down', 'Tab', 120, ['1P-start']))).toEqual([]);
  expect(tracker.handle(key('up', 'KeyQ', 200, ['1P-start']))).toEqual([]);
  expect(tracker.isDown('1P-start')).toBe(true);
  expect(tracker.handle(key('up', 'Tab', 300, ['1P-start']))).toEqual([
    { button: '1P-start', type: 'up', timeStamp: 300, heldMs: 200 },
  ]);
});

test('one key can be several buttons; a release of a key that was never down, and a reset, change nothing', () => {
  const tracker = createControlButtonTracker();
  expect(tracker.handle(key('up', 'KeyA', 50, ['1P-key1']))).toEqual([]);
  expect(tracker.handle(key('down', 'KeyA', 100, ['1P-key1', '1P-start'])).map((change) => change.button)).toEqual([
    '1P-key1',
    '1P-start',
  ]);
  tracker.reset();
  expect(tracker.isDown('1P-key1')).toBe(false);
  expect(tracker.handle(key('up', 'KeyA', 200, ['1P-key1', '1P-start']))).toEqual([]);
});
