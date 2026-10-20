import type { CourseDefinitionGroup } from '@be-music/player-web/collection';
import { describe, expect, test } from 'vite-plus/test';
import {
  COURSE_TABLE_URLS_STORAGE_KEY,
  describeCourseTableImportError,
  importCourseTable,
  isTableHeaderFilePath,
  mergeCourseGroup,
  normalizeCourseTableURL,
  parseStoredCourseTableURLs,
  readStoredCourseTableURLs,
  readTableHeaderFile,
  rememberCourseTableURL,
} from './course-table-import.ts';

const MD5_A = '0123456789abcdef0123456789abcdef';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe('course table URLs', () => {
  test('normalizeCourseTableURL accepts absolute http(s) URLs only', () => {
    expect(normalizeCourseTableURL('  https://example.com/sl/table.html ')).toBe('https://example.com/sl/table.html');
    expect(normalizeCourseTableURL('http://example.com')).toBe('http://example.com/');
    expect(normalizeCourseTableURL('')).toBeUndefined();
    expect(normalizeCourseTableURL('table.html')).toBeUndefined();
    expect(normalizeCourseTableURL('javascript:alert(1)')).toBeUndefined();
  });

  test('parseStoredCourseTableURLs keeps valid, distinct URLs', () => {
    expect(parseStoredCourseTableURLs(null)).toEqual([]);
    expect(parseStoredCourseTableURLs('{')).toEqual([]);
    expect(parseStoredCourseTableURLs('{"a":1}')).toEqual([]);
    expect(parseStoredCourseTableURLs('["https://a.example/t.html", 1, "nope", "https://a.example/t.html"]')).toEqual([
      'https://a.example/t.html',
    ]);
  });

  test('rememberCourseTableURL stores each URL once', () => {
    const storage = memoryStorage();
    expect(readStoredCourseTableURLs(storage)).toEqual([]);
    rememberCourseTableURL('https://a.example/t.html', storage);
    expect(rememberCourseTableURL('https://a.example/t.html', storage)).toEqual(['https://a.example/t.html']);
    rememberCourseTableURL('https://b.example/h.json', storage);
    expect(JSON.parse(storage.getItem(COURSE_TABLE_URLS_STORAGE_KEY)!)).toEqual([
      'https://a.example/t.html',
      'https://b.example/h.json',
    ]);
  });

  test('blocked storage reads as empty and still returns the URL', () => {
    const blocked: Pick<Storage, 'getItem' | 'setItem'> = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readStoredCourseTableURLs(blocked)).toEqual([]);
    expect(rememberCourseTableURL('https://a.example/t.html', blocked)).toEqual(['https://a.example/t.html']);
  });
});

describe('mergeCourseGroup', () => {
  const group = (label: string, name: string): CourseDefinitionGroup => ({
    label,
    courses: [
      {
        name,
        kind: 'grade',
        stages: [],
        constraints: [],
        trophies: [],
        release: true,
        source: { format: 'table', legacyGrade: false },
      },
    ],
  });

  test('appends a new label and replaces an existing one in place', () => {
    const groups = [group('A', 'a1'), group('B', 'b1')];
    expect(mergeCourseGroup(groups, group('C', 'c1')).map((g) => g.label)).toEqual(['A', 'B', 'C']);
    const replaced = mergeCourseGroup(groups, group('A', 'a2'));
    expect(replaced.map((g) => [g.label, g.courses[0]!.name])).toEqual([
      ['A', 'a2'],
      ['B', 'b1'],
    ]);
    expect(groups[0]!.courses[0]!.name).toBe('a1');
  });
});

describe('importCourseTable', () => {
  test('reads a table page into one labelled group', async () => {
    const pages: Record<string, string> = {
      'https://example.com/t/table.html': '<meta name="bmstable" content="header.json">',
      'https://example.com/t/header.json': JSON.stringify({
        name: 'Example',
        course: [[{ name: 'ex0', md5: [MD5_A] }]],
      }),
    };
    const imported = await importCourseTable('https://example.com/t/table.html', async (url) => pages[url]!);
    expect(imported.headerURL).toBe('https://example.com/t/header.json');
    expect(imported.group.label).toBe('Example');
    expect(imported.group.courses.map((course) => course.name)).toEqual(['ex0']);
  });

  test('rejects a table without courses', async () => {
    await expect(importCourseTable('https://example.com/h.json', async () => '{"name":"Empty"}')).rejects.toThrow(
      /no course/u,
    );
  });

  test('describes a blocked fetch with what to do instead', () => {
    expect(describeCourseTableImportError(new TypeError('Failed to fetch'))).toMatch(/drop it here/u);
    expect(describeCourseTableImportError(new Error('HTTP 404'))).toBe('Course table import failed: HTTP 404');
  });
});

describe('saved table headers', () => {
  const header = JSON.stringify({
    name: 'Insane',
    course: [[{ name: 'Dan 1', md5: [MD5_A], constraint: ['grade_mirror'] }]],
  });

  test('isTableHeaderFilePath matches header.json in any folder', () => {
    expect(isTableHeaderFilePath('tables/insane/header.json')).toBe(true);
    expect(isTableHeaderFilePath('HEADER.JSON')).toBe(true);
    expect(isTableHeaderFilePath('skin/play.json')).toBe(false);
  });

  test('readTableHeaderFile reads the courses under the table name', () => {
    const group = readTableHeaderFile(header, 'insane');
    expect(group?.label).toBe('Insane');
    expect(group?.courses.map((course) => course.name)).toEqual(['Dan 1']);
    expect(readTableHeaderFile(JSON.stringify({ symbol: '★', course: JSON.parse(header).course }), 'x')?.label).toBe(
      '★',
    );
    expect(readTableHeaderFile(JSON.stringify({ course: JSON.parse(header).course }), 'insane')?.label).toBe('insane');
  });

  test('readTableHeaderFile leaves files that are not table headers with courses', () => {
    expect(readTableHeaderFile('not json', 'x')).toBeUndefined();
    expect(readTableHeaderFile('[1]', 'x')).toBeUndefined();
    expect(readTableHeaderFile(JSON.stringify({ name: 'No courses' }), 'x')).toBeUndefined();
  });
});
