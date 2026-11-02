import { expect, test, vi } from 'vite-plus/test';
import { parseChart } from '@be-music/chart-parser';
import { createReplayRecorder, parseReplay, serializeReplay } from '@be-music/player-engine/replay';
import { createEmptyScore } from '@be-music/player-engine/ruleset';
import type { LibraryChart } from '@be-music/player-scene-model';
import { PlaySession } from './play-session.ts';
import { prepareChart } from './play-chart.ts';

const entry: LibraryChart = {
  id: 'scatter',
  sourceId: 'scatter',
  sourceLabel: 'SCATTER',
  sourceKind: 'directory',
  chartPath: 'scatter.pms',
  directoryLabel: '',
  fileLabel: 'scatter.pms',
  title: 'SCATTER',
  totalNotes: 3,
  chart: parseChart('#BPM 120\n#LNOBJ AA\n#00111:01\n#00212:02\n#00312:AA\n#004D3:0A\n#00234:03\n#00522:04', 'bms'),
};
function prepare(options: ConstructorParameters<typeof PlaySession>[0]) {
  const play = new PlaySession(options);
  play.chart = entry;
  prepareChart(play, entry);
  return play;
}

test.each(['SCATTER', 'SCATTER-CORRECTED'] as const)(
  '%s retains exact PMS arrangement, source identity and LN endpoints through serialized replay',
  (mode) => {
    // Every lane random is seeded (#933): these seeds send the first note to LR2 beta3's tenth destination ('26') and
    // to the corrected nine-key one ('25').
    const randomSeed1P = mode === 'SCATTER' ? '9' : '4';
    const random = vi.spyOn(Math, 'random');
    try {
      const source = structuredClone(entry.chart);
      const original = prepare({ judgeRuleset: 'lr2', random1P: mode, randomSeed1P });
      expect(original.notes[0]!.channel).toBe(mode === 'SCATTER' ? '26' : '25');
      expect(original.preparedChart!.laneBindings).toHaveLength(9);
      expect(original.preparedChart!.laneBindings.some((binding) => binding.channel === '26')).toBe(false);
      expect(original.laneChannels).toHaveLength(9);
      expect(original.laneChannels).not.toContain('26');
      expect(original.notes).toHaveLength(3);
      expect(original.notes[1]!.endSeconds).toBeGreaterThan(original.notes[1]!.seconds);
      const replay = parseReplay(
        serializeReplay(
          createReplayRecorder({
            json: entry.chart,
            chart: original.preparedChart!,
            play: {
              mode: 'manual',
              autoScratch: false,
              judgeRuleset: 'lr2',
              randomLane: { p1: mode, p2: 'OFF' },
              options: { random1P: mode },
            },
          }).finalize({ summary: { ...createEmptyScore(original.notes.length), fast: 0, slow: 0 } }),
        ),
      );
      expect(replay.play.options?.random1P).toBe(mode);
      expect(replay.chart.notes.some((note) => note.sourceChannel === '11')).toBe(true);
      const population = (play: PlaySession) => ({
        notes: play.notes.map((note) => [note.channel, note.seconds, note.endSeconds, note.event.value]),
        mines: play.mineNotes.map((note) => [note.channel, note.seconds, note.event.value]),
        hidden: play.invisibleNotes.map((note) => [note.channel, note.seconds, note.event.value]),
      });
      random.mockReturnValue(0);
      expect(original.randomSeeds).toEqual({ p1: randomSeed1P });
      const restored = prepare({ judgeRuleset: 'lr2', replay });
      expect(population(restored)).toEqual(population(original));
      expect(restored.laneChannels).toEqual(original.laneChannels);
      expect(
        population(prepare({ judgeRuleset: 'lr2', random1P: mode, dpFlip: true })).notes.map((note) => note[0]),
      ).not.toContain('21');
      expect(entry.chart).toEqual(source);
    } finally {
      random.mockRestore();
    }
  },
);
