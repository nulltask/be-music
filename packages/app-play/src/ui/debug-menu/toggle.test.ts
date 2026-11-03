import { expect, test } from 'vite-plus/test';
import { DebugMenu } from './index.ts';

test('the header gear opens and closes the Options dialog', () => {
  const pane = { expanded: false };
  const menu = Object.create(DebugMenu.prototype) as DebugMenu;
  menu.gui = pane as DebugMenu['gui'];
  menu.toggle();
  expect(pane.expanded).toBe(true);
  menu.toggle();
  expect(pane.expanded).toBe(false);
  const missing = Object.create(DebugMenu.prototype) as DebugMenu;
  missing.toggle();
});
