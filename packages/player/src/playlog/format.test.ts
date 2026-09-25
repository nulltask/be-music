import { describe, expect, test } from 'vitest';
import {
  BE_MUSIC_PLAYLOG_FORMAT,
  BE_MUSIC_PLAYLOG_VERSION,
  parsePlaylog,
  PLAYLOG_FILE_SUFFIX,
  PlaylogParseError,
  resolvePlaylogFilename,
  serializePlaylog,
  type BeMusicPlaylog,
} from './format.ts';

function makePlaylog(): BeMusicPlaylog {
  return {
    format: BE_MUSIC_PLAYLOG_FORMAT,
    version: BE_MUSIC_PLAYLOG_VERSION,
    createdAt: '2026-08-17T01:02:03.456Z',
    clock: { unit: 'us', origin: 'chart-zero' },
    chart: {
      title: 'Song / Title: Test',
      subtitle: 'ANOTHER',
      artist: 'composer',
      genre: 'genre',
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
    ],
    play: {
      mode: 'manual',
      autoScratch: true,
      gauge: 'HARD',
      randomLane: { p1: 'MIRROR', p2: 'RANDOM' },
      dpFlip: true,
      judgeWindowOverrideMs: 500,
      aborted: true,
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
      },
    },
  };
}

function corrupt(mutate: (value: any) => void): unknown {
  const value = JSON.parse(serializePlaylog(makePlaylog()));
  mutate(value);
  return value;
}

