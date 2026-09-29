import { describe, expect, it } from 'vite-plus/test';
import {
  RIPPLE_LIFE_MS,
  countInStep,
  digitTransitions,
  mixLineAngle,
  needleAngle,
  scrambleText,
  scrambleTick,
  springEase,
  tileFlipPhase,
} from './field.ts';

/** Angle difference between two undirected lines, in [0, π/2]. */
function lineDelta(a: number, b: number): number {
  const d = Math.abs((((a - b) % Math.PI) + Math.PI) % Math.PI);
  return Math.min(d, Math.PI - d);
}

describe('needleAngle', () => {
  const calm = { seconds: 0, beatPhase: 0, flow: 0 };

  it('rests at 45 degrees with no forces', () => {
    expect(needleAngle(100, 100, calm)).toBeCloseTo(Math.PI / 4, 12);
  });

  it('points at a full-strength attractor', () => {
    const angle = needleAngle(0, 0, { ...calm, attractor: { x: 10, y: 0, strength: 1 } });
    expect(lineDelta(angle, 0)).toBeCloseTo(0, 9);
  });

  it('lies tangent to a full-strength swirl', () => {
    const angle = needleAngle(10, 0, { ...calm, swirl: { x: 0, y: 0, strength: 1 } });
    expect(lineDelta(angle, Math.PI / 2)).toBeCloseTo(0, 9);
  });

  it('turns needles on a ripple front and forgets expired ripples', () => {
    const at = (ageMs: number) => needleAngle(50, 0, { ...calm, ripples: [{ x: 0, y: 0, ageMs, strength: 1 }] });
    expect(lineDelta(at(100), Math.PI / 4)).toBeGreaterThan(0.5);
    expect(at(RIPPLE_LIFE_MS)).toBeCloseTo(Math.PI / 4, 12);
  });

  it('sweeps a beat wave through the field', () => {
    const onFront = needleAngle(320, 0, { ...calm, beatPhase: 0.5, beatWave: 1 });
    const offFront = needleAngle(0, 0, { ...calm, beatPhase: 0.5, beatWave: 1 });
    expect(onFront - Math.PI / 4).toBeCloseTo(Math.PI / 2, 6);
    expect(offFront).toBeCloseTo(Math.PI / 4, 6);
  });

  it('trembles within its amplitude', () => {
    for (let step = 0; step < 30; step += 1) {
      const angle = needleAngle(40 + step * 10, 60, { ...calm, seconds: step / 30, tremble: 0.1 });
      expect(Math.abs(angle - Math.PI / 4)).toBeLessThanOrEqual(0.1 + 1e-9);
    }
  });

  it('stands needles upright inside a spectrum bar and leaves the rest alone', () => {
    const spectrum = { levels: [1, 0], left: 0, right: 200, top: 0, bottom: 100 };
    // Left column is full: every needle in it stands.
    expect(lineDelta(needleAngle(50, 10, { ...calm, spectrum }), Math.PI / 2)).toBeCloseTo(0, 9);
    // Right column is silent.
    expect(needleAngle(150, 90, { ...calm, spectrum })).toBeCloseTo(Math.PI / 4, 12);
    // Outside the spectrum rect nothing changes.
    expect(needleAngle(250, 50, { ...calm, spectrum })).toBeCloseTo(Math.PI / 4, 12);
  });

  it('raises a half-height bar with a feathered top', () => {
    const spectrum = { levels: [0.5], left: 0, right: 100, top: 0, bottom: 100 };
    expect(lineDelta(needleAngle(50, 90, { ...calm, spectrum }), Math.PI / 2)).toBeCloseTo(0, 9);
    expect(needleAngle(50, 20, { ...calm, spectrum })).toBeCloseTo(Math.PI / 4, 12);
    const edge = needleAngle(50, 44, { ...calm, spectrum });
    expect(lineDelta(edge, Math.PI / 4)).toBeGreaterThan(0);
    expect(lineDelta(edge, Math.PI / 2)).toBeGreaterThan(0);
  });

  it('is deterministic under jitter', () => {
    const input = { ...calm, seconds: 1.23, jitter: 1 };
    expect(needleAngle(40, 60, input)).toBe(needleAngle(40, 60, input));
  });
});

describe('mixLineAngle', () => {
  it('turns the short way for undirected lines', () => {
    // 170° and 10° are 20° apart as lines; halfway lands on 0° / 180°.
    const mixed = mixLineAngle((170 * Math.PI) / 180, (10 * Math.PI) / 180, 0.5);
    expect(lineDelta(mixed, 0)).toBeCloseTo(0, 9);
  });
});

