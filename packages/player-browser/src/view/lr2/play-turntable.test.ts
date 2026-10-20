import { describe, expect, test } from 'vite-plus/test';
import { LR2Turntable } from './play-turntable.ts';

const PLAYING = { introPlaying: false, paused: false };

/** The turntable after a first update at `start`, so the next one integrates. */
function started(start = 1000): LR2Turntable {
  const turntable = new LR2Turntable();
  turntable.update(start, PLAYING);
  return turntable;
}

describe('LR2Turntable', () => {
  test('spins forward at one turn a second while nobody scratches', () => {
    const turntable = started();
    turntable.update(1500, PLAYING);
    expect(turntable.angleOf('1')).toBeCloseTo(Math.PI);
    expect(turntable.angleOf('2')).toBeCloseTo(Math.PI);
  });

  test('a lone press brakes the disc backwards; a quick second one pushes it forward', () => {
    const turntable = started();
    turntable.impulse('16', 1000);
    turntable.update(1100, PLAYING);
    const afterBrake = turntable.angleOf('1');
    expect(afterBrake).toBeCloseTo(-0.3 * Math.PI);
    turntable.impulse('16', 1100);
    turntable.update(1200, PLAYING);
    expect(turntable.angleOf('1') - afterBrake).toBeCloseTo(0.3 * Math.PI);
    // The 2P disc kept its idle spin.
    expect(turntable.angleOf('2')).toBeCloseTo(0.4 * Math.PI);
  });

  test('a press after a pause brakes again, and other lanes leave the disc alone', () => {
    const turntable = started();
    turntable.impulse('26', 1000);
    turntable.impulse('26', 2000);
    turntable.impulse('11', 2000);
    turntable.update(1001, PLAYING);
    turntable.update(1101, PLAYING);
    expect(turntable.angleOf('2')).toBeLessThan(0);
  });

  test('holds still through the intro and while paused', () => {
    const turntable = started();
    turntable.update(2000, { introPlaying: true, paused: false });
    expect(turntable.angleOf('1')).toBe(0);
    turntable.update(3000, { introPlaying: false, paused: true });
    expect(turntable.angleOf('1')).toBe(0);
  });

  test('reset puts the disc back at angle 0 with no streak', () => {
    const turntable = started();
    turntable.impulse('16', 1000);
    turntable.update(1200, PLAYING);
    turntable.reset();
    expect(turntable.angleOf('1')).toBe(0);
    turntable.update(5000, PLAYING);
    turntable.update(5500, PLAYING);
    expect(turntable.angleOf('1')).toBeCloseTo(Math.PI);
  });
});
