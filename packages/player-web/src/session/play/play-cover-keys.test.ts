import { createPlayState, reducePlayState, type LaneCoverState } from '@be-music/scene-model';
import { describe, expect, test } from 'vite-plus/test';
import { resolvePlayCoverKey } from './play-cover-keys.ts';

const OFF: LaneCoverState = { side: '1P', sudden: 0, suddenOn: false, hidden: 0, hiddenOn: false, lift: 0 };

/** The 1P cover after pressing `keys` in turn from no cover. */
function press(...keys: Array<{ key: string; shiftKey?: boolean }>): LaneCoverState {
  let state = createPlayState({ view: { covers: [OFF] } });
  for (const { key, shiftKey } of keys) {
    const cover = resolvePlayCoverKey({ key, shiftKey: shiftKey === true });
    if (cover !== undefined) state = reducePlayState(state, cover.command);
  }
  return state.view.covers[0]!;
}

describe('resolvePlayCoverKey', () => {
  test('PageDown lowers SUDDEN+ by 1 % of the lane, 5 % with Shift, and PageUp raises it back', () => {
    expect(press({ key: 'PageDown' })).toMatchObject({ sudden: 0.01, suddenOn: true });
    expect(press({ key: 'PageDown', shiftKey: true })).toMatchObject({ sudden: 0.05, suddenOn: true });
    expect(press({ key: 'PageDown', shiftKey: true }, { key: 'PageUp' })).toMatchObject({ sudden: 0.04 });
    // Raised back to nothing, it goes off.
    expect(press({ key: 'PageDown' }, { key: 'PageUp' })).toMatchObject({ sudden: 0, suddenOn: false });
    expect(resolvePlayCoverKey({ key: 'PageUp', shiftKey: false })?.setting).toBe('sudden');
  });

  test('End raises the LIFT and Home lowers it, within the lane', () => {
    expect(press({ key: 'End' }, { key: 'End', shiftKey: true })).toMatchObject({ lift: 0.06 });
    expect(press({ key: 'Home' })).toMatchObject({ lift: 0 });
    expect(resolvePlayCoverKey({ key: 'End', shiftKey: false })?.setting).toBe('lift');
  });

  test('H switches HIDDEN+ on at a quarter of the lane and off again, keeping its height', () => {
    expect(press({ key: 'h' })).toMatchObject({ hidden: 0.25, hiddenOn: true });
    expect(press({ key: 'H' }, { key: 'h' })).toMatchObject({ hidden: 0.25, hiddenOn: false });
    expect(resolvePlayCoverKey({ key: 'h', shiftKey: false })?.setting).toBe('hidden-toggle');
  });

  test('K raises HIDDEN+ (switching it on) and J lowers it', () => {
    expect(press({ key: 'k' })).toMatchObject({ hidden: 0.01, hiddenOn: true });
    expect(press({ key: 'K', shiftKey: true }, { key: 'j' })).toMatchObject({ hidden: 0.04, hiddenOn: true });
    expect(resolvePlayCoverKey({ key: 'J', shiftKey: false })?.setting).toBe('hidden');
  });

  test('leaves every other key alone', () => {
    for (const key of ['ArrowUp', 'Escape', 'z', 'l', 'Enter']) {
      expect(resolvePlayCoverKey({ key, shiftKey: false })).toBeUndefined();
    }
  });
});
