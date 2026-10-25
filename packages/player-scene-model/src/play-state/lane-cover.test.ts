import { describe, expect, test } from 'vite-plus/test';
import { DEFAULT_PLAY_OPTIONS } from '../play-options/choices.ts';
import { laneCoversFromPlayOptions, reduceLaneCovers, resolveLaneCover, type LaneCoverState } from './lane-cover.ts';

const cover = (overrides: Partial<LaneCoverState> = {}): LaneCoverState => ({
  side: '1P',
  sudden: 0.25,
  suddenOn: false,
  hidden: 0.25,
  hiddenOn: false,
  lift: 0,
  ...overrides,
});

describe('laneCoversFromPlayOptions', () => {
  test('retains the beatoraja default while off and enables each side independently', () => {
    const [one, two] = laneCoversFromPlayOptions({ ...DEFAULT_PLAY_OPTIONS, liftOn2P: true, lift2P: 0.3 }, [
      '1P',
      '2P',
    ]);
    expect(one).toMatchObject({ lift: 0.1, liftOn: false });
    expect(resolveLaneCover(one!).lift).toBe(0);
    expect(resolveLaneCover(two!).lift).toBe(0.3);
    const off = reduceLaneCovers([two!], { type: 'cover-toggle', part: 'lift' });
    expect(off[0]).toMatchObject({ lift: 0.3, liftOn: false });
    expect(resolveLaneCover(off[0]!).lift).toBe(0);
    expect(resolveLaneCover(reduceLaneCovers(off, { type: 'cover-toggle', part: 'lift' })[0]!).lift).toBe(0.3);
  });

  const options = { ...DEFAULT_PLAY_OPTIONS, laneCover: true, shutter: 0.3 };

  test('covers the top under SUDDEN, the bottom under HIDDEN and both under HID+SUD, per side', () => {
    const covers = laneCoversFromPlayOptions({ ...options, hiddenSudden1P: 'SUDDEN', hiddenSudden2P: 'HID+SUD' }, [
      '1P',
      '2P',
    ]);
    expect(covers.map(resolveLaneCover)).toEqual([
      { side: '1P', sudden: 0.3, hidden: 0, lift: 0 },
      { side: '2P', sudden: 0.3, hidden: 0.3, lift: 0 },
    ]);
    expect(resolveLaneCover(laneCoversFromPlayOptions({ ...options, hiddenSudden1P: 'HIDDEN' }, ['1P'])[0]!)).toEqual({
      side: '1P',
      sudden: 0,
      hidden: 0.3,
      lift: 0,
    });
  });

  test('covers nothing while LANE COVER is off, keeping the height for when it comes on', () => {
    const [off] = laneCoversFromPlayOptions({ ...options, laneCover: false, hiddenSudden1P: 'HID+SUD' }, ['1P']);
    expect(resolveLaneCover(off!)).toEqual({ side: '1P', sudden: 0, hidden: 0, lift: 0 });
    expect(off).toMatchObject({ sudden: 0.3, hidden: 0.3 });
  });

  test('clamps the height to the lane', () => {
    const [full] = laneCoversFromPlayOptions({ ...options, shutter: 1.5, hiddenSudden1P: 'SUDDEN' }, ['1P']);
    expect(full!.sudden).toBe(1);
    const [none] = laneCoversFromPlayOptions({ ...options, shutter: -0.2, hiddenSudden1P: 'HIDDEN' }, ['1P']);
    expect(resolveLaneCover(none!).hidden).toBe(0);
  });

  test('covers nothing on a side whose mode is OFF', () => {
    const [off] = laneCoversFromPlayOptions({ ...options, hiddenSudden1P: 'OFF' }, ['1P']);
    expect(resolveLaneCover(off!)).toEqual({ side: '1P', sudden: 0, hidden: 0, lift: 0 });
  });
});

describe('resolveLaneCover', () => {
  test('scales SUDDEN+ as well as HIDDEN+ to the remaining lane', () => {
    expect(resolveLaneCover(cover({ suddenOn: true, sudden: 0.5, hiddenOn: true, hidden: 0.25, lift: 0.2 }))).toEqual({
      side: '1P',
      sudden: 0.4,
      hidden: 0.2,
      lift: 0.2,
    });
  });
  test('scales HIDDEN+ to the lane above the LIFT', () => {
    expect(resolveLaneCover(cover({ hiddenOn: true, hidden: 0.5, lift: 0.2 }))).toEqual({
      side: '1P',
      sudden: 0,
      hidden: 0.4,
      lift: 0.2,
    });
  });
});

describe('reduceLaneCovers', () => {
  const sides = [cover(), cover({ side: '2P' })];

  test('raises a cover that is off back on at its height plus the step, on every side', () => {
    const next = reduceLaneCovers(sides, { type: 'cover-adjust', part: 'sudden', delta: 0.05 });
    expect(next.map((entry) => [entry.sudden, entry.suddenOn])).toEqual([
      [0.3, true],
      [0.3, true],
    ]);
  });

  test('turns a cover lowered to nothing off', () => {
    const on = [cover({ hidden: 0.05, hiddenOn: true })];
    expect(reduceLaneCovers(on, { type: 'cover-adjust', part: 'hidden', delta: -0.05 })[0]).toMatchObject({
      hidden: 0,
      hiddenOn: false,
    });
  });

  test('moves the LIFT within the lane, on one side only when one is named', () => {
    const next = reduceLaneCovers(sides, { type: 'cover-adjust', part: 'lift', delta: 2, side: '2P' });
    expect(next.map((entry) => entry.lift)).toEqual([0, 1]);
  });

  test('switches a cover on at its height, or at a quarter of the lane without one, and off again', () => {
    const toggled = reduceLaneCovers([cover({ hidden: 0 })], { type: 'cover-toggle', part: 'hidden' });
    expect(toggled[0]).toMatchObject({ hidden: 0.25, hiddenOn: true });
    expect(reduceLaneCovers(toggled, { type: 'cover-toggle', part: 'hidden' })[0]).toMatchObject({
      hidden: 0.25,
      hiddenOn: false,
    });
  });

  test('sets covers outright by side', () => {
    const next = reduceLaneCovers(sides, { type: 'cover-set', covers: [{ side: '2P', sudden: 0.6, suddenOn: true }] });
    expect(next[1]).toMatchObject({ side: '2P', sudden: 0.6, suddenOn: true });
    expect(next[0]).toBe(sides[0]);
  });

  test('changes nothing while locked or for a step that is not a number', () => {
    expect(reduceLaneCovers(sides, { type: 'cover-adjust', part: 'sudden', delta: 0.1 }, true)).toBe(sides);
    expect(reduceLaneCovers(sides, { type: 'cover-adjust', part: 'sudden', delta: Number.NaN })).toBe(sides);
    expect(reduceLaneCovers([cover({ lift: 0 })], { type: 'cover-adjust', part: 'lift', delta: -0.1 })[0]!.lift).toBe(
      0,
    );
  });
});
