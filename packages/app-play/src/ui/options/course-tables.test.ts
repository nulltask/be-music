import { describe, expect, test } from 'vite-plus/test';
import { courseTableURLLabel } from './course-tables.ts';

describe('courseTableURLLabel', () => {
  test('names a table by its host and path until it has imported', () => {
    expect(courseTableURLLabel('https://stellabms.xyz/sl/table.html')).toBe('stellabms.xyz/sl/table.html');
    expect(courseTableURLLabel('https://example.com/')).toBe('example.com');
    expect(courseTableURLLabel('https://example.com/%E8%A1%A8/?level=2')).toBe('example.com/表?level=2');
    expect(courseTableURLLabel('not a url')).toBe('not a url');
  });
});
