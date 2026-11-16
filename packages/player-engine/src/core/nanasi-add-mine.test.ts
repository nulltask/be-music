import { describe, expect, test } from 'vite-plus/test';
import { addNanasiMines } from './nanasi-add-mine.ts';

/** A random source that returns `values` in turn (as fractions of `n` for nanasigroove's `rand() % n`). */
function sequence(...values: number[]): () => number {
  let index = 0;
  return () => {
    if (index >= values.length) throw new Error('sequence exhausted');
    return values[index++]!;
  };
}

describe('addNanasiMines', () => {
  test('a regular lane: a 360 step, four candidates in five, damage by band, halved to a gauge percentage', () => {
    const random = sequence(
      0.5, // lane kind 500: regular
      0, // first step: 0 + 24
      0.5, // candidate kept (2 of 5)
      0.1, // damage band 100: under 400 → 1–5
      0.9, // 4 + 1 = 5 points → 2.5 %
      0.5, // next step: 180 + 24 → 228
      0, // candidate dropped (0 of 5)
      0.99, // next step: 356 + 24 → 608, past the end
    );
    expect(addNanasiMines(['11'], new Map(), 12, random)).toEqual([{ lane: '11', beat: 0.5, damage: 2.5 }]);
  });

  test('the bands follow the lane thresholds, and the rarest band heals, played as no damage', () => {
    const mineAt = (band: number, value: number) =>
      addNanasiMines(['11'], new Map(), 1, sequence(0.5, 0, 0.5, band, value, 0.99))[0]!.damage;
    expect(mineAt(0.5, 0.99)).toBe(5); // 925 > 500 ≥ 400: 1–10 → 10 points
    expect(mineAt(0.95, 0.99)).toBe(25); // under 975: 1–50 → 50 points
    expect(mineAt(0.99, 0.999)).toBe(100); // under 998: 1–200 → 200 points
    expect(addNanasiMines(['11'], new Map(), 1, sequence(0.5, 0, 0.5, 0.999, 0.99))[0]!.damage).toBe(0);
  });

  test('a candidate within 12 positions of a note on its lane is skipped, without a damage draw', () => {
    // A note at beat 0.75 (36): the first candidate at 24 is 12 away.
    const random = sequence(0.5, 0, 0.5, 0.99);
    expect(addNanasiMines(['11'], new Map([['11', [0.75]]]), 1, random)).toEqual([]);
    // 13 away is clear.
    const clear = sequence(0.5, 0, 0.5, 0, 0, 0.99);
    expect(addNanasiMines(['11'], new Map([['11', [0.77]]]), 1, clear)).toHaveLength(1);
  });

  test('a dense lane steps by up to 168, and a varied lane draws its two steps and last threshold', () => {
    // Dense (kind 0): first step 168 → 0.9 × 168 = 151 + 24 = 175.
    const dense = sequence(0, 0.9, 0, 0.9);
    expect(addNanasiMines(['11'], new Map(), 4, dense)).toEqual([]);
    // Varied (kind 50): steps 360 − 90 = 270 and 360 − 0 = 360, last threshold 998 − 4 = 994.
    // Its band 995 is past 994, the healing band, played as no damage.
    const varied = sequence(0.05, 0.5, 0, 0.5, 0, 0.5, 0.995, 0.99);
    expect(addNanasiMines(['11'], new Map(), 1, varied)).toEqual([{ lane: '11', beat: 0.5, damage: 0 }]);
  });

  test('lanes draw in the order given and are returned lane by lane', () => {
    const random = sequence(0.5, 0, 0.5, 0.1, 0, 0.99, 0.5, 0, 0.5, 0.1, 0, 0.99);
    expect(addNanasiMines(['12', '11'], new Map(), 1, random).map((mine) => mine.lane)).toEqual(['12', '11']);
  });

  test('a draw outside [0, 1) is refused', () => {
    expect(() => addNanasiMines(['11'], new Map(), 12, () => 1)).toThrow(RangeError);
  });
});
