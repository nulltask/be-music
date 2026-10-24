import { describe, expect, test } from 'vite-plus/test';
import {
  BE_MUSIC_REPLAY_FORMAT,
  BE_MUSIC_REPLAY_VERSION,
  parseReplay,
  REPLAY_FILE_SUFFIX,
  ReplayParseError,
  resolveReplayFilename,
  serializeReplay,
  type BeMusicReplay,
} from './format.ts';

function makeReplay(): BeMusicReplay {
  return {
    format: BE_MUSIC_REPLAY_FORMAT,
    version: BE_MUSIC_REPLAY_VERSION,
    createdAt: '2026-08-17T01:02:03.456Z',
    recorder: { name: 'be-music-web', version: '0.5.0', build: '6471cd16', engine: '0.8.0', platform: 'web' },
    clock: { unit: 'us', origin: 'chart-zero' },
    chart: {
      title: 'Song / Title: Test',
      subtitle: 'ANOTHER',
      artist: 'composer',
      genre: 'genre',
      playLevel: '12',
      difficulty: 3,
      sha256: 'a'.repeat(64),
      md5: 'c'.repeat(32),
      chartFingerprint: `bmfp0:${'a'.repeat(64)}`,
      playFingerprint: `bmfp0:${'b'.repeat(64)}`,
      sourceFormat: 'bms',
      laneMode: '7keys',
      total: 300,
      lnMode: 2,
      judgeRank: {
        percent: 75,
        sourceRank: 2,
        sourceExRank: 100,
        timeline: [{ timeUs: 4_000_000, exRankValue: 48 }],
      },
      noteCount: 3,
      notes: [
        { id: 0, channel: '11', type: 'normal', timeUs: 500_000 },
        { id: 1, channel: '12', type: 'long', timeUs: 1_000_000, endTimeUs: 2_000_000, lnMode: 2 },
        { id: 2, channel: '13', type: 'mine', timeUs: 1_500_000, damage: 10 },
        { id: 3, channel: '14', type: 'invisible', timeUs: 1_600_000 },
        { id: 4, channel: '17', type: 'freezone', timeUs: 1_700_000, endTimeUs: 1_900_000 },
      ],
    },
    inputs: [
      { seq: 0, timeUs: 499_000, action: 'down', channels: ['11'], tokens: ['z'] },
      { seq: 1, timeUs: 520_000, action: 'up', channels: ['11', '12'] },
      { seq: 2, timeUs: 640_000, action: 'up', channels: ['13'], tokens: ['x'], inferred: true },
    ],
    play: {
      mode: 'manual',
      autoScratch: true,
      gauge: 'HARD',
      randomLane: { p1: 'MIRROR', p2: 'RANDOM' },
      dpFlip: true,
      judgeWindowOverrideMs: 500,
      randomDraws: [
        { command: 'RANDOM', range: 3, value: 2 },
        { command: 'SETRANDOM', range: 1, value: 4 },
        { command: 'SWITCH', range: 2, value: 1 },
      ],
      aborted: true,
      abortedAtUs: 1_234_567,
      endOnFailure: true,
      course: { kind: 'grade', gaugeSet: 'lr2', judge: 'no-good', carryIn: { gauge: 62.4, combo: 31, maxCombo: 120 } },
      native: { hiSpeed: 2.5, skin: 'default', assist: false, memo: null },
    },
    results: {
      native: {
        ruleset: 'be-music/native',
        judge: { pgreat: 1, great: 1, good: 0, bad: 0, poor: 1, emptyPoor: 2 },
        fast: 1,
        slow: 0,
        exScore: 3,
        noteCount: 3,
        maxCombo: 2,
        score: 100000,
        djLevel: 'AA',
        gauge: { type: 'HARD', final: 0, cleared: false, failedMidPlay: true },
        course: { combo: 0, maxCombo: 120 },
      },
    },
  };
}

function corrupt(mutate: (value: any) => void): unknown {
  const value = JSON.parse(serializeReplay(makeReplay()));
  mutate(value);
  return value;
}

