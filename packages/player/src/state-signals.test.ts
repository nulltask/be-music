import { describe, expect, test } from 'vitest';
import { createPlayerStateSignals } from './state-signals.ts';

describe('player state signals', () => {
  test('publishes judge/combo updates with tick increments', () => {
    const signals = createPlayerStateSignals(1);
    expect(signals.judgeComboTick()).toBe(0);

    signals.publishJudgeCombo('GREAT', 12, '11', 123);
    expect(signals.judgeComboTick()).toBe(1);
    expect(signals.getJudgeCombo()).toEqual({
      judge: 'GREAT',
      combo: 12,
      channel: '11',
      updatedAtMs: 123,
    });
  });

  test('normalizes combo and deduplicates paused/high-speed writes', () => {
    const signals = createPlayerStateSignals(2);
    signals.publishJudgeCombo('BAD', -4, '12', 100);
    expect(signals.getJudgeCombo().combo).toBe(0);

    signals.setPaused(false);
    expect(signals.paused()).toBe(false);
    signals.setPaused(true);
    expect(signals.paused()).toBe(true);

    signals.setHighSpeed(2);
    expect(signals.highSpeed()).toBe(2);
    signals.setHighSpeed(2.5);
    expect(signals.highSpeed()).toBe(2.5);
  });
});
