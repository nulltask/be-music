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
  // Removing mines changes the chart only, so LR2 rules take it too (#774); LR2 still decides when a mine goes off.
  const lr2 = prepare({ judgeRuleset: 'lr2', mineModifier: 'REMOVE' }, entry);
  expect(lr2.mineNotes).toEqual([]);
  expect(lr2.preparedChart!.mineModifierChangeCount).toBe(1);
});

test.each(['ADD_RANDOM', 'ADD_NEAR', 'ADD_BLANK'] as const)(
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
        // The same mines, in time and lane order: mines at one instant on different lanes come back in lane order.
        const population = (play: typeof original) =>
          play.mineNotes
            .map((mine) => ({
              channel: mine.channel,
              timeUs: Math.round(mine.seconds * 1e6),
              damage: mine.event.bmson?.damage,
              silent: mine.silent,
            }))
            .sort((a, b) => a.timeUs - b.timeUs || a.channel.localeCompare(b.channel));
        expect(population(restored)).toEqual(population(original));
        expect(restored.preparedChart!.mineModifierChangeCount).toBe(original.preparedChart!.mineModifierChangeCount);
      }
    } finally {
      random.mockRestore();
    }
  },
);

test('fresh reuse preserves simultaneous keysounds and mine damage after source-lane recording', () => {
  const entry = {
    ...chart,
    chartPath: 'identity.bms',
    chart: parseChart('#BPM 120\n#00011:01\n#00012:02\n#001D1:01\n#001D2:0A', 'bms'),
  };
  const original = prepare({ judgeRuleset: 'beatoraja', random1P: 'MIRROR' }, entry);
  const replay = parseReplay(
    serializeReplay(
      createReplayRecorder({
        json: entry.chart,
        chart: original.preparedChart!,
        play: { mode: 'manual', autoScratch: false, judgeRuleset: 'beatoraja' },
      }).finalize({ summary: { ...createEmptyScore(original.notes.length), fast: 0, slow: 0 } }),
    ),
  );
  expect(replay.chart.notes.some((note) => note.sourceChannel !== undefined)).toBe(true);
  const fresh = prepare({ judgeRuleset: 'beatoraja', fixedArrangement: replay }, entry);
  expect(fresh.notes.map((note) => [note.channel, note.event.value])).toEqual(
    original.notes.map((note) => [note.channel, note.event.value]),
  );
  expect(fresh.mineNotes.map((mine) => [mine.channel, mine.event.value])).toEqual(
    original.mineNotes.map((mine) => [mine.channel, mine.event.value]),
  );
});

test('added-mine replay restores original mine lanes before source-aware arrangement matching', () => {
  const entry = {
    ...chart,
    chartPath: 'generated-identity.bms',
    chart: parseChart('#BPM 120\n#00013:01\n#00111:01', 'bms'),
  };
  const original = prepare({ judgeRuleset: 'beatoraja', mineModifier: 'ADD_NEAR', random1P: 'MIRROR' }, entry);
  const replay = parseReplay(
    serializeReplay(
      createReplayRecorder({
        json: entry.chart,
        chart: original.preparedChart!,
        play: { mode: 'manual', autoScratch: false, judgeRuleset: 'beatoraja', mineModifier: 'ADD_NEAR' },
      }).finalize({ summary: { ...createEmptyScore(original.notes.length), fast: 0, slow: 0 } }),
    ),
  );
  const fresh = prepare({ judgeRuleset: 'beatoraja', fixedArrangement: replay }, entry);
  const mineIdentity = (play: typeof original) =>
    play.mineNotes.map((mine) => `${mine.event.channel}:${mine.channel}:${mine.beat}`).sort();
  expect(mineIdentity(fresh)).toEqual(mineIdentity(original));
});

