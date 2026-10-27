import { parseChart } from '@be-music/chart-parser';
import { expect, test } from 'vite-plus/test';
import type { PlayerOptions } from '../engine-types.ts';
import { observePlay, tap, type CharacterizationDriver, type PlayObservation, type ScriptStep } from './harness.ts';

// Sixteen notes on 11, an eighth of a second apart, from 2 s.
const CHART = `#PLAYER 1\n#BPM 120\n#TOTAL 300\n#00111:${'01'.repeat(16)}`;

/** Every note hit `lateMs` late. */
function lateTaps(lateMs: number, count = 16): ScriptStep[] {
  return Array.from({ length: count }, (_, index) => tap(2000 + index * 125 + lateMs, '11')).flat();
}

async function play(options: PlayerOptions, script: readonly ScriptStep[], driver: CharacterizationDriver = 'manual') {
  return observePlay({ driver, chart: parseChart(CHART, 'bms'), options: { judgeRuleset: 'lr2', ...options }, script });
}

/** The recorded timing steps of a play. */
function steps(observed: PlayObservation): unknown[] {
  return (observed.replay?.play.optionChanges ?? []).map((change) => change.values.judgeTimingMs);
}

test.each(['LR2-ON', 'LR2-SILENT'] as const)(
  '%s steps the timing 1 ms after ten late hits and records the step',
  async (mode) => {
    const observed = await play({ judgeTimingAutoAdjust: mode, judgeTimingMs: 0 }, lateTaps(20));
    expect(observed.summary).toMatchObject({ total: 16, great: 16 });
    // Sixteen hits fill one window of ten; the other six wait for the next.
    expect(steps(observed)).toEqual([1]);
    expect(observed.replay?.play.options).toMatchObject({ judgeTimingAutoAdjust: mode, judgeTimingMs: 0 });
    const changes = observed.replay?.play.optionChanges ?? [];
    expect(changes.map((change) => change.values)).toEqual([{ judgeTimingMs: 1 }]);
    // The tenth hit lands at 3.145 s; the step is recorded on the pass that judged it.
    expect(changes[0]!.timeUs).toBeGreaterThanOrEqual(3_145_000);
    expect(changes[0]!.timeUs).toBeLessThan(3_270_000);
    // The timing is display-only: the re-simulated replay judges the same.
    expect(observed.simulated?.lr2).toMatchObject({ judge: { pgreat: 0, great: 16 }, slow: 16 });
  },
);

test('LR2 moves toward early hits too, and not at all for fewer than ten', async () => {
  expect(steps(await play({ judgeTimingAutoAdjust: 'LR2-ON', judgeTimingMs: 5 }, lateTaps(-20)))).toEqual([4]);
  expect(steps(await play({ judgeTimingAutoAdjust: 'LR2-ON', judgeTimingMs: 5 }, lateTaps(20, 9)))).toEqual([]);
});

test('AUTO and a two-player BATTLE take no LR2 step', async () => {
  const auto = await play({ judgeTimingAutoAdjust: 'LR2-ON', judgeTimingMs: 0 }, [], 'auto');
  expect(auto.ui.some((entry) => entry.includes('judge-timing'))).toBe(false);
  const battle = await play(
    { judgeTimingAutoAdjust: 'LR2-ON', judgeTimingMs: 0, battleMode: 'TWO-PLAYER' },
    lateTaps(20),
  );
  expect(battle.summary?.great).toBe(16);
  expect(steps(battle)).toEqual([]);
});

test("beatoraja's calibration runs under LR2 judge rules too", async () => {
  const observed = await play({ judgeTimingAutoAdjust: 'BEATORAJA', judgeTimingMs: 0 }, lateTaps(20, 3));
  // Each 20 ms GOOD-or-better hit moves it by round(20 / 30) = 1 ms.
  expect(steps(observed)).toEqual([1, 2, 3]);
});
