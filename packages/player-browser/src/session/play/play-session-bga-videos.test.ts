import { expect, test, vi } from 'vite-plus/test';
import { PlaySession } from './play-session.ts';

test('pause freezes every video and resume restarts the active second overlay only', () => {
  const session = new PlaySession({});
  function video() {
    const value = {
      paused: false,
      pause: vi.fn(() => {
        value.paused = true;
      }),
      play: vi.fn(async () => {
        value.paused = false;
      }),
    };
    return value;
  }
  const active = video(),
    inactive = video();
  const key = String.fromCharCode(0) + 'layer2:01';
  session.bgaVideos.set(key, { video: active as unknown as HTMLVideoElement, objectURL: 'blob:active' });
  session.bgaVideos.set('unused', { video: inactive as unknown as HTMLVideoElement, objectURL: 'blob:unused' });
  session.bgaActiveVideos.layer2 = { key, cueSeconds: 3 };
  session.pauseAllBGAVideos();
  expect(active.paused).toBe(true);
  expect(inactive.paused).toBe(true);
  session.resumeActiveBGAVideos();
  expect(active.play).toHaveBeenCalledOnce();
  expect(active.paused).toBe(false);
  expect(inactive.play).not.toHaveBeenCalled();
  expect(inactive.paused).toBe(true);
});
