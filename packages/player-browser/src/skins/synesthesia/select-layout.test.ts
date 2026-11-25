import { expect, test } from 'vite-plus/test';
import { resolveSelectListWindow } from '../../skin/be-music/registry.ts';
import { LANDSCAPE_QUICK_OPTIONS_INSET } from './select-play-options.ts';
import { synesthesiaSelectSkin } from './select.ts';

test('fits twelve landscape list rows above the quick options at the standard stage height', () => {
  const height = 480;
  const { layout } = synesthesiaSelectSkin;
  const { visibleRows } = resolveSelectListWindow(layout, height, 8, 24);
  expect(visibleRows).toBe(12);
  const gap = height - LANDSCAPE_QUICK_OPTIONS_INSET - (layout.listTop + visibleRows * layout.rowHeight);
  expect(gap).toBe(1);
});
