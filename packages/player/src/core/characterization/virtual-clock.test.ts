import { describe, expect, test } from 'vite-plus/test';
import { delay, getEngineScheduler } from '../engine-clock.ts';
import { basicChart, longNoteChart } from './charts.ts';
import { observePlay, realTime, tap, virtualTime, type PlayObservation } from './harness.ts';
import { createVirtualClock } from './virtual-clock.ts';

describe('createVirtualClock', () => {
  test('fires timers exactly when due, in time order and then in the order they were set', async () => {
    const clock = createVirtualClock();
    const fired: string[] = [];
    await clock.run(async () => {
      clock.setTimeout(() => fired.push(`b@${clock.now()}`), 20);
      clock.setTimeout(() => fired.push(`a@${clock.now()}`), 10);
      clock.setTimeout(() => fired.push(`c@${clock.now()}`), 20);
      clock.setImmediate(() => fired.push(`now@${clock.now()}`));
      await delay(25);
      fired.push(`delay@${clock.now()}`);
    });
    expect(fired).toEqual(['now@0', 'a@10', 'b@20', 'c@20', 'delay@25']);
  });

  test('a cancelled timer does not fire', async () => {
    const clock = createVirtualClock();
    let fired = false;
    await clock.run(async () => {
      clock.setTimeout(() => {
        fired = true;
      }, 5)();
      await delay(10);
    });
    expect(fired).toBe(false);
  });

  test('the engine reads the virtual clock only during a run', async () => {
    const clock = createVirtualClock();
    const host = getEngineScheduler();
    await clock.run(async () => {
      expect(getEngineScheduler()).toBe(clock);
      await delay(5);
    });
    expect(getEngineScheduler()).toBe(host);
    await expect(clock.run(() => Promise.reject(new Error('play failed')))).rejects.toThrow('play failed');
    expect(getEngineScheduler()).toBe(host);
  });

  test('a run fails instead of hanging when the play waits on nothing the clock knows', async () => {
    const clock = createVirtualClock();
    await expect(clock.run(() => new Promise<void>(() => undefined))).rejects.toThrow('nothing is scheduled');
  });

  test('a run fails once the play passes the virtual time limit', async () => {
    const clock = createVirtualClock({ limitMs: 100 });
    const forever = async (): Promise<void> => {
      for (;;) await delay(30);
    };
    await expect(clock.run(forever)).rejects.toThrow('past 100 ms');
  });
});

/**
 * Real time against virtual time: the same plays on the host's clock and on the virtual clock reach the same result.
 * The real-time runs tick on the host's timers, so only what does not depend on where the ticks fall is compared: a
 * replay (judged on chart time, `advanceJudgeCoreReplay`) and an auto play, their summaries and play logs, the
 * judgments in order, and the audio session's calls and the UI commands as sets.
 */
describe('the virtual clock against real time', () => {
  const untimed = (entries: readonly string[]): string[] => entries.map((entry) => entry.replace(/^\S+ /, ''));
  const comparable = (observation: PlayObservation) => {
    const { createdAt: _createdAt, recorder: _recorder, ...playlog } = observation.playlog!;
    return {
      outcome: observation.outcome,
      summary: observation.summary,
      playlog,
      simulated: observation.simulated,
      judges: untimed(observation.judges),
      audio: untimed(observation.audio).sort(),
      ui: untimed(observation.ui).sort(),
      judged: untimed(observation.frames.judged.map((entry) => entry.replace(/ seconds=\S+/, ''))).sort(),
      host: untimed(observation.host),
      output: observation.output,
    };
  };

  test('a replay and an auto play give the same results', { timeout: 20_000 }, async () => {
    // Recorded on the virtual clock: presses on time and off it, long notes held and released early.
    const chart = longNoteChart(2);
    const recorded = await observePlay({
      driver: 'manual',
      chart,
      script: [
        { atMs: 500, down: ['11'] },
        { atMs: 1030, down: ['12'] },
        ...tap(1210, '13'),
        { atMs: 1500, up: ['11'] },
        { atMs: 1600, up: ['12'] },
        ...tap(2000, '16', 520),
        ...tap(3440, '15'),
      ],
      options: { judgeRuleset: 'beatoraja' },
    });
    // Driven eight times as fast so the real-time runs take about two seconds.
    const replay = {
      driver: 'manual' as const,
      chart,
      options: { judgeRuleset: 'beatoraja' as const, speed: 8, replayInputs: recorded.playlog!.inputs },
    };
    const auto = { driver: 'auto' as const, chart: basicChart(), options: { speed: 8 } };

    const virtualReplay = await observePlay(replay, virtualTime());
    const realReplay = await observePlay(replay, realTime());
    expect(comparable(realReplay)).toEqual(comparable(virtualReplay));
    expect(virtualReplay.summary).toEqual(recorded.summary);

    const virtualAuto = await observePlay(auto, virtualTime());
    const realAuto = await observePlay(auto, realTime());
    expect(comparable(realAuto)).toEqual(comparable(virtualAuto));
  });
});