test.each(['ADD_LN', 'ADD_CN', 'ADD_HCN', 'ADD_ALL'] as const)(
  '%s replay and previous layout restore original heads/endpoints before shuffled matching',
  (longNoteModifier) => {
    const entry = {
      ...chart,
      chartPath: 'generated-ln.bms',
      chart: parseChart('#BPM 120\n#00011:01\n#00012:02\n#00001:0001\n#00111:01', 'bms'),
    };
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const original = prepare(
        { judgeRuleset: 'beatoraja', longNoteModifier, longNoteRate: 0.5, random1P: 'MIRROR' },
        entry,
      );
      const replay = parseReplay(
        serializeReplay(
          createReplayRecorder({
            json: entry.chart,
            chart: original.preparedChart!,
            play: {
              mode: 'manual',
              autoScratch: false,
              judgeRuleset: 'beatoraja',
              longNoteModifier,
              longNoteRate: 0.5,
            },
          }).finalize({ summary: { ...createEmptyScore(original.notes.length), fast: 0, slow: 0 } }),
        ),
      );
      expect(replay.chart.notes.filter((note) => note.generatedLongNote)).toHaveLength(2);
      random.mockReturnValue(0.99);
      for (const options of [{ replay }, { fixedArrangement: replay, autoPlay: false }]) {
        const restored = prepare({ judgeRuleset: 'beatoraja', ...options }, entry);
        expect(restored.notes.map((note) => [note.channel, note.endBeat, note.event.value, note.longNoteMode])).toEqual(
          original.notes.map((note) => [note.channel, note.endBeat, note.event.value, note.longNoteMode]),
        );
        expect(restored.preparedChart!.longNoteModifierChangeCount).toBe(2);
      }
      expect(() => prepare({ judgeRuleset: 'lr2', longNoteModifier }, entry)).toThrow(/only for beatoraja/);
    } finally {
      random.mockRestore();
    }
  },
);

test('mixed LN/CN/HCN types stay attached to their original keysounds through a shuffled replay', () => {
  const entry = {
    ...chart,
    chartPath: 'mixed-ln.bms',
    chart: parseChart('#BPM 120\n#00011:01\n#00012:02\n#00013:03\n#00101:01', 'bms'),
  };
  const draws = [0, 0, 0, 1 / 3, 0, 2 / 3];
  const random = vi.spyOn(Math, 'random').mockImplementation(() => draws.shift() ?? 0.5);
  try {
    const original = prepare(
      { judgeRuleset: 'beatoraja', longNoteModifier: 'ADD_ALL', longNoteRate: 1, random1P: 'MIRROR' },
      entry,
    );
    expect(original.notes.map((note) => note.longNoteMode)).toEqual([1, 2, 3]);
    const replay = parseReplay(
      serializeReplay(
        createReplayRecorder({
          json: entry.chart,
          chart: original.preparedChart!,
          play: {
            mode: 'manual',
            autoScratch: false,
            judgeRuleset: 'beatoraja',
            longNoteModifier: 'ADD_ALL',
            longNoteRate: 1,
            longNoteModifierChangeCount: 3,
          },
        }).finalize({ summary: { ...createEmptyScore(original.notes.length), fast: 0, slow: 0 } }),
      ),
    );
    random.mockReturnValue(0.99);
    const restored = prepare({ judgeRuleset: 'beatoraja', replay }, entry);
    expect(restored.notes.map((note) => [note.event.value, note.channel, note.longNoteMode, note.endBeat])).toEqual(
      original.notes.map((note) => [note.event.value, note.channel, note.longNoteMode, note.endBeat]),
    );
  } finally {
    random.mockRestore();
  }
});

