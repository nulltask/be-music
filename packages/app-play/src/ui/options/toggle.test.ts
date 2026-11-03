import { expect, test } from 'vite-plus/test';
import { OptionsDialog } from './index.ts';

test('the header gear opens and closes the Options dialog', () => {
  const pane = { expanded: false };
  const menu = Object.create(OptionsDialog.prototype) as OptionsDialog;
  menu.gui = pane as OptionsDialog['gui'];
  menu.toggle();
  expect(pane.expanded).toBe(true);
  menu.toggle();
  expect(pane.expanded).toBe(false);
  const missing = Object.create(OptionsDialog.prototype) as OptionsDialog;
  missing.toggle();
});
