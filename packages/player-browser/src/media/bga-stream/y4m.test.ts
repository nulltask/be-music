import { describe, expect, it } from 'vite-plus/test';
import { i420FrameBytes, parseY4MHeader, Y4MParser, type Y4MHeader } from './y4m.ts';

const encoder = new TextEncoder();

function y4m(header: string, frames: Uint8Array[]): Uint8Array {
  const parts: Uint8Array[] = [encoder.encode(`${header}\n`)];
  for (const frame of frames) parts.push(encoder.encode('FRAME\n'), frame);
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function collect(): { headers: Y4MHeader[]; frames: Uint8Array[]; parser: Y4MParser } {
  const headers: Y4MHeader[] = [];
  const frames: Uint8Array[] = [];
  const parser = new Y4MParser({ header: (header) => headers.push(header), frame: (frame) => frames.push(frame) });
  return { headers, frames, parser };
}

describe('i420FrameBytes', () => {
  it('rounds odd chroma planes up', () => {
    expect(i420FrameBytes(4, 2)).toBe(8 + 2 * 2);
    expect(i420FrameBytes(3, 3)).toBe(9 + 2 * 4);
  });
});

describe('parseY4MHeader', () => {
  it('reads the size and the frame rate fraction', () => {
    expect(parseY4MHeader('YUV4MPEG2 W320 H240 F30000:1001 Ip A1:1 C420jpeg XYSCSS=420JPEG')).toEqual({
      width: 320,
      height: 240,
      frameRateNumerator: 30000,
      frameRateDenominator: 1001,
    });
  });

  it('accepts a header without a colorspace (4:2:0 by default)', () => {
    expect(parseY4MHeader('YUV4MPEG2 W2 H2 F25:1').width).toBe(2);
  });

  it('rejects anything but 4:2:0 and incomplete headers', () => {
    expect(() => parseY4MHeader('YUV4MPEG2 W2 H2 F25:1 C444')).toThrow(/colorspace/u);
    expect(() => parseY4MHeader('YUV4MPEG W2 H2 F25:1')).toThrow(/signature/u);
    expect(() => parseY4MHeader('YUV4MPEG2 W2 F25:1')).toThrow(/size/u);
    expect(() => parseY4MHeader('YUV4MPEG2 W2 H2 F25:0')).toThrow(/frame rate/u);
  });
});

describe('Y4MParser', () => {
  const frameA = Uint8Array.from({ length: 6 }, (_, i) => i);
  const frameB = Uint8Array.from({ length: 6 }, (_, i) => 100 + i);
  const stream = y4m('YUV4MPEG2 W2 H2 F10:1 C420jpeg', [frameA, frameB]);

  it('reports the header once and each frame in its own buffer', () => {
    const { headers, frames, parser } = collect();
    parser.push(stream);
    expect(headers).toEqual([{ width: 2, height: 2, frameRateNumerator: 10, frameRateDenominator: 1 }]);
    expect(frames).toEqual([frameA, frameB]);
    expect(frames[0]!.buffer).not.toBe(frames[1]!.buffer);
    expect(parser.atFrameBoundary).toBe(true);
  });

  it('reads the same stream fed one byte at a time, from a reused buffer', () => {
    const { headers, frames, parser } = collect();
    const scratch = new Uint8Array(1);
    for (const byte of stream) {
      scratch[0] = byte;
      parser.push(scratch);
    }
    expect(headers).toHaveLength(1);
    expect(frames).toEqual([frameA, frameB]);
  });

  it('ignores frame parameters and reports a cut-off frame', () => {
    const { frames, parser } = collect();
    const withParams = y4m('YUV4MPEG2 W2 H2 F10:1', [frameA]);
    const text = new TextDecoder('latin1').decode(withParams).replace('FRAME\n', 'FRAME Ip\n');
    parser.push(Uint8Array.from(text, (char) => char.charCodeAt(0)));
    expect(frames).toEqual([frameA]);
    parser.push(encoder.encode('FRAME\n\u0001\u0002'));
    expect(parser.atFrameBoundary).toBe(false);
  });

  it('throws on a missing frame marker or a runaway line', () => {
    expect(() => collect().parser.push(encoder.encode('YUV4MPEG2 W2 H2 F10:1\nFRAMX\n'))).toThrow(/FRAME/u);
    expect(() => collect().parser.push(new Uint8Array(5000).fill(0x41))).toThrow(/too long/u);
  });
});