describe('playlog format', () => {
  test('serializePlaylog → parsePlaylog round-trips every field', () => {
    const playlog = makePlaylog();
    expect(parsePlaylog(serializePlaylog(playlog))).toEqual(playlog);
    // An already-parsed value is accepted too.
    expect(parsePlaylog(JSON.parse(serializePlaylog(playlog)))).toEqual(playlog);
  });

  test('round-trips a minimal playlog without any optional field', () => {
    const minimal: BeMusicPlaylog = {
      format: BE_MUSIC_PLAYLOG_FORMAT,
      version: BE_MUSIC_PLAYLOG_VERSION,
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
    const parsed = parsePlaylog(serializePlaylog(minimal));
    expect(parsed).toEqual(minimal);
    expect(parsed.results).toBeUndefined();
  });

  test('chart.reversalTimeUs survives the round-trip and stays absent when the chart has none', () => {
    // LR2 negative-BPM reversal (#134): the recorder stamps the reversal instant so re-simulations freeze
    // judging at the same point. It must survive serialize → parse untouched.
    const playlog = makePlaylog();
    playlog.chart.reversalTimeUs = 2_000_000;
    const parsed = parsePlaylog(serializePlaylog(playlog));
    expect(parsed.chart.reversalTimeUs).toBe(2_000_000);
    expect(parsed).toEqual(playlog);

    // A chart without a reversal keeps the key ABSENT (deleted), not `undefined`, so `toEqual` comparisons and
    // JSON output stay canonical.
    const withoutReversal = parsePlaylog(serializePlaylog(makePlaylog()));
    expect(withoutReversal.chart).not.toHaveProperty('reversalTimeUs');
  });

  test('rejects invalid JSON and wrong format / version / clock markers', () => {
    expect(() => parsePlaylog('{oops')).toThrow(PlaylogParseError);
    expect(() => parsePlaylog('{oops')).toThrow(/invalid JSON/);
    expect(() =>
      parsePlaylog(
        corrupt((value) => {
          value.format = 'other-format';
        }),
      ),
    ).toThrow(/^format:/);
    expect(() =>
      parsePlaylog(
        corrupt((value) => {
          value.version = 2;
        }),
      ),
    ).toThrow(/^version:/);
    expect(() =>
      parsePlaylog(
        corrupt((value) => {
          value.clock.unit = 'ms';
        }),
      ),
    ).toThrow(/^clock:/);
  });

  test('reports the field path of structural problems', () => {
    expect(() =>
      parsePlaylog(
        corrupt((value) => {
          value.inputs = {};
        }),
      ),
    ).toThrow('inputs: expected an array');
    expect(() =>
      parsePlaylog(
        corrupt((value) => {
          value.inputs[0].action = 'press';
        }),
      ),
    ).toThrow("inputs[0].action: expected 'down' | 'up'");
    expect(() =>
      parsePlaylog(
        corrupt((value) => {
          value.inputs[0].channels = [11];
        }),
      ),
    ).toThrow('inputs[0].channels: expected string[]');
    expect(() =>
      parsePlaylog(
        corrupt((value) => {
          value.chart.notes[1].type = 'weird';
        }),
      ),
    ).toThrow(/chart\.notes\[1\]\.type/);
    expect(() =>
      parsePlaylog(
        corrupt((value) => {
          delete value.chart.notes[0].timeUs;
        }),
      ),
    ).toThrow('chart.notes[0].timeUs: expected a finite number');
    expect(() =>
      parsePlaylog(
        corrupt((value) => {
          delete value.chart.judgeRank.percent;
        }),
      ),
    ).toThrow('chart.judgeRank.percent: expected a finite number');
    expect(() =>
      parsePlaylog(
        corrupt((value) => {
          value.chart.lnMode = 5;
        }),
      ),
    ).toThrow('chart.lnMode: expected 1 | 2 | 3');
    expect(() =>
      parsePlaylog(
        corrupt((value) => {
          value.play.gauge = 'SUPER';
        }),
      ),
    ).toThrow(/play\.gauge/);
    expect(() =>
      parsePlaylog(
        corrupt((value) => {
          delete value.results.native.judge.pgreat;
        }),
      ),
    ).toThrow('results.native.judge.pgreat: expected a finite number');
  });

  test('ignores unknown fields for forward compatibility', () => {
    const parsed = parsePlaylog(
      corrupt((value) => {
        value.futureRootField = true;
        value.chart.futureChartField = 'x';
        value.chart.notes[0].futureNoteField = 1;
        value.inputs[0].futureInputField = 1;
        value.play.futurePlayField = 1;
        value.results.native.futureResultField = 1;
      }),
    );
    expect(parsed).toEqual(makePlaylog());
    expect(parsed).not.toHaveProperty('futureRootField');
    expect(parsed.chart.notes[0]).not.toHaveProperty('futureNoteField');
  });

  test('resolvePlaylogFilename sanitizes the title and stamps createdAt', () => {
    const playlog = makePlaylog();
    expect(resolvePlaylogFilename(playlog)).toBe('Song Title Test-2026-08-17T01-02-03-456Z.bmplay.json');
    // An explicit `when` wins over the playlog's own createdAt.
    expect(resolvePlaylogFilename(playlog, new Date('2027-02-03T04:05:06.007Z'))).toBe(
      'Song Title Test-2027-02-03T04-05-06-007Z.bmplay.json',
    );
  });

  test("resolvePlaylogFilename falls back to 'play' / 'unknown-time'", () => {
    const playlog = makePlaylog();
    delete playlog.chart.title;
    delete playlog.createdAt;
    expect(resolvePlaylogFilename(playlog)).toBe(`play-unknown-time${PLAYLOG_FILE_SUFFIX}`);

    // A title made entirely of filesystem-hostile characters sanitizes to nothing → 'play'.
    const hostile = makePlaylog();
    hostile.chart.title = '<>:"/\\|?*';
    expect(resolvePlaylogFilename(hostile)).toBe('play-2026-08-17T01-02-03-456Z.bmplay.json');

    // A createdAt that does not parse as a date is reported as unknown-time.
    const badDate = makePlaylog();
    badDate.createdAt = 'not-a-date';
    expect(resolvePlaylogFilename(badDate)).toBe(`Song Title Test-unknown-time${PLAYLOG_FILE_SUFFIX}`);
    expect(resolvePlaylogFilename(badDate).endsWith('.bmplay.json')).toBe(true);
  });
});
