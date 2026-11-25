import { afterEach, expect, test } from 'vite-plus/test';
import './collapsible-panel.ts';
import type { CollapsiblePanelElement } from './collapsible-panel.ts';
import { mountAuxiliaryPanel, setAuxiliaryDockBelowStage, setAuxiliaryDockScreen } from './auxiliary-dock.ts';

afterEach(() => document.body.replaceChildren());

test('panels take their place in the row and their screens, whatever order they are mounted in', () => {
  const dock = document.createElement('div');
  dock.id = 'auxiliary-panels';
  document.body.append(dock);
  const skin = document.createElement('section');
  const warnings = document.createElement('aside');
  mountAuxiliaryPanel(skin, 'skin-config');
  mountAuxiliaryPanel(warnings, 'chart-diagnostics');
  expect(skin.parentElement).toBe(dock);
  expect(Number(warnings.style.order)).toBeLessThan(Number(skin.style.order));
  expect(warnings.dataset.auxiliaryScreens).toBe('select decide');

  setAuxiliaryDockScreen('play');
  expect(dock.dataset.screen).toBe('play');
  setAuxiliaryDockBelowStage(true);
  expect(dock.hasAttribute('data-below-stage')).toBe(true);
  setAuxiliaryDockBelowStage(false);
  expect(dock.hasAttribute('data-below-stage')).toBe(false);
});

test('a panel without a dock on the page goes to the fallback', () => {
  const fallback = document.createElement('div');
  document.body.append(fallback);
  const panel = document.createElement('aside');
  mountAuxiliaryPanel(panel, 'replay-slots', fallback);
  expect(panel.parentElement).toBe(fallback);
});

test('one panel is open at a time, and its owner hears when the dock closes it', async () => {
  const dock = document.createElement('div');
  dock.id = 'auxiliary-panels';
  document.body.append(dock);
  const first = document.createElement('be-music-collapsible-panel') as CollapsiblePanelElement;
  const second = document.createElement('be-music-collapsible-panel') as CollapsiblePanelElement;
  first.open = true;
  second.open = false;
  mountAuxiliaryPanel(first, 'chart-diagnostics');
  mountAuxiliaryPanel(second, 'skin-config');
  expect(first.position).toBe('dock');
  await first.updateComplete;
  const toggles: boolean[] = [];
  first.addEventListener('panel-toggle', (event) =>
    toggles.push((event as CustomEvent<{ open: boolean }>).detail.open),
  );

  second.open = true;
  await second.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(first.open).toBe(false);
  expect(second.open).toBe(true);
  expect(toggles).toEqual([false]);
});
