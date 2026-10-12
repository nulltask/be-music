import { computePlayFingerprint } from '@be-music/chart';
import { parseChart, resolveBmsControlFlow } from '@be-music/parser';
import { autoPlay, resolveBmsControlFlowForPlayback, type PlayerOptions } from '@be-music/player/core/engine';
import type { BeMusicPlaylog } from '@be-music/player/playlog';
import { describe, expect, test } from 'vite-plus/test';
import { resolvePlayChart } from '../chart/play-chart.ts';
import { composeBeatorajaEngineOptions } from '../scene/beatoraja/engine-options.ts';
import { toEngineChart } from './engine-chart.ts';

// Branch 1 puts a note on lane 11 and loads `one.wav`; branch 2 puts one on lane 12 and loads `two.wav`.
const RANDOM_CHART = [
  '#BPM 120',
  '#RANDOM 2',
  '#IF 1',
  '#WAV01 one.wav',
  '#00111:01',
  '#ENDIF',
  '#IF 2',
  '#WAV02 two.wav',
  '#00112:02',
  '#ENDIF',
  '#ENDRANDOM',
].join('\n');

function laneEvents(chart: ReturnType<typeof parseChart>): string[] {
  return chart.events
    .filter((event) => event.channel === '11' || event.channel === '12')
    .map((event) => `${event.channel}:${event.value}`);
}

describe('toEngineChart', () => {
  // The host (decide screen, gameplay prep, skin graphs, BGA timeline) resolves the chart with branch 1.
  const hostResolved = resolveBmsControlFlow(parseChart(RANDOM_CHART, 'bms'), { random: () => 0 });

  test('a host-resolved chart still carries its control flow, so the engine would resolve it a second time', () => {
    expect(laneEvents(hostResolved)).toEqual(['11:01']);
    // The engine re-rolls (here: branch 2) and adds that branch on top of the one already resolved.
    const reResolved = resolveBmsControlFlowForPlayback(hostResolved, () => 0.9);
    expect(reResolved.randomPatterns).toEqual([{ index: 1, current: 2, total: 2 }]);
    expect(laneEvents(reResolved.resolvedJson)).toEqual(['11:01', '12:02']);
    expect(reResolved.resolvedJson.resources.wav).toEqual({ '01': 'one.wav', '02': 'two.wav' });
    // Re-rolling the same branch duplicates its notes instead.
    expect(laneEvents(resolveBmsControlFlowForPlayback(hostResolved, () => 0).resolvedJson)).toEqual([
      '11:01',
      '11:01',
    ]);
  });

  test('the engine plays exactly the branch the host resolved', () => {
    const engineChart = toEngineChart(hostResolved);
    expect(engineChart.bms.controlFlow).toEqual([]);
    for (const roll of [0, 0.9]) {
      const playback = resolveBmsControlFlowForPlayback(engineChart, () => roll);
      expect(playback.randomPatterns).toEqual([]);
      expect(laneEvents(playback.resolvedJson)).toEqual(['11:01']);
      expect(playback.resolvedJson.resources.wav).toEqual({ '01': 'one.wav' });
      expect(playback.resolvedJson.events).toEqual(hostResolved.events);
    }
  });

  test('leaves the host chart untouched and returns a chart without control flow as is', () => {
    const before = hostResolved.bms.controlFlow.length;
    toEngineChart(hostResolved);
    expect(hostResolved.bms.controlFlow).toHaveLength(before);
    const plain = parseChart(['#BPM 120', '#00111:01'].join('\n'), 'bms');
    expect(toEngineChart(plain)).toBe(plain);
  });

  test('the play log records only the host-resolved branch', async () => {
    const recordNotes = async (chart: typeof hostResolved): Promise<string[]> => {
      let playlog: BeMusicPlaylog | undefined;
      await autoPlay(chart, {
        speed: 64,
        leadInMs: 0,
        audio: false,
        tui: false,
        laneModeExtension: '.bme',
        onPlaylogRecorded: (recorded) => {
          playlog = recorded;
        },
      });
      return playlog!.chart.notes.map((note) => note.channel);
    };
    expect(await recordNotes(toEngineChart(hostResolved))).toEqual(['11']);
  });
});