test('EXTRA replays and previous layouts retain converted keysounds and source placement after MIRROR', () => {
  const entry = {
    ...chart,
    chartPath: 'extra.bme',
    chart: parseChart('#BPM 240\n#00101:01\n#00101:01\n#00201:02\n#00212:03', 'bms'),
  };
  const original = prepare(
    { judgeRuleset: 'beatoraja', extraNoteDepth: 2, extraNoteScratch: true, random1P: 'MIRROR' },
    entry,
  );
  const replay = parseReplay(
    serializeReplay(
      createReplayRecorder({
        json: entry.chart,
        chart: original.preparedChart!,
        play: {
          mode: 'manual',
          autoScratch: false,
          judgeRuleset: 'beatoraja',
          extraNoteDepth: 2,
          extraNoteScratch: true,
          extraNoteChangeCount: 3,
        },
      }).finalize({ summary: { ...createEmptyScore(original.notes.length), fast: 0, slow: 0 } }),
    ),
  );
  for (const options of [{ replay }, { fixedArrangement: replay, autoPlay: false }]) {
    const restored = prepare(
      { judgeRuleset: 'beatoraja', extraNoteDepth: 100, extraNoteScratch: false, ...options },
      entry,
    );
    expect(restored.notes.map((note) => [note.channel, note.event.value, note.seconds])).toEqual(
      original.notes.map((note) => [note.channel, note.event.value, note.seconds]),
    );
    expect(restored.preparedChart).toMatchObject({
      extraNoteDepth: 2,
      extraNoteScratch: true,
      extraNoteChangeCount: 3,
    });
    expect(
      restored.preparedChart!.resolvedChart.sampleTriggers.map((trigger) => [trigger.channel, trigger.sampleKey]),
    ).toEqual(
      original.preparedChart!.resolvedChart.sampleTriggers.map((trigger) => [trigger.channel, trigger.sampleKey]),
    );
  }
  const lr2 = prepare({ judgeRuleset: 'lr2', extraNoteDepth: 1 }, entry);
  expect(lr2.preparedChart).toMatchObject({ extraNoteDepth: 1 });
  expect(lr2.preparedChart!.extraNoteChangeCount).toBeGreaterThan(0);
});

test('LR2 EXTRA replay reconstructs the recorded source tempo before restoring shuffled channels', () => {
  const cells = Array<string>(32).fill('00');
  cells[9] = '01';
  const entry = {
    ...chart,
    chartPath: 'lr2-extra.bme',
    chart: parseChart(`#BPM 300\n#00011:01\n#00001:${cells.join('')}\n#00111:01`, 'bms'),
  };
  const original = prepare(
    { judgeRuleset: 'lr2', lr2ExtraMode: true, lr2ExtraLevel: 0, tempo: 2, random1P: 'MIRROR' },
    entry,
  );
  expect(original.preparedChart).toMatchObject({
    lr2ExtraMode: true,
    lr2ExtraTempo: 2,
    lr2ExtraConvertedObjectCount: 1,
  });
  const replay = parseReplay(
    serializeReplay(
      createReplayRecorder({
        json: entry.chart,
        chart: original.preparedChart!,
        play: {
          mode: 'manual',
          autoScratch: false,
          judgeRuleset: 'lr2',
          lr2ExtraMode: true,
          lr2ExtraLevel: 0,
          lr2ExtraTempo: 2,
          tempo: 2,
        },
      }).finalize({ summary: { ...createEmptyScore(original.notes.length), fast: 0, slow: 0 } }),
    ),
  );
  const restored = prepare({ judgeRuleset: 'lr2', replay, lr2ExtraMode: false, lr2ExtraLevel: 2, tempo: 0.5 }, entry);
  expect(restored.preparedChart).toMatchObject({ lr2ExtraMode: true, lr2ExtraLevel: 0, lr2ExtraTempo: 2 });
  expect(restored.notes.map((note) => [note.channel, note.seconds, note.event.value])).toEqual(
    original.notes.map((note) => [note.channel, note.seconds, note.event.value]),
  );
  expect(prepare({ judgeRuleset: 'beatoraja', lr2ExtraMode: true }, entry).preparedChart).toMatchObject({
    lr2ExtraMode: true,
  });
});

