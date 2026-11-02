import { Texture } from 'pixi.js';
import { afterEach, expect, test, vi } from 'vite-plus/test';
import { createColorKeyVideoTexture } from './color-key-video.ts';

const gpu = vi.hoisted(() => ({ draw: vi.fn(() => true) }));
vi.mock('./bga-gpu-pixels.ts', () => ({ canDrawBGAPixelsOnGPU: () => true, drawBGAPixelsOnGPU: gpu.draw }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test('keys each frame on the GPU without reading pixels back, on a canvas kept off the CPU', () => {
  const video = {
    videoWidth: 4,
    videoHeight: 2,
    readyState: 2,
    requestVideoFrameCallback: vi.fn(() => 1),
    cancelVideoFrameCallback: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as HTMLVideoElement;
  const getImageData = vi.fn();
  const context = { clearRect: vi.fn(), drawImage: vi.fn(), getImageData, putImageData: vi.fn() };
  const getContext = vi.fn(() => context);
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext }) });
  const update = vi.fn();
  vi.spyOn(Texture, 'from').mockReturnValue({ source: { update } } as unknown as Texture);
  const keys = { bmsColorKey: { a: 0, r: 255, g: 255, b: 255 } };
  const keyed = createColorKeyVideoTexture(video, keys);
  expect(getContext).toHaveBeenCalledWith('2d', { willReadFrequently: false });
  expect(gpu.draw).toHaveBeenCalledWith(video, 4, 2, keys, context);
  expect(getImageData).not.toHaveBeenCalled();
  expect(update).toHaveBeenCalledOnce();
  keyed.dispose();
});
