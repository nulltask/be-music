import { expect, test } from 'vite-plus/test';
import { renderHTML } from './server.ts';
import { resolveSkeleton, skeletonLabel, skeletonLength } from './skeleton-model.ts';
import { skeletonGroupTemplate, skeletonTemplate } from './skeleton-template.ts';

test('a length is pixels for a number and a CSS length as given, falling back on anything else', () => {
  expect(skeletonLength(24, '1em')).toBe('24px');
  expect(skeletonLength(0, '1em')).toBe('0px');
  expect(skeletonLength(' 12ch ', '1em')).toBe('12ch');
  expect(skeletonLength(undefined, '1em')).toBe('1em');
  expect(skeletonLength('', '1em')).toBe('1em');
  expect(skeletonLength(-4, '1em')).toBe('1em');
  expect(skeletonLength(Number.NaN, '1em')).toBe('1em');
  expect(skeletonLength('1px;background:red', '1em')).toBe('1em');
});

test('each shape takes the box of what it stands in for, and a circle stays round', () => {
  expect(resolveSkeleton()).toEqual({ shape: 'line', style: 'inline-size:100%;block-size:1em' });
  expect(resolveSkeleton({ shape: 'line', width: '18ch' })).toEqual({
    shape: 'line',
    style: 'inline-size:18ch;block-size:1em',
  });
  expect(resolveSkeleton({ shape: 'circle' })).toEqual({ shape: 'circle', style: 'inline-size:24px;block-size:24px' });
  expect(resolveSkeleton({ shape: 'circle', width: 40, height: 10 })).toEqual({
    shape: 'circle',
    style: 'inline-size:40px;block-size:40px',
  });
  expect(resolveSkeleton({ shape: 'block', height: 32 })).toEqual({
    shape: 'block',
    style: 'inline-size:100%;block-size:32px',
  });
});

test('a loading region is announced in the page language unless the caller names it', () => {
  expect(skeletonLabel('en')).toBe('Loading…');
  expect(skeletonLabel('ja')).toBe('読み込み中…');
  expect(skeletonLabel('en', '  ')).toBe('Loading…');
  expect(skeletonLabel('en', 'Checking account…')).toBe('Checking account…');
});

test('placeholders are silent and their group is busy, on the server as in the browser', () => {
  const shape = renderHTML(skeletonTemplate({ shape: 'circle', width: 24, className: 'extra' }));
  expect(shape).toContain('class="be-music-skeleton extra"');
  expect(shape).toContain('data-shape="circle"');
  expect(shape).toContain('style="inline-size:24px;block-size:24px"');
  expect(shape).toContain('aria-hidden="true"');
  const group = renderHTML(skeletonGroupTemplate({ locale: 'ja', content: skeletonTemplate() }));
  expect(group).toContain('role="status"');
  expect(group).toContain('aria-busy="true"');
  expect(group).toContain('<span class="be-music-skeleton-label">読み込み中…</span>');
  expect(group).toContain('class="be-music-skeleton"');
  const named = renderHTML(skeletonGroupTemplate({ locale: 'en', label: '<b>x</b>', content: '' }));
  expect(named).toContain('&lt;b&gt;x&lt;/b&gt;');
});
