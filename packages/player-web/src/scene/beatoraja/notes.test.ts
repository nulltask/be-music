import { describe, expect, it } from 'vitest';
import { beatorajaDisplayScrollBeat, beatorajaPixelsPerBeat } from './notes.ts';

// Mirrors upstream `LaneRenderer.java:271-276`'s `rxhs = (hu - hl) * hispeed` divided by
// `getMeasureBeats(1.0) === 4` to convert "y-delta per measure" into "y-delta per beat".
// The previous implementation used a fixed 72 px/beat regardless of skin lane height; that
// produced a ~2.9× slower scroll on ModernChic (lane = 841 px → upstream's 210 px/beat
// vs our 72), which the user reported as the beatoraja path falling slower than the LR2
// path on the same chart at the same hispeed.
describe('beatorajaPixelsPerBeat (upstream `rxhs / 4` for the beatoraja note layer)', () => {
  it('returns laneHeight / 4 at hispeed=1 (= 1 measure visible per lane height)', () => {
    // ModernChic-shaped lane (841 px in skin coords): 1 measure = 4 beats spans 1 lane.
    expect(beatorajaPixelsPerBeat(841, 1)).toBeCloseTo(841 / 4, 6);
    // Default play5.json's 580-px lane authored at `y:140, h:580`: 580 / 4 = 145 px/beat.
    expect(beatorajaPixelsPerBeat(580, 1)).toBeCloseTo(145, 6);
  });

  it('scales linearly with hispeed', () => {
    expect(beatorajaPixelsPerBeat(800, 2)).toBeCloseTo(400, 6);
    expect(beatorajaPixelsPerBeat(800, 0.5)).toBeCloseTo(100, 6);
    // hispeed 4× → 4× the per-beat scroll → only 1 beat fits per lane height.
    expect(beatorajaPixelsPerBeat(800, 4)).toBeCloseTo(800, 6);
  });

  it('returns 0 for non-positive lane height (degenerate skin or pre-mount frames)', () => {
    expect(beatorajaPixelsPerBeat(0, 1)).toBe(0);
    expect(beatorajaPixelsPerBeat(-50, 1)).toBe(0);
  });

  it('returns 0 for non-positive hispeed (paused / clamped state)', () => {
    expect(beatorajaPixelsPerBeat(800, 0)).toBe(0);
    expect(beatorajaPixelsPerBeat(800, -1)).toBe(0);
  });

  it('returns 0 for non-finite inputs (NaN guard)', () => {
    expect(beatorajaPixelsPerBeat(Number.NaN, 1)).toBe(0);
    expect(beatorajaPixelsPerBeat(800, Number.NaN)).toBe(0);
    expect(beatorajaPixelsPerBeat(Number.POSITIVE_INFINITY, 1)).not.toBeNaN();
  });
});

// The display layers (note + marker) scroll from the engine's mirrored `displayBeat` once an LR2 negative-BPM
// reversal (issue #134) is past; before that the field is unset and the true `currentBeat` drives the scroll.
describe('beatorajaDisplayScrollBeat (LR2 negative-BPM reversal display clock)', () => {
  it('returns currentBeat while no reversal mirror is armed', () => {
    expect(beatorajaDisplayScrollBeat({ currentBeat: 12.5 })).toBe(12.5);
    expect(beatorajaDisplayScrollBeat({ currentBeat: 12.5, displayBeat: undefined })).toBe(12.5);
  });

  it('returns the mirrored displayBeat once the engine publishes it (scrolling backwards past the reversal)', () => {
    // Past the reversal the engine mirrors the clock — displayBeat runs BEHIND currentBeat and shrinks each
    // frame while currentBeat keeps advancing; the display consumer must follow the mirror, not the true clock.
    expect(beatorajaDisplayScrollBeat({ currentBeat: 20, displayBeat: 12 })).toBe(12);
    expect(beatorajaDisplayScrollBeat({ currentBeat: 21, displayBeat: 11 })).toBe(11);
    // A mirrored beat of 0 is a valid position (back at the chart head) — `??` must not treat it as unset.
    expect(beatorajaDisplayScrollBeat({ currentBeat: 32, displayBeat: 0 })).toBe(0);
  });
});
