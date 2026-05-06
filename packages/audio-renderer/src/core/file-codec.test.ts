import { describe, expect, test } from 'vitest';
import { detectAudioFormat, encodeAiff16, encodeWav16, type StereoRenderResult } from './file-codec.ts';

describe('audio file codecs', () => {
  test('detectAudioFormat: detects AIFF extensions and defaults to WAV', () => {
    expect(detectAudioFormat('render.aiff')).toBe('aiff');
    expect(detectAudioFormat('render.AIF')).toBe('aiff');
    expect(detectAudioFormat('render.wav')).toBe('wav');
    expect(detectAudioFormat('render')).toBe('wav');
  });

  test('encodeWav16: writes RIFF/WAVE headers and little-endian PCM', () => {
    const encoded = encodeWav16(createStereoFixture());
    const view = createDataView(encoded);

    expect(readAscii(encoded, 0, 4)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(44);
    expect(readAscii(encoded, 8, 4)).toBe('WAVE');
    expect(readAscii(encoded, 12, 4)).toBe('fmt ');
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(8000);
    expect(readAscii(encoded, 36, 4)).toBe('data');
    expect(view.getUint32(40, true)).toBe(8);
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-16384);
    expect(view.getInt16(48, true)).toBe(-32768);
    expect(view.getInt16(50, true)).toBe(16384);
  });

  test('encodeAiff16: writes FORM/AIFF headers and big-endian PCM', () => {
    const encoded = encodeAiff16(createStereoFixture());
    const view = createDataView(encoded);

    expect(readAscii(encoded, 0, 4)).toBe('FORM');
    expect(view.getUint32(4, false)).toBe(54);
    expect(readAscii(encoded, 8, 4)).toBe('AIFF');
    expect(readAscii(encoded, 12, 4)).toBe('COMM');
    expect(view.getUint16(20, false)).toBe(2);
    expect(view.getUint32(22, false)).toBe(2);
    expect(view.getUint16(26, false)).toBe(16);
    expect(readAscii(encoded, 38, 4)).toBe('SSND');
    expect(view.getUint32(42, false)).toBe(16);
    expect(view.getInt16(54, false)).toBe(32767);
    expect(view.getInt16(56, false)).toBe(-16384);
    expect(view.getInt16(58, false)).toBe(-32768);
    expect(view.getInt16(60, false)).toBe(16384);
  });
});

function createStereoFixture(): StereoRenderResult {
  return {
    sampleRate: 8000,
    left: new Float32Array([1, -1]),
    right: new Float32Array([-0.5, 0.5]),
  };
}

function createDataView(buffer: Uint8Array): DataView {
  return new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

function readAscii(buffer: Uint8Array, offset: number, length: number): string {
  let text = '';
  for (let index = 0; index < length; index += 1) {
    text += String.fromCharCode(buffer[offset + index]!);
  }
  return text;
}
