import { computeChartFingerprint, computePlayFingerprint, drawRandomOutcomes } from '@be-music/chart-model';
import { createEmptyJSON } from '@be-music/chart-source';
import { parseChart, resolveBMSControlFlowWithDraws } from '@be-music/chart-parser';
import { autoPlay, resolvePlayChart, type PlayerOptions } from '@be-music/player-engine';
import type { BeMusicReplay, ReplayViewState } from '@be-music/player-engine/replay';
import { describe, expect, test } from 'vite-plus/test';
import { resolveReplayRecording } from './play-engine.ts';

// Ported from the removed beatoraja gameplay scene's `engine-options.test.ts`: the play session now composes the
// replay fields for every family, the beatoraja play included.

const VIEW: ReplayViewState = { hiSpeed: 2, hiSpeedScale: 'beatoraja', hsFix: 'OFF', visibleMs: 1000 };

describe('resolveReplayRecording', () => {
  test('records the DP-flip intent and the chart path next to the host fields', () => {
    const chart = createEmptyJSON('bms');
    expect(
      resolveReplayRecording(
        { gauge: 'HARD', chartSHA256: 'abc', dpFlip: true },
        { chart, chartPath: 'song/chart.bms' },
        VIEW,
      ),
    ).toEqual({
      gauge: 'HARD',
      chartSHA256: 'abc',
      sourceChart: chart,
      dpFlip: true,
      view: VIEW,
      native: { chartPath: 'song/chart.bms' },
    });
  });

  test("passes the song's chart through as the fingerprints' source", () => {
    const chart = createEmptyJSON('bms');
    expect(resolveReplayRecording({}, { chart, chartPath: 'chart.bms' }, VIEW).sourceChart).toBe(chart);
    expect(resolveReplayRecording({}, undefined, VIEW)).toEqual({ gauge: undefined, view: VIEW });
  });

  test.each(['random1P', 'random2P'] as const)('does not record a new mislabeled SCATTER play on %s', (side) => {
    expect(() => resolveReplayRecording({ [side]: 'SCATTER' }, undefined, VIEW)).toThrow(/SCATTER.*disabled/);
  });

  test('records the lane options a play runs with, the beatoraja play included', () => {
    const recording = resolveReplayRecording({ random1P: 'OFF', random2P: 'OFF' }, undefined, VIEW);
    expect(recording.randomLane).toEqual({ p1: 'OFF', p2: 'OFF' });
    expect(resolveReplayRecording({ random1P: 'MIRROR' }, undefined, VIEW).randomLane).toEqual({ p1: 'MIRROR' });
    expect(resolveReplayRecording({ random1P: 'S-RANDOM', random2P: 'RANDOM' }, undefined, VIEW).randomLane).toEqual({
      p1: 'S-RANDOM',
      p2: 'RANDOM',
    });
  });
});

