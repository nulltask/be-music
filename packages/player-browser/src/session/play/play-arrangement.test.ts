import { expect, test, vi } from 'vite-plus/test';
import { parseChart } from '@be-music/chart-parser';
import { resolvePlayChart } from '@be-music/player-engine';
import { createReplayRecorder, parseReplay, serializeReplay } from '@be-music/player-engine/replay';
import { createEmptyScore } from '@be-music/player-engine/ruleset';
import { DEFAULT_PLAY_OPTIONS, type LibraryChart } from '@be-music/player-scene-model';
import { PlaySession } from './play-session.ts';
import { prepareChart } from './play-chart.ts';
import { PlaySceneSession } from './play-scene-session.ts';

const chart: LibraryChart = {
  id: 'seed',
  sourceId: 'seed',
  sourceLabel: 'Seed',
  sourceKind: 'directory',
  chartPath: 'seed.bme',
  directoryLabel: '',
  fileLabel: 'seed.bme',
  title: 'Seed',
  totalNotes: 8,
  chart: parseChart(
    '#BPM 120\n#PLAYER 3\n#LNOBJ AA\n#00011:01\n#00012:01\n#00013:01\n#00014:01\n#00015:01\n#00018:01\n#00019:01\n#00021:0001\n#00121:00AA',
    'bms',
  ),
};
function prepare(options: ConstructorParameters<typeof PlaySession>[0], entry: LibraryChart = chart) {
  const play = new PlaySession(options);
  play.chart = entry;
  prepareChart(play, entry);
  return play;
}

test('manual source seeds reproduce each side independently, including LN channels', () => {
  const options = {
    judgeRuleset: 'beatoraja',
    random1P: 'RANDOM',
    random2P: 'R-RANDOM',
    randomSeed1P: '0',
    randomSeed2P: '9223372036854775807',
  } as const;
  const first = prepare(options),
    second = prepare(options);
  expect(second.notes.map((note) => note.channel)).toEqual(first.notes.map((note) => note.channel));
  expect(first.randomSeeds).toEqual({ p1: '0', p2: '9223372036854775807' });
  expect(first.notes.some((note) => note.endSeconds !== undefined)).toBe(true);
  const changed = prepare({ ...options, randomSeed2P: '1234' });
  expect(changed.notes.filter((note) => note.channel.startsWith('1')).map((note) => note.channel)).toEqual(
    first.notes.filter((note) => note.channel.startsWith('1')).map((note) => note.channel),
  );
});

test('previous arrangement reproduces exact channels while retaining fresh live input and replay recording', () => {
  const original = prepare({
    judgeRuleset: 'beatoraja',
    random1P: 'RANDOM',
    random2P: 'S-RANDOM',
    randomSeed1P: '42',
    randomSeed2P: '7',
  });
  const replay = createReplayRecorder({
    json: chart.chart,
    chart: original.preparedChart!,
    play: {
      mode: 'manual',
      autoScratch: false,
      judgeRuleset: 'beatoraja',
      options: { randomSeed1P: '42', randomSeed2P: '7' },
    },
  }).finalize({ summary: { ...createEmptyScore(original.notes.length), fast: 0, slow: 0 } });
  const fresh = prepare({ judgeRuleset: 'beatoraja', fixedArrangement: replay, autoPlay: false });
  expect(fresh.notes.map(({ channel, endSeconds }) => ({ channel, endSeconds }))).toEqual(
    original.notes.map(({ channel, endSeconds }) => ({ channel, endSeconds })),
  );
  expect(fresh.options.replay).toBeUndefined();
  expect(fresh.options.autoPlay).toBe(false);
  expect(fresh.randomSeeds).toEqual({ p1: '42', p2: '7' });
  const scene = new PlaySceneSession(fresh, { chart, playOptions: DEFAULT_PLAY_OPTIONS });
  expect(scene.frame(0).replay).toBe(false);
  expect(() =>
    prepare({ judgeRuleset: 'beatoraja', fixedArrangement: replay, chartSHA256: 'different' }),
  ).not.toThrow();
  replay.chart.sha256 = 'source';
  expect(() => prepare({ judgeRuleset: 'beatoraja', fixedArrangement: replay, chartSHA256: 'different' })).toThrow(
    /different source chart/,
  );
});

