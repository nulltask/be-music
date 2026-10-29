import { applyBMSColorKey, type BmsARGB } from '@be-music/chart-model';
import { Texture } from 'pixi.js';

const dynamicCanvases = new WeakSet<object>();
export function isColorKeyVideoCanvas(resource: object): boolean {
  return dynamicCanvases.has(resource);
}

/** Key decoded video pixels before sub-region views are cut; every alias shares the live native-size canvas. */
export function createColorKeyVideoTexture(
  video: HTMLVideoElement,
  keys: { bmsColorKey?: BmsARGB; swBGAColorKey?: BmsARGB },
): {
  texture: Texture;
  dispose: () => void;
} {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, video.videoWidth);
  canvas.height = Math.max(1, video.videoHeight);
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  const texture = Texture.from(canvas);
  texture.source.scaleMode = 'nearest';
  dynamicCanvases.add(canvas);
  let disposed = false;
  let callback: number | undefined;
  const update = (): void => {
    if (disposed || !video.videoWidth || !video.videoHeight || video.readyState < 2) return;
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
    try {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(video, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      // EXBMP compares the inserted alpha of opaque movies against zero.
      if (keys.bmsColorKey) applyBMSColorKey(pixels.data, keys.bmsColorKey, false);
      if (keys.swBGAColorKey) applyBMSColorKey(pixels.data, keys.swBGAColorKey, true);
      context.putImageData(pixels, 0, 0);
      texture.source.update();
    } catch {
      /* A seeking/not-yet-buffered video is retried on the next decoded frame. */
    }
  };
  const next = (): void => {
    if (disposed) return;
    update();
    callback = video.requestVideoFrameCallback?.(next);
  };
  for (const event of ['loadeddata', 'seeked', 'timeupdate']) video.addEventListener(event, update);
  update();
  callback = video.requestVideoFrameCallback?.(next);
  return {
    texture,
    dispose: () => {
      disposed = true;
      if (callback !== undefined) video.cancelVideoFrameCallback?.(callback);
      for (const event of ['loadeddata', 'seeked', 'timeupdate']) video.removeEventListener(event, update);
      dynamicCanvases.delete(canvas);
    },
  };
}
