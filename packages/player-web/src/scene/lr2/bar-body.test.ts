import type { Lr2BarBodyKind, Lr2BarBodySource } from '@be-music/lr2-skin';
import { describe, expect, it } from 'vite-plus/test';
import type { BrowserBrowseEntry, BrowserCourseEntry } from '../../collection/types.ts';
import { pickLr2BarBody } from './bar-body.ts';

function bodies(...kinds: Lr2BarBodyKind[]): Lr2BarBodySource[] {
  return kinds.map((kind) => ({ kind, source: { imagePath: `${kind}.png` } }) as unknown as Lr2BarBodySource);
}

function course(extra: Partial<BrowserCourseEntry> = {}): BrowserBrowseEntry {
  return { kind: 'course', course: { id: 'c', stages: [], playable: true, ...extra } as BrowserCourseEntry };
}

describe('pickLr2BarBody', () => {
  const all = bodies('song', 'folder', 'courseFolder', 'courseCreate', 'course', 'randomCourse');

  it('takes LR2’s NEW COURSE body (7) and random-course body (9)', () => {
    expect(pickLr2BarBody(all, course({ newCourse: true }))?.kind).toBe('courseCreate');
    expect(pickLr2BarBody(all, course({ random: {} as BrowserCourseEntry['random'] }))?.kind).toBe('randomCourse');
    expect(pickLr2BarBody(all, course())?.kind).toBe('course');
  });

  it('falls back to the course body (8), then the song body', () => {
    const plain = bodies('song', 'course');
    expect(pickLr2BarBody(plain, course({ newCourse: true }))?.kind).toBe('course');
    expect(pickLr2BarBody(plain, course({ random: {} as BrowserCourseEntry['random'] }))?.kind).toBe('course');
    expect(pickLr2BarBody(bodies('song'), course({ newCourse: true }))?.kind).toBe('song');
  });

  it('keeps the folder bodies and draws a body for an empty slot', () => {
    expect(pickLr2BarBody(all, { kind: 'folder', folder: { label: 'f', songs: [], courses: [] } })?.kind).toBe(
      'courseFolder',
    );
    expect(
      pickLr2BarBody(bodies('song', 'folder'), { kind: 'folder', folder: { label: 'f', songs: [], courses: [] } })
        ?.kind,
    ).toBe('folder');
    expect(pickLr2BarBody(all, undefined)?.kind).toBe('song');
    expect(pickLr2BarBody([], undefined)).toBeUndefined();
  });
});
