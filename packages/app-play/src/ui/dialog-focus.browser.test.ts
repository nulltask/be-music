import { afterEach, expect, test, vi } from 'vite-plus/test';
import { page, userEvent } from 'vite-plus/test/browser';
import { releaseFocusOnClose } from './dialog-focus.ts';

afterEach(() => document.body.replaceChildren());

test('Escape closes a native modal and the next Enter reaches the player keyboard handler', async ({
  onTestFinished,
}) => {
  const opener = document.createElement('button');
  opener.textContent = 'Options';
  const dialog = document.createElement('dialog');
  const close = document.createElement('button');
  close.textContent = 'Close';
  close.autofocus = true;
  dialog.append(close);
  const player = document.createElement('main');
  player.append(opener, dialog);
  document.body.append(player);
  releaseFocusOnClose(dialog);

  const open = vi.fn(() => dialog.showModal());
  opener.addEventListener('click', open);
  const play = vi.fn();
  function handleEnter(event: KeyboardEvent): void {
    if (event.key === 'Enter') play(event.target);
  }
  document.addEventListener('keydown', handleEnter);
  onTestFinished(() => document.removeEventListener('keydown', handleEnter));

  await page.getByRole('button', { name: 'Options' }).click();
  expect(dialog.matches(':modal')).toBe(true);
  expect(document.activeElement).toBe(close);
  await userEvent.keyboard('{Escape}');
  await expect.poll(() => document.activeElement).toBe(document.body);
  expect(dialog.open).toBe(false);
  await userEvent.keyboard('{Enter}');
  expect(play).toHaveBeenCalledExactlyOnceWith(document.body);
  expect(open).toHaveBeenCalledOnce();
  expect(dialog.open).toBe(false);
});