describe('replay format', () => {
  test('preserves mine POOR counts and rejects negative or fractional counts', () => {
    const replay = makeReplay();
    replay.results!.native!.minePoor = 1;
    expect(parseReplay(serializeReplay(replay))).toEqual(replay);
    for (const value of [-1, 0.5, '1']) {
      expect(() =>
        parseReplay(
          corrupt((log) => {
            log.results.native.minePoor = value;
          }),
        ),
      ).toThrow(/minePoor: expected a non-negative integer/);
    }
  });

  test.each([true, false])('preserves fullCombo=%s and rejects non-boolean values', (fullCombo) => {
    const replay = makeReplay();
    replay.results!.native!.fullCombo = fullCombo;
    expect(parseReplay(serializeReplay(replay)).results!.native!.fullCombo).toBe(fullCombo);
    expect(() =>
      parseReplay(
        corrupt((value) => {
          value.results.native.fullCombo = 0;
        }),
      ),
    ).toThrow(/fullCombo: expected a boolean/);
    expect(parseReplay(serializeReplay(makeReplay())).results!.native).not.toHaveProperty('fullCombo');
  });

  test('serializeReplay → parseReplay round-trips every field', () => {
    const replay = makeReplay();
    expect(parseReplay(serializeReplay(replay))).toEqual(replay);
    // An already-parsed value is accepted too.
    expect(parseReplay(JSON.parse(serializeReplay(replay)))).toEqual(replay);
  });

  test('round-trips a minimal replay without any optional field', () => {
    const minimal: BeMusicReplay = {
      format: BE_MUSIC_REPLAY_FORMAT,
      version: BE_MUSIC_REPLAY_VERSION,
      clock: { unit: 'us', origin: 'chart-zero' },
      chart: {
        sourceFormat: 'bmson',
        laneMode: '7keys',
        lnMode: 1,
        judgeRank: { percent: 75 },
        noteCount: 0,
        notes: [],
      },
      inputs: [],
      play: { mode: 'auto', autoScratch: false, gauge: 'GROOVE' },
    };
    const parsed = parseReplay(serializeReplay(minimal));
    expect(parsed).toEqual(minimal);
    expect(parsed.results).toBeUndefined();
    expect(parsed.chart).not.toHaveProperty('sha256');
    expect(parsed.chart).not.toHaveProperty('md5');
    expect(parsed.chart).not.toHaveProperty('chartFingerprint');
    expect(parsed.chart).not.toHaveProperty('playFingerprint');
  });

  test('rejects #RANDOM draws that no control-flow line could have made', () => {
    for (const randomDraws of [
      3,
      [2],
      [{ command: 'IF', range: 2, value: 1 }],
      [{ command: 'RANDOM', range: 0, value: 1 }],
      [{ command: 'RANDOM', range: 2, value: 3 }],
      [{ command: 'RANDOM', range: 2, value: 1.5 }],
      [{ command: 'SETRANDOM', range: 2, value: 1 }],
      [{ command: 'SWITCH', range: 2, value: '1' }],
    ]) {
      const log = makeReplay() as unknown as { play: Record<string, unknown> };
      log.play.randomDraws = randomDraws;
      expect(() => parseReplay(JSON.stringify(log))).toThrow(/play\.randomDraws/);
    }
  });

  test('chart.reversalTimeUs survives the round-trip and stays absent when the chart has none', () => {
    // LR2 negative-BPM reversal (#134): the recorder stamps the reversal instant so re-simulations freeze
    // judging at the same point. It must survive serialize → parse untouched.
    const replay = makeReplay();
    replay.chart.reversalTimeUs = 2_000_000;
    const parsed = parseReplay(serializeReplay(replay));
    expect(parsed.chart.reversalTimeUs).toBe(2_000_000);
    expect(parsed).toEqual(replay);

    // A chart without a reversal keeps the key ABSENT (deleted), not `undefined`, so `toEqual` comparisons and
    // JSON output stay canonical.
    const withoutReversal = parseReplay(serializeReplay(makeReplay()));
    expect(withoutReversal.chart).not.toHaveProperty('reversalTimeUs');
  });

  test('play.tempo survives the round-trip, a tempo of 1 is dropped and a non-positive one is refused', () => {
    const replay = makeReplay();
    replay.play.tempo = 0.75;
    const parsed = parseReplay(serializeReplay(replay));
    expect(parsed.play.tempo).toBe(0.75);
    expect(parsed).toEqual(replay);
    // Logs without the field (every log before it existed) played at tempo 1.
    expect(parseReplay(serializeReplay(makeReplay())).play).not.toHaveProperty('tempo');
    const unit = makeReplay() as unknown as { play: Record<string, unknown> };
    unit.play.tempo = 1;
    expect(parseReplay(JSON.stringify(unit)).play).not.toHaveProperty('tempo');
    for (const tempo of [0, -0.5, 'fast']) {
      const log = makeReplay() as unknown as { play: Record<string, unknown> };
      log.play.tempo = tempo;
      expect(() => parseReplay(JSON.stringify(log))).toThrow(/play\.tempo/);
    }
  });

  test('writes the unstable revision 0 and still reads logs stamped 1, as revision 0', () => {
    expect(BE_MUSIC_REPLAY_VERSION).toBe(0);
    const legacy = parseReplay(
      corrupt((value) => {
        value.version = 1;
      }),
    );
    expect(legacy.version).toBe(0);
    expect(legacy).toEqual(parseReplay(serializeReplay(makeReplay())));
  });

  test('rejects invalid JSON and wrong format / version / clock markers', () => {
    expect(() => parseReplay('{oops')).toThrow(ReplayParseError);
    expect(() => parseReplay('{oops')).toThrow(/invalid JSON/);
    expect(() =>
      parseReplay(
        corrupt((value) => {
          value.format = 'other-format';
        }),
      ),
    ).toThrow(/^format:/);
    expect(() =>
      parseReplay(
        corrupt((value) => {
          value.version = 2;
        }),
      ),
    ).toThrow(/^version:/);
    expect(() =>
      parseReplay(
        corrupt((value) => {
          value.clock.unit = 'ms';
        }),
      ),
    ).toThrow(/^clock:/);
  });

  test('reads a course stage without a carry-in and rejects malformed course fields', () => {
    const first = parseReplay(
      corrupt((value) => {
        value.play.course = { kind: 'expert' };
      }),
    );
    expect(first.play.course).toEqual({ kind: 'expert' });
    for (const [mutate, message] of [
      [(value: any) => (value.play.course.kind = 'dan'), "play.course.kind: expected 'grade' | 'expert' | 'nonstop'"],
      [(value: any) => (value.play.course.gaugeSet = '8k'), 'play.course.gaugeSet'],
      [(value: any) => (value.play.course.judge = 'no-bad'), 'play.course.judge'],
      [
        (value: any) => (value.play.course.carryIn.combo = -1),
        'play.course.carryIn.combo: expected a non-negative integer',
      ],
      [(value: any) => (value.play.course.carryIn.gauge = 'full'), 'play.course.carryIn.gauge'],
    ] as const) {
      expect(() => parseReplay(corrupt(mutate))).toThrow(message);
    }
  });

  test('reports the field path of structural problems', () => {
    expect(() =>
      parseReplay(
        corrupt((value) => {
          value.inputs = {};
        }),
      ),
    ).toThrow('inputs: expected an array');
    expect(() =>
      parseReplay(
        corrupt((value) => {
          value.inputs[0].inferred = true;
        }),
      ),
    ).toThrow("inputs[0].inferred: expected true on an 'up'");
    expect(() =>
      parseReplay(
        corrupt((value) => {
          value.inputs[0].action = 'press';
        }),
      ),
    ).toThrow("inputs[0].action: expected 'down' | 'up'");
    expect(() =>
      parseReplay(
        corrupt((value) => {
          value.inputs[0].channels = [11];
        }),
      ),
    ).toThrow('inputs[0].channels: expected string[]');
    expect(() =>
      parseReplay(
        corrupt((value) => {
          value.chart.notes[1].type = 'weird';
        }),
      ),
    ).toThrow(/chart\.notes\[1\]\.type/);
    expect(() =>
      parseReplay(
        corrupt((value) => {
          delete value.chart.notes[0].timeUs;
        }),
      ),
    ).toThrow('chart.notes[0].timeUs: expected a finite number');
    expect(() =>
      parseReplay(
        corrupt((value) => {
          delete value.chart.judgeRank.percent;
        }),
      ),
    ).toThrow('chart.judgeRank.percent: expected a finite number');
    expect(() =>
      parseReplay(
        corrupt((value) => {
          value.chart.lnMode = 5;
        }),
      ),
    ).toThrow('chart.lnMode: expected 1 | 2 | 3');
    expect(() =>
      parseReplay(
        corrupt((value) => {
          value.chart.chartFingerprint = 42;
        }),
      ),
    ).toThrow('chart.chartFingerprint: expected a string');
    expect(() =>
      parseReplay(
        corrupt((value) => {
          value.chart.playFingerprint = 42;
        }),
      ),
    ).toThrow('chart.playFingerprint: expected a string');
    expect(() =>
      parseReplay(
        corrupt((value) => {
          value.play.gauge = 'SUPER';
        }),
      ),
    ).toThrow(/play\.gauge/);
    expect(() =>
      parseReplay(
        corrupt((value) => {
          delete value.results.native.judge.pgreat;
        }),
      ),
    ).toThrow('results.native.judge.pgreat: expected a finite number');
    expect(() =>
      parseReplay(
        corrupt((value) => {
          value.recorder = 'be-music-web';
        }),
      ),
    ).toThrow('recorder: expected an object');
    expect(() =>
      parseReplay(
        corrupt((value) => {
          value.recorder.version = 5;
        }),
      ),
    ).toThrow('recorder.version: expected a string');
  });

  test('keeps only the recorder fields that are present', () => {
    const parsed = parseReplay(
      corrupt((value) => {
        value.recorder = { engine: '0.8.0' };
      }),
    );
    expect(parsed.recorder).toEqual({ engine: '0.8.0' });
  });

  test('ignores unknown fields for forward compatibility', () => {
    const parsed = parseReplay(
      corrupt((value) => {
        value.futureRootField = true;
        value.chart.futureChartField = 'x';
        value.chart.notes[0].futureNoteField = 1;
        value.inputs[0].futureInputField = 1;
        value.play.futurePlayField = 1;
        value.results.native.futureResultField = 1;
        value.recorder.futureRecorderField = 'x';
      }),
    );
    expect(parsed).toEqual(makeReplay());
    expect(parsed).not.toHaveProperty('futureRootField');
    expect(parsed.chart.notes[0]).not.toHaveProperty('futureNoteField');
  });

  test('resolveReplayFilename sanitizes the title and stamps createdAt', () => {
    const replay = makeReplay();
    expect(resolveReplayFilename(replay)).toBe('Song Title Test-2026-08-17T01-02-03-456Z.bmplay.json');
    // An explicit `when` wins over the replay's own createdAt.
    expect(resolveReplayFilename(replay, new Date('2027-02-03T04:05:06.007Z'))).toBe(
      'Song Title Test-2027-02-03T04-05-06-007Z.bmplay.json',
    );
  });

  test("resolveReplayFilename falls back to 'play' / 'unknown-time'", () => {
    const replay = makeReplay();
    delete replay.chart.title;
    delete replay.createdAt;
    expect(resolveReplayFilename(replay)).toBe(`play-unknown-time${REPLAY_FILE_SUFFIX}`);

    // A title made entirely of filesystem-hostile characters sanitizes to nothing → 'play'.
    const hostile = makeReplay();
    hostile.chart.title = '<>:"/\\|?*';
    expect(resolveReplayFilename(hostile)).toBe('play-2026-08-17T01-02-03-456Z.bmplay.json');

    // A createdAt that does not parse as a date is reported as unknown-time.
    const badDate = makeReplay();
    badDate.createdAt = 'not-a-date';
    expect(resolveReplayFilename(badDate)).toBe(`Song Title Test-unknown-time${REPLAY_FILE_SUFFIX}`);
    expect(resolveReplayFilename(badDate).endsWith('.bmplay.json')).toBe(true);
  });
});

