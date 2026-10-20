import { describe, expect, it } from 'vite-plus/test';
import { KICK_REST, kickLevel, stepKick, type KickState } from './kick.ts';

const frame = 1 / 60;
const bandsWith = (low: number, rest = 0) => Array.from({ length: 16 }, (_, band) => (band <= 2 ? low : rest));
const run = (state: KickState, bands: readonly number[], onset: number, seconds: number) => {
  let current = state;
  for (let step = 0; step < Math.round(seconds / frame); step += 1) current = stepKick(current, bands, onset, frame);
  return current;
};

describe('kickLevel', () => {
  it('reads the three lowest bands only', () => {
    expect(kickLevel(bandsWith(0.6, 1))).toBe(kickLevel(bandsWith(0.6, 0)));
    expect(kickLevel(bandsWith(0.6, 0))).toBeGreaterThan(0.3);
    expect(kickLevel(bandsWith(0, 1))).toBe(0);
  });
});

describe('stepKick', () => {
  it('stays at rest in silence', () => {
    expect(stepKick(KICK_REST, bandsWith(0), 0, frame).swell).toBe(0);
  });

  it('flicks up on the attack of a kick', () => {
    expect(stepKick(KICK_REST, bandsWith(0.9), 0, frame).swell).toBeGreaterThan(0.8);
  });

  it('is gone again within about 0.15 s even while the low end stays up', () => {
    const hit = stepKick(KICK_REST, bandsWith(0.9), 0, frame);
    expect(run(hit, bandsWith(0.9), 0, 0.15).swell).toBeLessThan(0.15);
  });

  it('does not fire on a sustained bass line', () => {
    const settled = run(KICK_REST, bandsWith(0.8), 0, 4);
    expect(run(settled, bandsWith(0.8), 0, 1).swell).toBeLessThan(0.05);
  });

  it('fires on an onset while the low end stands above what it is used to', () => {
    const quiet = run(KICK_REST, bandsWith(0.4), 0, 4);
    expect(stepKick(quiet, bandsWith(0.4), 1, frame).swell).toBeLessThan(0.05);
    expect(stepKick(quiet, bandsWith(0.6), 1, frame).swell).toBeGreaterThan(0.5);
  });

  it('waits out a short cooldown between kicks', () => {
    const hit = stepKick(KICK_REST, bandsWith(0.9), 0, frame);
    const dip = run(hit, bandsWith(0), 0, 0.03);
    const tooSoon = stepKick(dip, bandsWith(0.9), 0, frame);
    expect(tooSoon.swell).toBeLessThanOrEqual(dip.swell);
    const later = run(dip, bandsWith(0), 0, 0.2);
    expect(stepKick(later, bandsWith(0.9), 0, frame).swell).toBeGreaterThan(0.5);
  });

  it('ignores the mids and highs', () => {
    expect(stepKick(KICK_REST, bandsWith(0, 1), 0, frame).swell).toBe(0);
  });
});
