import { DEFAULT_COMPRESSOR_PARAMS, KEY_BUS_COMPRESSOR_PARAMS } from '@be-music/player-web/runtime';
import { describe, expect, it } from 'vite-plus/test';
import {
  defaultCompressorTunings,
  paramsFromTuning,
  parseCompressorTunings,
  tuningFromParams,
} from './compressor-tuning.ts';

describe('tuningFromParams / paramsFromTuning', () => {
  it('shows attack and release in milliseconds', () => {
    expect(tuningFromParams(KEY_BUS_COMPRESSOR_PARAMS)).toEqual({
      thresholdDb: KEY_BUS_COMPRESSOR_PARAMS.threshold,
      kneeDb: KEY_BUS_COMPRESSOR_PARAMS.knee,
      ratio: KEY_BUS_COMPRESSOR_PARAMS.ratio,
      attackMs: KEY_BUS_COMPRESSOR_PARAMS.attack * 1000,
      releaseMs: KEY_BUS_COMPRESSOR_PARAMS.release * 1000,
    });
  });

  it('round-trips back to the bus parameters', () => {
    const params = paramsFromTuning(tuningFromParams(KEY_BUS_COMPRESSOR_PARAMS), KEY_BUS_COMPRESSOR_PARAMS);
    expect(params.threshold).toBe(KEY_BUS_COMPRESSOR_PARAMS.threshold);
    expect(params.attack).toBeCloseTo(KEY_BUS_COMPRESSOR_PARAMS.attack);
    expect(params.release).toBeCloseTo(KEY_BUS_COMPRESSOR_PARAMS.release);
  });

  it('clamps slider values into the Web Audio ranges', () => {
    const params = paramsFromTuning(
      { thresholdDb: 5, kneeDb: 80, ratio: 50, attackMs: 4000, releaseMs: -10 },
      KEY_BUS_COMPRESSOR_PARAMS,
    );
    expect(params).toEqual({ threshold: 0, knee: 40, ratio: 20, attack: 1, release: 0 });
  });
});

describe('parseCompressorTunings', () => {
  it('falls back to the factory tuning for missing or unreadable storage', () => {
    expect(parseCompressorTunings(null)).toEqual(defaultCompressorTunings());
    expect(parseCompressorTunings('not json')).toEqual(defaultCompressorTunings());
    expect(parseCompressorTunings('42')).toEqual(defaultCompressorTunings());
  });

  it('merges saved values over the factory tuning per compressor', () => {
    const tunings = parseCompressorTunings(JSON.stringify({ key: { thresholdDb: -20, ratio: 'x' } }));
    expect(tunings.key.thresholdDb).toBe(-20);
    expect(tunings.key.ratio).toBe(DEFAULT_COMPRESSOR_PARAMS.key.ratio);
    expect(tunings.bgm).toEqual(defaultCompressorTunings().bgm);
  });

  it('clamps out-of-range saved values', () => {
    const tunings = parseCompressorTunings(JSON.stringify({ master: { kneeDb: 99 } }));
    expect(tunings.master.kneeDb).toBe(40);
  });
});
