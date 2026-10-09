import { describe, expect, it } from 'vite-plus/test';
import { DARK_ORB, CHARGE_ORB_COUNT, chargeOrbs, orbBrightness, stepOrbLight } from './charge-cloud.ts';

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

describe('stepOrbLight', () => {
  const frame = 1 / 60;

  it('stays dark while its band is silent', () => {
    const light = stepOrbLight(DARK_ORB, 0, 0, frame);
    expect(light.flash).toBe(0);
    expect(light.glow).toBe(0);
  });

  it('fires the flash within one frame when its band jumps', () => {
    const light = stepOrbLight(DARK_ORB, 0.8, 0, frame);
    expect(light.flash).toBe(1);
    expect(light.glow).toBeGreaterThan(0.5);
  });

  it('fires on an onset while its band is loud, but not while it is quiet', () => {
    const loud = { flash: 0, glow: 0.4, energy: 0.7 };
    expect(stepOrbLight(loud, 0.7, 1, frame).flash).toBeGreaterThan(0.9);
    const quiet = { flash: 0, glow: 0.1, energy: 0.2 };
    expect(stepOrbLight(quiet, 0.2, 1, frame).flash).toBe(0);
  });

  it('drops the flash within about a tenth of a second and lets the glow linger for about a second', () => {
    let light = stepOrbLight(DARK_ORB, 1, 0, frame);
    for (let step = 0; step < 12; step += 1) light = stepOrbLight(light, 0, 0, frame);
    expect(light.flash).toBeLessThan(0.1);
    expect(light.glow).toBeGreaterThan(0.6);
    for (let step = 0; step < 120; step += 1) light = stepOrbLight(light, 0, 0, frame);
    expect(light.glow).toBeLessThan(0.15);
  });

  it('brightens with the flash and the glow', () => {
    expect(orbBrightness({ flash: 1, glow: 1, energy: 1 })).toBeGreaterThan(
      orbBrightness({ flash: 0, glow: 1, energy: 1 }),
    );
    expect(orbBrightness(DARK_ORB)).toBeGreaterThan(0);
  });
});
