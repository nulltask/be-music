import { describe, expect, test } from 'vite-plus/test';
import type { BeMusicJSON } from '@be-music/chart-source';
import type { ReplayRulesetResult } from '../../replay/format.ts';
import { basicChart, denseChart, exRankChart, longNoteChart, mineChart } from './charts.ts';
import { command, observePlay, tap, type PlayObservation, type ScriptStep } from './harness.ts';

/**
 * Where the manual and the auto driver, and a live play and its replay, used to drift apart. The one play loop (ADR
 * 0003, migration phase P1) fixed them one at a time; each test now asserts that both sides agree. A test still named
 * `drift: …` pins a difference that remains on purpose: a pull request that removes it changes its test (and the
 * snapshots it touches) and says so.
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

/** One 60 Hz tick, and the rounding of a snapshot time (the loop's tick times are sums of 1000 / 60 ms). */
const TICK_MS = 1000 / 60 + 0.001;

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
    // Both settle at the first tick past their horizon (3.5 s chart + 0.2 s BAD reach + 1 s).
    for (const observation of [manual, auto]) {
      expect(settledAt(observation)).toBeGreaterThanOrEqual(4700);
      expect(settledAt(observation)).toBeLessThanOrEqual(4700 + TICK_MS);
    }
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
    // Its replay records the changes, and manual play judges by them.
    expect(withChanges.replay?.chart.judgeRank.timeline).toEqual([
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
    expect(manual.replay?.play.aborted).toBe(true);
    expect(auto.replay?.play.aborted).toBe(true);
    // The last tick before the ESC was drained (ticks every 1000 / 60 ms).
    expect(manual.replay?.play.abortedAtUs).toBe(1_783_333);
    expect(auto.replay?.play.abortedAtUs).toBe(1_783_333);
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
      expect(observation.replay?.play).toMatchObject({ aborted: true, abortedAtUs: 0 });
    }
  });

  test('manual and auto play both start their input runtime before the lead-in', async () => {
    const play = { chart: basicChart(), options: { leadInMs: 500 } };
    const starts = (observation: PlayObservation) =>
      observation.host.filter((entry) => entry.endsWith('input-runtime start'));
    expect(starts(await observePlay({ ...play, driver: 'manual' }))).toEqual(['0.000 input-runtime start']);
    expect(starts(await observePlay({ ...play, driver: 'auto' }))).toEqual(['0.000 input-runtime start']);
  });

  test('with an audio session manual and auto play both run on past the chart by the widest BAD reach and 1 s', async () => {
    const play = { chart: basicChart(), options: { leadInMs: 1000 } };
    const script = ON_TIME.map((step) => ({ ...step, atMs: step.atMs + 1000 }));
    const manual = await observePlay({ ...play, driver: 'manual', script });
    const auto = await observePlay({ ...play, driver: 'auto' });
    // 1000 lead-in + 3500 chart + 200 ms BAD reach + 1000 ms, counted once on the play clock: the first tick past it.
    for (const observation of [manual, auto]) {
      expect(observation.endedAtMs).toBeGreaterThanOrEqual(5700);
      expect(observation.endedAtMs).toBeLessThanOrEqual(5700 + TICK_MS);
    }
    // Without an audio session both end once their chart is judged.
    const silentManual = await observePlay({ ...play, driver: 'manual', audio: false, script });
    const silentAuto = await observePlay({ ...play, driver: 'auto', audio: false });
    expect(silentManual.endedAtMs).toBeLessThan(4600);
    expect(silentAuto.endedAtMs).toBeLessThan(4600);
  });

  test('manual and auto play both close on a frame at the end of the play, never earlier than the one before', async () => {
    const manual = await observePlay({ driver: 'manual', chart: basicChart(), script: ON_TIME });
    const auto = await observePlay({ driver: 'auto', chart: basicChart() });
    const lastFrame = (observation: PlayObservation): { atMs: number; seconds: number } => {
      const [, atMs, seconds] = /^(\S+) seconds=(\S+) /.exec(observation.frames.last!)!;
      return { atMs: Number(atMs), seconds: Number(seconds) };
    };
    for (const observation of [manual, auto]) {
      // Published once the play is over (within a tick of the end), showing the chart time of the last tick before the
      // horizon (3.5 s chart + 0.2 s BAD reach + 1 s; the play clock runs at tempo 1 from 0 here) rather than going back
      // to the chart's end.
      const { atMs, seconds } = lastFrame(observation);
      expect(seconds).toBeGreaterThan(4.7 - TICK_MS / 1000);
      expect(atMs - seconds * 1000).toBeGreaterThanOrEqual(0);
      expect(atMs - seconds * 1000).toBeLessThanOrEqual(TICK_MS);
    }
    // A play that ends on failure closes where it failed, not at the chart's end.
    const failed = await observePlay({ driver: 'manual', chart: denseChart(), options: { gauge: 'DEATH' } });
    expect(failed.summary?.gauge?.failedMidPlay).toBe(true);
    expect(lastFrame(failed).seconds).toBeLessThan(1);
  });

  test('manual and auto play both send each note’s keysound to the audio session once', async () => {
    const manual = await observePlay({ driver: 'manual', chart: basicChart(), script: ON_TIME });
    const auto = await observePlay({ driver: 'auto', chart: basicChart() });
    const lane11 = (observation: PlayObservation) =>
      audioCalls(observation, 'trigger').filter((entry) => entry.includes(' trigger 11:'));
    expect(lane11(manual)).toHaveLength(3);
    expect(lane11(auto)).toHaveLength(3);
  });

  test('manual and auto play both record endOnFailure', async () => {
    const manual = await observePlay({ driver: 'manual', chart: basicChart(), script: ON_TIME });
    const auto = await observePlay({ driver: 'auto', chart: basicChart() });
    expect(manual.replay?.play.endOnFailure).toBe(true);
    expect(auto.replay?.play.endOnFailure).toBe(true);
    const keepingOn = await observePlay({ driver: 'auto', chart: basicChart(), options: { endOnFailure: false } });
    expect(keepingOn.replay?.play).not.toHaveProperty('endOnFailure');
  });

  test('a replay records neither the tempo nor the tempo changes it is re-driven at, in manual and auto play', async () => {
    const options = { speed: 1.5, replayTempoChanges: [{ timeUs: 1_000_000, tempo: 0.75 }] };
    const live = await observePlay({ driver: 'manual', chart: basicChart(), script: ON_TIME });
    const replay = await observePlay({
      driver: 'manual',
      chart: basicChart(),
      options: { ...options, replayInputs: live.replay!.inputs },
    });
    // A replay of an auto-played log: its inputs are empty.
    const auto = await observePlay({ driver: 'auto', chart: basicChart(), options: { ...options, replayInputs: [] } });
    expect(replay.host.filter((entry) => entry.includes(' tempo '))).toHaveLength(1);
    expect(replay.replay?.play).not.toHaveProperty('tempo');
    expect(replay.replay?.play).not.toHaveProperty('tempoChanges');
    expect(auto.host.filter((entry) => entry.includes(' tempo '))).toHaveLength(1);
    expect(auto.replay?.play).not.toHaveProperty('tempo');
    expect(auto.replay?.play).not.toHaveProperty('tempoChanges');
  });

  test('manual and auto play both follow replayTempoChanges only in a replay', async () => {
    const options = { replayTempoChanges: [{ timeUs: 1_000_000, tempo: 0.75 }] };
    const manual = await observePlay({ driver: 'manual', chart: basicChart(), script: ON_TIME, options });
    const auto = await observePlay({ driver: 'auto', chart: basicChart(), options });
    const autoReplay = await observePlay({
      driver: 'auto',
      chart: basicChart(),
      options: { ...options, replayInputs: [] },
    });
    expect(manual.host.some((entry) => entry.includes(' tempo '))).toBe(false);
    expect(auto.host.some((entry) => entry.includes(' tempo '))).toBe(false);
    expect(autoReplay.host.some((entry) => entry.includes(' tempo '))).toBe(true);
  });

  test('a replay of an ESC-aborted log stops where the play was aborted, like the simulators', async () => {
    const live = await observePlay({
      driver: 'manual',
      chart: basicChart(),
      script: [...ON_TIME.slice(0, 4), escape(1100)],
    });
    const replay = await observePlay({
      driver: 'manual',
      chart: basicChart(),
      options: { replayInputs: live.replay!.inputs, replayAbortedAtUs: live.replay!.play.abortedAtUs },
    });
    expect(live.simulated?.lr2.judge.poor).toBe(0);
    expect(live.summary?.poor).toBe(0);
    // The replay misses nothing after the abort: it ends there, as an ESC, with the live play's result and log.
    expect(replay.outcome).toBe('completed');
    expect(replay.summary).toEqual(live.summary);
    expect(replay.replay?.inputs).toEqual(live.replay?.inputs);
    expect(replay.replay?.play).toMatchObject({ aborted: true, abortedAtUs: live.replay!.play.abortedAtUs });
    expect(replay.endedAtMs).toBeLessThan(1100 + 1000 / 60);
  });

  test('a play from input without key releases, its replay and the simulators agree', async () => {
    // A terminal without the kitty keyboard protocol sends a key as one press and then, while it is held, as repeated
    // presses, with no releases. The engine infers when each key came up and records it (`inferred` ups), so the log
    // says what the judge saw: its replay and the replay simulator of the play's ruleset reach the same result.
    const presses = (fromMs: number, toMs: number, everyMs: number, lane: string): ScriptStep[] =>
      Array.from({ length: Math.floor((toMs - fromMs) / everyMs) + 1 }, (_, index) => ({
        atMs: fromMs + index * everyMs,
        press: [lane],
      }));
    const press = (atMs: number, lane: string, pressedAtMs?: number): ScriptStep =>
      pressedAtMs === undefined ? { atMs, press: [lane] } : { atMs, press: [lane], pressedAtMs };
    const cases: Array<{ name: string; chart: BeMusicJSON; script: ScriptStep[] }> = [];
    for (const lnMode of [1, 2, 3] as const) {
      // Held through a long note's tail, a long note let go early, a tap, a scratch long note, a late press.
      cases.push({
        name: `long notes, LNMODE ${lnMode}`,
        chart: longNoteChart(lnMode),
        script: [
          ...presses(500, 1500, 100, '11'),
          press(1012, '12'),
          press(1260, '13', 1250),
          press(2010, '16', 1995),
          press(3600, '15', 3480),
        ],
      });
      // A long note whose repeats start after the grace (it is let go, and the late repeats press nothing), one
      // repeated past its tail, one let go before it, and a key mashed faster than the grace.
      cases.push({
        name: `key repeat, LNMODE ${lnMode}`,
        chart: longNoteChart(lnMode),
        script: [
          press(500, '11'),
          ...presses(1000, 1440, 40, '11'),
          press(1000, '12'),
          ...presses(1300, 2100, 40, '12'),
          press(1200, '13'),
          press(1250, '13'),
          press(2500, '14'),
          ...presses(2800, 3400, 40, '14'),
          press(3500, '15'),
        ],
      });
    }
    // Mines under a held key, a mashed key and a press onto a mine.
    cases.push({
      name: 'mines',
      chart: mineChart(),
      script: [
        press(450, '11'),
        press(520, '11'),
        ...presses(900, 1100, 50, '11'),
        press(1240, '12'),
        press(2000, '12'),
        press(2400, '16'),
        ...presses(2700, 2900, 50, '16'),
      ],
    });
    for (const { name, chart, script } of cases) {
      for (const judgeRuleset of ['lr2', 'beatoraja', 'iidx'] as const) {
        const play = `${name} / ${judgeRuleset}`;
        const live = await observePlay({ driver: 'manual', chart, script, options: { judgeRuleset } });
        expect(
          live.replay?.inputs.some((input) => input.inferred === true),
          play,
        ).toBe(true);
        const replay = await observePlay({
          driver: 'manual',
          chart,
          options: { judgeRuleset, replayInputs: live.replay!.inputs },
        });
        expect(replay.summary, play).toEqual(live.summary);
        expect(replay.replay?.inputs, play).toEqual(live.replay?.inputs);
        const outcome = (result: ReplayRulesetResult | undefined) => ({
          judge: result?.judge,
          fast: result?.fast,
          slow: result?.slow,
          exScore: result?.exScore,
          maxCombo: result?.maxCombo,
          gauge: { final: result?.gauge.final, cleared: result?.gauge.cleared },
        });
        expect(live.replay?.results?.native?.judge, play).toBeDefined();
        expect(outcome(live.simulated?.[judgeRuleset]), play).toEqual(outcome(live.replay?.results?.native));
      }
    }
  });
});
