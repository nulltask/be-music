import { expect, test } from 'vite-plus/test';
import type { BmsonBGAEventCue } from '@be-music/chart-model';
import { BmsonBGAController, resolveBmsonBGAEventInput } from './bmson-bga.ts';

function cue(condition: BmsonBGAEventCue['condition'] = 'play', interval = 0): BmsonBGAEventCue {
  return {
    seconds: 1,
    plane: 'layer',
    condition,
    interval,
    sequences: [
      {
        id: 10,
        frames: [
          { elapsedSeconds: 0, key: 'a' },
          { elapsedSeconds: 0.1, key: 'b' },
          { elapsedSeconds: 0.4, end: true },
        ],
      },
      {
        id: 11,
        frames: [
          { elapsedSeconds: 0, key: 'c' },
          { elapsedSeconds: 0.4, end: true },
        ],
      },
    ],
  };
}

test('PLAY triggers only on successful judgments, uses chart time and cycles image sets', () => {
  const state = new BmsonBGAController([cue()]);
  state.addInput({ seconds: 0.5, condition: 'play' });
  state.addInput({ seconds: 1.1, condition: 'miss' });
  state.addInput({ seconds: 1.2, condition: 'play' });
  state.addInput({ seconds: 2, condition: 'play' });
  expect(state.read(1.15)).toBeUndefined();
  expect(state.read(1.2)).toEqual({ plane: 'layer', key: 'a', startedSeconds: 1.2, frameStartSeconds: 1.2 });
  expect(state.read(1.35)?.key).toBe('b');
  expect(state.read(1.6)).toBeUndefined();
  expect(state.read(2)?.key).toBe('c');
  expect(state.read(1.2)?.key).toBe('a');
  expect(state.read(2)?.key).toBe('c');
});

test('MISS restarts on failed judgments and clears on success', () => {
  const state = new BmsonBGAController([cue('miss')]);
  state.addInput({ seconds: 1.1, condition: 'miss' });
  state.addInput({ seconds: 1.25, condition: 'miss' });
  state.addInput({ seconds: 1.3, condition: 'play' });
  expect(state.read(1.2)?.plane).toBe('poor');
  expect(state.read(1.26)?.key).toBe('c');
  expect(state.read(1.3)).toBeUndefined();
});

test('interval is a minimum start interval in chart milliseconds for PLAY/MISS', () => {
  const state = new BmsonBGAController([cue('play', 250)]);
  for (const seconds of [1, 1.1, 1.249, 1.25]) state.addInput({ seconds, condition: 'play' });
  expect(state.read(1.249)?.startedSeconds).toBe(1);
  expect(state.read(1.25)?.key).toBe('c');
  expect(state.read(1.25)?.startedSeconds).toBe(1.25);
});

test('ALWAYS starts at selection, repeats at its interval and cycles alternatives independently of judgments', () => {
  const state = new BmsonBGAController([cue('always', 1000)]);
  expect(state.read(0.9)).toBeUndefined();
  expect(state.read(1)?.key).toBe('a');
  expect(state.read(1.41)).toBeUndefined();
  expect(state.read(2)?.key).toBe('c');
  expect(state.read(3.2)?.key).toBe('b');
  expect(state.read(1.01)?.key).toBe('a');
  const once = new BmsonBGAController([cue('always', 0)]);
  expect(once.read(2)).toBeUndefined();
});

test('new selection cancels old state and equal-time selections precede judgments', () => {
  const next = { ...cue('miss'), seconds: 1.2 };
  const state = new BmsonBGAController([cue(), next]);
  state.addInput({ seconds: 1.1, condition: 'play' });
  state.addInput({ seconds: 1.2, condition: 'miss' });
  expect(state.read(1.2)).toMatchObject({ plane: 'poor', key: 'a', startedSeconds: 1.2 });
  expect(state.read(2)).toBeUndefined();
});

test('late inputs, reset/rebuilt history, explicit choices, empty sets and reversal stay deterministic', () => {
  const source = cue();
  const state = new BmsonBGAController([source], 2);
  source.sequences[0]!.frames[0]!.key = 'mutated';
  expect(state.read(1.2)).toBeUndefined();
  state.addInput({ seconds: 1.1, condition: 'play', choice: -1 });
  expect(state.read(1.2)?.key).toBe('c');
  state.reset([{ seconds: 1.9, condition: 'play', choice: 0 }]);
  expect(state.read(1.95)?.key).toBe('a');
  expect(state.read(3)?.key).toBe('b');
  state.addInput({ seconds: 2.1, condition: 'play' });
  expect(state.read(4)?.startedSeconds).toBe(1.9);
  state.reset();
  expect(state.read(1.9)).toBeUndefined();
  expect(state.read(NaN)).toBeUndefined();
  const empty = new BmsonBGAController([{ ...cue('always'), sequences: [] }]);
  expect(empty.read(1)).toBeUndefined();
});

test('effect mapping uses exactly successful combo judgments or explicit POOR triggers', () => {
  for (const judge of ['PERFECT', 'GREAT', 'GOOD']) {
    expect(resolveBmsonBGAEventInput({ kind: 'combo', seconds: 2, value: 1, reason: 'judge', judge })).toEqual({
      seconds: 2,
      condition: 'play',
    });
  }
  expect(
    resolveBmsonBGAEventInput({ kind: 'combo', seconds: 2, value: 0, reason: 'judge', judge: 'BAD' }),
  ).toBeUndefined();
  expect(resolveBmsonBGAEventInput({ kind: 'poor-bga', seconds: 2, action: 'trigger' })).toEqual({
    seconds: 2,
    condition: 'miss',
  });
  expect(resolveBmsonBGAEventInput({ kind: 'poor-bga', seconds: 2, action: 'clear' })).toBeUndefined();
});

test('absolute chart-time subtraction reaches authored millisecond boundaries without a floating-point delay', () => {
  const state = new BmsonBGAController([cue()]);
  state.addInput({ seconds: 1.1, condition: 'play' });
  expect(state.read(1.1999)?.key).toBe('a');
  expect(state.read(1.2)?.key).toBe('b');
  expect(state.read(1.5)).toBeUndefined();
});
