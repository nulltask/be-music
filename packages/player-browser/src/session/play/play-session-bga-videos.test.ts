import { expect, test, vi } from 'vite-plus/test';
import { PlaySession } from './play-session.ts';
import { disposeBGAVideos } from './play-media.ts';

test.each(['layer2', 'poor'] as const)('pause freezes every video and resumes only the active %s plane', (track) => {
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
  const key = String.fromCharCode(0) + track + ':01';
  session.bgaVideos.set(key, { video: active as unknown as HTMLVideoElement, objectURL: 'blob:active' });
  session.bgaVideos.set('unused', { video: inactive as unknown as HTMLVideoElement, objectURL: 'blob:unused' });
  session.bgaActiveVideos[track] = { key, cueSeconds: 3 };
  session.pauseAllBGAVideos();
  expect(active.paused).toBe(true);
  expect(inactive.paused).toBe(true);
  session.resumeActiveBGAVideos();
  expect(active.play).toHaveBeenCalledOnce();
  expect(active.paused).toBe(false);
  expect(inactive.play).not.toHaveBeenCalled();
  expect(inactive.paused).toBe(true);
});

test('disposes a video shared by source and alias keys only once', () => {
  const video = { pause: vi.fn(), removeAttribute: vi.fn(), load: vi.fn() };
  const handle = { video: video as unknown as HTMLVideoElement, objectURL: 'blob:shared' };
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  try {
    const context = {
      bgaVideos: new Map([
        ['root', handle],
        ['alias', handle],
      ]),
      bgaActiveVideos: {},
    };
    disposeBGAVideos(context);
    expect(video.pause).toHaveBeenCalledOnce();
    expect(video.load).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:shared');
    expect(context.bgaVideos.size).toBe(0);
  } finally {
    revoke.mockRestore();
  }
});
