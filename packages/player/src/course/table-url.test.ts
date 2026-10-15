import { describe, expect, test } from 'vite-plus/test';
import { fetchTableHeaderCourses, resolveTableHeaderUrl } from './index.ts';

const MD5_A = '0123456789abcdef0123456789abcdef';
const HEADER = {
  name: 'Example table',
  symbol: 'ex',
  data_url: 'data.json',
  course: [[{ name: 'ex0', md5: [MD5_A] }], [{ name: 'ex1', md5: [MD5_A, MD5_A] }]],
};

function stubFetch(pages: Record<string, string>): { fetchText: (url: string) => Promise<string>; fetched: string[] } {
  const fetched: string[] = [];
  return {
    fetched,
    fetchText: async (url) => {
      fetched.push(url);
      const body = pages[url];
      if (body === undefined) throw new Error(`404 ${url}`);
      return body;
    },
  };
}

describe('resolveTableHeaderUrl', () => {
  const page = 'https://example.com/sl/table.html';

  test('resolves the bmstable meta content against the page URL', () => {
    expect(resolveTableHeaderUrl(page, '<head><meta name="bmstable" content="header.json"></head>')).toBe(
      'https://example.com/sl/header.json',
    );
    expect(resolveTableHeaderUrl(page, '<meta content="/tables/h.json" name="bmstable" />')).toBe(
      'https://example.com/tables/h.json',
    );
  });

  test('accepts any quoting and case, and decodes entities', () => {
    expect(resolveTableHeaderUrl(page, "<META NAME='BMSTable' CONTENT='./a/header.json'>")).toBe(
      'https://example.com/sl/a/header.json',
    );
    expect(resolveTableHeaderUrl(page, '<meta name=bmstable content=header.json>')).toBe(
      'https://example.com/sl/header.json',
    );
    expect(resolveTableHeaderUrl(page, '<meta name="bmstable" content="h.json?a=1&amp;b=2">')).toBe(
      'https://example.com/sl/h.json?a=1&b=2',
    );
    expect(resolveTableHeaderUrl(page, '<meta name="bmstable" content="https://cdn.example.org/h.json">')).toBe(
      'https://cdn.example.org/h.json',
    );
  });

  test('skips other meta tags and returns undefined without a bmstable meta', () => {
    expect(
      resolveTableHeaderUrl(
        page,
        '<meta charset="utf-8"><meta name="viewport" content="x"><meta name="bmstable" content="h.json">',
      ),
    ).toBe('https://example.com/sl/h.json');
    expect(resolveTableHeaderUrl(page, '<meta name="description" content="header.json">')).toBeUndefined();
    expect(resolveTableHeaderUrl(page, '<meta name="bmstable" content="">')).toBeUndefined();
    expect(resolveTableHeaderUrl('not a url', '<meta name="bmstable" content="h.json">')).toBeUndefined();
  });
});

describe('fetchTableHeaderCourses', () => {
  test('follows a table page to its header and flattens the course groups', async () => {
    const { fetchText, fetched } = stubFetch({
      'https://example.com/sl/table.html': '<html><meta name="bmstable" content="header.json"></html>',
      'https://example.com/sl/header.json': JSON.stringify(HEADER),
    });
    const result = await fetchTableHeaderCourses('https://example.com/sl/table.html', fetchText);
    expect(result.label).toBe('Example table');
    expect(result.headerUrl).toBe('https://example.com/sl/header.json');
    expect(result.courses.map((course) => course.name)).toEqual(['ex0', 'ex1']);
    // The song list behind data_url is never fetched.
    expect(fetched).toEqual(['https://example.com/sl/table.html', 'https://example.com/sl/header.json']);
  });

  test('reads a header JSON URL directly, with a BOM, and falls back to the symbol or host for the label', async () => {
    const { fetchText, fetched } = stubFetch({
      'https://example.com/h.json': `﻿${JSON.stringify({ ...HEADER, name: ' ' })}`,
      'https://example.com/bare.json': JSON.stringify({ course: HEADER.course }),
    });
    const bySymbol = await fetchTableHeaderCourses('https://example.com/h.json', fetchText);
    expect(bySymbol.label).toBe('ex');
    expect(bySymbol.courses).toHaveLength(2);
    expect((await fetchTableHeaderCourses('https://example.com/bare.json', fetchText)).label).toBe('example.com');
    expect(fetched).toEqual(['https://example.com/h.json', 'https://example.com/bare.json']);
  });

  test('rejects a page without a header and a header that is not JSON', async () => {
    const { fetchText } = stubFetch({
      'https://example.com/plain.html': '<html></html>',
      'https://example.com/broken.html': '<meta name="bmstable" content="h.json">',
      'https://example.com/h.json': '<html>not json</html>',
    });
    await expect(fetchTableHeaderCourses('https://example.com/plain.html', fetchText)).rejects.toThrow(/bmstable/u);
    await expect(fetchTableHeaderCourses('https://example.com/broken.html', fetchText)).rejects.toThrow(/JSON/u);
    await expect(fetchTableHeaderCourses('https://example.com/missing', fetchText)).rejects.toThrow(/404/u);
  });
});
