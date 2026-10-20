import { describe, expect, test } from 'vite-plus/test';
import {
  type CourseChartRecord,
  evaluateCourseChartFilter,
  parseCourseChartFilter,
  selectCourseCharts,
} from './index.ts';

const SONG: CourseChartRecord = {
  md5: '0123456789abcdef0123456789abcdef',
  sha256: 'a'.repeat(64),
  title: 'Air (Another)',
  subtitle: '[ANOTHER]',
  artist: 'Some Artist',
  genre: 'TRANCE',
  path: 'songs/air/air_a.bms',
  level: 12,
  difficulty: 4,
  mode: 7,
  notes: 1500,
  minbpm: 150,
  maxbpm: 300,
  length: 125_000,
  judge: 2,
  feature: 8 | 64,
};

function matches(sql: string, record: CourseChartRecord = SONG): boolean {
  const parsed = parseCourseChartFilter(sql);
  if (!parsed.ok) throw new Error(parsed.error);
  return evaluateCourseChartFilter(parsed.filter, record);
}

function parseError(sql: string): string | undefined {
  const parsed = parseCourseChartFilter(sql);
  return parsed.ok ? undefined : parsed.error;
}

describe('parseCourseChartFilter / evaluateCourseChartFilter', () => {
  test('comparisons on integer columns', () => {
    expect(matches('level = 12')).toBe(true);
    expect(matches('level == 12')).toBe(true);
    expect(matches('level != 12')).toBe(false);
    expect(matches('level <> 11')).toBe(true);
    expect(matches('level < 12')).toBe(false);
    expect(matches('level <= 12')).toBe(true);
    expect(matches('level > 11')).toBe(true);
    expect(matches('level >= 13')).toBe(false);
    expect(matches('12 = level')).toBe(true);
    expect(matches('song.notes >= 1000.5')).toBe(true);
  });

  test('AND, OR, NOT and parentheses follow SQL precedence', () => {
    expect(matches('level = 12 AND song.mode = 7')).toBe(true);
    expect(matches('level = 11 OR song.mode = 7 AND difficulty = 4')).toBe(true);
    expect(matches('(level = 11 OR song.mode = 7) AND difficulty = 3')).toBe(false);
    expect(matches('NOT level = 11')).toBe(true);
    expect(matches('not (level = 12 and song.mode = 7)')).toBe(false);
  });

  test('IN, BETWEEN and their negations', () => {
    expect(matches('level IN (11, 12)')).toBe(true);
    expect(matches('level NOT IN (11, 12)')).toBe(false);
    expect(matches("genre IN ('TRANCE', 'HOUSE')")).toBe(true);
    expect(matches('level IN ()')).toBe(false);
    expect(matches('level BETWEEN 10 AND 12 AND song.mode = 7')).toBe(true);
    expect(matches('level NOT BETWEEN 10 AND 12')).toBe(false);
    expect(matches('maxbpm BETWEEN 100 AND 200')).toBe(false);
  });

  test('LIKE matches % and _ case-insensitively for ASCII, with ESCAPE', () => {
    expect(matches("title LIKE '%another%'")).toBe(true);
    expect(matches("title LIKE 'air%'")).toBe(true);
    expect(matches("title LIKE 'ai_ (Another)'")).toBe(true);
    expect(matches("title LIKE 'air'")).toBe(false);
    expect(matches("title NOT LIKE '%HYPER%'")).toBe(true);
    expect(matches("subtitle LIKE '[%]'")).toBe(true);
    expect(matches("path LIKE '%.bms'")).toBe(true);
    expect(matches("title LIKE '%x%%' ESCAPE 'x'", { title: 'a 100% b' })).toBe(true);
    expect(matches("title LIKE '%x%%' ESCAPE 'x'", { title: 'a 100 b' })).toBe(false);
    expect(matches("title LIKE 'Ä%'", { title: 'ä' })).toBe(false);
    expect(matches("level LIKE '1%'")).toBe(true);
  });

  test('text comparison is case-sensitive, as SQLite BINARY collation is', () => {
    expect(matches("genre = 'TRANCE'")).toBe(true);
    expect(matches("genre = 'trance'")).toBe(false);
    expect(matches("artist > 'Some'")).toBe(true);
  });

  test('column affinity converts the other operand as SQLite does', () => {
    expect(matches("level = '12'")).toBe(true);
    expect(matches("level = ' 12 '")).toBe(true);
    expect(matches("level < '12a'")).toBe(true);
    expect(matches('title = 12', { title: '12' })).toBe(true);
    expect(matches("'12' = 12")).toBe(false);
  });

  test('missing record fields read as the song database defaults', () => {
    expect(matches("title = ''", {})).toBe(true);
    expect(matches('level = 0', {})).toBe(true);
    expect(matches('difficulty IS NULL', {})).toBe(false);
    expect(matches('difficulty IS NOT NULL', {})).toBe(true);
  });

  test('qualified and quoted column names', () => {
    expect(matches('song.level = 12')).toBe(true);
    expect(matches('SONG."level" = 12')).toBe(true);
    expect(matches('song.`mode` = 7 AND song.[notes] > 0')).toBe(true);
    expect(matches(`song.sha256 = '${'a'.repeat(64)}'`)).toBe(true);
    expect(matches('LEVEL = 12')).toBe(true);
  });

  test('arithmetic, bitwise and concatenation', () => {
    expect(matches('feature & 8 != 0')).toBe(true);
    expect(matches('(feature & 16) = 0')).toBe(true);
    expect(matches('feature | 1 = 73')).toBe(true);
    expect(matches('maxbpm - minbpm > 100')).toBe(true);
    expect(matches('song.notes / 1000 = 1')).toBe(true);
    expect(matches('song.notes / 1000.0 = 1.5')).toBe(true);
    expect(matches('song.notes % 7 = 2')).toBe(true);
    expect(matches('level * 2 + 1 = 25')).toBe(true);
    expect(matches('-level = -12')).toBe(true);
    expect(matches("genre || '!' = 'TRANCE!'")).toBe(true);
  });

  test('NULL follows three-valued logic', () => {
    expect(matches('NULL')).toBe(false);
    expect(matches('level = NULL')).toBe(false);
    expect(matches('NOT (level = NULL)')).toBe(false);
    expect(matches('level = NULL OR level = 12')).toBe(true);
    expect(matches('level = NULL AND level = 11')).toBe(false);
    expect(matches('level IN (11, NULL)')).toBe(false);
    expect(matches('level NOT IN (11, NULL)')).toBe(false);
    expect(matches('level IN (12, NULL)')).toBe(true);
    expect(matches('NULL IS NULL')).toBe(true);
    expect(matches('song.notes / 0 IS NULL')).toBe(true);
  });

  test('a bare literal is true when it is a non-zero number', () => {
    expect(matches('1')).toBe(true);
    expect(matches('0')).toBe(false);
    expect(matches("'abc'")).toBe(false);
    expect(matches("'2x'")).toBe(true);
    expect(matches('0x10 = 16')).toBe(true);
  });

  test('strings keep doubled quotes', () => {
    expect(matches("artist = 'It''s'", { artist: "It's" })).toBe(true);
  });

  test('unsupported syntax fails closed with a reason', () => {
    expect(parseError('playcount > 3')).toBe("unknown column 'playcount'");
    expect(parseError('score.clear > 3')).toBe("unsupported table 'score'");
    expect(parseError("lower(title) = 'a'")).toBe('functions are not supported: lower');
    expect(parseError('song.sha256 IN (SELECT sha256 FROM score)')).toBe('sub-queries are not supported');
    expect(parseError("title GLOB 'a*'")).toMatch(/unexpected/u);
    expect(parseError('level = ')).toMatch(/unexpected end of filter/u);
    expect(parseError("title = 'open")).toMatch(/unterminated string/u);
    expect(parseError('level = 12;')).toMatch(/unexpected ';'/u);
    expect(parseError('level BETWEEN 1 OR 2')).toMatch(/expected AND/u);
    expect(parseError('(level = 1')).toMatch(/expected '\)'/u);
    expect(parseError('level IS 1')).toMatch(/expected NULL/u);
    expect(parseError('AND level = 1')).toMatch(/unexpected AND/u);
    expect(parseError('12abc = 1')).toMatch(/bad number/u);
    expect(parseError('')).toMatch(/unexpected end of filter/u);
  });

  test("unqualified columns beatoraja's joined tables share are ambiguous, as SQLite refuses them", () => {
    // song / score / scorelog / information: `mode = 7` selects nothing in beatoraja; `song.mode = 7` works.
    for (const column of ['sha256', 'mode', 'notes', 'date', 'clear', 'combo', 'minbp', 'avgjudge']) {
      expect(parseError(`${column} = 1`)).toBe(`ambiguous column name: ${column}`);
    }
    expect(parseError('`Mode` = 7')).toBe('ambiguous column name: Mode');
    expect(parseError('level = 12 ORDER BY notes')).toBe('ambiguous column name: notes');
    expect(matches('song.mode = 7')).toBe(true);
    expect(parseError('song.date > 0')).toBe("unknown column 'date'");
  });

  test('a trailing ORDER BY / LIMIT / OFFSET parses into the query', () => {
    const parsed = parseCourseChartFilter('level >= 11 ORDER BY level DESC, title ASC NULLS LAST LIMIT 10 OFFSET 2');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.filter).toEqual(parsed.query.where);
    expect(parsed.query.orderBy).toEqual([
      { key: { type: 'column', column: 'level' }, descending: true },
      { key: { type: 'column', column: 'title' }, descending: false, nulls: 'last' },
    ]);
    expect(parsed.query).toMatchObject({ limit: 10, offset: 2 });
    // `LIMIT m, n` puts the offset first; a negative LIMIT is none and a negative OFFSET is 0, as in SQLite.
    const comma = parseCourseChartFilter('1 LIMIT 3, 5');
    expect(comma.ok && comma.query).toMatchObject({ limit: 5, offset: 3 });
    const negative = parseCourseChartFilter('1 LIMIT -1 OFFSET -4');
    expect(negative.ok && negative.query).toEqual({ where: { type: 'literal', value: 1 }, orderBy: [], offset: 0 });
    const random = parseCourseChartFilter('level = 12 ORDER BY RANDOM() LIMIT 1');
    expect(random.ok && random.query.orderBy).toEqual([{ key: { type: 'random' }, descending: false }]);
  });

  test('ORDER BY / LIMIT syntax outside the subset fails closed', () => {
    expect(parseError('1 ORDER BY 1')).toMatch(/column number is not supported/u);
    expect(parseError('1 ORDER level')).toMatch(/expected BY/u);
    expect(parseError('1 LIMIT 1.5')).toMatch(/LIMIT takes an integer/u);
    expect(parseError('1 LIMIT level')).toMatch(/LIMIT takes an integer/u);
    expect(parseError('1 LIMIT 1 ORDER BY level')).toMatch(/unexpected 'ORDER'/u);
    expect(parseError('1 ORDER BY level NULLS')).toMatch(/expected FIRST or LAST/u);
    expect(parseError('1 ORDER BY lower(title)')).toBe('functions are not supported: lower');
    expect(parseError('random() > 0')).toBe('functions are not supported: random');
  });
});

