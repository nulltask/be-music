import { describe, expect, it } from 'vitest';
import { DefaultHudMotion, DefaultSelectMotion } from './hud-motion.ts';

describe('DefaultHudMotion', () => {
  it('punches combo and score only when the value changes', () => {
    const motion = new DefaultHudMotion();
    const first = motion.sample({ combo: 10, score: 1000, nowMs: 1000 });
    expect(first.comboPunch).toBeGreaterThan(1);
    expect(first.scorePunch).toBeGreaterThan(1);
    const held = motion.sample({ combo: 10, score: 1000, nowMs: 1300 });
    expect(held.comboPunch).toBe(1);
    expect(held.scorePunch).toBe(1);
    const next = motion.sample({ combo: 11, score: 1000, nowMs: 1310 });
    expect(next.comboPunch).toBeGreaterThan(1);
    expect(next.scorePunch).toBe(1);
  });

  it('resets so a new play does not inherit the previous judge clock', () => {
    const motion = new DefaultHudMotion();
    motion.sample({ judge: 'PERFECT', nowMs: 500 });
    const late = motion.sample({ judge: 'PERFECT', nowMs: 5000 });
    expect(late.judgeElapsed).toBe(4500);
    motion.reset();
    const fresh = motion.sample({ judge: 'PERFECT', nowMs: 20 });
    expect(fresh.judgeElapsed).toBe(0);
  });
});

describe('DefaultSelectMotion', () => {
  it('snaps on the first sample then follows subsequent targets', () => {
    const motion = new DefaultSelectMotion();
    expect(motion.step(40, 0, (current, target) => (current + target) / 2)).toBe(40);
    expect(motion.step(80, 16, (current, target) => (current + target) / 2)).toBe(60);
    motion.enter();
    expect(motion.step(12, 32, (current) => current)).toBe(12);
  });
});
