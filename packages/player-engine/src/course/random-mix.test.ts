import { describe, expect, test } from 'vite-plus/test';
import {
  DEFAULT_LR2_RANDOM_MIX_SETTINGS,
  drawLR2RandomMix,
  type LR2RandomMixChart,
  type LR2RandomMixSettings,
  normalizeLR2RandomMixSettings,
  resolveLR2RandomMixSettings,
  stepLR2RandomMixSetting,
} from './index.ts';

function md5(n: number): string {
  return n.toString(16).padStart(32, '0');
}

function chart(n: number, values: Partial<LR2RandomMixChart> = {}): LR2RandomMixChart & { n: number } {
  return {
    n,
    md5: md5(n),
    folder: `f${n}`,
    keyMode: 7,
    level: 5,
    minBPM: 150,
    maxBPM: 150,
    title: `song ${n}`,
    ...values,
  };
}

function settings(values: Partial<LR2RandomMixSettings> = {}): LR2RandomMixSettings {
  return { ...DEFAULT_LR2_RANDOM_MIX_SETTINGS, ...values };
}

/** A `random` that keeps the input order: every shuffle step swaps an element with itself. */
const inOrder = (): number => 0.999999;

describe('LR2 RANDOM MIX settings', () => {
  test('step wraps around at both ends, BPMs by 10', () => {
    expect(stepLR2RandomMixSetting(settings(), 'stageCount', 1).stageCount).toBe(0);
    expect(stepLR2RandomMixSetting(settings({ stageCount: 0 }), 'stageCount', -1).stageCount).toBe(5);
    expect(stepLR2RandomMixSetting(settings(), 'maxBPM', -1).maxBPM).toBe(990);
    expect(stepLR2RandomMixSetting(settings({ maxBPM: 150 }), 'maxBPM', 1).maxBPM).toBe(160);
    expect(stepLR2RandomMixSetting(settings({ preferredLevel: 99 }), 'preferredLevel', 1).preferredLevel).toBe(0);
  });

  test('normalize clamps, snaps and fills LR2 defaults', () => {
    expect(normalizeLR2RandomMixSettings({ maxBPM: 1234, minBPM: 155, stageCount: 'x', minLevel: -3 })).toEqual({
      ...DEFAULT_LR2_RANDOM_MIX_SETTINGS,
      maxBPM: 990,
      minBPM: 160,
      minLevel: 0,
    });
  });

  test('resolve swaps min and max only when both are set', () => {
    expect(resolveLR2RandomMixSettings(settings({ minLevel: 9, maxLevel: 3, minBPM: 200, maxBPM: 100 }))).toEqual(
      settings({ minLevel: 3, maxLevel: 9, minBPM: 100, maxBPM: 200 }),
    );
    expect(resolveLR2RandomMixSettings(settings({ minLevel: 9 })).minLevel).toBe(9);
  });
});

