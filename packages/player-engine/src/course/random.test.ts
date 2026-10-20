import { describe, expect, test } from 'vite-plus/test';
import {
  type CourseChartRecord,
  drawRandomCourse,
  parseBeatorajaCommandFolderFile,
  type RandomCourseDefinition,
} from './index.ts';

function hex(n: number, length: number): string {
  return n.toString(16).padStart(length, '0');
}

function chartEntry(
  n: number,
  level: number,
  extra: Partial<CourseChartRecord> = {},
): CourseChartRecord & { id: number } {
  return { id: n, md5: hex(n, 32), sha256: hex(n, 64), title: `song ${n}`, artist: `artist ${n}`, level, ...extra };
}

const LIBRARY = [chartEntry(1, 10), chartEntry(2, 11), chartEntry(3, 12), chartEntry(4, 12), chartEntry(5, 12)];

function definition(stages: RandomCourseDefinition['stages'], extra: Partial<RandomCourseDefinition> = {}) {
  return { name: 'Random', stages, constraints: [], trophies: [], distinct: false, ...extra } as RandomCourseDefinition;
}

/** A `random` that returns the given values in turn (then repeats the last one). */
function sequence(...values: number[]): () => number {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)]!;
}

describe('drawRandomCourse', () => {
  test('draws one chart per stage from its filter and builds a fixed course', () => {
    const result = drawRandomCourse(
      definition([{ filter: 'level = 10' }, { filter: 'level = 12' }], {
        constraints: ['grade_mirror', 'gauge_lr2'],
        trophies: [{ name: 'gold', missRate: 2.5, scoreRate: 85 }],
      }),
      LIBRARY,
      sequence(0, 0.5),
    );
    expect(result).toEqual({
      ok: true,
      course: {
        name: 'Random',
        kind: 'grade',
        stages: [
          { md5: hex(1, 32), sha256: hex(1, 64), title: 'song 1', artist: 'artist 1' },
          { md5: hex(4, 32), sha256: hex(4, 64), title: 'song 4', artist: 'artist 4' },
        ],
        constraints: ['grade_mirror', 'gauge_lr2'],
        trophies: [{ name: 'gold', missRate: 2.5, scoreRate: 85 }],
        release: false,
        source: { format: 'beatoraja-random' },
      },
      charts: [LIBRARY[0], LIBRARY[3]],
    });
  });

  test('is an expert course without a lane-option constraint', () => {
    const result = drawRandomCourse(definition([{ filter: 'level = 11' }]), LIBRARY, () => 0);
    expect(result.ok && result.course.kind).toBe('expert');
  });

  test('a first stage without a filter draws from every chart; a later one reuses the previous selection', () => {
    const first = drawRandomCourse(definition([{}]), LIBRARY, () => 0.99);
    expect(first.ok && first.charts.map(({ id }) => id)).toEqual([5]);
    const reuse = drawRandomCourse(definition([{ filter: 'level = 12' }, {}, {}]), LIBRARY, sequence(0, 0.4, 0.99));
    expect(reuse.ok && reuse.charts.map(({ id }) => id)).toEqual([3, 4, 5]);
  });

  test('without distinct a chart can repeat', () => {
    const result = drawRandomCourse(definition([{ filter: 'level = 12' }, {}]), LIBRARY, () => 0);
    expect(result.ok && result.charts.map(({ id }) => id)).toEqual([3, 3]);
  });

  test('distinct redraws a repeat and allows one once every candidate is taken', () => {
    const stages = [{ filter: 'level = 12' }, {}, {}, {}];
    const result = drawRandomCourse(definition(stages, { distinct: true }), LIBRARY, () => 0);
    // Stage 2 draws index 0 (song 3, taken), drops it, then draws song 4; stage 3 likewise ends on song 5; stage 4
    // finds every candidate taken and falls back to a plain draw.
    expect(result.ok && result.charts.map(({ id }) => id)).toEqual([3, 4, 5, 3]);
  });

  test('distinct compares charts by SHA-256', () => {
    const twin = { ...chartEntry(3, 12), id: 99, md5: hex(99, 32) };
    const result = drawRandomCourse(
      definition([{ filter: 'level = 12' }, {}], { distinct: true }),
      [chartEntry(3, 12), twin, chartEntry(4, 12)],
      sequence(0, 0, 0),
    );
    expect(result.ok && result.charts.map(({ id }) => id)).toEqual([3, 4]);
  });

  test('reports the first stage with no candidates or an invalid filter', () => {
    expect(
      drawRandomCourse(definition([{ filter: 'level = 11' }, { filter: 'level = 20' }]), LIBRARY, () => 0),
    ).toEqual({ ok: false, stage: 1, reason: 'no-candidates' });
    expect(drawRandomCourse(definition([{ filter: 'clear = 5' }]), LIBRARY, () => 0)).toEqual({
      ok: false,
      stage: 0,
      reason: 'invalid-filter',
      error: 'ambiguous column name: clear',
    });
    expect(drawRandomCourse(definition([{}]), [], () => 0)).toEqual({ ok: false, stage: 0, reason: 'no-candidates' });
  });

  test("draws from what a filter's ORDER BY / LIMIT leaves, as beatoraja's MY BEST folder writes it", () => {
    // `level DESC LIMIT 2` keeps songs 3 and 4 (ties keep the library order); 0.99 picks the second.
    const top = drawRandomCourse(
      definition([{ filter: 'level >= 11 ORDER BY level DESC LIMIT 2' }]),
      LIBRARY,
      () => 0.99,
    );
    expect(top.ok && top.charts.map((entry) => entry.id)).toEqual([4]);
    // A later stage without a filter reuses the cut selection.
    const reuse = drawRandomCourse(definition([{ filter: '1 ORDER BY level LIMIT 1' }, {}]), LIBRARY, () => 0.5);
    expect(reuse.ok && reuse.charts.map((entry) => entry.id)).toEqual([1, 1]);
  });

  test('ORDER BY RANDOM() draws its sort keys from the injected random source, before the pick', () => {
    // Keys for songs 3, 4, 5 come first (0.7, 0.2, 0.9 → order 4, 3, 5), LIMIT 1 keeps song 4, then the pick reads 0.
    const result = drawRandomCourse(
      definition([{ filter: 'level = 12 ORDER BY RANDOM() LIMIT 1' }]),
      LIBRARY,
      sequence(0.7, 0.2, 0.9, 0),
    );
    expect(result.ok && result.charts.map((entry) => entry.id)).toEqual([4]);
  });

  test('a filter with an unqualified ambiguous column is invalid, as it selects nothing in beatoraja', () => {
    expect(drawRandomCourse(definition([{ filter: 'mode = 7' }]), LIBRARY, () => 0)).toEqual({
      ok: false,
      stage: 0,
      reason: 'invalid-filter',
      error: 'ambiguous column name: mode',
    });
  });

  test('never draws a candidate without a chart hash, and clamps a random value of 1', () => {
    const result = drawRandomCourse(definition([{}]), [{ title: 'no hash', level: 1 }, chartEntry(7, 1)], () => 1);
    expect(result.ok && result.charts.map((entry) => entry.title)).toEqual(['song 7']);
  });

  test('is deterministic for the same random sequence', () => {
    const def = definition([{ filter: 'level >= 11' }, {}, {}], { distinct: true });
    const draw = () => drawRandomCourse(def, LIBRARY, sequence(0.3, 0.7, 0.1, 0.9, 0.5));
    expect(draw()).toEqual(draw());
  });
});

