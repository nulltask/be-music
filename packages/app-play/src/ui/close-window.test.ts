import { expect, test, vi } from 'vite-plus/test';
import { requestPlayerWindowClose } from './close-window.ts';
test('requests closing and reports a blocked browser close without navigation', () => {
  const blocked = vi.fn();
  const callbacks: (() => void)[] = [];
  const win = {
    close: vi.fn(),
    closed: false,
    setTimeout: (callback: () => void) => {
      callbacks.push(callback);
      return 1;
    },
  };
  requestPlayerWindowClose(win as unknown as Pick<Window, 'close' | 'closed' | 'setTimeout'>, blocked);
  expect(win.close).toHaveBeenCalledOnce();
  callbacks[0]!();
  expect(blocked).toHaveBeenCalledOnce();
  win.closed = true;
  blocked.mockClear();
  callbacks[0]!();
  expect(blocked).not.toHaveBeenCalled();
});
