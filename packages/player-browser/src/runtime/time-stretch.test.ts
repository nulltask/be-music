import { describe, expect, it } from 'vite-plus/test';
import { timeStretchChannels } from './time-stretch.ts';

const RATE = 44100;

function sine(frequency: number, seconds: number, amplitude = 0.5): Float32Array {
  const signal = new Float32Array(Math.round(RATE * seconds));
  for (let index = 0; index < signal.length; index += 1) {
    signal[index] = amplitude * Math.sin((2 * Math.PI * frequency * index) / RATE);
  }
  return signal;
}

/** The frequency of a steady tone from its rising zero crossings, away from the edges. */
function frequencyOf(signal: Float32Array): number {
  const from = Math.round(signal.length * 0.1);
  const to = Math.round(signal.length * 0.9);
  let crossings = 0;
  for (let index = from + 1; index < to; index += 1) if (signal[index - 1]! < 0 && signal[index]! >= 0) crossings += 1;
  return (crossings * RATE) / (to - from);
}

function rms(signal: Float32Array, from: number, to: number): number {
  let sum = 0;
  for (let index = from; index < to; index += 1) sum += signal[index]! ** 2;
  return Math.sqrt(sum / (to - from));
}

describe('timeStretchChannels', () => {
  it('changes the length by the rate and keeps the pitch', () => {
    const tone = sine(440, 1);
    for (const rate of [2 / 3, 1.5]) {
      const [stretched] = timeStretchChannels([tone], RATE, rate);
      expect(stretched!.length).toBe(Math.round(tone.length / rate));
      expect(frequencyOf(stretched!)).toBeCloseTo(440, -1);
    }
  });

  it('keeps the level steady, the attack included', () => {
    const tone = sine(440, 0.5);
    const [stretched] = timeStretchChannels([tone], RATE, 2 / 3);
    const level = rms(tone, 0, tone.length);
    expect(rms(stretched!, 0, 441)).toBeGreaterThan(level * 0.8);
    expect(rms(stretched!, 4410, stretched!.length - 4410)).toBeCloseTo(level, 1);
  });

  it('moves every channel by the same frames', () => {
    const left = sine(440, 0.3);
    const [a, b] = timeStretchChannels([left, left.slice()], RATE, 0.8);
    expect(b).toEqual(a);
  });

  it('copies the input at rate 1 or an invalid rate', () => {
    const tone = sine(440, 0.1);
    for (const rate of [1, 0, Number.NaN]) {
      const [copy] = timeStretchChannels([tone], RATE, rate);
      expect(copy).toEqual(tone);
      expect(copy).not.toBe(tone);
    }
  });
});
