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

  test('drainPendingJudgeCombos returns every publish in order, then clears', () => {
    // Regression cover for the AUTO PLAY simultaneous-press bomb bug: when several `publishJudgeCombo` calls
    // fired inside the same engine tick (= an AUTO chord resolves N notes at once), the renderer's
    // `getJudgeCombo()` peek inside `drainWebUiSignals` only saw the LAST publish — the others got overwritten
    // on the latch — so only the right-most lane's bomb / FC update fired. The queue must surface every publish
    // verbatim and in publish order so the host can fan one bomb sprite per chord note.
    const signals = createPlayerStateSignals(1);
    expect(signals.drainPendingJudgeCombos()).toEqual([]);

    // Simulate an AUTO chord: three lanes resolve PERFECT in one tick.
    signals.publishJudgeCombo('PERFECT', 1, '11', 100);
    signals.publishJudgeCombo('PERFECT', 2, '12', 100);
    signals.publishJudgeCombo('PERFECT', 3, '13', 100);

    const drained = signals.drainPendingJudgeCombos();
    expect(drained).toEqual([
      { judge: 'PERFECT', combo: 1, channel: '11', updatedAtMs: 100 },
      { judge: 'PERFECT', combo: 2, channel: '12', updatedAtMs: 100 },
      { judge: 'PERFECT', combo: 3, channel: '13', updatedAtMs: 100 },
    ]);
    // The latch still reflects the most recent publish for HUD readout — both APIs coexist.
    expect(signals.getJudgeCombo()).toEqual({ judge: 'PERFECT', combo: 3, channel: '13', updatedAtMs: 100 });
    // Drain is destructive: a second drain returns nothing until the next publish.
    expect(signals.drainPendingJudgeCombos()).toEqual([]);

    // Drained snapshots are detached from the latch — a publish AFTER the drain must NOT mutate the values
    // that already came out of `drainPendingJudgeCombos`.
    signals.publishJudgeCombo('BAD', 0, '14', 200);
    expect(drained[2]).toEqual({ judge: 'PERFECT', combo: 3, channel: '13', updatedAtMs: 100 });
  });
});
