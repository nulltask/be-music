import { computeChartFingerprint, computePlayFingerprint, drawRandomOutcomes } from '@be-music/chart';
import { createEmptyJson } from '@be-music/json';
import { parseChart, resolveBmsControlFlowWithDraws } from '@be-music/parser';
import { autoPlay, resolvePlayChart, type PlayerOptions } from '@be-music/player/core/engine';
import type { BeMusicPlaylog } from '@be-music/player/playlog';
import { describe, expect, test } from 'vite-plus/test';
import { composeBeatorajaEngineOptions } from './engine-options.ts';

describe('composeBeatorajaEngineOptions', () => {
  test('infers the lane-mode extension and play variant unless the host set them', () => {
    expect(composeBeatorajaEngineOptions({ chartPath: 'Song.v1/chart.PMS', variant: '9' })).toMatchObject({
      laneModeExtension: '.pms',
      playVariant: '9',
    });
    expect(
      composeBeatorajaEngineOptions({
        chartPath: 'chart.pms',
        variant: '9',
        engineOptions: { laneModeExtension: '.bme', playVariant: '7' },
      }),
    ).toMatchObject({ laneModeExtension: '.bme', playVariant: '7' });
    expect(composeBeatorajaEngineOptions({ chartPath: 'dir.with.dots/chart' }).laneModeExtension).toBeUndefined();
  });

  test('records the DP-flip intent and the chart path next to the host fields', () => {
    const options = composeBeatorajaEngineOptions({
      chartPath: 'song/chart.bms',
      dpFlip: true,
      engineOptions: { recordPlaylog: { gauge: 'HARD', chartSha256: 'abc', native: { skin: 'x' } } },
    });
    expect(options.recordPlaylog).toEqual({
      gauge: 'HARD',
      chartSha256: 'abc',
      dpFlip: true,
      native: { skin: 'x', chartPath: 'song/chart.bms' },
    });
  });

  test('passes the source chart through for the fingerprints and keeps the host draws', () => {
    const sourceChart = createEmptyJson('bms');
    const randomDraws = [{ command: 'RANDOM', range: 2, value: 1 }] as const;
    const options = composeBeatorajaEngineOptions({ sourceChart, engineOptions: { randomDraws } });
    expect(options.recordPlaylog?.sourceChart).toBe(sourceChart);
    expect(options.randomDraws).toBe(randomDraws);
    expect(composeBeatorajaEngineOptions({}).recordPlaylog).toEqual({});
  });
});

describe('play-log #RANDOM draws on the web paths', () => {
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

  async function recordPlaylog(
    chart: typeof SOURCE,
    engineOptions: Omit<PlayerOptions, 'onPlaylogRecorded'>,
  ): Promise<BeMusicPlaylog> {
    let playlog: BeMusicPlaylog | undefined;
    await autoPlay(chart, {
      speed: 64,
      leadInMs: 0,
      audio: false,
      tui: false,
      ...engineOptions,
      onPlaylogRecorded: (recorded) => {
        playlog = recorded;
      },
    });
    return playlog!;
  }

  function expectReproducible(playlog: BeMusicPlaylog, played: typeof SOURCE): void {
    // A verifier with the chart file rebuilds the played chart from the recorded draws ...
    const rebuilt = resolveBmsControlFlowWithDraws(SOURCE, playlog.play.randomDraws ?? []);
    expect(rebuilt).toEqual(played);
    // ... and recomputes both fingerprints the log carries.
    expect(playlog.chart.playFingerprint).toBe(computePlayFingerprint(played, { chartPath: CHART_PATH }));
    expect(playlog.chart.chartFingerprint).toBe(computeChartFingerprint(SOURCE, { chartPath: CHART_PATH }));
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
    test(`core scene: records the draws ${drawn.join(', ')} of the chart it played`, async () => {
      // `CoreGameplayView.prepareSong` resolves once; `launchSharedEngine` hands the engine that chart, its draws
      // and the song's chart as the fingerprint source.
      const resolved = resolvePlayChart(SOURCE, { random: sequence(...values) });
      const playlog = await recordPlaylog(resolved.chart, {
        laneModeExtension: '.pms',
        randomDraws: resolved.randomDraws,
        recordPlaylog: { sourceChart: SOURCE, native: { chartPath: CHART_PATH } },
      });
      expect(playlog.play.randomDraws?.map((draw) => draw.value)).toEqual(drawn);
      expect(playlog.chart.notes.map((note) => note.channel)).toEqual(lanes);
      expectReproducible(playlog, resolved.chart);
    });

    test(`beatoraja scene: records the draws ${drawn.join(', ')} of the chart it played`, async () => {
      // The decide screen / `prepareBeatorajaGameplayChart` resolve once; the host passes the draws as
      // `engineOptions.randomDraws` and the view composes the rest of the engine options.
      const resolved = resolvePlayChart(SOURCE, { random: sequence(...values) });
      const playlog = await recordPlaylog(
        resolved.chart,
        composeBeatorajaEngineOptions({
          chartPath: CHART_PATH,
          variant: '9',
          sourceChart: SOURCE,
          engineOptions: { randomDraws: resolved.randomDraws, recordPlaylog: { gauge: 'GROOVE' } },
        }),
      );
      expect(playlog.play.randomDraws?.map((draw) => draw.value)).toEqual(drawn);
      expect(playlog.chart.notes.map((note) => note.channel)).toEqual(lanes);
      expectReproducible(playlog, resolved.chart);
    });
  }

  test('a replay resolved with the recorded draws plays the recorded chart', async () => {
    const recorded = resolvePlayChart(SOURCE, { random: sequence(0.9, 0.9) });
    const playlog = await recordPlaylog(recorded.chart, {
      laneModeExtension: '.pms',
      randomDraws: recorded.randomDraws,
      recordPlaylog: { sourceChart: SOURCE },
    });
    // The core scene resolves a replay with the log's draws, whatever the random source would draw.
    const replayed = resolvePlayChart(SOURCE, { randomDraws: playlog.play.randomDraws, random: () => 0 });
    expect(replayed.chart).toEqual(recorded.chart);
    expect(replayed.randomDraws).toEqual(recorded.randomDraws);
  });

  test('a chart without control flow records no draws', async () => {
    const chart = parseChart(['#BPM 120', '#00111:01'].join('\n'), 'bms');
    const resolved = resolvePlayChart(chart);
    expect(resolved.randomDraws).toEqual(drawRandomOutcomes(chart, () => 0));
    const playlog = await recordPlaylog(
      resolved.chart,
      composeBeatorajaEngineOptions({
        chartPath: CHART_PATH,
        sourceChart: chart,
        engineOptions: { randomDraws: resolved.randomDraws },
      }),
    );
    expect(playlog.play.randomDraws).toBeUndefined();
    expect(playlog.chart.chartFingerprint).toBe(playlog.chart.playFingerprint);
  });
});
