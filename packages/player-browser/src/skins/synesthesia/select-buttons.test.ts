import { describe, expect, it } from 'vite-plus/test';
import { canStartFocusedEntry } from './select-buttons.ts';

describe('canStartFocusedEntry', () => {
  it('lets PLAY and AUTO start a chart or a course', () => {
    expect(canStartFocusedEntry({ chart: {} })).toBe(true);
    expect(canStartFocusedEntry({ course: {} })).toBe(true);
  });

  it('disables them on a folder or with no bar under the cursor', () => {
    expect(canStartFocusedEntry({})).toBe(false);
    expect(canStartFocusedEntry({ chart: undefined, course: undefined })).toBe(false);
  });
});