test('replay round-trip preserves mixed NONSTOP rank units and absolute TOTAL', () => {
  const replay = makeReplay();
  replay.chart.sourceFormat = 'bmson';
  replay.chart.totalUnit = 'absolute';
  replay.chart.judgeRank.stageRanks = [
    { timeUs: 0, rank: 125, table: 'bmson' },
    { timeUs: 1e6, rank: 150, table: 'bms-exrank' },
  ];
  const parsed = parseReplay(serializeReplay(replay));
  expect(parsed.chart.totalUnit).toBe('absolute');
  expect(parsed.chart.judgeRank.stageRanks).toEqual(replay.chart.judgeRank.stageRanks);
  expect(() => parseReplay({ ...replay, chart: { ...replay.chart, totalUnit: 'bad' } })).toThrow(/totalUnit/);
  expect(() =>
    parseReplay({
      ...replay,
      chart: {
        ...replay.chart,
        judgeRank: { ...replay.chart.judgeRank, stageRanks: [{ timeUs: 0, rank: 125, table: 'bad' }] },
      },
    }),
  ).toThrow(/stageRanks/);
});

test('preserves independent AUTO SCRATCH sides and rejects non-boolean switches', () => {
  const replay = makeReplay();
  replay.play.autoScratch1P = false;
  replay.play.autoScratch2P = true;
  expect(parseReplay(serializeReplay(replay)).play).toMatchObject({
    autoScratch: true,
    autoScratch1P: false,
    autoScratch2P: true,
  });
  for (const key of ['autoScratch1P', 'autoScratch2P']) {
    const invalid = JSON.parse(serializeReplay(replay));
    invalid.play[key] = 1;
    expect(() => parseReplay(invalid)).toThrow(ReplayParseError);
  }
});

