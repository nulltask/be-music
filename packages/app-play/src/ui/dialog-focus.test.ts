import { expect, test, vi } from 'vite-plus/test';
import { releaseFocusOnClose, returnKeysToPlay } from './dialog-focus.ts';

test('takes focus off the button the dialog restored it to', () => {
  const blur = vi.fn();
  returnKeysToPlay({ activeElement: { blur } });
  expect(blur).toHaveBeenCalledOnce();
  expect(() => returnKeysToPlay({ activeElement: null })).not.toThrow();
  expect(() => returnKeysToPlay({ activeElement: {} })).not.toThrow();
});

test('releases the focus each time the dialog closes', () => {
  let onClose: (() => void) | undefined;
  const blur = vi.fn();
  releaseFocusOnClose({ addEventListener: (_type, listener) => (onClose = listener) }, { activeElement: { blur } });
  expect(blur).not.toHaveBeenCalled();
  onClose?.();
  onClose?.();
  expect(blur).toHaveBeenCalledTimes(2);
});
