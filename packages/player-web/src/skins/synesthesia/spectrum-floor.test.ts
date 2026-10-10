import { describe, expect, it } from 'vite-plus/test';
import {
  SPECTRUM_HISTORY_HZ,
  SPECTRUM_RIDGE_HEIGHT,
  SPECTRUM_WAVE_SPEED,
  SpectrumHistory,
  floorRowStep,
  spectrumLevels,
  spectrumRise,
} from './spectrum-floor.ts';

const TICK = 1 / SPECTRUM_HISTORY_HZ;

describe('SpectrumHistory', () => {
  it('is silent before anything is pushed', () => {
    const history = new SpectrumHistory(4, 10);
    expect(history.sample(0.5, 0)).toBe(0);
  });

  it('keeps the newest snapshot at age zero and older ones behind it', () => {
    const history = new SpectrumHistory(2, 10);
    history.push([1, 0], TICK);
    history.push([0, 1], TICK);
    expect(history.sample(0, 0)).toBe(0);
    expect(history.sample(1, 0)).toBe(1);
    expect(history.sample(0, TICK)).toBeCloseTo(1, 6);
    expect(history.sample(1, TICK)).toBeCloseTo(0, 6);
  });

  it('blends between bands and between snapshots', () => {
    const history = new SpectrumHistory(2, 10);
    history.push([0, 0], TICK);
    history.push([0, 1], TICK);
    expect(history.sample(0.5, 0)).toBeCloseTo(0.5, 6);
    expect(history.sample(1, TICK / 2)).toBeCloseTo(0.5, 6);
  });

  it('writes one snapshot per elapsed tick and carries the remainder', () => {
    const history = new SpectrumHistory(1, 10);
    history.push([1], TICK * 0.6);
    expect(history.sample(0, 0)).toBe(0);
    history.push([1], TICK * 0.6);
    expect(history.sample(0, 0)).toBe(1);
  });

  it('forgets what falls off the end of the ring', () => {
    const history = new SpectrumHistory(1, 3);
    history.push([1], TICK * 10);
    expect(history.sample(0, TICK * 2)).toBe(1);
    expect(history.sample(0, TICK * 3)).toBe(0);
  });
});

describe('spectrumLevels', () => {
  it('maps silence to zero and a loud spectrum to full level', () => {
    const out = new Float32Array(16);
    expect([...spectrumLevels(new Array(16).fill(0), out)].every((level) => level === 0)).toBe(true);
    expect([...spectrumLevels(new Array(16).fill(1), out)].every((level) => level === 1)).toBe(true);
  });
});

describe('spectrumRise', () => {
  it('raises the band under x as it was when the wave at z left the viewer', () => {
    const history = new SpectrumHistory(2, 120);
    history.push([1, 0], TICK);
    history.push([0, 0], 0.5 + TICK / 2);
    // Bass (left) was loud half a second ago (30 ticks back) and is quiet now.
    expect(spectrumRise(history, 0, 0)).toBe(0);
    expect(spectrumRise(history, 0, SPECTRUM_WAVE_SPEED * 0.5)).toBe(SPECTRUM_RIDGE_HEIGHT);
    // The highs (right) never played.
    expect(spectrumRise(history, 1, SPECTRUM_WAVE_SPEED * 0.5)).toBe(0);
  });
});

describe('floorRowStep', () => {
  it('is coarse far away and halves toward the viewer', () => {
    expect(floorRowStep(2400, 200, 6)).toBe(50);
    expect(floorRowStep(0, 200, 6)).toBe(6.25);
    expect(floorRowStep(400, 200, 6)).toBe(25);
  });

  it('never gets finer than three halvings or coarser than the widest gap', () => {
    expect(floorRowStep(0, 200, 0.1)).toBe(6.25);
    expect(floorRowStep(100000, 200, 6)).toBe(50);
  });
});