describe('parseBeatorajaCommandFolderFile', () => {
  test('collects the rcourse lists of nested command folders', () => {
    const file = JSON.stringify([
      { name: 'SQL only', sql: 'level = 12' },
      {
        name: 'Random',
        rcourse: [{ name: 'R1', stage: [{ sql: 'level = 12', title: 'Stage 1' }, {}], rconstraint: ['DISTINCT'] }],
        folder: [{ name: 'Inner', rcourse: [{ name: 'R2', stage: [{ sql: 'level = 1' }] }, { name: 'empty' }] }],
      },
      { rcourse: [{ name: 'R3', stage: [{}] }] },
    ]);
    expect(parseBeatorajaCommandFolderFile(file)).toEqual([
      {
        name: 'Random',
        courses: [
          {
            name: 'R1',
            stages: [{ filter: 'level = 12', title: 'Stage 1' }, {}],
            constraints: [],
            trophies: [],
            distinct: true,
          },
        ],
      },
      {
        name: 'Random > Inner',
        courses: [{ name: 'R2', stages: [{ filter: 'level = 1' }], constraints: [], trophies: [], distinct: false }],
      },
      {
        name: 'RANDOM COURSE',
        courses: [{ name: 'R3', stages: [{}], constraints: [], trophies: [], distinct: false }],
      },
    ]);
  });

  test('reads bytes and ignores a file that is not JSON', () => {
    const file = new TextEncoder().encode(JSON.stringify({ name: 'F', rcourse: [{ name: 'R', stage: [{}] }] }));
    expect(parseBeatorajaCommandFolderFile(file)).toHaveLength(1);
    expect(parseBeatorajaCommandFolderFile('{')).toEqual([]);
  });
});
