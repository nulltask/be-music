import { describe, expect, it, vi } from 'vite-plus/test';
import {
  attachBlobUrlToTexture,
  isRawVideoStreamFormat,
  loadTextureFromBytes,
  parseFfmpegProbe,
  registerImageDecoder,
} from './textures.ts';

describe('attachBlobUrlToTexture', () => {
  it('records the blob URL on a real texture object', () => {
    // Minimal duck-typed `Texture` stand-in — `attachBlobUrlToTexture` only stamps a Symbol-keyed string. Real Pixi
    // textures inherit from `EventEmitter` etc.; we don't need that surface to exercise the property write.
    const texture: Record<symbol, unknown> = {};
    attachBlobUrlToTexture(texture as unknown as Parameters<typeof attachBlobUrlToTexture>[0], 'blob:test/abc');
    const symbol = Object.getOwnPropertySymbols(texture).find((s) => s.description?.includes('texture-blob-url'));
    expect(symbol).toBeDefined();
    expect(texture[symbol!]).toBe('blob:test/abc');
  });

  it('is a no-op for null/undefined textures (regression: Pixi Assets.load can resolve null)', () => {
    // Pixi v8 occasionally resolves `Assets.load(blobUrl)` with `null` for unsupported payload bytes (e.g. a `.dds`
    // file blob-loaded as `image/png` falls through every decoder). Before the guard, the resulting
    // `attachBlobUrlToTexture(null, url)` crashed with `Cannot set properties of null (setting 'Symbol...')` —
    // surfaced as a hard error from the LITONE4 font loader's `font_11.dds`. The guard now silently no-ops on
    // null / undefined input so the caller's normal "unsupported asset → fallback" path runs.
    expect(() => attachBlobUrlToTexture(null, 'blob:test/null')).not.toThrow();
    expect(() => attachBlobUrlToTexture(undefined, 'blob:test/undef')).not.toThrow();
  });

  it('does not invoke the Symbol setter when the texture is falsy', () => {
    // Ensures the guard short-circuits BEFORE the property write — otherwise a getter on `texture[Symbol]` would
    // still run for non-null falsy values. We use a spy on `Object.defineProperty` to confirm no write happens.
    const spy = vi.spyOn(Object, 'defineProperty');
    attachBlobUrlToTexture(null, 'blob:no');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('registerImageDecoder', () => {
  it('routes matching extensions (case-insensitively) through the registered decoder', async () => {
    const decoder = vi.fn(() => undefined);
    registerImageDecoder('.TESTFMT', decoder);
    const bytes = new Uint8Array([1, 2, 3]);
    // The decoder declines (returns `undefined`), so the loader falls through to the blob path, which has no
    // `createImageBitmap` under Node and resolves `undefined` — the point here is only that the decoder saw the bytes.
    await expect(loadTextureFromBytes('Skin/Sheet.TestFmt', bytes)).resolves.toBeUndefined();
    expect(decoder).toHaveBeenCalledTimes(1);
    expect(decoder).toHaveBeenCalledWith(bytes);
  });

  it('leaves other extensions alone', async () => {
    const decoder = vi.fn(() => undefined);
    registerImageDecoder('.otherfmt', decoder);
    await loadTextureFromBytes('Skin/Sheet.png', new Uint8Array([1]));
    expect(decoder).not.toHaveBeenCalled();
  });
});

describe('parseFfmpegProbe', () => {
  it('reads geometry, frame rate, duration and the input format from ffmpeg stderr', () => {
    const lines = [
      "Input #0, asf, from 'bga-input.wmv':",
      '  Duration: 00:02:46.40, start: 0.000000, bitrate: 124 kb/s',
      '  Stream #0:0: Video: vc1 (Advanced) (WVC1 / 0x31435657), yuv420p, 512x512 [SAR 1:1 DAR 1:1], 60 fps, 60 tbr, 1k tbn',
    ];
    expect(parseFfmpegProbe(lines)).toEqual({
      width: 512,
      height: 512,
      frameRate: 60,
      durationSec: 166.4,
      inputFormat: 'asf',
    });
  });

  it('flags a bare MPEG-1 stream whose header duration is a guess', () => {
    const lines = [
      "Input #0, mpegvideo, from 'bga-input.mpg':",
      '  Duration: 00:00:01.15, bitrate: 104857 kb/s',
      '  Stream #0:0: Video: mpeg1video, yuv420p(tv, progressive), 512x512 [SAR 1:1 DAR 1:1], 104857 kb/s, 25 fps, 60 tbr, 1200k tbn',
    ];
    const probe = parseFfmpegProbe(lines);
    expect(probe?.inputFormat).toBe('mpegvideo');
    expect(isRawVideoStreamFormat(probe?.inputFormat)).toBe(true);
  });

  it('returns nothing without a duration', () => {
    expect(
      parseFfmpegProbe([
        "Input #0, mpegvideo, from 'bga-input.mpg':",
        '  Duration: N/A, bitrate: N/A',
        '  Stream #0:0: Video: mpeg2video (Main), yuv420p(tv, progressive), 640x640, 25 fps, 25 tbr, 1200k tbn',
      ]),
    ).toBeUndefined();
  });
});

describe('isRawVideoStreamFormat', () => {
  it('is true only for bare elementary streams', () => {
    for (const format of ['mpegvideo', 'h264', 'hevc', 'm4v', 'vc1']) expect(isRawVideoStreamFormat(format)).toBe(true);
    for (const format of ['asf', 'avi', 'mpeg', 'mov,mp4,m4a,3gp,3g2,mj2', 'matroska,webm', undefined]) {
      expect(isRawVideoStreamFormat(format)).toBe(false);
    }
  });
});
