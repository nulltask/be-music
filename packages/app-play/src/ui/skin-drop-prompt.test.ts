import { afterEach, expect, test, vi } from 'vite-plus/test';
import { confirmSkinDrop } from './skin-drop-prompt.ts';

afterEach(() => vi.unstubAllGlobals());

test('uses the requested family when confirmation is off and both families are available', async () => {
  const querySelector = vi.fn();
  vi.stubGlobal('document', { querySelector });

  await expect(confirmSkinDrop(new Set(['lr2', 'beatoraja']), 'beatoraja', false, vi.fn())).resolves.toBe('beatoraja');
  expect(querySelector).not.toHaveBeenCalled();
});

test.each([
  ['lr2', 'lr2', true],
  ['', undefined, false],
] as const)('saves the checked preference only when a skin is accepted (%s)', async (value, family, saves) => {
  const checkbox = { checked: true };
  const dialog = new EventTarget();
  const modal = Object.assign(dialog, {
    open: false,
    returnValue: '',
    querySelector: () => checkbox,
    querySelectorAll: () => [],
    showModal: vi.fn(),
  });
  vi.stubGlobal('document', { querySelector: () => modal });
  const disableConfirmation = vi.fn();

  const result = confirmSkinDrop(new Set(['lr2']), undefined, true, disableConfirmation);
  expect(checkbox.checked).toBe(false);
  checkbox.checked = true;
  modal.returnValue = value;
  dialog.dispatchEvent(new Event('close'));

  await expect(result).resolves.toBe(family);
  expect(disableConfirmation).toHaveBeenCalledTimes(Number(saves));
});