test('round-trips source long-note modifiers and rejects unknown variants', () => {
  for (const longNoteModifier of ['OFF', 'LEGACY', 'REMOVE'] as const) {
    const replay = makeReplay();
    replay.play.longNoteModifier = longNoteModifier;
    expect(parseReplay(serializeReplay(replay)).play.longNoteModifier).toBe(longNoteModifier);
  }
  const invalid = JSON.parse(serializeReplay(makeReplay()));
  invalid.play.longNoteModifier = 'CUSTOM';
  expect(() => parseReplay(invalid)).toThrow(ReplayParseError);
});

test('records EX-HARD independently of DEATH', () => {
  for (const gauge of ['EX-HARD', 'DEATH'] as const) {
    const replay = makeReplay();
    replay.play.gauge = gauge;
    expect(parseReplay(serializeReplay(replay)).play.gauge).toBe(gauge);
  }
});

test('round-trips the ASSIST EASY gauge without an AUTO SCRATCH flag', () => {
  const replay = makeReplay();
  replay.play.gauge = 'ASSIST-EASY';
  replay.play.autoScratch = false;
  expect(parseReplay(serializeReplay(replay)).play).toMatchObject({ gauge: 'ASSIST-EASY', autoScratch: false });
});

test('round-trips confirmed beatoraja algorithms and rejects the internal Score variant', () => {
  for (const judgeAlgorithm of ['combo', 'duration', 'lowest'] as const) {
    const replay = makeReplay();
    replay.play.judgeAlgorithm = judgeAlgorithm;
    expect(parseReplay(serializeReplay(replay)).play.judgeAlgorithm).toBe(judgeAlgorithm);
  }
  const invalid = JSON.parse(serializeReplay(makeReplay()));
  invalid.play.judgeAlgorithm = 'score';
  expect(() => parseReplay(invalid)).toThrow(ReplayParseError);
});

