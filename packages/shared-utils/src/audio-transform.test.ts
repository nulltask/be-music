import { describe, expect, test } from 'vite-plus/test';
import { resolveSampleSliceEnvelope, sampleSliceEnvelopeGain, transformStereoPCM } from './audio-transform.ts';

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

describe('sample slice envelope', () => {
  test('leaves a window that covers the whole file unfaded', () => {
    expect(resolveSampleSliceEnvelope(0, undefined, 100, 3)).toEqual({ fadeIn: 0, fadeOut: 0 });
    expect(resolveSampleSliceEnvelope(0, 100, 100, 3)).toEqual({ fadeIn: 0, fadeOut: 0 });
    expect(resolveSampleSliceEnvelope(0, 250, 100, 3)).toEqual({ fadeIn: 0, fadeOut: 0 });
  });
  test('fades in a window that starts inside the file and out one that stops before its end', () => {
    expect(resolveSampleSliceEnvelope(0, 40, 100, 3)).toEqual({ fadeIn: 0, fadeOut: 3 });
    expect(resolveSampleSliceEnvelope(40, 30, 100, 3)).toEqual({ fadeIn: 3, fadeOut: 3 });
    expect(resolveSampleSliceEnvelope(70, undefined, 100, 3)).toEqual({ fadeIn: 3, fadeOut: 0 });
  });
  test('clamps the fade-in to the window and the fade-out to the audio left after it', () => {
    expect(resolveSampleSliceEnvelope(40, 2, 100, 3)).toEqual({ fadeIn: 2, fadeOut: 3 });
    expect(resolveSampleSliceEnvelope(40, 59, 100, 3)).toEqual({ fadeIn: 3, fadeOut: 1 });
  });
  test('resolves no ramp for an empty window or a zero fade length', () => {
    expect(resolveSampleSliceEnvelope(100, 10, 100, 3)).toEqual({ fadeIn: 0, fadeOut: 0 });
    expect(resolveSampleSliceEnvelope(40, 30, 100, 0)).toEqual({ fadeIn: 0, fadeOut: 0 });
  });
  test('ramps the gain linearly in, holds it, and ramps it out past the window end', () => {
    const envelope = { fadeIn: 4, fadeOut: 4 };
    expect([0, 1, 2, 4, 9].map((position) => sampleSliceEnvelopeGain(position, 10, envelope))).toEqual([
      0, 0.25, 0.5, 1, 1,
    ]);
    expect([10, 11, 13, 14, -1].map((position) => sampleSliceEnvelopeGain(position, 10, envelope))).toEqual([
      1, 0.75, 0.25, 0, 0,
    ]);
    expect(sampleSliceEnvelopeGain(5, Infinity, { fadeIn: 0, fadeOut: 0 })).toBe(1);
  });
  test('crossfades a continuation with the slice before it to unity gain', () => {
    const fade = 4;
    const previous = resolveSampleSliceEnvelope(0, 10, 100, fade);
    const next = resolveSampleSliceEnvelope(10, 10, 100, fade);
    for (let frame = 10; frame < 10 + fade; frame += 1) {
      expect(sampleSliceEnvelopeGain(frame, 10, previous) + sampleSliceEnvelopeGain(frame - 10, 10, next)).toBe(1);
    }
  });
});
