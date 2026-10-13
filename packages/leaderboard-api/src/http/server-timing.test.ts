import { describe, expect, test } from 'vite-plus/test';
import { formatServerTiming, instrumentD1, type QueryTally } from './server-timing.ts';

/** A stand-in for the D1 binding: statements answer after the fake clock moves 10 ms. */
function fakeD1(clock: { now: number }) {
  const batched: unknown[][] = [];
  const statement = (sql: string, args: unknown[] = []): D1PreparedStatement =>
    ({
      sql,
      args,
      bind: (...next: unknown[]) => statement(sql, next),
      all: async () => {
        clock.now += 10;
        return { results: [{ sql, args }] };
      },
      first: async () => {
        clock.now += 10;
        return { sql, args };
      },
    }) as unknown as D1PreparedStatement;
  const d1 = {
    prepare: (sql: string) => statement(sql),
    batch: async (statements: D1PreparedStatement[]) => {
      clock.now += 25;
      batched.push(statements);
      return [];
    },
  } as unknown as D1Database;
  return { d1, batched };
}

describe('instrumentD1', () => {
  test('counts and times each statement that reaches the database', async () => {
    const clock = { now: 0 };
    const tally: QueryTally = { count: 0, ms: 0 };
    const { d1 } = fakeD1(clock);
    const db = instrumentD1(d1, tally, () => clock.now);

    const first = await db.prepare('select 1').bind(42).first();
    await db.prepare('select 2').all();

    expect(first).toEqual({ sql: 'select 1', args: [42] });
    expect(tally).toEqual({ count: 2, ms: 20 });
  });

  test('counts a batch as one call and hands D1 its own statements', async () => {
    const clock = { now: 0 };
    const tally: QueryTally = { count: 0, ms: 0 };
    const { d1, batched } = fakeD1(clock);
    const db = instrumentD1(d1, tally, () => clock.now);
    const statements = [db.prepare('a'), db.prepare('b').bind(1)];

    await db.batch(statements);

    expect(tally).toEqual({ count: 1, ms: 25 });
    // The wrappers were swapped back for the binding's statements.
    expect(batched[0]!.every((statement) => !statements.includes(statement as D1PreparedStatement))).toBe(true);
  });
});

describe('formatServerTiming', () => {
  test('reports the database calls and the whole request', () => {
    expect(formatServerTiming({ count: 7, ms: 123.456 }, 456.7)).toBe('db;dur=123.5;desc="7 queries", total;dur=456.7');
    expect(formatServerTiming({ count: 1, ms: 5 }, 9)).toBe('db;dur=5.0;desc="1 query", total;dur=9.0');
  });
});
