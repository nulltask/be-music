import { expect, test } from 'vite-plus/test';
import { parseChart } from '@be-music/chart-parser';
import { createReplayRecorder, parseReplay, serializeReplay } from '@be-music/player-engine/replay';
import { createEmptyScore } from '@be-music/player-engine/ruleset';
import type { LibraryChart } from '@be-music/player-scene-model';
import { PlaySession } from './play-session.ts';
import { prepareChart } from './play-chart.ts';

const entry: LibraryChart = {
  id: 'scroll',
  sourceId: 'scroll',
  sourceLabel: 'Scroll',
  sourceKind: 'directory',
  chartPath: 'scroll.bms',
  directoryLabel: '',
  fileLabel: 'scroll.bms',
  title: 'Scroll',
  totalNotes: 2,
  chart: parseChart(
    '#BPM 120\n#BPM01 240\n#STOP01 192\n#SCROLL01 -1\n#LNOBJ AA\n#00111:01\n#00108:01\n#00209:01\n#002SC:01\n#00312:01\n#00412:AA',
    'bms',
  ),
};
function prepare(options: ConstructorParameters<typeof PlaySession>[0]) {
  const play = new PlaySession(options);
  play.chart = entry;
  prepareChart(play, entry);
  return play;
}

test('scroll REMOVE shares the flattened coordinate map across notes, bar lines, BPM readout and replay', () => {
  const original = prepare({ judgeRuleset: 'beatoraja', scrollModifier: 'REMOVE' });
  expect(original.notes.map((note) => [note.beat, note.seconds, note.endBeat, note.endSeconds])).toEqual([
    [4, 2, undefined, undefined],
    [10, 5, 12, 6],
  ]);
  expect(original.timingResolver!.stopPoints).toEqual([]);
  expect(original.beatAtSeconds!(3.5)).toBe(7);
  expect(original.chartBPMRange).toEqual({ minBPM: 120, maxBPM: 120, mainBPM: 120 });
  expect(original.preparedChart!.resolvedChart).toBe(original.resolvedPlayChart);
  const replay = parseReplay(
    serializeReplay(
      createReplayRecorder({
        json: entry.chart,
        chart: original.preparedChart!,
        play: {
          mode: 'manual',
          autoScratch: false,
          judgeRuleset: 'beatoraja',
          scrollModifier: 'REMOVE',
          scrollModifierChanged: true,
        },
      }).finalize({ summary: { ...createEmptyScore(original.notes.length), fast: 0, slow: 0 } }),
    ),
  );
  for (const options of [{ replay }, { fixedArrangement: replay }]) {
    const restored = prepare({ judgeRuleset: 'beatoraja', scrollModifier: 'OFF', ...options });
    expect(restored.notes.map((note) => [note.beat, note.seconds, note.endBeat, note.endSeconds])).toEqual(
      original.notes.map((note) => [note.beat, note.seconds, note.endBeat, note.endSeconds]),
    );
    expect(restored.beatAtSeconds!(3.5)).toBe(7);
    expect(restored.chartBPMRange).toEqual(original.chartBPMRange);
    expect(restored.preparedChart!.scrollModifierChanged).toBe(true);
  }
  expect(() => prepare({ judgeRuleset: 'lr2', scrollModifier: 'REMOVE' })).toThrow(/only for beatoraja/);
});