describe('drawLR2RandomMix', () => {
  test('draws the stage count from distinct folders and builds a made course', () => {
    const charts = [chart(1), chart(2), chart(3, { folder: 'f2' }), chart(4), chart(5)];
    const result = drawLR2RandomMix(
      { kind: 'expert', keyMode: 7, settings: settings({ stageCount: 3 }) },
      charts,
      inOrder,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.charts.map(({ n }) => n)).toEqual([1, 2, 4]);
    expect(result.course).toMatchObject({
      name: 'RANDOM MIX',
      kind: 'expert',
      keyMode: 7,
      release: false,
      stages: [{ md5: md5(1) }, { md5: md5(2) }, { md5: md5(4) }],
    });
  });

  test('a random stage count draws 2-5 from the first draw', () => {
    const charts = [1, 2, 3, 4, 5, 6].map((n) => chart(n));
    const draw = (first: number) =>
      drawLR2RandomMix({ kind: 'expert', keyMode: 7, settings: settings({ stageCount: 0 }) }, charts, () => first);
    const count = (first: number) => {
      const result = draw(first);
      return result.ok ? result.charts.length : 0;
    };
    expect(count(0)).toBe(2);
    expect(count(0.999)).toBe(5);
  });

  test('a course runs short when candidates run out', () => {
    const result = drawLR2RandomMix(
      { kind: 'expert', keyMode: 7, settings: settings() },
      [chart(1), chart(2, { folder: 'f1' })],
      inOrder,
    );
    expect(result.ok && result.charts.map(({ n }) => n)).toEqual([1]);
  });

  test('filters by key mode, level limits and a valid MD5', () => {
    const charts = [
      chart(1, { keyMode: 5 }),
      chart(2, { level: 12 }),
      chart(3, { md5: 'nope' }),
      chart(4, { level: 3 }),
      chart(5, { level: 8 }),
    ];
    const result = drawLR2RandomMix(
      { kind: 'expert', keyMode: 7, settings: settings({ minLevel: 4, maxLevel: 10 }) },
      charts,
      inOrder,
    );
    expect(result.ok && result.charts.map(({ n }) => n)).toEqual([5]);
    expect(drawLR2RandomMix({ kind: 'expert', keyMode: 14, settings: settings() }, charts, inOrder)).toEqual({
      ok: false,
      reason: 'no-candidates',
    });
  });

  test('stage 1 needs a constant BPM with a range; stages 2+ stay within the range of its max BPM', () => {
    const charts = [
      chart(1, { minBPM: 100, maxBPM: 200 }),
      chart(2, { minBPM: 180, maxBPM: 180 }),
      chart(3, { minBPM: 170, maxBPM: 190 }),
      chart(4, { minBPM: 150, maxBPM: 190 }),
      chart(5, { minBPM: 185, maxBPM: 200 }),
    ];
    const result = drawLR2RandomMix(
      { kind: 'expert', keyMode: 7, settings: settings({ bpmRange: 10 }) },
      charts,
      inOrder,
    );
    expect(result.ok && result.charts.map(({ n }) => n)).toEqual([2, 3]);
    // Without a range, any BPM goes, and stage 1 may change BPM.
    const free = drawLR2RandomMix({ kind: 'expert', keyMode: 7, settings: settings({ bpmRange: 0 }) }, charts, inOrder);
    expect(free.ok && free.charts.map(({ n }) => n)).toEqual([1, 2, 3, 4, 5]);
  });

  test('BPM limits bound the min and max BPM', () => {
    const charts = [chart(1, { minBPM: 120, maxBPM: 160 }), chart(2, { minBPM: 140, maxBPM: 150 })];
    const result = drawLR2RandomMix(
      { kind: 'expert', keyMode: 7, settings: settings({ bpmRange: 0, minBPM: 130, maxBPM: 150 }) },
      charts,
      inOrder,
    );
    expect(result.ok && result.charts.map(({ n }) => n)).toEqual([2]);
  });

  test('a preferred level plays the nearest chart of the drawn folder within the level limits', () => {
    const charts = [
      chart(1, { level: 2 }),
      chart(2, { level: 9, folder: 'f1' }),
      chart(3, { level: 6, folder: 'f1' }),
      chart(4, { level: 12, folder: 'f1' }),
      chart(5, { level: 6, folder: 'f1', keyMode: 5 }),
    ];
    const result = drawLR2RandomMix(
      { kind: 'expert', keyMode: 7, settings: settings({ preferredLevel: 11, maxLevel: 10 }) },
      charts,
      inOrder,
    );
    expect(result.ok && result.charts.map(({ n }) => n)).toEqual([2]);
  });

  test('a NONSTOP draw gets the default connection after every stage', () => {
    const result = drawLR2RandomMix(
      { kind: 'nonstop', keyMode: 7, settings: settings({ stageCount: 3 }), defaultConnection: 'cut' },
      [chart(1), chart(2), chart(3)],
      inOrder,
    );
    expect(result.ok && result.course.connections).toEqual(['cut', 'cut']);
    expect(result.ok && result.course.source).toMatchObject({ format: 'lr2crs', type: 1 });
  });

  test('is deterministic given random', () => {
    const charts = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => chart(n));
    const seeded = () => {
      let seed = 7;
      return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    };
    const a = drawLR2RandomMix({ kind: 'expert', keyMode: 7, settings: settings() }, charts, seeded());
    const b = drawLR2RandomMix({ kind: 'expert', keyMode: 7, settings: settings() }, charts, seeded());
    expect(a).toEqual(b);
  });
});