test('round-trips resolved BPM extrema and rejects invalid ranges', () => {
  const replay = makeReplay();
  replay.chart.bpmRange = { min: 120, max: 240 };
  replay.chart.headerBPM = 150;
  expect(parseReplay(serializeReplay(replay)).chart.bpmRange).toEqual({ min: 120, max: 240 });
  expect(parseReplay(serializeReplay(replay)).chart.headerBPM).toBe(150);
  for (const bpmRange of [{ min: 240, max: 120 }, { min: null, max: 240 }, { max: 240 }]) {
    const invalid = JSON.parse(serializeReplay(replay));
    invalid.chart.bpmRange = bpmRange;
    expect(() => parseReplay(invalid)).toThrow(ReplayParseError);
  }
});

test('mine modifiers and actual change counts round-trip with strict validation', () => {
  const replay = makeReplay();
  replay.play.mineModifier = 'REMOVE';
  replay.play.mineModifierChangeCount = 0;
  expect(parseReplay(serializeReplay(replay)).play).toMatchObject({
    mineModifier: 'REMOVE',
    mineModifierChangeCount: 0,
  });
  expect(() => parseReplay(JSON.stringify({ ...replay, play: { ...replay.play, mineModifier: 'HIDE' } }))).toThrow(
    ReplayParseError,
  );
  for (const mineModifierChangeCount of [-1, 0.5, '1'])
    expect(() => parseReplay(JSON.stringify({ ...replay, play: { ...replay.play, mineModifierChangeCount } }))).toThrow(
      ReplayParseError,
    );
});