test('SP TO DP replay restores source variant and source assists before DP FLIP and both-side MIRROR matching', () => {
  const entry = {
    ...chart,
    chartPath: 'sp-to-dp.bme',
    chart: parseChart(`#BPM 240\n#00116:01\n#00111:01\n#00113:${'00'.repeat(1)}01${'00'.repeat(8)}\n#00418:01`, 'bms'),
  };
  const original = prepare(
    {
      judgeRuleset: 'lr2',
      battleMode: 'SP-TO-DP',
      autoPlay: true,
      autoScratch2P: true,
      tempo: 1,
      dpFlip: true,
      random1P: 'MIRROR',
      random2P: 'MIRROR',
    },
    entry,
  );
  expect(original.chartPlayVariant).toBe('14');
  expect(original.notes.map((note) => note.channel)).toEqual(expect.arrayContaining(['29', '15', '16']));
  const replay = parseReplay(
    serializeReplay(
      createReplayRecorder({
        json: entry.chart,
        chart: original.preparedChart!,
        play: {
          mode: 'auto',
          autoScratch: false,
          autoScratch1P: false,
          autoScratch2P: false,
          judgeRuleset: 'lr2',
          battleMode: 'SP-TO-DP',
          battleSourceVariant: '7',
          battleTempo: 1,
          battleAssist1P: false,
          battleAssist2P: true,
        },
      }).finalize({ summary: { ...createEmptyScore(original.notes.length), fast: 0, slow: 0 } }),
    ),
  );
  const restored = prepare({ judgeRuleset: 'lr2', replay, battleMode: 'OFF', autoScratch2P: false, tempo: 0.5 }, entry);
  expect(restored.chartPlayVariant).toBe('14');
  expect(restored.preparedChart).toMatchObject({ battleSourceVariant: '7', battleAssist2P: true, battleTempo: 1 });
  expect(restored.notes.map((note) => [note.channel, note.event.value, note.seconds, note.endSeconds])).toEqual(
    original.notes.map((note) => [note.channel, note.event.value, note.seconds, note.endSeconds]),
  );
});

test('7-to-9 runs after SP RANDOM and restores canonical conversion while current settings differ', () => {
  const entry = {
    ...chart,
    chart: parseChart('#BPM 240\n#WAV01 a.wav\n#LNOBJ ZZ\n#00111:01\n#00116:0001\n#00218:01\n#00318:ZZ', 'bms'),
  };
  const original = prepare(
    {
      judgeRuleset: 'beatoraja',
      sevenToNinePattern: 3,
      sevenToNineType: 2,
      hRandomThresholdBPM: 180,
      random1P: 'MIRROR',
    },
    entry,
  );
  // MIRROR maps key 1 to key 7 before the conversion's key offset (+2).
  expect(original.notes[0]!.channel).toBe('19');
  expect(original.notes[1]!.channel).toBe('12');
  expect(original.chartPlayVariant).toBe('9');
  expect(original.laneChannels).toHaveLength(9);
  const recorded = createReplayRecorder({
    json: entry.chart,
    chart: original.preparedChart!,
    play: {
      mode: 'manual',
      autoScratch: false,
      judgeRuleset: 'beatoraja',
      sevenToNinePattern: 3,
      sevenToNineType: 2,
      sevenToNineThresholdBPM: 180,
      sevenToNineApplied: true,
    },
  }).finalize({ summary: { ...createEmptyScore(original.notes.length), fast: 0, slow: 0 } });
  const replay = parseReplay(serializeReplay(recorded));
  const restored = prepare(
    {
      judgeRuleset: 'beatoraja',
      sevenToNinePattern: 0,
      sevenToNineType: 0,
      hRandomThresholdBPM: 60,
      random1P: 'OFF',
      replay,
    },
    entry,
  );
  expect(
    restored.notes.map(({ channel, endSeconds, event }) => ({ channel, endSeconds, source: event.channel })),
  ).toEqual(original.notes.map(({ channel, endSeconds, event }) => ({ channel, endSeconds, source: event.channel })));
  expect(restored.chartPlayVariant).toBe('9');
  expect(restored.preparedChart).toMatchObject({
    sevenToNinePattern: 3,
    sevenToNineType: 2,
    sevenToNineThresholdBPM: 180,
    sevenToNineApplied: true,
  });
  const fresh = prepare({ judgeRuleset: 'beatoraja', fixedArrangement: replay }, entry);
  expect(fresh.notes.map((note) => note.channel)).toEqual(original.notes.map((note) => note.channel));
});

