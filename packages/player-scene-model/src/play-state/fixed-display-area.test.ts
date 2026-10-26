import { expect, test } from 'vite-plus/test';
import { createHiSpeedState } from './hi-speed.ts';
import { createPlayState, reducePlayState } from './state.ts';
import { DEFAULT_PLAY_OPTIONS, resolvePlayOptionValue } from '../play-options/choices.ts';

function state(floating = true) {
  return createPlayState({
    view: {
      fixedDisplayArea: true,
      hiSpeed: createHiSpeedState({ floating, hiSpeed: 2, bpm: 120, visibleFraction: 1 - 181 / 723 - 72 / 723 }),
      covers: [
        {
          side: '1P',
          sudden: 181 / 723,
          suddenOn: true,
          hidden: 0,
          hiddenOn: false,
          lift: 72 / 723,
          liftOn: true,
          absolute: true,
        },
      ],
    },
  });
}

test('fixed geometry ignores all interactive cover/LIFT edits, including direct host sets', () => {
  const initial = state();
  for (const part of ['sudden', 'hidden', 'lift'] as const) {
    expect(reducePlayState(initial, { type: 'cover-adjust', part, delta: 0.1 })).toBe(initial);
    expect(reducePlayState(initial, { type: 'cover-toggle', part })).toBe(initial);
  }
  expect(reducePlayState(initial, { type: 'cover-set', covers: [{ sudden: 0.5, lift: 0.5 }] })).toBe(initial);
});

test('restoring initial time recalculates speed at the current BPM without moving any geometry', () => {
  const initial = state();
  const edited = reducePlayState(initial, { type: 'hi-speed-step', delta: 1, bpm: 240 });
  expect(edited.view.hiSpeed.player).toBe(2.5);
  const restored = reducePlayState(edited, {
    type: 'floating-speed-restore',
    bpm: 240,
    visibleFraction: 1 - 181 / 723 - 72 / 723,
  });
  expect(restored.view.hiSpeed.player).toBe(1);
  expect(restored.view.covers).toBe(initial.view.covers);
  expect(restored.view.fixedDisplayArea).toBe(true);
});

test('uncovered fine adjustments do not replace the initial time used by fixed-area restore', () => {
  const initial = createPlayState({
    view: { fixedDisplayArea: true, hiSpeed: createHiSpeedState({ floating: true, hiSpeed: 2, bpm: 120 }) },
  });
  const edited = reducePlayState(initial, { type: 'hi-speed-fine', direction: 1, bpm: 120, visibleFraction: 1 });
  expect(edited.view.hiSpeed.floating).not.toBe(initial.view.hiSpeed.floating);
  expect(edited.view.hiSpeed.floatingInitial).toBe(initial.view.hiSpeed.floatingInitial);
  expect(
    reducePlayState(edited, { type: 'floating-speed-restore', bpm: 240, visibleFraction: 1 }).view.hiSpeed.player,
  ).toBe(1);
});

test('a nonfloating play has geometry protection but no restore action; course speed lock remains independent', () => {
  const ordinary = state(false);
  expect(reducePlayState(ordinary, { type: 'floating-speed-restore', bpm: 240, visibleFraction: 0.5 })).toBe(ordinary);
  const locked = {
    ...state(),
    view: { ...state().view, hiSpeed: createHiSpeedState({ floating: true, locked: true }) },
  };
  expect(reducePlayState(locked, { type: 'floating-speed-restore', bpm: 240, visibleFraction: 1 })).toBe(locked);
  expect(reducePlayState(locked, { type: 'hi-speed-step', delta: 1 })).toBe(locked);
});

test('recorded views restore their actual geometry while leaving the interactive lock in force', () => {
  const initial = state();
  const replayed = reducePlayState(initial, {
    type: 'cover-set',
    recorded: true,
    covers: [{ side: '1P', sudden: 200 / 723 }],
  });
  expect(replayed.view.covers[0]?.sudden).toBe(200 / 723);
  expect(replayed.view.fixedDisplayArea).toBe(true);
  expect(reducePlayState(replayed, { type: 'cover-adjust', part: 'lift', delta: 0.1 })).toBe(replayed);
});

test('fixed display area is an independent opt-in visual option', () => {
  expect(DEFAULT_PLAY_OPTIONS.fixedDisplayArea).toBe(false);
  expect(resolvePlayOptionValue('fixedDisplayArea', true)).toBe(true);
  expect(resolvePlayOptionValue('fixedDisplayArea', 'ON')).toBeUndefined();
});