describe('springEase', () => {
  it('starts at 0, overshoots, and settles at 1', () => {
    expect(springEase(0)).toBe(0);
    expect(springEase(1)).toBe(1);
    let peak = 0;
    for (let step = 1; step < 100; step += 1) peak = Math.max(peak, springEase(step / 100));
    expect(peak).toBeGreaterThan(1.1);
    expect(peak).toBeLessThan(1.35);
    expect(springEase(0.95)).toBeCloseTo(1, 1);
  });

  it('clamps out-of-range time', () => {
    expect(springEase(-1)).toBe(0);
    expect(springEase(Number.NaN)).toBe(0);
    expect(springEase(4)).toBe(1);
  });
});

describe('digitTransitions', () => {
  it('turns only the wheels that change', () => {
    expect(digitTransitions(129, 130).map((digit) => digit.changed)).toEqual([false, true, true]);
  });

  it('marks a new leading digit', () => {
    expect(digitTransitions(99, 100)).toEqual([
      { char: '1', previous: '', changed: true },
      { char: '0', previous: '9', changed: true },
      { char: '0', previous: '9', changed: true },
    ]);
  });
});

describe('countInStep', () => {
  it('counts 3 / 2 / 1 then GO', () => {
    expect(countInStep(-2400)).toEqual({ label: '3', progress: 0 });
    expect(countInStep(-1200)).toEqual({ label: '2', progress: 0.5 });
    expect(countInStep(-1)?.label).toBe('1');
    expect(countInStep(300)).toEqual({ label: 'GO', progress: 0.5 });
  });

  it('is silent outside the count-in', () => {
    expect(countInStep(-2401)).toBeUndefined();
    expect(countInStep(600)).toBeUndefined();
    expect(countInStep(Number.NEGATIVE_INFINITY)).toBeUndefined();
  });
});

describe('tileFlipPhase', () => {
  it('flips the top-left tile first and the bottom-right tile last', () => {
    expect(tileFlipPhase(0, 0, 10, 8, 0.5)).toBe(1);
    expect(tileFlipPhase(9, 7, 10, 8, 0.5)).toBe(0);
    expect(tileFlipPhase(9, 7, 10, 8, 1)).toBe(1);
  });

  it('stays within 0..1', () => {
    for (const t of [-1, 0, 0.3, 0.7, 2]) {
      const phase = tileFlipPhase(4, 3, 10, 8, t);
      expect(phase).toBeGreaterThanOrEqual(0);
      expect(phase).toBeLessThanOrEqual(1);
    }
  });
});

describe('scrambleText', () => {
  it('is blank before, noisy during, and exact after', () => {
    expect(scrambleText('LATTICE', 0, 1)).toMatch(/^.\s{6}$/u);
    const middle = scrambleText('LATTICE', 0.5, 1);
    expect(Array.from(middle)).toHaveLength(7);
    expect(middle).not.toBe('LATTICE');
    expect(scrambleText('LATTICE', 1, 1)).toBe('LATTICE');
    expect(scrambleText('LATTICE', 2, 1)).toBe('LATTICE');
  });

  it('decodes left to right', () => {
    const early = scrambleText('ABCDEFGH', 0.55, 3);
    expect(early.slice(0, 2)).toBe('AB');
    expect(early.at(-1)).not.toBe('H');
  });

  it('keeps spaces and line length, scrambling wide characters through katakana', () => {
    const scrambled = scrambleText('曲 名です', 0.5, 2);
    expect(Array.from(scrambled)).toHaveLength(5);
    expect(Array.from(scrambled)[1]).toBe(' ');
    for (const char of scrambled) {
      if (char !== ' ') expect(char.codePointAt(0)!).toBeGreaterThan(0x2e7f);
    }
  });

  it('re-rolls glyphs with the tick but is stable within one', () => {
    expect(scrambleText('SCRAMBLE', 0.5, 9)).toBe(scrambleText('SCRAMBLE', 0.5, 9));
    const rolls = new Set([1, 2, 3, 4, 5, 6].map((tick) => scrambleText('SCRAMBLE', 0.5, tick)));
    expect(rolls.size).toBeGreaterThan(1);
  });

  it('handles empty text and bad progress', () => {
    expect(scrambleText('', 0.5, 1)).toBe('');
    expect(scrambleText('ABC', Number.NaN, 1)).toBe('ABC');
  });
});

describe('scrambleTick', () => {
  it('advances every interval', () => {
    expect(scrambleTick(0)).toBe(0);
    expect(scrambleTick(44)).toBe(0);
    expect(scrambleTick(45)).toBe(1);
    expect(scrambleTick(Number.NaN)).toBe(0);
  });
});
