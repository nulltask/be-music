import { beforeEach, describe, expect, test, vi } from 'vite-plus/test';

// The engine writes to a mocked Node audio sink (shared state in test-support/player-fixtures.ts).
vi.mock('./audio-sink.ts', async () => (await import('./test-support/player-fixtures.ts')).mockAudioSinkModule());

import { createEmptyJson } from '../../json/src/index.ts';
import { parseChart } from '../../parser/src/index.ts';
import { autoPlay, manualPlay } from './index.ts';
import { preparePlaybackChartData } from './core/bootstrap.ts';
import { parsePlaylog, serializePlaylog, type BeMusicPlaylog } from './playlog/index.ts';
import {
  resetAudioSinkState,
  createLandmineOnlyChart,
  HELD_LANDMINE_INPUT,
  createScheduledInputRuntime,
} from './test-support/player-fixtures.ts';

beforeEach(resetAudioSinkState);

describe('player', () => {
  test("player: LR2's multi-BAD collector takes down every other note the press mistimed", async () => {
    // lr2oraja `MultiBadCollector`: one press at 1.15 s sits 150 ms after the `11` note and 150 ms before the `12`
    // note — inside BAD (±200 ms at `#RANK 2`) but outside GOOD (±100 ms) for both. LR2 BADs both; beatoraja has
    // no collector, so its press consumes one note and the other misses on its own deadline.
    const json = createEmptyJson('bms');
    json.metadata.bpm = 240;
    json.metadata.rank = 2;
    json.events = [
      { measure: 1, channel: '11', position: [0, 1], value: '01' },
      { measure: 1, channel: '12', position: [3, 10], value: '01' }, // +300 ms
      { measure: 3, channel: '19', position: [0, 1], value: '01' },
    ];
    const base = {
      speed: 8,
      leadInMs: 0,
      audio: false,
      tui: false,
      replayInputs: [{ seq: 0, timeUs: 1_150_000, action: 'down' as const, channels: ['11', '12'] }],
    };

    const lr2 = await manualPlay(json, { ...base });
    const beatoraja = await manualPlay(json, { ...base, judgeRuleset: 'beatoraja' });

    expect(lr2.bad).toBe(2);
    expect(beatoraja.bad).toBe(1);
  });

  test('player: recordPlaylog stamps the chart hash and judge ruleset into the playlog', async () => {
    const json = createEmptyJson('bms');
    json.metadata.bpm = 240;
    json.events = [{ measure: 1, channel: '11', position: [0, 1], value: '01' }];

    let playlog: BeMusicPlaylog | undefined;
    await manualPlay(json, {
      speed: 8,
      leadInMs: 0,
      audio: false,
      tui: false,
      judgeRuleset: 'iidx',
      recordPlaylog: { chartSha256: 'ABCDEF0123456789' },
      onPlaylogRecorded: (recorded) => {
        playlog = recorded;
      },
      createInputRuntime: createScheduledInputRuntime([
        { delayMs: 50, command: { kind: 'interrupt', reason: 'escape' } },
      ]),
    });

    expect(playlog!.chart.sha256).toBe('abcdef0123456789');
    expect(playlog!.play.judgeRuleset).toBe('iidx');
    const parsed = parsePlaylog(serializePlaylog(playlog!));
    expect(parsed.chart.sha256).toBe('abcdef0123456789');
    expect(parsed.play.judgeRuleset).toBe('iidx');
  });

  test('player: ESC-interrupted play records an aborted playlog', async () => {
    const json = createEmptyJson('bms');
    json.metadata.bpm = 240;
    json.events = [{ measure: 1, channel: '11', position: [0, 1], value: '01' }];

    let playlog: BeMusicPlaylog | undefined;
    await manualPlay(json, {
      speed: 1,
      leadInMs: 0,
      audio: false,
      tui: false,
      onPlaylogRecorded: (recorded) => {
        playlog = recorded;
      },
      createInputRuntime: createScheduledInputRuntime([
        { delayMs: 100, command: { kind: 'interrupt', reason: 'escape' } },
      ]),
    });

    expect(playlog).toBeDefined();
    expect(playlog!.play.aborted).toBe(true);
    expect(playlog!.inputs).toHaveLength(0);
  });

  test('preparePlaybackChartData: lane mode comes from the shared play-variant rule, not mines or invisible objects', () => {
    const chart = (...lines: string[]) =>
      parseChart(['#PLAYER 1', '#BPM 120', '#WAV01 a.wav', ...lines, ''].join('\n'));
    const laneMode = (json: ReturnType<typeof parseChart>, laneModeExtension?: string) =>
      preparePlaybackChartData(json, { laneModeExtension }, true, 0).laneDisplayMode;

    // Same pressable notes (1P lanes 1..5); a mine on lane 8 and an invisible object on lane 9 must not turn the
    // chart into 7 KEY (and the beatoraja ruleset must not swap its 5 KEY judge windows for the 7 KEY ones).
    const plain = chart('#00111:01', '#00115:01');
    const withMineAndInvisible = chart('#00111:01', '#00115:01', '#001D8:01', '#00139:01');
    expect(laneMode(plain, '.bms')).toBe('5 KEY SP');
    expect(laneMode(withMineAndInvisible, '.bms')).toBe('5 KEY SP');
    expect(laneMode(withMineAndInvisible)).toBe('5 KEY SP');
    expect(preparePlaybackChartData(withMineAndInvisible, {}, true, 0).landmineNotes).toHaveLength(1);

    // The `.bme` extension does not complete the mode: the lanes in use decide, as in beatoraja.
    expect(laneMode(plain, '.bme')).toBe('5 KEY SP');
    expect(laneMode(withMineAndInvisible, '.bme')).toBe('5 KEY SP');

    // `#LNOBJ` and `#LNTYPE 1` spellings of the same long note on lane 8 resolve to the same lane mode.
    expect(laneMode(chart('#LNOBJ ZZ', '#WAVZZ z.wav', '#00111:01', '#00118:01', '#00218:ZZ'), '.bms')).toBe(
      '7 KEY SP',
    );
    expect(laneMode(chart('#LNTYPE 1', '#00111:01', '#00158:01', '#00258:01'), '.bms')).toBe('7 KEY SP');

    // PMS-STD content without the `.pms` extension is 9 KEY on every host (it used to be 5 KEY DP in the engine).
    expect(laneMode(chart('#00111:01', '#00122:01'), '.bms')).toBe('9 KEY (PMS-STD)');

    // A host-declared variant still wins.
    expect(
      preparePlaybackChartData(plain, { laneModeExtension: '.bms', playVariant: '7' }, true, 0).laneDisplayMode,
    ).toBe('7 KEY SP');
  });

  test('player: blank press between same-lane notes plays the previous keysound, not the next pending keysound', async () => {
    const json = createEmptyJson('bms');
    json.metadata.bpm = 240;
    json.resources.wav = {
      '01': 'a.wav',
      '02': 'b.wav',
    };
    json.events = [
      { measure: 1, channel: '11', position: [0, 1] as const, value: '01' },
      { measure: 1, channel: '11', position: [1, 2] as const, value: '02' },
    ];
    const preparedChart = preparePlaybackChartData(json, {}, false, 0);
    expect(preparedChart.scorableNotes[0]?.seconds).toBeCloseTo(1, 6);
    expect(preparedChart.scorableNotes[1]?.seconds).toBeCloseTo(1.5, 6);

    const triggeredEvents: string[] = [];
    const output: string[] = [];
    const summary = await manualPlay(json, {
      speed: 1,
      leadInMs: 0,
      audio: true,
      tui: false,
      judgeWindowMs: 50,
      preparedChart,
      writeOutput: (text) => {
        output.push(text);
      },
      createAudioSession: async () => ({
        backendLabel: 'recording-audio',
        chartStartDelayMs: 0,
        start: () => undefined,
        pause: () => undefined,
        resume: () => undefined,
        finish: async () => undefined,
        dispose: async () => undefined,
        triggerEvent: (event) => {
          triggeredEvents.push(event.value);
        },
        stopChannel: () => undefined,
      }),
      createInputRuntime: createScheduledInputRuntime([
        { delayMs: 1300, command: { kind: 'lane-input', tokens: ['z'] } },
        { delayMs: 1380, command: { kind: 'interrupt', reason: 'escape' } },
      ]),
    });

    expect(triggeredEvents).toEqual(['01']);
    expect(preparedChart.scorableNotes[0]?.judged).toBe(true);
    expect(preparedChart.scorableNotes[1]?.judged).toBe(false);
    expect(summary.poor).toBe(1);
    expect(output.some((line) => line.includes('kind:sample-trigger') && line.includes('source:lane-fallback'))).toBe(
      true,
    );
    expect(output.some((line) => line.includes('kind:judge') && line.includes('result:EMPTY_POOR'))).toBe(true);
  });

  test('player: invisible objects update the same-lane fallback keysound', async () => {
    const json = createEmptyJson('bms');
    json.metadata.bpm = 240;
    json.resources.wav = {
      '01': 'a.wav',
      '02': 'b.wav',
      '03': 'invisible.wav',
    };
    json.events = [
      { measure: 1, channel: '11', position: [0, 1] as const, value: '01' },
      { measure: 1, channel: '31', position: [1, 5] as const, value: '03' },
      { measure: 1, channel: '11', position: [1, 2] as const, value: '02' },
    ];
    const preparedChart = preparePlaybackChartData(json, {}, false, 0);
    expect(preparedChart.scorableNotes[0]?.seconds).toBeCloseTo(1, 6);
    expect(preparedChart.invisibleNotes[0]?.seconds).toBeCloseTo(1.2, 6);
    expect(preparedChart.scorableNotes[1]?.seconds).toBeCloseTo(1.5, 6);

    const triggeredEvents: string[] = [];
    const output: string[] = [];
    const summary = await manualPlay(json, {
      speed: 1,
      leadInMs: 0,
      audio: true,
      tui: false,
      judgeWindowMs: 50,
      preparedChart,
      writeOutput: (text) => {
        output.push(text);
      },
      createAudioSession: async () => ({
        backendLabel: 'recording-audio',
        chartStartDelayMs: 0,
        start: () => undefined,
        pause: () => undefined,
        resume: () => undefined,
        finish: async () => undefined,
        dispose: async () => undefined,
        triggerEvent: (event) => {
          triggeredEvents.push(event.value);
        },
        stopChannel: () => undefined,
      }),
      createInputRuntime: createScheduledInputRuntime([
        { delayMs: 1180, command: { kind: 'lane-input', tokens: ['z'] } },
        { delayMs: 1260, command: { kind: 'interrupt', reason: 'escape' } },
      ]),
    });

    expect(triggeredEvents).toEqual(['03']);
    expect(triggeredEvents).not.toContain('02');
    expect(preparedChart.scorableNotes[1]?.judged).toBe(false);
    expect(summary.poor).toBe(1);
    expect(output.some((line) => line.includes('kind:sample-trigger') && line.includes('value:03'))).toBe(true);
    expect(output.some((line) => line.includes('kind:judge') && line.includes('result:EMPTY_POOR'))).toBe(true);
  });

  test('player: invisible objects do not auto-trigger without lane input in manual play', async () => {
    const json = createEmptyJson('bms');
    json.metadata.bpm = 240;
    json.resources.wav = {
      '03': 'invisible.wav',
    };
    json.events = [{ measure: 1, channel: '31', position: [1, 5] as const, value: '03' }];
    const preparedChart = preparePlaybackChartData(json, {}, false, 0);
    expect(preparedChart.invisibleNotes[0]?.seconds).toBeCloseTo(1.2, 6);

    const triggeredEvents: string[] = [];
    await manualPlay(json, {
      speed: 1,
      leadInMs: 0,
      audio: true,
      tui: false,
      preparedChart,
      writeOutput: () => undefined,
      createAudioSession: async () => ({
        backendLabel: 'recording-audio',
        chartStartDelayMs: 0,
        start: () => undefined,
        pause: () => undefined,
        resume: () => undefined,
        finish: async () => undefined,
        dispose: async () => undefined,
        triggerEvent: (event) => {
          triggeredEvents.push(event.value);
        },
        stopChannel: () => undefined,
      }),
      createInputRuntime: createScheduledInputRuntime([
        { delayMs: 1300, command: { kind: 'interrupt', reason: 'escape' } },
      ]),
    });

    expect(triggeredEvents).toEqual([]);
  });

  test('player: `#BASE 62` lowercase sample IDs are looked up case-sensitively at runtime', async () => {
    // Two separate samples with case-distinct IDs (`#WAV0a` != `#WAV0A`). On a base-36 chart the parser would have
    // collapsed these into one slot during ingest; under `#BASE 62` they stay distinct and the player must resolve them
    // via case-preserved keys when emitting `sample-trigger` logs.
    const json = parseChart(
      ['#BASE 62', '#TITLE Base62 Sample', '#BPM 120', '#WAV0a lower.wav', '#WAV0A upper.wav', '#00111:0a0A', ''].join(
        '\n',
      ),
    );
    expect(json.bms.base).toBe(62);
    expect(json.resources.wav['0a']).toBe('lower.wav');
    expect(json.resources.wav['0A']).toBe('upper.wav');

    const output: string[] = [];
    await autoPlay(json, {
      speed: 240,
      leadInMs: 0,
      audio: false,
      tui: false,
      writeOutput: (text) => {
        output.push(text);
      },
    });

    // First note (`0a`) must hit the lowercase entry — `lower.wav` — and the runtime log must report the same
    // case-preserved `sample:0a` token. Folding either side to uppercase would emit `file:upper.wav` / `sample:0A` and
    // break this assertion.
    expect(
      output.some(
        (line) =>
          line.includes('kind:sample-trigger') &&
          line.includes('source:auto-note') &&
          line.includes('sample:0a') &&
          line.includes('file:lower.wav'),
      ),
    ).toBe(true);
    expect(
      output.some(
        (line) =>
          line.includes('kind:sample-trigger') &&
          line.includes('source:auto-note') &&
          line.includes('sample:0A') &&
          line.includes('file:upper.wav'),
      ),
    ).toBe(true);
  });

  test('player: manual landmine hit triggers #WAV00 in runtime logs', async () => {
    const json = createLandmineOnlyChart();
    const output: string[] = [];

    const summary = await manualPlay(json, {
      speed: 1,
      leadInMs: 0,
      audio: false,
      tui: false,
      writeOutput: (text) => {
        output.push(text);
      },
      createInputRuntime: createScheduledInputRuntime(HELD_LANDMINE_INPUT),
    });

    expect(summary.total).toBe(0);
    // LR2 — mine hits never emit a verdict: gauge damage + explosion sound only.
    expect(summary.bad).toBe(0);
    expect(summary.poor).toBe(0);
    expect(
      output.some(
        (line) =>
          line.includes('kind:sample-trigger') &&
          line.includes('source:mine-hit') &&
          line.includes('channel:11') &&
          line.includes('sample:00') &&
          line.includes('file:explode.wav'),
      ),
    ).toBe(true);
    expect(output.some((line) => line.includes('kind:mine-hit') && line.includes('channel:11'))).toBe(true);
  });

  test('player: manual landmine hit applies the LR2 raw-value damage with no verdict', async () => {
    const summary = await manualPlay(createLandmineOnlyChart({ value: '08' }), {
      speed: 1,
      leadInMs: 0,
      audio: false,
      tui: false,
      createInputRuntime: createScheduledInputRuntime(HELD_LANDMINE_INPUT),
    });

    expect(summary.total).toBe(0);
    expect(summary.bad).toBe(0);
    expect(summary.poor).toBe(0);
    // LR2 / beatoraja interpret the mine value directly as the damage percent ('08' = 8 %, NOT the nanasi-memo
    // value/2): gauge 20 → 12.
    expect(summary.gauge?.current).toBeCloseTo(12, 9);
  });

  test('player: manual landmine hit clamps large mine damage at the groove gauge minimum', async () => {
    const summary = await manualPlay(createLandmineOnlyChart({ value: 'ZZ' }), {
      speed: 1,
      leadInMs: 0,
      audio: false,
      tui: false,
      createInputRuntime: createScheduledInputRuntime(HELD_LANDMINE_INPUT),
    });

    expect(summary.bad).toBe(0);
    // ZZ (= 1295 % raw) wipes the gauge; GROOVE's 2 % soft floor catches it (a survival gauge would die instead).
    expect(summary.gauge?.current).toBeCloseTo(2, 9);
  });

  test('player: bmson per-mine damage overrides the BMS value/2 rule', async () => {
    // bmson `mine_channels[].notes[].damage` is an explicit gauge percentage carried on `event.bmson.damage`. When
    // present it wins over the BMS raw-value interpretation: value '08' alone would deal 8 %, the authored damage
    // of 7 must deal exactly 7 % (gauge 20 → 13).
    const json = createLandmineOnlyChart({ value: '08' });
    json.events[0]!.bmson = { damage: 7 };

    const summary = await manualPlay(json, {
      speed: 1,
      leadInMs: 0,
      audio: false,
      tui: false,
      createInputRuntime: createScheduledInputRuntime(HELD_LANDMINE_INPUT),
    });

    expect(summary.bad).toBe(0);
    expect(summary.gauge?.current).toBeCloseTo(13, 9);
  });

  test('player: bmson damage 0 is a valid no-damage decoration mine', async () => {
    const json = createLandmineOnlyChart({ value: '08' });
    json.events[0]!.bmson = { damage: 0 };

    const summary = await manualPlay(json, {
      speed: 1,
      leadInMs: 0,
      audio: false,
      tui: false,
      createInputRuntime: createScheduledInputRuntime(HELD_LANDMINE_INPUT),
    });

    expect(summary.bad).toBe(0);
    expect(summary.gauge?.current).toBeCloseTo(20, 9);
  });
});
