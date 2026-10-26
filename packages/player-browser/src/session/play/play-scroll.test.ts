import { expect, test, vi } from 'vite-plus/test';
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
  // Scroll REMOVE only changes how the chart is drawn, so LR2 rules take it too (#774).
  expect(prepare({ judgeRuleset: 'lr2', scrollModifier: 'REMOVE' }).preparedChart!.scrollModifierChanged).toBe(true);
});

test('scroll ADD restores the exact generated curve and parameters without rerolling for replay or previous layout', () => {
  const random = vi.spyOn(Math, 'random').mockReturnValue(0.25);
  try {
    const original = prepare({ judgeRuleset: 'beatoraja', scrollModifier: 'ADD', scrollSection: 4, scrollRate: 0.5 });
    const timeline = original.preparedChart!.scrollModifierTimeline!;
    expect(timeline).toEqual([
      { beat: 0, speed: 1 },
      { beat: 12, speed: 0.75 },
    ]);
    expect(original.timingResolver!.stopPoints.length).toBeGreaterThan(0);
    expect(original.notes.map((note) => [note.beat, note.seconds, note.endBeat, note.endSeconds])).toEqual([
      [4, 2, undefined, undefined],
      [12, 5, 16, 6],
    ]);
    const replay = parseReplay(
      serializeReplay(
        createReplayRecorder({
          json: entry.chart,
          chart: original.preparedChart!,
          play: {
            mode: 'manual',
            autoScratch: false,
            judgeRuleset: 'beatoraja',
            scrollModifier: 'ADD',
            scrollSection: 4,
            scrollRate: 0.5,
            scrollModifierTimeline: timeline,
            scrollModifierChanged: true,
          },
        }).finalize({ summary: { ...createEmptyScore(original.notes.length), fast: 0, slow: 0 } }),
      ),
    );
    random.mockClear().mockReturnValue(0.99);
    for (const options of [{ replay }, { fixedArrangement: replay }]) {
      const restored = prepare({
        judgeRuleset: 'beatoraja',
        scrollModifier: 'OFF',
        scrollSection: 1,
        scrollRate: 0,
        ...options,
      });
      expect(restored.preparedChart).toMatchObject({
        scrollSection: 4,
        scrollRate: 0.5,
        scrollModifierTimeline: timeline,
      });
      expect(restored.resolvedPlayChart!.scroll).toEqual(timeline);
      expect(restored.notes.map((note) => [note.beat, note.seconds, note.endBeat, note.endSeconds])).toEqual(
        original.notes.map((note) => [note.beat, note.seconds, note.endBeat, note.endSeconds]),
      );
    }
    expect(random).not.toHaveBeenCalled();
    delete replay.play.scrollModifierTimeline;
    expect(() => prepare({ judgeRuleset: 'beatoraja', replay })).toThrow(/effective timeline/);
    expect(prepare({ judgeRuleset: 'lr2', scrollModifier: 'ADD' }).preparedChart!.scrollModifierApplied).toBe('ADD');
  } finally {
    random.mockRestore();
  }
});
