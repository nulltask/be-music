import { describe, expect, test } from 'vite-plus/test';
import {
  DEFAULT_LR2_RANDOM_MIX_SETTINGS,
  DEFAULT_RANDOM_MIX_CONDITIONS,
  createRandomMixCourse,
  drawRandomMixStage,
  filterRandomMixCandidates,
  isRandomMixKept,
  listRandomMixKeyModes,
  matchesRandomMixConditions,
  normalizeRandomMixConditions,
  resolveRandomMixCount,
  type LR2RandomMixSettings,
  type RandomMixCandidate,
  type RandomMixConditions,
} from './index.ts';

interface Chart extends RandomMixCandidate {
  n: number;
  bpm: [number, number];
}

function chart(n: number, values: Partial<Chart> = {}): Chart {
  return { n, folder: `f${n}`, keyMode: 7, level: 5, bpm: [150, 150], ...values };
}

function conditions(values: Partial<RandomMixConditions> = {}): RandomMixConditions {
  return { ...DEFAULT_RANDOM_MIX_CONDITIONS, ...values };
}

function settings(values: Partial<LR2RandomMixSettings> = {}): LR2RandomMixSettings {
  return { ...DEFAULT_LR2_RANDOM_MIX_SETTINGS, bpmRange: 0, ...values };
}

const bpmOf = (c: Chart) => ({ min: c.bpm[0], max: c.bpm[1] });

