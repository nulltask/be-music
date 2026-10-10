import { describe, expect, it } from 'vite-plus/test';
import {
  bandExcess,
  CHARGE_ORB_COUNT,
  chargeOrbs,
  DARK_ORB,
  orbBrightness,
  stepOrbLight,
  type OrbLight,
} from './charge-cloud.ts';

const SILENT = { bands: Array.from({ length: 16 }, () => 0), onset: 0 };

describe('chargeOrbs', () => {
  it('places every orb with a unit spin axis and a positive radius', () => {
    const orbs = chargeOrbs(3.7, SILENT);
    expect(orbs).toHaveLength(CHARGE_ORB_COUNT);
    for (const orb of orbs) {
      expect(Math.hypot(...orb.axis)).toBeCloseTo(1, 9);
      expect(orb.radius).toBeGreaterThan(0);
      expect(orb.energy).toBe(0);
      expect(Math.hypot(orb.x, orb.y, orb.z)).toBeLessThan(1);
    }
  });

  it('spreads the spectrum over the orbs, lows first and highs last', () => {
    const lows = chargeOrbs(0, { bands: SILENT.bands.map((_, band) => (band <= 2 ? 1 : 0)), onset: 0 });
    expect(lows.map((orb) => orb.energy)).toEqual([1, 0, 0, 0, 0]);
    const highs = chargeOrbs(0, { bands: SILENT.bands.map((_, band) => (band >= 12 ? 1 : 0)), onset: 0 });
    expect(highs.map((orb) => orb.energy)).toEqual([0, 0, 0, 0, 1]);
  });

  it('swells an orb a little with its band range', () => {
    const quiet = chargeOrbs(1, SILENT)[0]!;
    const loud = chargeOrbs(1, { bands: SILENT.bands.map(() => 1), onset: 0 })[0]!;
    expect(loud.radius).toBeGreaterThan(quiet.radius);
    expect(loud.radius).toBeLessThan(quiet.radius * 1.25);
  });

  it('moves the orbs over time and stays deterministic', () => {
    expect(chargeOrbs(2, SILENT)).toEqual(chargeOrbs(2, SILENT));
    expect(chargeOrbs(2, SILENT)[0]!.x).not.toBeCloseTo(chargeOrbs(4, SILENT)[0]!.x, 3);
  });
});

describe('bandExcess', () => {
  it('reads zero at or below what the orb is used to and one at full scale', () => {
    expect(bandExcess(0.5, 0.6)).toBe(0);
    expect(bandExcess(1, 0.6)).toBe(1);
    expect(bandExcess(0.3, 0)).toBeCloseTo(0.3, 9);
  });

  it('gives a quiet passage and a loud passage the same headroom', () => {
    const quiet = bandExcess(0.4, 0.2);
    const loud = bandExcess(0.9, 0.7);
    expect(quiet).toBeGreaterThan(0.2);
    expect(loud).toBeGreaterThan(0.2);
  });
});

describe('stepOrbLight', () => {
  const frame = 1 / 60;
  const run = (light: OrbLight, energy: number, onset: number, seconds: number) => {
    let current = light;
    for (let step = 0; step < Math.round(seconds / frame); step += 1) {
      current = stepOrbLight(current, energy, onset, frame);
    }
    return current;
  };

  it('stays dark while its band is silent', () => {
    const light = stepOrbLight(DARK_ORB, 0, 0, frame);
    expect(light.flash).toBe(0);
    expect(light.glow).toBe(0);
  });

  it('fires the flash within one frame when its band jumps', () => {
    const light = stepOrbLight(DARK_ORB, 0.8, 0, frame);
    expect(light.flash).toBeGreaterThan(0.9);
    expect(light.glow).toBeGreaterThan(0.5);
  });

  it('drops the flash within about a tenth of a second and lets the glow linger for about a second', () => {
    let light = stepOrbLight(DARK_ORB, 1, 0, frame);
    light = run(light, 0, 0, 0.2);
    expect(light.flash).toBeLessThan(0.1);
    expect(light.glow).toBeGreaterThan(0.5);
    light = run(light, 0, 0, 2);
    expect(light.glow).toBeLessThan(0.15);
  });

  it('settles back down during a sustained loud passage', () => {
    const light = run(DARK_ORB, 0.8, 0, 8);
    expect(light.flash).toBeLessThan(0.05);
    expect(light.glow).toBeLessThan(0.15);
    expect(light.mean).toBeGreaterThan(0.7);
  });

  it('fires on an onset only when its band stands out from what it is used to', () => {
    const used = run(DARK_ORB, 0.7, 0, 8);
    expect(stepOrbLight(used, 0.7, 1, frame).flash).toBeLessThan(0.05);
    expect(stepOrbLight(used, 0.95, 1, frame).flash).toBeGreaterThan(0.5);
  });

  it('waits out a short cooldown before it can flash again', () => {
    let light = stepOrbLight(DARK_ORB, 0.9, 0, frame);
    light = run(light, 0, 0, 0.05);
    const tooSoon = stepOrbLight(light, 0.9, 1, frame);
    expect(tooSoon.flash).toBeLessThan(light.flash);
    light = run(light, 0, 0, 0.3);
    expect(stepOrbLight(light, 0.9, 1, frame).flash).toBeGreaterThan(0.5);
  });

  it('brightens with the flash and the glow', () => {
    const lit = { ...DARK_ORB, glow: 1 };
    expect(orbBrightness({ ...lit, flash: 1 })).toBeGreaterThan(orbBrightness(lit));
    expect(orbBrightness(DARK_ORB)).toBeGreaterThan(0);
  });
});
