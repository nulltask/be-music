import { describe, expect, it } from 'vite-plus/test';
import { pickRecorderMimeType, resolveCaptureSize, shouldCaptureFrame } from './gameplay-recorder.ts';

describe('pickRecorderMimeType', () => {
  // The picker accepts an injected `isSupported` so the test can exercise every branch without relying on the host
  // browser's `MediaRecorder.isTypeSupported`. Production usage wraps that API directly.

  it('returns the highest-priority codec the runtime supports', () => {
    // Modern Chrome / Firefox: VP9 + Opus is universally supported and gives the best quality, so it wins outright.
    const isSupported = (type: string): boolean => type === 'video/webm;codecs=vp9,opus';
    expect(pickRecorderMimeType(isSupported)).toBe('video/webm;codecs=vp9,opus');
  });

  it('falls back to VP8 when VP9 is unavailable', () => {
    // Older Safari / Firefox stable channels: VP9 unsupported, VP8 + Opus still works. The picker shouldn't drop
    // straight to bare `video/webm` — the codec hint helps the encoder pick the right pipeline.
    const supported = new Set(['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp8', 'video/webm']);
    expect(pickRecorderMimeType((type) => supported.has(type))).toBe('video/webm;codecs=vp8,opus');
  });

  it('falls back to bare video/webm when no codec hint matches', () => {
    // Very minimal MediaRecorder implementations (some embedded browsers) advertise only the bare container MIME type.
    // The last entry in the priority list catches that.
    const isSupported = (type: string): boolean => type === 'video/webm';
    expect(pickRecorderMimeType(isSupported)).toBe('video/webm');
  });

  it('returns undefined when nothing in the chain is supported', () => {
    // Older Safari + iOS used to expose `MediaRecorder` but no WebM. Returning undefined lets the caller surface a
    // "recording unavailable on this browser" message rather than guessing at a codec the encoder will reject.
    expect(pickRecorderMimeType(() => false)).toBeUndefined();
  });

  it('prefers VP9 over VP8 when both are supported', () => {
    // Sanity-check the ordering. With both codecs alive the VP9 entry MUST come back first — losing this invariant
    // would silently regress recording quality across upgrades.
    const isSupported = (type: string): boolean =>
      type === 'video/webm;codecs=vp9,opus' || type === 'video/webm;codecs=vp8,opus';
    expect(pickRecorderMimeType(isSupported)).toBe('video/webm;codecs=vp9,opus');
  });
});

describe('shouldCaptureFrame', () => {
  it('always takes the first frame', () => {
    expect(shouldCaptureFrame(1000, undefined, 60)).toBe(true);
  });

  it('takes every frame of a 60 Hz loop at 60 fps, despite rAF jitter', () => {
    expect(shouldCaptureFrame(1016.7, 1000, 60)).toBe(true);
    expect(shouldCaptureFrame(1015.5, 1000, 60)).toBe(true);
  });

  it('takes every other frame of a 60 Hz loop at 30 fps', () => {
    expect(shouldCaptureFrame(1016.7, 1000, 30)).toBe(false);
    expect(shouldCaptureFrame(1033.3, 1000, 30)).toBe(true);
    expect(shouldCaptureFrame(1031.5, 1000, 30)).toBe(true);
  });

  it('samples a 120 Hz display down to 60 fps', () => {
    expect(shouldCaptureFrame(1008.3, 1000, 60)).toBe(false);
    expect(shouldCaptureFrame(1016.7, 1000, 60)).toBe(true);
  });

  it('takes every frame for a non-positive or non-finite rate', () => {
    expect(shouldCaptureFrame(1001, 1000, 0)).toBe(true);
    expect(shouldCaptureFrame(1001, 1000, Number.NaN)).toBe(true);
  });
});

describe('resolveCaptureSize', () => {
  const max = { width: 1920, height: 1080 };

  it('keeps a canvas that already fits', () => {
    expect(resolveCaptureSize(1280, 960, max)).toEqual({ width: 1280, height: 960 });
    expect(resolveCaptureSize(1920, 1080, max)).toEqual({ width: 1920, height: 1080 });
  });

  it('scales an oversized high-DPR canvas down to fit, keeping its aspect ratio', () => {
    expect(resolveCaptureSize(2944, 2108, max)).toEqual({ width: 1508, height: 1080 });
    expect(resolveCaptureSize(3840, 2160, max)).toEqual({ width: 1920, height: 1080 });
  });

  it('rounds a scaled size down to even dimensions', () => {
    const size = resolveCaptureSize(2001, 1999, max);
    expect(size.width % 2).toBe(0);
    expect(size.height % 2).toBe(0);
    expect(size.height).toBeLessThanOrEqual(1080);
  });
});
