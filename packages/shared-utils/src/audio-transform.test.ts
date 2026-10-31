import { describe, expect, test } from 'vite-plus/test';
import { transformStereoPCM } from './audio-transform.ts';

describe('sample PCM transform', () => {
  test('combines pitch rate with output resampling without changing the source', () => {
    const left = Float32Array.of(0, 1, 0, -1);
    const right = Float32Array.of(1, 0, -1, 0);
    const result = transformStereoPCM(left, right, 4, 4, { playbackRate: 2 });
    expect([...result.left]).toEqual([0, 0]);
    expect([...result.right]).toEqual([1, -1]);
    expect([...left]).toEqual([0, 1, 0, -1]);
    expect(transformStereoPCM(left, right, 4, 8, { playbackRate: 2 }).left).toEqual(left);
  });
  test('interpolates slower playback and never reads outside the last sample', () => {
    const result = transformStereoPCM(Float32Array.of(0, 1), Float32Array.of(1, 0), 2, 2, { playbackRate: 0.5 });
    expect([...result.left]).toEqual([0, 0.5, 1, 1]);
    expect([...result.right]).toEqual([1, 0.5, 0, 0]);
  });
  test('attenuates independent channels without crossfeeding or mutating mono sources', () => {
    const mono = Float32Array.of(1, 0.5);
    const result = transformStereoPCM(mono, mono, 2, 2, { leftGain: 0, rightGain: 0.5 });
    expect([...result.left]).toEqual([0, 0]);
    expect([...result.right]).toEqual([0.5, 0.25]);
    expect([...mono]).toEqual([1, 0.5]);
  });
  test('caps duration after pitch conversion and never loops or pads a short sample', () => {
    const input = new Float32Array(100).fill(1);
    expect(
      transformStereoPCM(input, input, 100, 100, { playbackRate: 0.5, maxDurationSeconds: 0.75 }).left.length,
    ).toBe(75);
    expect(transformStereoPCM(input, input, 100, 100, { playbackRate: 2, maxDurationSeconds: 10 }).left.length).toBe(
      50,
    );
    expect(transformStereoPCM(input, input, 100, 100, { maxDurationSeconds: 0 }).left.length).toBe(0);
  });
  test('handles empty data and cancellation', () => {
    expect(transformStereoPCM(new Float32Array(), new Float32Array(), 44100, 48000).left.length).toBe(0);
    const controller = new AbortController();
    controller.abort();
    expect(() => transformStereoPCM(Float32Array.of(1), Float32Array.of(1), 1, 1, {}, controller.signal)).toThrow();
  });
  test('rejects invalid gains and duration without emitting non-finite PCM', () => {
    const input = Float32Array.of(1);
    expect(() => transformStereoPCM(input, input, 44100, 44100, { leftGain: NaN })).toThrow(RangeError);
    expect(() => transformStereoPCM(input, input, 44100, 44100, { maxDurationSeconds: -1 })).toThrow(RangeError);
  });
  test.each([0, -1, Infinity, NaN])('rejects invalid sample/playback rate %s', (rate) => {
    expect(() => transformStereoPCM(Float32Array.of(1), Float32Array.of(1), rate, 44100)).toThrow(RangeError);
    expect(() =>
      transformStereoPCM(Float32Array.of(1), Float32Array.of(1), 44100, 44100, { playbackRate: rate }),
    ).toThrow(RangeError);
  });
});