describe('play-log random outcomes on the web paths', () => {
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
  const CHART_PATH = 'song/chart.bme';

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
    // A verifier with the chart file rebuilds the played chart from the recorded outcomes ...
    const rebuilt = resolveBmsControlFlow(SOURCE, { outcomes: playlog.play.randomOutcomes });
    expect(rebuilt).toEqual(played);
    // ... and recomputes the play fingerprint the log carries.
    expect(playlog.chart.fingerprint).toBe(computePlayFingerprint(played, { chartPath: CHART_PATH }));
    expect(computePlayFingerprint(rebuilt, { chartPath: CHART_PATH })).toBe(playlog.chart.fingerprint);
  }

  for (const [draws, expected, lanes] of [
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
    test(`core scene: records the outcomes ${expected.join(', ')} of the chart it played`, async () => {
      // `CoreGameplayView.prepareSong` resolves once; `launchSharedEngine` hands the engine that chart and records
      // the drawn values next to its other play-log fields.
      const resolved = resolvePlayChart(SOURCE, { random: sequence(...draws) });
      expect(resolved.randomOutcomes).toEqual(expected);
      const playlog = await recordPlaylog(toEngineChart(resolved.chart), {
        laneModeExtension: '.bme',
        recordPlaylog: {
          ...(resolved.randomOutcomes.length > 0 ? { randomOutcomes: [...resolved.randomOutcomes] } : {}),
          native: { chartPath: CHART_PATH },
        },
      });
      expect(playlog.play.randomOutcomes).toEqual(expected);
      expect(playlog.chart.notes.map((note) => note.channel)).toEqual(lanes);
      expectReproducible(playlog, resolved.chart);
    });

    test(`beatoraja scene: records the outcomes ${expected.join(', ')} of the chart it played`, async () => {
      // The decide screen / `prepareBeatorajaGameplayChart` resolve once; the gameplay view gets the chart and its
      // `randomOutcomes` and composes the engine options from them.
      const resolved = resolvePlayChart(SOURCE, { random: sequence(...draws) });
      const playlog = await recordPlaylog(
        toEngineChart(resolved.chart),
        composeBeatorajaEngineOptions({
          chartPath: CHART_PATH,
          variant: '7',
          randomOutcomes: resolved.randomOutcomes,
          engineOptions: { recordPlaylog: { gauge: 'GROOVE' } },
        }),
      );
      expect(playlog.play.randomOutcomes).toEqual(expected);
      expect(playlog.chart.notes.map((note) => note.channel)).toEqual(lanes);
      expectReproducible(playlog, resolved.chart);
    });
  }

  test('a replay resolved with the recorded outcomes plays the recorded chart', async () => {
    const recorded = resolvePlayChart(SOURCE, { random: sequence(0.9, 0.9) });
    const playlog = await recordPlaylog(toEngineChart(recorded.chart), {
      laneModeExtension: '.bme',
      recordPlaylog: { randomOutcomes: recorded.randomOutcomes },
    });
    // The core scene resolves a replay with the log's values, whatever the random source would draw.
    const replayed = resolvePlayChart(SOURCE, { outcomes: playlog.play.randomOutcomes, random: () => 0 });
    expect(replayed.chart).toEqual(recorded.chart);
    expect(replayed.randomOutcomes).toEqual(recorded.randomOutcomes);
  });

  test('a chart without control flow records no outcomes', async () => {
    const resolved = resolvePlayChart(parseChart(['#BPM 120', '#00111:01'].join('\n'), 'bms'));
    const playlog = await recordPlaylog(
      toEngineChart(resolved.chart),
      composeBeatorajaEngineOptions({ chartPath: CHART_PATH, randomOutcomes: resolved.randomOutcomes }),
    );
    expect(playlog.play.randomOutcomes).toBeUndefined();
  });
});
