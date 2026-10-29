import { Texture } from 'pixi.js';
import { afterEach, expect, test, vi } from 'vite-plus/test';
import { createKeyBoundVideoTexture, isKeyBoundVideoCanvas } from './key-bound-video.ts';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test('keys each native video frame, keeps unkeyed black and cancels callbacks on disposal', () => {
  let source = new Uint8ClampedArray([255, 255, 255, 255, 237, 23, 75, 255, 0, 0, 0, 255]);
  let output: Uint8ClampedArray = new Uint8ClampedArray();
  let next: (() => void) | undefined;
  const handlers = new Map<string, () => void>();
  const video = {
    videoWidth: 3,
    videoHeight: 1,
    readyState: 2,
    requestVideoFrameCallback: vi.fn((fn: () => void) => {
      next = fn;
      return 17;
    }),
    cancelVideoFrameCallback: vi.fn(),
    addEventListener: (name: string, fn: () => void) => handlers.set(name, fn),
    removeEventListener: (name: string) => handlers.delete(name),
  } as unknown as HTMLVideoElement;
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      clearRect() {},
      drawImage() {},
      getImageData: () => ({ data: source.slice() }),
      putImageData: (image: { data: Uint8ClampedArray }) => {
        output = image.data;
      },
    }),
  };
  const update = vi.fn();
  vi.stubGlobal('document', { createElement: () => canvas });
  vi.spyOn(Texture, 'from').mockReturnValue({ source: { update } } as unknown as Texture);
  const keyed = createKeyBoundVideoTexture(video, { a: 255, r: 255, g: 255, b: 255 });
  expect([...output]).toEqual([255, 255, 255, 0, 237, 23, 75, 255, 0, 0, 0, 255]);
  expect(isKeyBoundVideoCanvas(canvas)).toBe(true);
  source = new Uint8ClampedArray([255, 255, 255, 255, 22, 207, 99, 255, 0, 0, 0, 255]);
  next!();
  expect([...output]).toEqual([255, 255, 255, 0, 22, 207, 99, 255, 0, 0, 0, 255]);
  expect(update).toHaveBeenCalledTimes(2);
  const pending = next;
  keyed.dispose();
  expect(video.cancelVideoFrameCallback).toHaveBeenCalledWith(17);
  expect(handlers.size).toBe(0);
  expect(isKeyBoundVideoCanvas(canvas)).toBe(false);
  pending!();
  expect(update).toHaveBeenCalledTimes(2);
});