test('scroll REMOVE keeps generated mines on their notes timelines for time-based arrangements', () => {
  // BPM changes make scroll REMOVE recompute the generated mines' seconds, a float step away from the notes'.
  const lines = ['#BPM 150', '#PLAYER 1', '#WAV01 a.wav', '#00203:00C8', '#00403:0096'];
  const patterns = ['01000100', '00010001', '01010000', '00000101', '01000001', '00100010'];
  for (let measure = 0; measure < 8; measure++)
    ['11', '12', '13', '14', '15', '16', '18', '19'].forEach((channel, index) =>
      lines.push(`#${String(measure).padStart(3, '0')}${channel}:${patterns[(measure + index) % patterns.length]}`),
    );
  const entry: LibraryChart = { ...chart, id: 'remove', chart: parseChart(lines.join('\n'), 'bms') };
  for (const random1P of ['S-RANDOM', 'H-RANDOM', 'S-RANDOM-EX'] as const) {
    const play = prepare(
      { judgeRuleset: 'beatoraja', random1P, randomSeed1P: '42', mineModifier: 'ADD_BLANK', scrollModifier: 'REMOVE' },
      entry,
    );
    const occupied = new Set(play.notes.map((note) => `${note.channel}@${Math.round(note.seconds * 1e6)}`));
    expect(play.mineNotes.length).toBeGreaterThan(0);
    expect(play.mineNotes.filter((mine) => occupied.has(`${mine.channel}@${Math.round(mine.seconds * 1e6)}`))).toEqual(
      [],
    );
  }
});

/** An SP 7KEY chart with a note on every key and the scratch, twice. */
const sp7: LibraryChart = {
  ...chart,
  id: 'sp7',
  chart: parseChart(
    [
      '#BPM 120',
      '#PLAYER 1',
      ...['11', '12', '13', '14', '15', '16', '18', '19'].map((lane) => `#000${lane}:0101`),
    ].join('\n'),
    'bms',
  ),
};

test.each(['lr2', 'beatoraja', '____'] as const)(
  'source-specific lane options arrange the chart under %s rules (#774)',
  (judgeRuleset) => {
    for (const random1P of [
      'R-RANDOM',
      'SPIRAL',
      'H-RANDOM',
      'ALL-SCR',
      'RANDOM-EX',
      'S-RANDOM-EX',
      'SCATTER',
    ] as const) {
      const play = prepare({ judgeRuleset, random1P }, sp7);
      const lanes = play.notes.map((note) => note.channel);
      expect(lanes).toHaveLength(16);
      // Only the 1P keys and scratch are rearranged; nothing lands outside the 7KEY layout.
      expect(
        lanes.every((lane) => play.laneChannels.includes(lane)),
        `${random1P} under ${judgeRuleset}`,
      ).toBe(true);
    }
  },
);

test('a chart copied onto both sides takes the battle arrangements and two-player M-RAN under any ruleset (#774)', () => {
  const synchronized = prepare(
    { judgeRuleset: 'beatoraja', battleMode: 'BATTLE', random1P: 'SYNCHRONIZE-RANDOM' },
    sp7,
  );
  const keys = (side: '1' | '2') =>
    synchronized.notes
      .filter((note) => note.channel.startsWith(side) && note.channel !== `${side}6`)
      .map((note) => note.channel.slice(1));
  expect(keys('2')).toEqual(keys('1'));
  const dBattle = prepare({ judgeRuleset: '____', battleMode: 'D-BATTLE', random1P: 'SYMMETRY-RANDOM' }, sp7);
  expect(dBattle.preparedChart!.battleMode).toBe('D-BATTLE');
  const mRan = prepare(
    { judgeRuleset: 'lr2', battleMode: 'TWO-PLAYER', random1P: 'RANDOM', random2P: 'RANDOM', mRan2P: true },
    sp7,
  );
  const sides = (side: '1' | '2') =>
    mRan.notes
      .filter((note) => note.channel.startsWith(side) && !note.channel.endsWith('6'))
      .map((note) => note.channel.slice(1));
  // Both players share 1P's arrangement, and M-RAN mirrors the second player's side.
  const mirror: Record<string, string> = { '1': '9', '2': '8', '3': '5', '4': '4', '5': '3', '8': '2', '9': '1' };
  expect(sides('2')).toEqual(sides('1').map((lane) => mirror[lane]));
});

