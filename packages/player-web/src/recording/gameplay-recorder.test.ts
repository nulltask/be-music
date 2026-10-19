import {
  BlobSource,
  BufferTarget,
  EncodedPacket,
  EncodedVideoPacketSource,
  Input,
  Output,
  WEBM,
  WebMOutputFormat,
} from 'mediabunny';
import { describe, expect, it } from 'vite-plus/test';

import { makeWebmSeekable, pickRecorderMimeType, resolveCaptureSize, shouldCaptureFrame } from './gameplay-recorder.ts';

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

/** A VP8 key-frame header (frame tag, start code, 16×16) padded with filler — enough for the muxers, never decoded. */
function fakeVp8Frame(keyFrame: boolean): Uint8Array {
  const data = new Uint8Array(64).fill(0x5a);
  data.set([keyFrame ? 0x10 : 0x11, 0x02, 0x00, 0x9d, 0x01, 0x2a, 16, 0, 16, 0]);
  return data;
}

/**
 * Writes a WebM the way `MediaRecorder` does: append-only, so it carries neither a `Duration` nor `Cues`. 30 frames at
 * 30 fps starting at `startSec`, a key frame every 10.
 */
async function writeStreamingWebm(startSec = 0): Promise<Blob> {
  const output = new Output({ format: new WebMOutputFormat({ appendOnly: true }), target: new BufferTarget() });
  const source = new EncodedVideoPacketSource('vp8');
  output.addVideoTrack(source, { frameRate: 30 });
  await output.start();
  for (let i = 0; i < 30; i++) {
    const keyFrame = i % 10 === 0;
    const packet = new EncodedPacket(fakeVp8Frame(keyFrame), keyFrame ? 'key' : 'delta', startSec + i / 30, 1 / 30);
    await source.add(
      packet,
      i === 0 ? { decoderConfig: { codec: 'vp8', codedWidth: 16, codedHeight: 16 } } : undefined,
    );
  }
  await output.finalize();
  return new Blob([output.target.buffer!], { type: 'video/webm;codecs=vp8' });
}

/** The `Duration` the file's header states, or `null` when it has none (as in a `MediaRecorder` capture). */
async function readMetadataDuration(blob: Blob): Promise<number | null> {
  const input = new Input({ source: new BlobSource(blob), formats: [WEBM] });
  try {
    return await input.getDurationFromMetadata();
  } finally {
    input.dispose();
  }
}

async function readPackets(blob: Blob): Promise<Array<{ timestamp: number; type: string; size: number }>> {
  const input = new Input({ source: new BlobSource(blob), formats: [WEBM] });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('no video track');
    const { EncodedPacketSink } = await import('mediabunny');
    const packets: Array<{ timestamp: number; type: string; size: number }> = [];
    for await (const packet of new EncodedPacketSink(track).packets()) {
      packets.push({ timestamp: packet.timestamp, type: packet.type, size: packet.byteLength });
    }
    return packets;
  } finally {
    input.dispose();
  }
}

describe('makeWebmSeekable', () => {
  it('writes the duration and seek index into a streaming WebM and keeps every packet as recorded', async () => {
    const recorded = await writeStreamingWebm();
    expect(await readMetadataDuration(recorded)).toBeNull();

    const seekable = await makeWebmSeekable(recorded);

    expect(seekable).not.toBe(recorded);
    expect(seekable.type).toBe('video/webm;codecs=vp8');
    expect(await readMetadataDuration(seekable)).toBeCloseTo(1, 3);
    expect(await readPackets(seekable)).toEqual(await readPackets(recorded));
  });

  it('keeps the original timestamps when the recording does not start at zero', async () => {
    const recorded = await writeStreamingWebm(0.5);
    const packets = await readPackets(await makeWebmSeekable(recorded));
    expect(packets[0]?.timestamp).toBeCloseTo(0.5, 3);
    expect(packets).toHaveLength(30);
  });

  it('returns the input unchanged when it is not a WebM', async () => {
    const notWebm = new Blob([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], { type: 'video/webm' });
    expect(await makeWebmSeekable(notWebm)).toBe(notWebm);
  });

  it('returns an empty blob unchanged', async () => {
    const empty = new Blob([], { type: 'video/webm' });
    expect(await makeWebmSeekable(empty)).toBe(empty);
  });
});