/** A seeded `[0, 1)` source (mulberry32), so a draw is reproducible. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('RANDOM MIX conditions', () => {
  test('normalize keeps valid values and falls back on the rest', () => {
    expect(normalizeRandomMixConditions(undefined)).toEqual(DEFAULT_RANDOM_MIX_CONDITIONS);
    expect(
      normalizeRandomMixConditions({
        keyModes: [14, 7, 7, 'x', -1],
        by: 'difficulty',
        minLevel: 120,
        maxLevel: -4,
        difficulties: [5, 9, 2],
        estimateDifficulty: false,
        count: 'infinity',
        loops: 500,
      }),
    ).toEqual({
      keyModes: [7, 14],
      by: 'difficulty',
      minLevel: 99,
      maxLevel: 0,
      difficulties: [2, 5],
      estimateDifficulty: false,
      count: 'infinity',
      loops: 99,
    });
    expect(normalizeRandomMixConditions({ count: 0, loops: 'infinity', by: 'other' })).toMatchObject({
      count: 1,
      loops: 'infinity',
      by: 'level',
    });
  });

  test('a chart matches by key mode and then by level range or difficulty', () => {
    expect(matchesRandomMixConditions(chart(1, { keyMode: 14 }), conditions())).toBe(false);
    expect(matchesRandomMixConditions(chart(1, { level: 5 }), conditions({ minLevel: 6 }))).toBe(false);
    // A min above the max is swapped; 0 is an open end.
    expect(matchesRandomMixConditions(chart(1, { level: 5 }), conditions({ minLevel: 8, maxLevel: 3 }))).toBe(true);
    expect(matchesRandomMixConditions(chart(1, { level: 50 }), conditions({ minLevel: 3 }))).toBe(true);
    const byDifficulty = conditions({ by: 'difficulty', difficulties: [4, 5], minLevel: 99 });
    expect(matchesRandomMixConditions(chart(1, { difficulty: 4 }), byDifficulty)).toBe(true);
    expect(matchesRandomMixConditions(chart(1, { difficulty: 2 }), byDifficulty)).toBe(false);
    // A chart naming no difficulty fits by its estimated one, unless estimating is off.
    expect(matchesRandomMixConditions(chart(1), byDifficulty)).toBe(false);
    expect(matchesRandomMixConditions(chart(1, { estimatedDifficulty: 5 }), byDifficulty)).toBe(true);
    expect(matchesRandomMixConditions(chart(1, { difficulty: 2, estimatedDifficulty: 5 }), byDifficulty)).toBe(false);
    expect(
      matchesRandomMixConditions(chart(1, { estimatedDifficulty: 5 }), { ...byDifficulty, estimateDifficulty: false }),
    ).toBe(false);
  });

  test('filter keeps library order and lists the key modes', () => {
    const charts = [chart(1, { keyMode: 14 }), chart(2), chart(3, { keyMode: 5 }), chart(4)];
    expect(filterRandomMixCandidates(charts, conditions({ keyModes: [7, 5] })).map((c) => c.n)).toEqual([2, 3, 4]);
    expect(listRandomMixKeyModes(charts)).toEqual([5, 7, 14]);
  });

  test('a NONSTOP draw is capped and never endless; only five stages or fewer are kept', () => {
    expect(resolveRandomMixCount('nonstop', 'infinity')).toBe(5);
    expect(resolveRandomMixCount('nonstop', 40)).toBe(5);
    expect(resolveRandomMixCount('nonstop', 3)).toBe(3);
    expect(resolveRandomMixCount('expert', 'infinity')).toBe('infinity');
    expect(isRandomMixKept(5)).toBe(true);
    expect(isRandomMixKept(6)).toBe(false);
    expect(isRandomMixKept('infinity')).toBe(false);
  });
});

describe('drawRandomMixStage', () => {
  test('is reproducible with the same random source', () => {
    const pool = Array.from({ length: 50 }, (_, n) => chart(n));
    const a = drawRandomMixStage(pool, { settings: settings(), bpmOf }, seeded(7));
    const b = drawRandomMixStage(pool, { settings: settings(), bpmOf }, seeded(7));
    expect(a).toBe(b);
  });

  test('picks uniformly among the charts that fit', () => {
    const pool = [chart(0), chart(1), chart(2), chart(3)];
    const random = seeded(1);
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < 4000; i += 1)
      counts[drawRandomMixStage(pool, { settings: settings(), bpmOf }, random)!.n]! += 1;
    for (const count of counts) expect(count).toBeGreaterThan(850);
  });

  test('skips used folders and excluded charts, and fails when none is left', () => {
    const pool = [chart(1), chart(2), chart(3)];
    const drawn = drawRandomMixStage(
      pool,
      { settings: settings(), bpmOf, usedFolders: new Set(['f1']), excluded: new Set([pool[2]!]) },
      seeded(3),
    );
    expect(drawn?.n).toBe(2);
    expect(
      drawRandomMixStage(pool, { settings: settings(), bpmOf, usedFolders: new Set(['f1', 'f2', 'f3']) }, seeded(3)),
    ).toBeUndefined();
  });

  test('stage 1 keeps one BPM under a BPM range; later stages stay in its key mode and BPM window', () => {
    const pool = [
      chart(1, { bpm: [100, 200] }),
      chart(2, { bpm: [150, 150] }),
      chart(3, { bpm: [180, 180] }),
      chart(4, { bpm: [155, 155], keyMode: 14 }),
      chart(5, { bpm: [158, 158] }),
    ];
    const ranged = settings({ bpmRange: 10 });
    expect(drawRandomMixStage(pool.slice(0, 2), { settings: ranged, bpmOf }, seeded(9))?.n).toBe(2);
    const first = pool[1]!;
    for (let seed = 0; seed < 20; seed += 1) {
      const next = drawRandomMixStage(
        pool,
        { settings: ranged, bpmOf, first, usedFolders: new Set(['f2']) },
        seeded(seed),
      );
      expect(next?.n).toBe(5);
    }
  });

  test('walks only as many charts as it needs for BPMs', () => {
    const pool = Array.from({ length: 1000 }, (_, n) => chart(n));
    let asked = 0;
    drawRandomMixStage(pool, { settings: settings({ bpmRange: 10 }), bpmOf: (c) => (asked++, bpmOf(c)) }, seeded(5));
    expect(asked).toBe(1);
    asked = 0;
    drawRandomMixStage(pool, { settings: settings(), bpmOf: (c) => (asked++, bpmOf(c)) }, seeded(5));
    expect(asked).toBe(0);
  });

  test('a favorite level swaps the drawn chart for its folder chart nearest that level', () => {
    const pool = [
      chart(1, { folder: 'a', level: 3 }),
      chart(2, { folder: 'a', level: 9 }),
      chart(3, { folder: 'a', level: 11 }),
    ];
    for (let seed = 0; seed < 10; seed += 1)
      expect(drawRandomMixStage(pool, { settings: settings({ preferredLevel: 10 }), bpmOf }, seeded(seed))?.n).toBe(2);
  });
});

describe('createRandomMixCourse', () => {
  test('names the course RANDOM MIX in stage 1 key mode, unranked', () => {
    const course = createRandomMixCourse('expert', [
      { md5: 'A'.repeat(32), keyMode: 7, title: 'one' },
      { md5: 'b'.repeat(32), keyMode: 7 },
    ])!;
    expect(course).toMatchObject({ name: 'RANDOM MIX', kind: 'expert', keyMode: 7, release: false });
    expect(course.stages.map((stage) => stage.md5)).toEqual(['a'.repeat(32), 'b'.repeat(32)]);
    expect(createRandomMixCourse('expert', [])).toBeUndefined();
  });
});
