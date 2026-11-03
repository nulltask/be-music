import { createLaneBindings } from '@be-music/player-engine/lanes';
import { createPlayState, reducePlayState, type LaneCoverState } from '@be-music/player-scene-model';
import { describe, expect, test } from 'vite-plus/test';
import { resolveLaneInputTokens, resolvePlayCoverKey } from './play-cover-keys.ts';
import { resolveControlActions } from '../controls/control-actions.ts';

const OFF: LaneCoverState = { side: '1P', sudden: 0, suddenOn: false, hidden: 0, hiddenOn: false, lift: 0 };

/** The physical key a typed key is on a US layout (`h` is KeyH). */
function codeOf(key: string): string {
  return /^[a-z]$/iu.test(key) ? `Key${key.toUpperCase()}` : key;
}

/** A cover key press of `key`, on its US-layout physical key. */
function cover(key: string, shiftKey = false) {
  return resolvePlayCoverKey({ key, code: codeOf(key), shiftKey });
}

/** The 1P cover after pressing `keys` in turn from no cover. */
function press(...keys: Array<{ key: string; shiftKey?: boolean }>): LaneCoverState {
  let state = createPlayState({ view: { covers: [OFF] } });
  for (const { key, shiftKey } of keys) {
    const cover = resolvePlayCoverKey({ key, code: codeOf(key), shiftKey: shiftKey === true });
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
    expect(cover('PageUp')?.setting).toBe('sudden');
  });

  test('End raises the LIFT and Home lowers it, within the lane', () => {
    expect(press({ key: 'End' }, { key: 'End', shiftKey: true })).toMatchObject({ lift: 0.06 });
    expect(press({ key: 'Home' })).toMatchObject({ lift: 0 });
    expect(cover('End')?.setting).toBe('lift');
  });

  test('H switches HIDDEN+ on at a quarter of the lane and off again, keeping its height', () => {
    expect(press({ key: 'h' })).toMatchObject({ hidden: 0.25, hiddenOn: true });
    expect(press({ key: 'H' }, { key: 'h' })).toMatchObject({ hidden: 0.25, hiddenOn: false });
    expect(cover('h')?.setting).toBe('hidden-toggle');
  });

  test('K raises HIDDEN+ (switching it on) and J lowers it', () => {
    expect(press({ key: 'k' })).toMatchObject({ hidden: 0.01, hiddenOn: true });
    expect(press({ key: 'K', shiftKey: true }, { key: 'j' })).toMatchObject({ hidden: 0.04, hiddenOn: true });
    expect(cover('J')?.setting).toBe('hidden');
  });

  test('leaves every other key alone', () => {
    for (const key of ['ArrowUp', 'Escape', 'z', 'l', 'Enter']) {
      expect(cover(key)).toBeUndefined();
    }
  });

  test("leaves a key one of the play's lanes takes to the lane: H / J / K on a DP chart's 2P side", () => {
    const sp = resolveLaneInputTokens(createLaneBindings(['16', '11', '12', '13', '14', '15', '18', '19']));
    const dp = resolveLaneInputTokens(
      createLaneBindings([
        '16',
        '11',
        '12',
        '13',
        '14',
        '15',
        '18',
        '19',
        '26',
        '21',
        '22',
        '23',
        '24',
        '25',
        '28',
        '29',
      ]),
    );
    const key = (key: string, code: string, tokens: ReadonlySet<string>) =>
      resolvePlayCoverKey({ key, code, shiftKey: false }, tokens);
    // A 7-key SP chart plays Z S X D C F V: H, J and K stay the HIDDEN+ keys.
    expect(key('h', 'KeyH', sp)?.setting).toBe('hidden-toggle');
    expect(key('j', 'KeyJ', sp)?.setting).toBe('hidden');
    // A 14-key DP chart plays B H N J M K , on its 2P side: H, J and K are lanes, and the other cover keys still work.
    for (const [name, code] of [
      ['h', 'KeyH'],
      ['J', 'KeyJ'],
      ['k', 'KeyK'],
    ] as const) {
      expect(key(name, code, dp)).toBeUndefined();
    }
    expect(key('PageDown', 'PageDown', dp)?.setting).toBe('sudden');
    expect(key('End', 'End', dp)?.setting).toBe('lift');
    // The keys are physical (`code`), as the lane input reads them: H's position is HIDDEN+ whatever the layout prints.
    expect(key('q', 'KeyH', sp)?.setting).toBe('hidden-toggle');
    expect(key('h', 'KeyQ', sp)).toBeUndefined();
  });
});

test('resolvePlayCoverKey reads the player’s keys for the cover operations', () => {
  const actions = resolveControlActions('lr2', { 'play.hidden-toggle': ['KeyG'] });
  expect(resolvePlayCoverKey({ key: 'g', code: 'KeyG', shiftKey: false }, undefined, actions)?.setting).toBe(
    'hidden-toggle',
  );
  expect(resolvePlayCoverKey({ key: 'h', code: 'KeyH', shiftKey: false }, undefined, actions)).toBeUndefined();
});
