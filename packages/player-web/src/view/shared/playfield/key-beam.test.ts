import { describe, expect, test } from 'vite-plus/test';
import { resolveKeyBeamAlpha, type KeyBeamState } from './key-beam.ts';

function beams(entries: { pressed?: string[]; on?: [string, number][]; fading?: [string, number][] } = {}) {
  return {
    pressedChannels: new Set(entries.pressed ?? []),
    keyBeamStartedAt: new Map(entries.on ?? []),
    keyBeamFadeStartedAt: new Map(entries.fading ?? []),
  } satisfies KeyBeamState;
}

describe('resolveKeyBeamAlpha', () => {
  test('is fully on while the key is down, whatever the beams say', () => {
    expect(resolveKeyBeamAlpha(beams({ pressed: ['11'] }), '11', 120, 0)).toBe(1);
    expect(resolveKeyBeamAlpha(beams({ pressed: ['11'], on: [['11', 0]], fading: [['11', 0]] }), '11', 120, 500)).toBe(
      1,
    );
  });

  test('is off for a lane with no beam on', () => {
    expect(resolveKeyBeamAlpha(beams({ fading: [['11', 0]] }), '11', 120, 10)).toBe(0);
    expect(resolveKeyBeamAlpha(beams({ on: [['12', 0]] }), '11', 120, 10)).toBe(0);
  });

  test('is fully on until its fade starts, then tapers to nothing over the fade', () => {
    const state = beams({ on: [['16', 100]] });
    expect(resolveKeyBeamAlpha(state, '16', 120, 400)).toBe(1);
    state.keyBeamFadeStartedAt.set('16', 400);
    expect(resolveKeyBeamAlpha(state, '16', 120, 400)).toBe(1);
    expect(resolveKeyBeamAlpha(state, '16', 120, 430)).toBeCloseTo(0.75);
    expect(resolveKeyBeamAlpha(state, '16', 120, 490)).toBeCloseTo(0.25);
    // A play clock behind the fade's start reads as its start.
    expect(resolveKeyBeamAlpha(state, '16', 120, 390)).toBe(1);
  });

  test('retires a beam whose fade has played out, and only that one', () => {
    const state = beams({
      on: [
        ['16', 0],
        ['11', 0],
      ],
      fading: [
        ['16', 100],
        ['11', 150],
      ],
    });
    expect(resolveKeyBeamAlpha(state, '16', 120, 220)).toBe(0);
    expect(state.keyBeamStartedAt.has('16')).toBe(false);
    expect(state.keyBeamFadeStartedAt.has('16')).toBe(false);
    expect(state.keyBeamStartedAt.has('11')).toBe(true);
    expect(state.keyBeamFadeStartedAt.get('11')).toBe(150);
  });
});