describe('selectCourseCharts', () => {
  const SONGS: CourseChartRecord[] = [
    { md5: 'a', title: 'A', level: 11 },
    { md5: 'b', title: 'B', level: 12 },
    { md5: 'c', title: 'C', level: 12 },
    { md5: 'd', title: 'D', level: 10 },
    { md5: 'e', title: 'E', level: 12 },
  ];

  function select(sql: string, random?: () => number): string[] {
    const parsed = parseCourseChartFilter(sql);
    if (!parsed.ok) throw new Error(parsed.error);
    return selectCourseCharts(parsed.query, SONGS, (chartEntry) => chartEntry, random).map(
      (chartEntry) => chartEntry.md5!,
    );
  }

  test('without ORDER BY / LIMIT it keeps the candidates the clause passes, in order', () => {
    expect(select('level = 12')).toEqual(['b', 'c', 'e']);
  });

  test('orders by the terms, ties keeping the candidates order, then applies OFFSET and LIMIT', () => {
    expect(select('1 ORDER BY level DESC')).toEqual(['b', 'c', 'e', 'a', 'd']);
    expect(select('1 ORDER BY level DESC, title DESC')).toEqual(['e', 'c', 'b', 'a', 'd']);
    expect(select('1 ORDER BY level DESC LIMIT 2')).toEqual(['b', 'c']);
    expect(select('1 ORDER BY level LIMIT 2 OFFSET 1')).toEqual(['a', 'b']);
    expect(select('level = 12 LIMIT 1, 5')).toEqual(['c', 'e']);
    expect(select('1 LIMIT 0')).toEqual([]);
  });

  test('NULL sorts first ascending and last descending unless NULLS says otherwise', () => {
    // `level / (level - 12)` is NULL for level 12 (division by zero), -11 for A and -5 for D.
    expect(select('1 ORDER BY level / (level - 12), title')).toEqual(['b', 'c', 'e', 'a', 'd']);
    expect(select('1 ORDER BY level / (level - 12) DESC, title')).toEqual(['d', 'a', 'b', 'c', 'e']);
    expect(select('1 ORDER BY level / (level - 12) NULLS LAST, title')).toEqual(['a', 'd', 'b', 'c', 'e']);
  });

  test('ORDER BY RANDOM() takes one value per selected candidate from the injected source', () => {
    const values = [0.9, 0.1, 0.5];
    let calls = 0;
    const random = () => values[calls++]!;
    expect(select('level = 12 ORDER BY RANDOM()', random)).toEqual(['c', 'e', 'b']);
    expect(calls).toBe(3);
    expect(() => select('level = 12 ORDER BY RANDOM()')).toThrow(/random source/u);
  });
});
