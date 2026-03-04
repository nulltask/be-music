import { describe, expect, test, vi } from 'vitest';
import type { PlayerRuntimeStateSnapshot, PlayerSummary } from './index.ts';
import { createPlayerStateSignals } from './index.ts';

function createSummary(overrides: Partial<PlayerSummary> = {}): PlayerSummary {
  return {
    total: 10,
    perfect: 0,
    fast: 0,
    slow: 0,
    great: 0,
    good: 0,
    bad: 0,
    poor: 0,
    exScore: 0,
    score: 0,
    ...overrides,
  };
}

function createSnapshot(overrides: Partial<PlayerRuntimeStateSnapshot> = {}): PlayerRuntimeStateSnapshot {
  return {
    mode: 'manual',
    phase: 'playing',
    speed: 1,
    highSpeed: 1,
    currentSeconds: 10,
    totalSeconds: 20,
    combo: 3,
    summary: createSummary({ great: 2, exScore: 4, score: 40000 }),
    ...overrides,
  };
}

describe('player signals', () => {
  test('tracks load progress and runtime snapshots', () => {
    const signals = createPlayerStateSignals();

    signals.options.onLoadProgress?.({
      ratio: 0.25,
      message: 'Loading chart',
    });

    expect(signals.state().loadProgress?.ratio).toBeCloseTo(0.25, 9);
    expect(signals.progressRatio()).toBeCloseTo(0.25, 9);
    expect(signals.progressPercent()).toBe(25);

    signals.options.onStateChange?.(
      createSnapshot({
        currentSeconds: 12,
        totalSeconds: 24,
        highSpeed: 2,
      }),
    );

    expect(signals.phase()).toBe('playing');
    expect(signals.isPlaying()).toBe(true);
    expect(signals.isPaused()).toBe(false);
    expect(signals.state().highSpeed).toBe(2);
    expect(signals.progressRatio()).toBeCloseTo(0.5, 9);
    expect(signals.progressPercent()).toBe(50);
    expect(signals.state().summary.great).toBe(2);
  });

  test('forwards wrapped callbacks while updating signal state', () => {
    const onLoadProgress = vi.fn();
    const onStateChange = vi.fn();
    const onHighSpeedChange = vi.fn();
    const signals = createPlayerStateSignals({
      auto: true,
      onLoadProgress,
      onStateChange,
      onHighSpeedChange,
    });

    const snapshot = createSnapshot({ mode: 'auto', phase: 'paused' });
    signals.options.onLoadProgress?.({ ratio: 0.6, message: 'Audio ready' });
    signals.options.onStateChange?.(snapshot);
    signals.options.onHighSpeedChange?.(3.5);

    expect(onLoadProgress).toHaveBeenCalledTimes(1);
    expect(onStateChange).toHaveBeenCalledWith(snapshot);
    expect(onHighSpeedChange).toHaveBeenCalledWith(3.5);
    expect(signals.state().mode).toBe('auto');
    expect(signals.state().phase).toBe('paused');
    expect(signals.state().highSpeed).toBe(3.5);
  });

  test('subscribe receives updates and reset restores initial state', () => {
    const signals = createPlayerStateSignals({ auto: true, speed: 2, highSpeed: 4 });
    const phases: string[] = [];
    const stop = signals.subscribe((state) => {
      phases.push(state.phase);
    });

    signals.options.onStateChange?.(createSnapshot({ mode: 'auto', phase: 'playing' }));
    signals.reset();
    stop();

    expect(phases[0]).toBe('loading');
    expect(phases).toContain('playing');
    expect(signals.state().mode).toBe('auto');
    expect(signals.state().phase).toBe('loading');
    expect(signals.state().speed).toBe(2);
    expect(signals.state().highSpeed).toBe(4);
  });
});
