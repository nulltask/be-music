import { computeChartFingerprint, computePlayFingerprint, drawRandomOutcomes } from '@be-music/chart';
import { createEmptyJson } from '@be-music/json';
import { parseChart, resolveBmsControlFlowWithDraws } from '@be-music/parser';
import { autoPlay, resolvePlayChart, type PlayerOptions } from '@be-music/player/core/engine';
import type { BeMusicPlaylog, PlaylogViewState } from '@be-music/player/playlog';
import { describe, expect, test } from 'vite-plus/test';
import { resolvePlaylogRecording } from './play-engine.ts';

// Ported from the removed beatoraja gameplay scene's `engine-options.test.ts`: the play session now composes the
// play-log fields for every family, the beatoraja play included.

const VIEW: PlaylogViewState = { hiSpeed: 2, hiSpeedScale: 'beatoraja', hsFix: 'OFF', visibleMs: 1000 };

describe('resolvePlaylogRecording', () => {
  test('records the DP-flip intent and the chart path next to the host fields', () => {
    const chart = createEmptyJson('bms');
    expect(
      resolvePlaylogRecording(
        { gauge: 'HARD', chartSha256: 'abc', dpFlip: true },
        { chart, chartPath: 'song/chart.bms' },
        VIEW,
      ),
    ).toEqual({
      gauge: 'HARD',
      chartSha256: 'abc',
      sourceChart: chart,
      dpFlip: true,
      view: VIEW,
      native: { chartPath: 'song/chart.bms' },
    });
  });

  test("passes the song's chart through as the fingerprints' source", () => {
    const chart = createEmptyJson('bms');
    expect(resolvePlaylogRecording({}, { chart, chartPath: 'chart.bms' }, VIEW).sourceChart).toBe(chart);
    expect(resolvePlaylogRecording({}, undefined, VIEW)).toEqual({ gauge: undefined, view: VIEW });
  });

  test('records the lane options a play runs with, the beatoraja play included', () => {
    const recording = resolvePlaylogRecording({ random1P: 'OFF', random2P: 'OFF' }, undefined, VIEW);
    expect(recording.randomLane).toEqual({ p1: 'OFF', p2: 'OFF' });
    expect(resolvePlaylogRecording({ random1P: 'MIRROR' }, undefined, VIEW).randomLane).toEqual({ p1: 'MIRROR' });
    expect(resolvePlaylogRecording({ random1P: 'S-RANDOM', random2P: 'SCATTER' }, undefined, VIEW).randomLane).toEqual({
      p1: 'S-RANDOM',
      p2: 'SCATTER',
    });
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
    test(`play session: records the draws ${drawn.join(', ')} of the chart it played`, async () => {
      // `prepareSong` resolves once; `launchSharedEngine` hands the engine that chart, its draws and the song's
      // chart as the fingerprint source.
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

    test(`beatoraja play: records the draws ${drawn.join(', ')} of the chart it played`, async () => {
      // The decide screen resolves once and the play takes its draws (`preResolved`); the session composes the
      // play-log fields of a beatoraja play as of any other, with its kit's lane options off.
      const resolved = resolvePlayChart(SOURCE, { random: sequence(...values) });
      const playlog = await recordPlaylog(resolved.chart, {
        laneModeExtension: '.pms',
        playVariant: '9',
        randomDraws: resolved.randomDraws,
        recordPlaylog: resolvePlaylogRecording(
          { gauge: 'GROOVE', random1P: 'OFF', random2P: 'OFF' },
          { chart: SOURCE, chartPath: CHART_PATH },
          VIEW,
        ),
      });
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
    // The session resolves a replay with the log's draws, whatever the random source would draw.
    const replayed = resolvePlayChart(SOURCE, { randomDraws: playlog.play.randomDraws, random: () => 0 });
    expect(replayed.chart).toEqual(recorded.chart);
    expect(replayed.randomDraws).toEqual(recorded.randomDraws);
  });

  test('a chart without control flow records no draws', async () => {
    const chart = parseChart(['#BPM 120', '#00111:01'].join('\n'), 'bms');
    const resolved = resolvePlayChart(chart);
    expect(resolved.randomDraws).toEqual(drawRandomOutcomes(chart, () => 0));
    const playlog = await recordPlaylog(resolved.chart, {
      laneModeExtension: '.pms',
      randomDraws: resolved.randomDraws,
      recordPlaylog: resolvePlaylogRecording({}, { chart, chartPath: CHART_PATH }, VIEW),
    });
    expect(playlog.play.randomDraws).toBeUndefined();
    expect(playlog.chart.chartFingerprint).toBe(playlog.chart.playFingerprint);
  });
});
