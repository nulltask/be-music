import { describe, expect, test } from 'vite-plus/test';
import { basicChart, exRankChart, longNoteChart } from './charts.ts';
import { command, observePlay, tap, type PlayObservation, type ScriptStep } from './harness.ts';

/**
 * Known drifts between the manual and the auto driver, and between a live play and its replay, as they stand today.
 * Each test pins one, named `drift: …`, so the one play loop (ADR 0003, migration phase P1) can keep it or flip it on
 * purpose: a pull request that removes a drift changes its test (and the snapshots it touches) and says so.
 */

const escape = (atMs: number): ScriptStep => command(atMs, { kind: 'interrupt', reason: 'escape' });

/** Taps on time for every note of the basic chart. */
const ON_TIME: ScriptStep[] = [
  ...tap(500, '11'),
  ...tap(750, '12'),
  ...tap(1000, '13'),
  ...tap(1250, '16'),
  ...tap(1500, ['14', '15']),
  ...tap(1750, '18'),
  ...tap(2000, '19'),
  ...tap(2500, '11'),
  ...tap(3000, '12'),
  ...tap(3500, '11'),
];

const audioCalls = (observation: PlayObservation, call: string): string[] =>
  observation.audio.filter((entry) => entry.split(' ')[1] === call);

describe('driver drift', () => {
  test('manual and auto play both honour holdAfterChart', async () => {
    const play = { chart: basicChart(), holdAfterChart: { releaseAfterMs: 500 } };
    const manual = await observePlay({ ...play, driver: 'manual', script: ON_TIME });
    const auto = await observePlay({ ...play, driver: 'auto' });
    const settledAt = (observation: PlayObservation): number => {
      // The play settles once, stays open, and ends on the release.
      const hold = observation.host.filter((entry) => entry.includes(' hold ')).map((entry) => entry.split(' '));
      expect(hold.map(([, , what]) => what)).toEqual(['settled', 'release']);
      const settledAtMs = Number(hold[0]![0]);
      expect(Number(hold[1]![0])).toBe(settledAtMs + 500);
      expect(observation.endedAtMs).toBeGreaterThanOrEqual(settledAtMs + 500);
      return settledAtMs;
    };
    // Manual play settles at the first tick past its horizon (3.5 s chart + 0.2 s BAD reach + 1 s).
    expect(settledAt(manual)).toBeGreaterThanOrEqual(4700);
    expect(settledAt(manual)).toBeLessThan(4700 + 1000 / 60);
    // Auto play settles past the chart's end too, instead of ending with it.
    expect(settledAt(auto)).toBeGreaterThan(3500);
  });

  test('auto play resolves the #EXRANK changes like manual play', async () => {
    // AUTO play judges every note PGREAT and reads only LR2's BAD reach, which no rank changes, so the changes show where
    // the windows are reported: under a judge-window override both modes trace them with the same windows.
    const options = { judgeWindowMs: 150 };
    const manual = await observePlay({ driver: 'manual', chart: exRankChart(true), ui: false, options });
    const auto = await observePlay({ driver: 'auto', chart: exRankChart(true), ui: false, options });
    const rankChanges = (observation: PlayObservation) =>
      observation.output.filter((line) => line.includes('kind:judge-rank-change'));
    expect(rankChanges(auto)).toEqual(rankChanges(manual));
    expect(rankChanges(auto).every((line) => line.endsWith(' bad:150ms'))).toBe(true);
    const withChanges = await observePlay({ driver: 'auto', chart: exRankChart(true) });
    // Its play log records the changes, and manual play judges by them.
    expect(withChanges.playlog?.chart.judgeRank.timeline).toEqual([
      { timeUs: 1_000_000, exRankValue: 25 },
      { timeUs: 2_000_000, exRankValue: 200 },
    ]);
    const lateBy35 = [...tap(535, '11'), ...tap(1535, '12'), ...tap(2535, '13'), ...tap(3035, '14')];
    const manualWithChanges = await observePlay({ driver: 'manual', chart: exRankChart(true), script: lateBy35 });
    const manualWithoutChanges = await observePlay({ driver: 'manual', chart: exRankChart(false), script: lateBy35 });
    expect(manualWithChanges.summary).not.toEqual(manualWithoutChanges.summary);
  });

  test('ESC — manual and auto play both record where their judge had settled as abortedAtUs', async () => {
    const manual = await observePlay({ driver: 'manual', chart: basicChart(), script: [escape(1800)] });
    const auto = await observePlay({ driver: 'auto', chart: basicChart(), script: [escape(1800)] });
    expect(manual.playlog?.play.aborted).toBe(true);
    expect(auto.playlog?.play.aborted).toBe(true);
    // The last tick before the ESC was drained (ticks every 1000 / 60 ms).
    expect(manual.playlog?.play.abortedAtUs).toBe(1_783_333);
    expect(auto.playlog?.play.abortedAtUs).toBe(1_783_333);
  });

  test('ESC — manual and auto play both trace the end of the play as an escape', async () => {
    const manual = await observePlay({ driver: 'manual', chart: basicChart(), script: [escape(1800)], ui: false });
    const auto = await observePlay({ driver: 'auto', chart: basicChart(), script: [escape(1800)], ui: false });
    expect(manual.output.filter((line) => line.includes('kind:playback-end'))).toEqual([
      'EVENT time:0:03.50 kind:playback-end reason:escape',
    ]);
    expect(auto.output.filter((line) => line.includes('kind:playback-end'))).toEqual([
      'EVENT time:0:03.50 kind:playback-end reason:escape',
    ]);
  });

  test('ESC during the lead-in — neither manual nor auto play starts the chart', async () => {
    const play = { chart: basicChart(), script: [escape(200)], options: { leadInMs: 500 } };
    const manual = await observePlay({ ...play, driver: 'manual' });
    const auto = await observePlay({ ...play, driver: 'auto' });
    for (const observation of [manual, auto]) {
      // The play stops at the ESC, before the chart's audio starts, and records an abort at the chart's start.
      expect(observation.audio).toEqual(['200.000 dispose']);
      expect(observation.endedAtMs).toBe(200);
      expect(observation.playlog?.play).toMatchObject({ aborted: true, abortedAtUs: 0 });
    }
  });

  test('manual and auto play both start their input runtime before the lead-in', async () => {
    const play = { chart: basicChart(), options: { leadInMs: 500 } };
    const starts = (observation: PlayObservation) =>
      observation.host.filter((entry) => entry.endsWith('input-runtime start'));
    expect(starts(await observePlay({ ...play, driver: 'manual' }))).toEqual(['0.000 input-runtime start']);
    expect(starts(await observePlay({ ...play, driver: 'auto' }))).toEqual(['0.000 input-runtime start']);
  });

  test('drift: with an audio session manualPlay runs on past the chart by the lead-in, the widest BAD reach and 1 s; autoPlay stops with the chart', async () => {
    const play = { chart: basicChart(), options: { leadInMs: 1000 } };
    const manual = await observePlay({
      ...play,
      driver: 'manual',
      script: ON_TIME.map((step) => ({ ...step, atMs: step.atMs + 1000 })),
    });
    const auto = await observePlay({ ...play, driver: 'auto' });
    // 1000 lead-in + 3500 chart, then manual's horizon adds the lead-in again, the 200 ms BAD reach and 1000 ms.
    expect(auto.endedAtMs).toBe(4500);
    expect(manual.endedAtMs).toBeGreaterThanOrEqual(6700);
    expect(manual.endedAtMs).toBeLessThan(6700 + 1000 / 60);
    // Without an audio session manual play ends once its chart is judged.
    const silent = await observePlay({
      ...play,
      driver: 'manual',
      audio: false,
      script: ON_TIME.map((step) => ({ ...step, atMs: step.atMs + 1000 })),
    });
    expect(silent.endedAtMs).toBeLessThan(4800);
  });

  test('drift: autoPlay publishes a closing frame at the chart’s end, manualPlay’s last frame is its last tick', async () => {
    const manual = await observePlay({ driver: 'manual', chart: basicChart(), script: ON_TIME });
    const auto = await observePlay({ driver: 'auto', chart: basicChart() });
    expect(auto.frames.last).toBe('3500.000 seconds=3.5 beat=7');
    expect(manual.frames.last).toMatch(/^4\d{3}\.\d{3} seconds=4\./);
  });

  test('drift: autoPlay sends every note’s keysound to the audio session twice, manualPlay once per press', async () => {
    const manual = await observePlay({ driver: 'manual', chart: basicChart(), script: ON_TIME });
    const auto = await observePlay({ driver: 'auto', chart: basicChart() });
    const lane11 = (observation: PlayObservation) =>
      audioCalls(observation, 'trigger').filter((entry) => entry.includes(' trigger 11:'));
    expect(lane11(manual)).toHaveLength(3);
    expect(lane11(auto)).toHaveLength(6);
  });

  test('drift: autoPlay does not record endOnFailure', async () => {
    const manual = await observePlay({ driver: 'manual', chart: basicChart(), script: ON_TIME });
    const auto = await observePlay({ driver: 'auto', chart: basicChart() });
    expect(manual.playlog?.play.endOnFailure).toBe(true);
    expect(auto.playlog?.play).not.toHaveProperty('endOnFailure');
  });

  test('drift: autoPlay records the tempo and the tempo changes of a play it re-drives, a manual replay records neither', async () => {
    const options = { speed: 1.5, replayTempoChanges: [{ timeUs: 1_000_000, tempo: 0.75 }] };
    const live = await observePlay({ driver: 'manual', chart: basicChart(), script: ON_TIME });
    const replay = await observePlay({
      driver: 'manual',
      chart: basicChart(),
      options: { ...options, replayInputs: live.playlog!.inputs },
    });
    const auto = await observePlay({ driver: 'auto', chart: basicChart(), options });
    expect(replay.host.filter((entry) => entry.includes(' tempo '))).toHaveLength(1);
    expect(replay.playlog?.play).not.toHaveProperty('tempo');
    expect(replay.playlog?.play).not.toHaveProperty('tempoChanges');
    expect(auto.host.filter((entry) => entry.includes(' tempo '))).toHaveLength(1);
    expect(auto.playlog?.play.tempo).toBe(1.5);
    expect(auto.playlog?.play.tempoChanges).toHaveLength(1);
  });

  test('drift: manualPlay follows replayTempoChanges only in a replay, autoPlay in any play', async () => {
    const options = { replayTempoChanges: [{ timeUs: 1_000_000, tempo: 0.75 }] };
    const manual = await observePlay({ driver: 'manual', chart: basicChart(), script: ON_TIME, options });
    const auto = await observePlay({ driver: 'auto', chart: basicChart(), options });
    expect(manual.host.some((entry) => entry.includes(' tempo '))).toBe(false);
    expect(auto.host.some((entry) => entry.includes(' tempo '))).toBe(true);
  });

  test('drift: a replay of an ESC-aborted log plays on past the abort, while the simulators stop there', async () => {
    const live = await observePlay({
      driver: 'manual',
      chart: basicChart(),
      script: [...ON_TIME.slice(0, 4), escape(1100)],
    });
    const replay = await observePlay({
      driver: 'manual',
      chart: basicChart(),
      options: { replayInputs: live.playlog!.inputs },
    });
    expect(live.simulated?.lr2.judge.poor).toBe(0);
    expect(live.summary?.poor).toBe(0);
    // The replay misses every note after the abort.
    expect(replay.summary?.poor).toBe(9);
  });

  test('drift: a replay of a log recorded without key releases judges differently from the live play', async () => {
    // A terminal without the kitty keyboard protocol sends repeated presses and no releases; the live play holds long
    // notes on hold-grace windows, but the log has only `down` inputs, so its replay holds every key forever.
    const repeats: ScriptStep[] = Array.from({ length: 11 }, (_, index) => ({
      atMs: 500 + index * 100,
      press: ['11'],
    }));
    const live = await observePlay({ driver: 'manual', chart: longNoteChart(1), script: repeats });
    expect(live.playlog?.inputs.every((input) => input.action === 'down')).toBe(true);
    const replay = await observePlay({
      driver: 'manual',
      chart: longNoteChart(1),
      options: { replayInputs: live.playlog!.inputs },
    });
    expect(live.summary?.emptyPoor).toBe(0);
    expect(replay.summary?.emptyPoor).toBeGreaterThan(0);
    expect(replay.summary).not.toEqual(live.summary);
  });
});
