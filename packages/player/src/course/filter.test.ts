import { describe, expect, test } from 'vite-plus/test';
import { type CourseSongRecord, evaluateCourseSongFilter, parseCourseSongFilter } from './index.ts';

const SONG: CourseSongRecord = {
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

function matches(sql: string, record: CourseSongRecord = SONG): boolean {
  const parsed = parseCourseSongFilter(sql);
  if (!parsed.ok) throw new Error(parsed.error);
  return evaluateCourseSongFilter(parsed.filter, record);
}

function parseError(sql: string): string | undefined {
  const parsed = parseCourseSongFilter(sql);
  return parsed.ok ? undefined : parsed.error;
}

describe('parseCourseSongFilter / evaluateCourseSongFilter', () => {
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
    expect(matches('notes >= 1000.5')).toBe(true);
  });

  test('AND, OR, NOT and parentheses follow SQL precedence', () => {
    expect(matches('level = 12 AND mode = 7')).toBe(true);
    expect(matches('level = 11 OR mode = 7 AND difficulty = 4')).toBe(true);
    expect(matches('(level = 11 OR mode = 7) AND difficulty = 3')).toBe(false);
    expect(matches('NOT level = 11')).toBe(true);
    expect(matches('not (level = 12 and mode = 7)')).toBe(false);
  });

  test('IN, BETWEEN and their negations', () => {
    expect(matches('level IN (11, 12)')).toBe(true);
    expect(matches('level NOT IN (11, 12)')).toBe(false);
    expect(matches("genre IN ('TRANCE', 'HOUSE')")).toBe(true);
    expect(matches('level IN ()')).toBe(false);
    expect(matches('level BETWEEN 10 AND 12 AND mode = 7')).toBe(true);
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
    expect(matches('`mode` = 7 AND [notes] > 0')).toBe(true);
    expect(matches('LEVEL = 12')).toBe(true);
  });

  test('arithmetic, bitwise and concatenation', () => {
    expect(matches('feature & 8 != 0')).toBe(true);
    expect(matches('(feature & 16) = 0')).toBe(true);
    expect(matches('feature | 1 = 73')).toBe(true);
    expect(matches('maxbpm - minbpm > 100')).toBe(true);
    expect(matches('notes / 1000 = 1')).toBe(true);
    expect(matches('notes / 1000.0 = 1.5')).toBe(true);
    expect(matches('notes % 7 = 2')).toBe(true);
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
    expect(matches('notes / 0 IS NULL')).toBe(true);
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
    expect(parseError('clear > 3')).toBe("unknown column 'clear'");
    expect(parseError('score.clear > 3')).toBe("unsupported table 'score'");
    expect(parseError("lower(title) = 'a'")).toBe('functions are not supported: lower');
    expect(parseError('sha256 IN (SELECT sha256 FROM score)')).toBe('sub-queries are not supported');
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
});
