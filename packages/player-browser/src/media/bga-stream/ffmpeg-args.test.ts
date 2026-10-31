import { describe, expect, it } from 'vite-plus/test';
import { buildBGAStreamArgs, buildScaleFilterArg, readAVCCodecString } from './ffmpeg-args.ts';
import { estimateBitrate } from './encode-worker.ts';
import { pickInputExtension } from './stream.ts';

describe('buildBGAStreamArgs', () => {
  it('writes constant-rate y4m at even dimensions with the frame rate capped', () => {
    expect(buildBGAStreamArgs({ input: '/in.wmv', output: '/dev/out', mode: 'raw' })).toEqual([
      '-i',
      '/in.wmv',
      '-vf',
      "scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=fast_bilinear,fps=fps='min(source_fps\\,60)'",
      '-fps_mode',
      'cfr',
      '-an',
      '-sn',
      '-dn',
      '-pix_fmt',
      'yuv420p',
      '-f',
      'yuv4mpegpipe',
      '/dev/out',
    ]);
  });

  it('caps the long edge when asked', () => {
    const args = buildBGAStreamArgs({ input: 'i', output: 'o', mode: 'raw', maxLongEdge: 480 });
    expect(args[3]).toBe(`${buildScaleFilterArg(480)},fps=fps='min(source_fps\\,60)'`);
  });

  it('writes fragmented MP4 from libx264 with a key frame (and fragment) every second', () => {
    const args = buildBGAStreamArgs({ input: 'i', output: 'o', mode: 'h264' });
    expect(args).toEqual(expect.arrayContaining(['libx264', 'expr:gte(t,n_forced*1)', 'mp4']));
    expect(args[args.indexOf('-movflags') + 1]).toBe('frag_keyframe+empty_moov+default_base_moof');
    expect(args.at(-1)).toBe('o');
  });
});

describe('readAVCCodecString', () => {
  it('reads profile, compatibility and level from the avcC box', () => {
    const bytes = new Uint8Array([0, 0, 0, 0x20, 0x61, 0x76, 0x63, 0x43, 1, 0x42, 0xc0, 0x1e, 0xff]);
    expect(readAVCCodecString(bytes)).toBe('avc1.42C01E');
  });

  it('waits for a complete box', () => {
    expect(readAVCCodecString(new Uint8Array([0x61, 0x76, 0x63, 0x43, 1, 0x42]))).toBeUndefined();
    expect(readAVCCodecString(new Uint8Array(16))).toBeUndefined();
  });
});

describe('estimateBitrate', () => {
  it('spends 0.08 bits per pixel per frame with a floor', () => {
    expect(estimateBitrate(1920, 1080, 30)).toBe(4_976_640);
    expect(estimateBitrate(256, 256, 30)).toBe(500_000);
  });
});

describe('pickInputExtension', () => {
  it('keeps known video extensions and falls back to .mpg', () => {
    expect(pickInputExtension('bga/MOVIE.WMV')).toBe('.wmv');
    expect(pickInputExtension('a.avi')).toBe('.avi');
    expect(pickInputExtension('a.exe/../x')).toBe('.mpg');
    expect(pickInputExtension('noext')).toBe('.mpg');
  });
});
