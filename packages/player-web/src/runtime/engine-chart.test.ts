import { parseChart, resolveBmsControlFlow } from '@be-music/parser';
import { autoPlay, resolveBmsControlFlowForPlayback } from '@be-music/player/core/engine';
import type { BeMusicPlaylog } from '@be-music/player/playlog';
import { describe, expect, test } from 'vite-plus/test';
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