describe('replay #RANDOM draws on the web paths', () => {
  // `#RANDOM 1` resolves without a draw; `#RANDOM 2` draws and picks lane 11 or 12; `#SWITCH 3` draws and picks
  // lane 13, 14 or 15.
  const SOURCE = parseChart(
    [
      '#BPM 120',
      '#RANDOM 1',
      '#IF 1',
      '#WAV01 one.wav',
      '#ENDIF',
      '#ENDRANDOM',
      '#RANDOM 2',
      '#IF 1',
      '#00111:01',
      '#ENDIF',
      '#IF 2',
      '#00112:01',
      '#ENDIF',
      '#ENDRANDOM',
      '#SWITCH 3',
      '#CASE 1',
      '#00213:01',
      '#SKIP',
      '#CASE 2',
      '#00214:01',
      '#SKIP',
      '#DEF',
      '#00215:01',
      '#ENDSW',
    ].join('\n'),
    'bms',
  );
  const CHART_PATH = 'song/chart.pms';

  function sequence(...values: number[]): () => number {
    let index = 0;
    return () => values[index++] ?? 0;
  }

  async function recordReplay(
    chart: typeof SOURCE,
    engineOptions: Omit<PlayerOptions, 'onReplayRecorded'>,
  ): Promise<BeMusicReplay> {
    let replay: BeMusicReplay | undefined;
    await autoPlay(chart, {
      speed: 64,
      leadInMs: 0,
      audio: false,
      tui: false,
      ...engineOptions,
      onReplayRecorded: (recorded) => {
        replay = recorded;
      },
    });
    return replay!;
  }

  function expectReproducible(replay: BeMusicReplay, played: typeof SOURCE): void {
    // A verifier with the chart file rebuilds the played chart from the recorded draws ...
    const rebuilt = resolveBMSControlFlowWithDraws(SOURCE, replay.play.randomDraws ?? []);
    expect(rebuilt).toEqual(played);
    // ... and recomputes both fingerprints the log carries.
    expect(replay.chart.playFingerprint).toBe(computePlayFingerprint(played, { chartPath: CHART_PATH }));
    expect(replay.chart.chartFingerprint).toBe(computeChartFingerprint(SOURCE, { chartPath: CHART_PATH }));
  }

  for (const [values, drawn, lanes] of [
    [
      [0, 0],
      [1, 1, 1],
      ['11', '13'],
    ],
    [
      [0.9, 0.5],
      [1, 2, 2],
      ['12', '14'],
    ],
    [
      [0.9, 0.9],
      [1, 2, 3],
      ['12', '15'],
    ],
  ] as const) {
    test(`play session: records the draws ${drawn.join(', ')} of the chart it played`, async () => {
      // `prepareChart` resolves once; `launchSharedEngine` hands the engine that chart, its draws and the song's
      // chart as the fingerprint source.
      const resolved = resolvePlayChart(SOURCE, { random: sequence(...values) });
      const replay = await recordReplay(resolved.chart, {
        laneModeExtension: '.pms',
        randomDraws: resolved.randomDraws,
        recordReplay: { sourceChart: SOURCE, native: { chartPath: CHART_PATH } },
      });
      expect(replay.play.randomDraws?.map((draw) => draw.value)).toEqual(drawn);
      expect(replay.chart.notes.map((note) => note.channel)).toEqual(lanes);
      expectReproducible(replay, resolved.chart);
    });

    test(`beatoraja play: records the draws ${drawn.join(', ')} of the chart it played`, async () => {
      // The decide screen resolves once and the play takes its draws (`preResolved`); the session composes the
      // replay fields of a beatoraja play as of any other (here with the lane options off).
      const resolved = resolvePlayChart(SOURCE, { random: sequence(...values) });
      const replay = await recordReplay(resolved.chart, {
        laneModeExtension: '.pms',
        playVariant: '9',
        randomDraws: resolved.randomDraws,
        recordReplay: resolveReplayRecording(
          { gauge: 'GROOVE', random1P: 'OFF', random2P: 'OFF' },
          { chart: SOURCE, chartPath: CHART_PATH },
          VIEW,
        ),
      });
      expect(replay.play.randomDraws?.map((draw) => draw.value)).toEqual(drawn);
      expect(replay.chart.notes.map((note) => note.channel)).toEqual(lanes);
      expectReproducible(replay, resolved.chart);
    });
  }

  test('a replay resolved with the recorded draws plays the recorded chart', async () => {
    const recorded = resolvePlayChart(SOURCE, { random: sequence(0.9, 0.9) });
    const replay = await recordReplay(recorded.chart, {
      laneModeExtension: '.pms',
      randomDraws: recorded.randomDraws,
      recordReplay: { sourceChart: SOURCE },
    });
    // The session resolves a replay with the log's draws, whatever the random source would draw.
    const replayed = resolvePlayChart(SOURCE, { randomDraws: replay.play.randomDraws, random: () => 0 });
    expect(replayed.chart).toEqual(recorded.chart);
    expect(replayed.randomDraws).toEqual(recorded.randomDraws);
  });

  test('a chart without control flow records no draws', async () => {
    const chart = parseChart(['#BPM 120', '#00111:01'].join('\n'), 'bms');
    const resolved = resolvePlayChart(chart);
    expect(resolved.randomDraws).toEqual(drawRandomOutcomes(chart, () => 0));
    const replay = await recordReplay(resolved.chart, {
      laneModeExtension: '.pms',
      randomDraws: resolved.randomDraws,
      recordReplay: resolveReplayRecording({}, { chart, chartPath: CHART_PATH }, VIEW),
    });
    expect(replay.play.randomDraws).toBeUndefined();
    expect(replay.chart.chartFingerprint).toBe(replay.chart.playFingerprint);
  });
});

test('records every selected option separately from the effective chart and engine fields', () => {
  const recordingOptionState = {
    hsFix: 'STARTBPM',
    displayAreaInfo: 'SUDDEN_ONLY',
    autoScratch1P: true,
    autoScratch2P: false,
  };
  const result = resolveReplayRecording({ recordingOptionState }, undefined, VIEW);
  recordingOptionState.autoScratch1P = false;
  expect(result.options).toEqual({
    hsFix: 'STARTBPM',
    displayAreaInfo: 'SUDDEN_ONLY',
    autoScratch1P: true,
    autoScratch2P: false,
  });
});

test('the recorded snapshot reflects course restrictions and an AUTO start instead of stale menu picks', () => {
  expect(
    resolveReplayRecording(
      {
        recordingOptionState: { autoPlay: false, gauge1P: 'EASY', random1P: 'RANDOM', autoScratch1P: true },
        autoPlay: true,
        gauge: 'HARD',
        random1P: 'OFF',
        autoScratch1P: false,
      },
      undefined,
      VIEW,
    ).options,
  ).toMatchObject({ autoPlay: true, gauge1P: 'HARD', random1P: 'OFF', autoScratch1P: false });
});

test('records the effective H-RANDOM threshold alongside the arrangement selection', () => {
  const recording = resolveReplayRecording({ random1P: 'H-RANDOM', hRandomThresholdBPM: 1200 }, undefined, VIEW);
  expect(recording.options).toMatchObject({ random1P: 'H-RANDOM', hRandomThresholdBPM: 1000 });
});

test('records LR2 CONVERGE with independent fixed-lane targets', () => {
  const recording = resolveReplayRecording(
    { random1P: 'CONVERGE', random2P: 'CONVERGE', randomFixedLane1P: 4, randomFixedLane2P: 0 },
    undefined,
    VIEW,
  );
  expect(recording.options).toMatchObject({
    random1P: 'CONVERGE',
    random2P: 'CONVERGE',
    randomFixedLane1P: 4,
    randomFixedLane2P: 0,
  });
});
