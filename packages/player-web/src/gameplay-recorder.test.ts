import { describe, expect, it } from 'vitest';
import { pickRecorderMimeType } from './gameplay-recorder.ts';

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