test('a previous arrangement is reused only under the judge rules it was played with', () => {
  const original = prepare({ judgeRuleset: 'lr2', random1P: 'SPIRAL' }, sp7);
  const replay = createReplayRecorder({
    json: sp7.chart,
    chart: original.preparedChart!,
    play: { mode: 'manual', autoScratch: false, judgeRuleset: 'lr2' },
  }).finalize({ summary: { ...createEmptyScore(original.notes.length), fast: 0, slow: 0 } });
  const fresh = prepare({ judgeRuleset: 'lr2', fixedArrangement: replay }, sp7);
  expect(fresh.notes.map((note) => note.channel)).toEqual(original.notes.map((note) => note.channel));
  expect(() => prepare({ judgeRuleset: 'beatoraja', fixedArrangement: replay }, sp7)).toThrow(/other judgment rules/);
});

test('conditional HDX LONGMODE wins user defaults with and without a pre-resolved branch', () => {
  const entry = {
    ...chart,
    chart: parseChart(
      '#BPM 120\n#LNTYPE 1\n#00051:01\n#00151:01\n#RANDOM 2\n#IF 1\n#OPTION charatbeatHDX:LONGMODE 0\n#ELSE\n#OPTION charatbeatHDX:LONGMODE 1\n#ENDIF\n#ENDRANDOM',
      'bms',
    ),
  };
  const random = vi.spyOn(Math, 'random').mockReturnValue(0);
  try {
    for (const preResolved of [undefined, resolvePlayChart(entry.chart, { random: () => 0.99 })]) {
      const play = prepare({ judgeRuleset: 'beatoraja', longNoteMode: 'HCN', preResolved }, entry);
      expect(play.notes[0]?.longNoteMode).toBe(preResolved ? 3 : 2);
    }
    const plain = { ...chart, chart: parseChart('#BPM 120\n#LNTYPE 1\n#00051:01\n#00151:01', 'bms') };
    expect(
      prepare({ judgeRuleset: 'beatoraja', longNoteMode: 'CN', preResolved: resolvePlayChart(plain.chart) }, plain)
        .notes[0]?.longNoteMode,
    ).toBe(2);
  } finally {
    random.mockRestore();
  }
});

test('recorded LN mode retains old replay and previous-arrangement semantics after recognizing HDX', () => {
  const plain = { ...chart, chart: parseChart('#BPM 120\n#LNTYPE 1\n#00051:01\n#00151:01', 'bms') };
  const original = prepare({ judgeRuleset: 'beatoraja' }, plain);
  const replay = parseReplay(
    serializeReplay(
      createReplayRecorder({
        json: plain.chart,
        chart: original.preparedChart!,
        play: { mode: 'manual', autoScratch: false, judgeRuleset: 'beatoraja' },
      }).finalize({ summary: { ...createEmptyScore(1), fast: 0, slow: 0 } }),
    ),
  );
  expect(replay.chart.lnMode).toBe(1);
  const entry = {
    ...plain,
    chart: parseChart('#OPTION charatbeatHDX:LONGMODE 1\n#BPM 120\n#LNTYPE 1\n#00051:01\n#00151:01', 'bms'),
  };
  expect(prepare({ judgeRuleset: 'beatoraja' }, entry).notes[0]?.longNoteMode).toBe(3);
  for (const options of [{ replay }, { fixedArrangement: replay }])
    expect(prepare({ judgeRuleset: 'beatoraja', longNoteMode: 'HCN', ...options }, entry).notes[0]?.longNoteMode).toBe(
      1,
    );
});
