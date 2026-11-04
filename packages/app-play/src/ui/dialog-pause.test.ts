import { expect, test, vi } from 'vite-plus/test';
import { DialogPauseController } from './dialog-pause.ts';
function play(paused = false) {
  return {
    isPaused: () => paused,
    requestTogglePause: vi.fn(() => {
      paused = !paused;
    }),
  };
}
test('pauses until the last modal closes', () => {
  const current = play();
  const controller = new DialogPauseController(() => current);
  controller.setOpen('help', true);
  controller.setOpen('settings', true);
  expect(current.isPaused()).toBe(true);
  controller.setOpen('help', false);
  expect(current.requestTogglePause).toHaveBeenCalledTimes(1);
  controller.setOpen('settings', false);
  expect(current.isPaused()).toBe(false);
});
test('keeps a user-paused play paused and never resumes a replacement play', () => {
  let current = play(true);
  const controller = new DialogPauseController(() => current);
  controller.setOpen('help', true);
  controller.setOpen('help', false);
  expect(current.requestTogglePause).not.toHaveBeenCalled();
  current = play();
  controller.setOpen('help', true);
  current = play(true);
  controller.setOpen('help', false);
  expect(current.requestTogglePause).not.toHaveBeenCalled();
});