test('previous arrangement keeps recorded BMS branch draws instead of a newly prepared branch', () => {
  const branching = {
    ...chart,
    chart: parseChart(
      '#BPM 120\n#WAV01 a.wav\n#WAV02 b.wav\n#RANDOM 2\n#IF 1\n#00018:01\n#ELSE\n#00019:02\n#ENDIF\n#ENDRANDOM',
      'bms',
    ),
  };
  const first = prepare(
    {
      judgeRuleset: 'beatoraja',
      random1P: 'RANDOM',
      randomSeed1P: '0',
      preResolved: resolvePlayChart(branching.chart, { random: () => 0 }),
    },
    branching,
  );
  const replay = createReplayRecorder({
    json: branching.chart,
    chart: first.preparedChart!,
    play: {
      mode: 'manual',
      autoScratch: false,
      judgeRuleset: 'beatoraja',
      randomDraws: first.randomDraws,
    },
  }).finalize({ summary: { ...createEmptyScore(first.notes.length), fast: 0, slow: 0 } });
  const fresh = prepare(
    {
      judgeRuleset: 'beatoraja',
      fixedArrangement: replay,
      preResolved: resolvePlayChart(branching.chart, { random: () => 0.99 }),
    },
    branching,
  );
  expect(fresh.randomDraws).toEqual(first.randomDraws);
  expect(fresh.resolvedChart).toEqual(first.resolvedChart);
  expect(fresh.notes.map((note) => note.channel)).toEqual(first.notes.map((note) => note.channel));
});

test('mine REMOVE removes the same mines from the browser judgment and view bundle', () => {
  const entry = { ...chart, chart: parseChart('#BPM 120\n#00011:01\n#000D1:01', 'bms') };
  const play = prepare({ judgeRuleset: 'beatoraja', mineModifier: 'REMOVE' }, entry);
  expect(play.mineNotes).toBe(play.preparedChart!.landmineNotes);
  expect(play.mineNotes).toEqual([]);
  expect(play.preparedChart!.mineModifierChangeCount).toBe(1);
  expect(() => prepare({ judgeRuleset: 'lr2', mineModifier: 'REMOVE' }, entry)).toThrow(/only for beatoraja/);
});

test.each(['ADD_RANDOM', 'ADD_NEAR'] as const)(
  '%s restores the exact generated mine population without rerolling for replay or fresh input',
  (mineModifier) => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    try {
      const original = prepare({ judgeRuleset: 'beatoraja', mineModifier });
      const replay = parseReplay(
        serializeReplay(
          createReplayRecorder({
            json: chart.chart,
            chart: original.preparedChart!,
            play: {
              mode: 'manual',
              autoScratch: false,
              judgeRuleset: 'beatoraja',
              mineModifier,
              mineModifierChangeCount: original.preparedChart!.mineModifierChangeCount,
            },
          }).finalize({ summary: { ...createEmptyScore(original.notes.length), fast: 0, slow: 0 } }),
        ),
      );
      expect(replay.chart.notes.filter((note) => note.type === 'mine').length).toBeGreaterThan(0);
      expect(
        replay.chart.notes.filter((note) => note.type === 'mine').every((note) => note.silent && note.damage === 10),
      ).toBe(true);
      random.mockReturnValue(0);
      for (const options of [{ replay }, { fixedArrangement: replay, autoPlay: false }]) {
        const restored = prepare({ judgeRuleset: 'beatoraja', ...options });
        const population = (play: typeof original) =>
          play.mineNotes.map((mine) => ({
            channel: mine.channel,
            timeUs: Math.round(mine.seconds * 1e6),
            damage: mine.event.bmson?.damage,
            silent: mine.silent,
          }));
        expect(population(restored)).toEqual(population(original));
        expect(restored.preparedChart!.mineModifierChangeCount).toBe(original.preparedChart!.mineModifierChangeCount);
      }
    } finally {
      random.mockRestore();
    }
  },
);
