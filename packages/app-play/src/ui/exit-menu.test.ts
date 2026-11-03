import { expect, test } from 'vite-plus/test';
import { exitMenuChoice } from './exit-menu.ts';

test('the exit menu leaves only when its Leave button closed it', () => {
  expect(exitMenuChoice('leave')).toBe('leave');
  expect(exitMenuChoice('cancel')).toBe('cancel');
  // Escape closes the dialog with no value.
  expect(exitMenuChoice('')).toBe('cancel');
});
