import { afterEach, expect, test, vi } from 'vite-plus/test';
import { confirmSkinDrop } from './skin-drop-prompt.ts';

afterEach(() => vi.unstubAllGlobals());

test('uses the requested family when confirmation is off and both families are available', async () => {
  const querySelector = vi.fn();
  vi.stubGlobal('document', { querySelector });

  await expect(confirmSkinDrop(new Set(['lr2', 'beatoraja']), 'beatoraja', 'apply', vi.fn())).resolves.toBe(
    'beatoraja',
  );
  expect(querySelector).not.toHaveBeenCalled();
});

test.each([
  ['lr2', 'lr2', true],
  ['', undefined, true],
  ['', undefined, false],
] as const)('applies the checkbox to the next folder after closing (%j, %j, %j)', async (value, family, checked) => {
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
  const preference: { policy: 'ask' | 'apply' | 'keep-current' } = { policy: 'ask' };
  const rememberChoice = (apply: boolean) => {
    preference.policy = apply ? 'apply' : 'keep-current';
  };

  const result = confirmSkinDrop(new Set(['lr2']), undefined, preference.policy, rememberChoice);
  expect(checkbox.checked).toBe(false);
  checkbox.checked = checked;
  modal.returnValue = value;
  dialog.dispatchEvent(new Event('close'));

  await expect(result).resolves.toBe(family);
  expect(preference.policy).toBe(checked ? (family ? 'apply' : 'keep-current') : 'ask');
  const next = confirmSkinDrop(new Set(['beatoraja']), undefined, preference.policy, rememberChoice);
  if (checked) {
    expect(modal.showModal).toHaveBeenCalledOnce();
  } else {
    expect(modal.showModal).toHaveBeenCalledTimes(2);
    modal.returnValue = 'beatoraja';
    dialog.dispatchEvent(new Event('close'));
  }
  await expect(next).resolves.toBe(checked && !family ? undefined : 'beatoraja');
});
