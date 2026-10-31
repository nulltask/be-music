import { Texture } from 'pixi.js';
import { afterEach, expect, test, vi } from 'vite-plus/test';
import { createColorKeyVideoTexture, isColorKeyVideoCanvas } from './color-key-video.ts';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test.each([
  { keys: { swBGAColorKey: { a: 255, r: 255, g: 255, b: 255 } }, white: 0, red: 255 },
  { keys: { bmsColorKey: { a: 0, r: 255, g: 255, b: 255 } }, white: 0, red: 255 },
  { keys: { bmsColorKey: { a: 255, r: 255, g: 255, b: 255 } }, white: 255, red: 255 },
  { keys: { bmsColorKey: { a: 0, r: 0, g: 0, b: 0 } }, white: 255, red: 255 },
  {
    keys: { bmsColorKey: { a: 0, r: 237, g: 23, b: 75 }, swBGAColorKey: { a: 255, r: 255, g: 255, b: 255 } },
    white: 0,
    red: 0,
  },
])('keys successive native video frames and disposes their callbacks (%j)', ({ keys, white, red }) => {
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
  const keyed = createColorKeyVideoTexture(video, keys);
  expect([...output]).toEqual([255, 255, 255, white, 237, 23, 75, red, 0, 0, 0, 255]);
  expect(isColorKeyVideoCanvas(canvas)).toBe(true);
  source = new Uint8ClampedArray([255, 255, 255, 255, 22, 207, 99, 255, 0, 0, 0, 255]);
  next!();
  expect([...output]).toEqual([255, 255, 255, white, 22, 207, 99, 255, 0, 0, 0, 255]);
  expect(update).toHaveBeenCalledTimes(2);
  const pending = next;
  keyed.dispose();
  expect(video.cancelVideoFrameCallback).toHaveBeenCalledWith(17);
  expect(handlers.size).toBe(0);
  expect(isColorKeyVideoCanvas(canvas)).toBe(false);
  pending!();
  expect(update).toHaveBeenCalledTimes(2);
});