test.each(['ADD_RANDOM', 'ADD_NEAR', 'ADD_BLANK'] as const)(
  '%s and silent mine flags round-trip with type validation',
  (mode) => {
    const replay = makeReplay();
    replay.play.mineModifier = mode;
    replay.chart.notes.push({ id: 999, channel: '16', type: 'mine', timeUs: 0, damage: 10, silent: true });
    const parsed = parseReplay(serializeReplay(replay));
    expect(parsed.play.mineModifier).toBe(mode);
    expect(parsed.chart.notes.at(-1)?.silent).toBe(true);
    replay.chart.notes.at(-1)!.type = 'normal';
    expect(() => parseReplay(serializeReplay(replay))).toThrow(ReplayParseError);
  },
);

test.each(['NONE', 'CONTINUE'] as const)(
  'gauge policy %s round-trips and rejects unknown policies',
  (gaugeAutoShift) => {
    const replay = makeReplay();
    replay.play.gaugeAutoShift = gaugeAutoShift;
    expect(parseReplay(serializeReplay(replay)).play.gaugeAutoShift).toBe(gaugeAutoShift);
    expect(() =>
      parseReplay(JSON.stringify({ ...replay, play: { ...replay.play, gaugeAutoShift: 'REVIVE' } })),
    ).toThrow(ReplayParseError);
  },
);

test('replay original lanes round-trip and reject malformed source identifiers', () => {
  const replay = makeReplay();
  replay.chart.notes[0]!.sourceChannel = '11';
  expect(parseReplay(serializeReplay(replay)).chart.notes[0]!.sourceChannel).toBe('11');
  for (const sourceChannel of ['D1', '1a', '111', 11, null])
    expect(() =>
      parseReplay(
        JSON.stringify({ ...replay, chart: { ...replay.chart, notes: [{ ...replay.chart.notes[0], sourceChannel }] } }),
      ),
    ).toThrow(ReplayParseError);
});

test.each([
  ['ADD_LN', 1],
  ['ADD_CN', 2],
  ['ADD_HCN', 3],
] as const)('%s endpoints and effective modifier rate/count survive serialization', (longNoteModifier, lnMode) => {
  const replay = makeReplay();
  replay.play.longNoteModifier = longNoteModifier;
  replay.play.longNoteRate = 0.375;
  replay.play.longNoteModifierChangeCount = 1;
  replay.chart.notes = [
    {
      id: 0,
      channel: '15',
      sourceChannel: '11',
      timeUs: 1_000_000,
      type: 'long',
      endTimeUs: 1_500_000,
      lnMode,
      generatedLongNote: true,
    },
  ];
  const parsed = parseReplay(serializeReplay(replay));
  expect(parsed.chart.notes).toEqual(replay.chart.notes);
  expect(parsed.play).toMatchObject({
    longNoteModifier,
    longNoteRate: 0.375,
    longNoteModifierChangeCount: 1,
  });
  for (const longNoteRate of [-0.1, 1.1, '1'])
    expect(() => parseReplay(JSON.stringify({ ...replay, play: { ...replay.play, longNoteRate } }))).toThrow(
      ReplayParseError,
    );
  for (const bad of [{ type: 'normal' }, { endTimeUs: 1_000_000 }, { lnMode: undefined }, { generatedLongNote: false }])
    expect(() =>
      parseReplay(
        JSON.stringify({ ...replay, chart: { ...replay.chart, notes: [{ ...replay.chart.notes[0], ...bad }] } }),
      ),
    ).toThrow(ReplayParseError);
});
