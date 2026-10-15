import { computeChartFingerprint, computePlayFingerprint, resolveChart, type RandomDraws } from '@be-music/chart';
import packageJson from '../../package.json' with { type: 'json' };
import { createEmptyJson, type BeMusicEvent, type BeMusicJson } from '@be-music/json';
import { parseBms, resolveBmsControlFlowWithDraws } from '@be-music/parser';
import { describe, expect, test } from 'vite-plus/test';
import type { PlayerSummary } from '../core/engine.ts';
import { resolveLandmineGaugeEffect } from '../core/landmine.ts';
import { resolveLaneDisplayMode } from '../core/lane-layout.ts';
import type { TimedLandmineNote, TimedPlayableNote } from '../playable-notes.ts';
import { BE_MUSIC_PLAYLOG_FORMAT, BE_MUSIC_PLAYLOG_VERSION } from './format.ts';
import {
  createPlaylogRecorder,
  PLAYLOG_NATIVE_RULESET_ID,
  type PlaylogRecorderChartData,
  type PlaylogRecorderOptions,
} from './recorder.ts';

function makeEvent(channel: string, value = '01'): BeMusicEvent {
  return { measure: 0, channel, position: [0, 1], value };
}

function playable(channel: string, seconds: number, overrides: Partial<TimedPlayableNote> = {}): TimedPlayableNote {
  return { event: makeEvent(channel), channel, beat: 0, seconds, judged: false, ...overrides };
}

function landmine(channel: string, seconds: number, value: string): TimedLandmineNote {
  return { event: makeEvent(channel, value), channel, beat: 0, seconds, judged: false, mine: true };
}

function makeJson(): BeMusicJson {
  const json = createEmptyJson('bms');
  json.metadata.title = 'My Song';
  json.metadata.artist = 'composer';
  json.metadata.total = 300;
  json.metadata.rank = 2;
  json.metadata.playLevel = 12;
  json.metadata.difficulty = 3;
  json.bms.lnMode = 2;
  return json;
}

function makeChartData(): PlaylogRecorderChartData {
  const scorable = [
    playable('13', 0.25),
    playable('11', 0.5),
    playable('12', 1, { endSeconds: 2 }),
    playable('18', 3, { endSeconds: 4, longNoteMode: 3 }),
  ];
  return {
    notes: [...scorable, playable('17', 1.5, { endSeconds: 2.5 })],
    landmineNotes: [landmine('14', 0.75, '0A')],
    invisibleNotes: [playable('15', 0.5, { invisible: true })],
    activeFreeZoneChannels: new Set(['17']),
    scorableNotes: scorable,
    laneDisplayMode: '7keys',
  };
}

function makeSummary(overrides: Partial<PlayerSummary> = {}): PlayerSummary {
  return {
    total: 4,
    perfect: 2,
    fast: 1,
    slow: 1,
    great: 1,
    good: 1,
    bad: 0,
    poor: 0,
    emptyPoor: 0,
    exScore: 5,
    score: 123456,
    ...overrides,
  };
}

function makeRecorderOptions(overrides: Partial<PlaylogRecorderOptions> = {}): PlaylogRecorderOptions {
  return {
    json: makeJson(),
    chart: makeChartData(),
    play: { mode: 'manual', autoScratch: false },
    now: () => new Date('2026-08-17T00:00:00.000Z'),
    ...overrides,
  };
}

describe('playlog recorder', () => {
  test('snapshots chart notes in (timeUs, channel, type) order with stable ids and resolved types', () => {
    const recorder = createPlaylogRecorder(makeRecorderOptions());
    const playlog = recorder.finalize({ summary: makeSummary() });

    expect(playlog.format).toBe(BE_MUSIC_PLAYLOG_FORMAT);
    expect(playlog.version).toBe(BE_MUSIC_PLAYLOG_VERSION);
    expect(playlog.createdAt).toBe('2026-08-17T00:00:00.000Z');
    expect(playlog.clock).toEqual({ unit: 'us', origin: 'chart-zero' });

    expect(playlog.chart.notes).toEqual([
      { id: 0, channel: '13', type: 'normal', timeUs: 250_000 },
      { id: 1, channel: '11', type: 'normal', timeUs: 500_000 },
      { id: 2, channel: '15', type: 'invisible', timeUs: 500_000 },
      { id: 3, channel: '14', type: 'mine', timeUs: 750_000, damage: 10 },
      // The chart-level #LNMODE 2 fills in when the note has no own long-note mode.
      { id: 4, channel: '12', type: 'long', timeUs: 1_000_000, endTimeUs: 2_000_000, lnMode: 2 },
      // Free-zone notes keep their tail but never carry an lnMode.
      { id: 5, channel: '17', type: 'freezone', timeUs: 1_500_000, endTimeUs: 2_500_000 },
      { id: 6, channel: '18', type: 'long', timeUs: 3_000_000, endTimeUs: 4_000_000, lnMode: 3 },
    ]);

    const mineNote = playlog.chart.notes.find((note) => note.type === 'mine');
    expect(mineNote?.damage).toBe(resolveLandmineGaugeEffect({ value: '0A' }).damage);
  });

  test('stamps the engine version and keeps the host-declared recorder fields', () => {
    const bare = createPlaylogRecorder(makeRecorderOptions()).finalize({ summary: makeSummary() });
    expect(bare.recorder).toEqual({ engine: packageJson.version });

    const declared = createPlaylogRecorder(
      makeRecorderOptions({
        recorder: { name: 'be-music-web', version: '0.5.0', build: '6471cd16', platform: 'web' },
      }),
    ).finalize({ summary: makeSummary() });
    expect(declared.recorder).toEqual({
      name: 'be-music-web',
      version: '0.5.0',
      build: '6471cd16',
      engine: packageJson.version,
      platform: 'web',
    });
  });

  test('stamps the chart file hashes in lowercase, and omits them when the host has none', () => {
    const bare = createPlaylogRecorder(makeRecorderOptions()).finalize({ summary: makeSummary() });
    expect(bare.chart).not.toHaveProperty('sha256');
    expect(bare.chart).not.toHaveProperty('md5');

    const hashed = createPlaylogRecorder(
      makeRecorderOptions({ chartSha256: 'A'.repeat(64), chartMd5: 'B'.repeat(32) }),
    ).finalize({ summary: makeSummary() });
    expect(hashed.chart.sha256).toBe('a'.repeat(64));
    expect(hashed.chart.md5).toBe('b'.repeat(32));
  });

  test('never lets the host override the engine version', () => {
    const playlog = createPlaylogRecorder(
      makeRecorderOptions({
        // Untyped hosts (plain JS) can still smuggle the field in; the recorder's own value wins.
        recorder: { name: 'host', engine: '9.9.9' } as PlaylogRecorderOptions['recorder'],
      }),
    ).finalize({ summary: makeSummary() });
    expect(playlog.recorder?.engine).toBe(packageJson.version);
  });

  test('captures chart metadata, noteCount, TOTAL, judge rank, and lnMode from the JSON', () => {
    const recorder = createPlaylogRecorder(makeRecorderOptions());
    const playlog = recorder.finalize({ summary: makeSummary() });

    expect(playlog.chart.sourceFormat).toBe('bms');
    expect(playlog.chart.laneMode).toBe('7keys');
    expect(playlog.chart.title).toBe('My Song');
    expect(playlog.chart.artist).toBe('composer');
    expect(playlog.chart.subtitle).toBeUndefined();
    expect(playlog.chart.playLevel).toBe('12');
    expect(playlog.chart.difficulty).toBe(3);
    expect(playlog.chart.total).toBe(300);
    expect(playlog.chart.lnMode).toBe(2);
    expect(playlog.chart.noteCount).toBe(4); // scorableNotes.length — mines / invisibles / freezones excluded
    expect(playlog.chart.judgeRank).toEqual({ percent: 75, sourceRank: 2 });
  });

  test('captures #DEFEXRANK and dynamic #EXRANK changes into judgeRank', () => {
    const json = makeJson();
    json.metadata.rank = 1;
    json.bms.defExRank = 120;
    const recorder = createPlaylogRecorder(
      makeRecorderOptions({
        json,
        dynamicJudgeRankChanges: [{ seconds: 12.5, exRankValue: 48 }],
      }),
    );
    const playlog = recorder.finalize({ summary: makeSummary() });

    expect(playlog.chart.judgeRank).toEqual({
      percent: 90, // #DEFEXRANK 120 × 75 / 100 — wins over #RANK 1
      sourceRank: 1,
      sourceExRank: 120,
      timeline: [{ timeUs: 12_500_000, exRankValue: 48 }],
    });
  });

  test('records inputs with microsecond timestamps, sequential seq, and copied channels', () => {
    const recorder = createPlaylogRecorder(makeRecorderOptions());

    // Inputs that resolve to no playable channel are not recorded (and consume no seq).
    recorder.recordInput('down', 0.5, ['q'], new Set());

    const sourceChannels = ['11'];
    recorder.recordInput('down', 1.234567, ['z'], sourceChannels);
    sourceChannels.push('19'); // later mutation must not leak into the recorded event
    recorder.recordInput('up', 1.3, [], new Set(['11', '12']));

    const playlog = recorder.finalize({ summary: makeSummary() });
    expect(playlog.inputs).toEqual([
      { seq: 0, timeUs: 1_234_567, action: 'down', channels: ['11'], tokens: ['z'] },
      { seq: 1, timeUs: 1_300_000, action: 'up', channels: ['11', '12'] },
    ]);
  });

  test('finalize caches the native result with judge counts, empty POORs, maxCombo, and gauge', () => {
    const recorder = createPlaylogRecorder(
      makeRecorderOptions({
        moneyScore: true,
        play: {
          mode: 'manual',
          autoScratch: true,
          gauge: 'HARD',
          randomLane: { p1: 'MIRROR' },
          dpFlip: true,
          native: { hiSpeed: 2 },
        },
      }),
    );
    recorder.recordEmptyPoor();
    recorder.recordEmptyPoor();

    const summary = makeSummary({
      gauge: {
        current: 88.5,
        max: 100,
        clearThreshold: 80,
        initial: 20,
        effectiveTotal: 300,
        cleared: true,
        type: 'GROOVE',
      },
    });
    const playlog = recorder.finalize({ summary, maxCombo: 5, aborted: true });

    expect(playlog.play).toEqual({
      mode: 'manual',
      autoScratch: true,
      gauge: 'HARD',
      randomLane: { p1: 'MIRROR' },
      dpFlip: true,
      aborted: true,
      native: { hiSpeed: 2 },
    });
    expect(playlog.results).toEqual({
      native: {
        ruleset: PLAYLOG_NATIVE_RULESET_ID,
        judge: { pgreat: 2, great: 1, good: 1, bad: 0, poor: 0, emptyPoor: 2 },
        fast: 1,
        slow: 1,
        exScore: 5,
        noteCount: 4,
        maxCombo: 5,
        djLevel: 'B',
        score: 123456,
        gauge: { type: 'GROOVE', final: 88.5, cleared: true },
      },
    });
  });

  test('finalize defaults: GROOVE gauge, maxCombo 0, declared gauge when the summary has none', () => {
    const recorder = createPlaylogRecorder(makeRecorderOptions());
    const playlog = recorder.finalize({ summary: makeSummary() });

    expect(playlog.play).toEqual({ mode: 'manual', autoScratch: false, gauge: 'GROOVE' });
    expect(playlog.play.aborted).toBeUndefined();
    expect(playlog.results?.native).toMatchObject({
      maxCombo: 0,
      gauge: { type: 'GROOVE', final: 0, cleared: false },
    });
    // Like the simulators, a ruleset without a money score reports none.
    expect(playlog.results?.native?.score).toBeUndefined();
  });

  test('the native result counts judgments as the ruleset does and flags a mid-play death', () => {
    const recorder = createPlaylogRecorder(makeRecorderOptions());
    const summary = makeSummary({
      total: 6,
      gauge: {
        current: 0,
        max: 100,
        clearThreshold: 0,
        initial: 100,
        effectiveTotal: 300,
        cleared: false,
        type: 'HARD',
        survival: true,
        failedMidPlay: true,
      },
    });
    const native = recorder.finalize({ summary }).results?.native;

    expect(native?.noteCount).toBe(6);
    expect(native?.gauge.failedMidPlay).toBe(true);
  });

  test('records the play fingerprint of the resolved chart', () => {
    const json = parseBms(
      ['#PLAYER 3', '#BPM 150', '#TITLE fingerprint', '#00111:01000100', '#00113:0001', '#00219:01'].join('\n'),
    );
    const playlog = createPlaylogRecorder(makeRecorderOptions({ json })).finalize({ summary: makeSummary() });

    expect(playlog.chart.playFingerprint).toBe(computePlayFingerprint(json, { chartPath: undefined }));
    expect(playlog.chart.playFingerprint).toMatch(/^bmfp0:[0-9a-f]{64}$/);
  });

  test('records one fingerprint as both chart and play fingerprint for a chart without control flow', () => {
    const json = parseBms(['#BPM 150', '#00111:01', '#00113:01'].join('\n'));
    const playlog = createPlaylogRecorder(makeRecorderOptions({ json, sourceChart: json })).finalize({
      summary: makeSummary(),
    });

    expect(playlog.chart.chartFingerprint).toBe(computeChartFingerprint(json, { chartPath: undefined }));
    expect(playlog.chart.chartFingerprint).toBe(playlog.chart.playFingerprint);
  });

  test('fingerprints a #RANDOM chart from its source chart and the recorded draws', () => {
    const source = parseBms(
      ['#BPM 150', '#00111:01', '#RANDOM 2', '#IF 1', '#00113:01', '#ENDIF', '#IF 2', '#00114:01', '#ENDIF'].join('\n'),
    );
    const draw = (value: number): RandomDraws => [{ command: 'RANDOM', range: 2, value }];
    const played = resolveBmsControlFlowWithDraws(source, draw(2));
    const record = (sourceChart: BeMusicJson | undefined, randomDraws?: RandomDraws) =>
      createPlaylogRecorder(
        makeRecorderOptions({
          json: played,
          ...(sourceChart !== undefined ? { sourceChart } : {}),
          play: { mode: 'manual', autoScratch: false, ...(randomDraws !== undefined ? { randomDraws } : {}) },
        }),
      ).finalize({ summary: makeSummary() });

    const playlog = record(source, draw(2));
    expect(playlog.chart.chartFingerprint).toBe(computeChartFingerprint(source, { chartPath: undefined }));
    expect(playlog.chart.playFingerprint).toBe(computePlayFingerprint(played, { chartPath: undefined }));
    expect(playlog.chart.chartFingerprint).not.toBe(playlog.chart.playFingerprint);

    // Both branches belong to one chart: the chart fingerprint does not depend on the outcome.
    const other = record(source, draw(1));
    expect(other.chart.chartFingerprint).toBe(playlog.chart.chartFingerprint);
    expect(other.chart.playFingerprint).toBe(
      computePlayFingerprint(resolveBmsControlFlowWithDraws(source, draw(1)), { chartPath: undefined }),
    );

    // Draws that do not belong to the source chart fall back to the engine's chart.
    const mismatched = record(source, [{ command: 'RANDOM', range: 3, value: 1 }]);
    expect(mismatched.chart.chartFingerprint).toBeUndefined();
    expect(mismatched.chart.playFingerprint).toBe(computePlayFingerprint(played, { chartPath: undefined }));
  });

  test('takes the fingerprints from the source chart, not a working copy whose lanes the host rewrote', () => {
    const source = parseBms(['#BPM 150', '#00111:01', '#00122:01'].join('\n'));
    // A DP flip baked into the chart the engine plays (`1x` ↔ `2x`) — a lane option, part of neither fingerprint.
    const flipped = parseBms(['#BPM 150', '#00121:01', '#00112:01'].join('\n'));
    const playlog = createPlaylogRecorder(makeRecorderOptions({ json: flipped, sourceChart: source })).finalize({
      summary: makeSummary(),
    });

    expect(playlog.chart.playFingerprint).toBe(computePlayFingerprint(source, { chartPath: undefined }));
    expect(playlog.chart.chartFingerprint).toBe(computeChartFingerprint(source, { chartPath: undefined }));
    expect(playlog.chart.playFingerprint).not.toBe(computePlayFingerprint(flipped, { chartPath: undefined }));
  });

  test('omits the chart fingerprint when draws were recorded but no source chart can be resolved with them', () => {
    const source = parseBms(['#BPM 150', '#RANDOM 2', '#IF 1', '#00113:01', '#ENDIF'].join('\n'));
    const randomDraws: RandomDraws = [{ command: 'RANDOM', range: 2, value: 1 }];
    // A host resolved `#RANDOM` itself and handed the engine the result, which carries no control flow.
    const engineChart = resolveBmsControlFlowWithDraws(source, randomDraws);
    const playlog = createPlaylogRecorder(
      makeRecorderOptions({
        json: engineChart,
        sourceChart: engineChart,
        play: { mode: 'manual', autoScratch: false, randomDraws },
      }),
    ).finalize({ summary: makeSummary() });

    expect(playlog.chart.chartFingerprint).toBeUndefined();
    expect(playlog.chart.playFingerprint).toBe(computePlayFingerprint(engineChart, { chartPath: undefined }));
  });

  test('fingerprints a chart played as 9 KEY with the .pms lane mode', () => {
    const json = parseBms(['#BPM 150', '#00111:01', '#00115:01'].join('\n'));
    const keysLog = createPlaylogRecorder(makeRecorderOptions({ json })).finalize({ summary: makeSummary() });
    // The lane mode the engine reports when it plays the same chart from a `.pms` file.
    const laneDisplayMode = resolveLaneDisplayMode(['11', '15'], { chartExtension: '.pms' });
    const pmsLog = createPlaylogRecorder(
      makeRecorderOptions({ json, chart: { ...makeChartData(), laneDisplayMode } }),
    ).finalize({ summary: makeSummary() });

    expect(keysLog.chart.playFingerprint).toBe(computePlayFingerprint(json, { chartPath: undefined }));
    expect(pmsLog.chart.playFingerprint).toBe(computePlayFingerprint(json, { chartPath: 'song.pms' }));
    expect(pmsLog.chart.playFingerprint).not.toBe(keysLog.chart.playFingerprint);
  });

  test('fingerprints with the chart extension the engine passes', () => {
    const json = parseBms(['#BPM 150', '#00111:01', '#00115:01'].join('\n'));
    const pmsLog = createPlaylogRecorder(makeRecorderOptions({ json, laneModeExtension: '.pms' })).finalize({
      summary: makeSummary(),
    });
    expect(pmsLog.chart.playFingerprint).toBe(computePlayFingerprint(json, { chartPath: 'song.pms' }));
    expect(pmsLog.chart.playFingerprint).not.toBe(computePlayFingerprint(json, { chartPath: undefined }));
  });

  test('records the #RANDOM draws it is given', () => {
    const options = makeRecorderOptions();
    const randomDraws: RandomDraws = [
      { command: 'RANDOM', range: 3, value: 2 },
      { command: 'SETSWITCH', range: 1, value: 1 },
    ];
    const withDraws = createPlaylogRecorder({ ...options, play: { ...options.play, randomDraws } });
    expect(withDraws.finalize({ summary: makeSummary() }).play.randomDraws).toEqual(randomDraws);
    const empty = createPlaylogRecorder({ ...options, play: { ...options.play, randomDraws: [] } });
    expect(empty.finalize({ summary: makeSummary() }).play).not.toHaveProperty('randomDraws');
  });

  test('omits the fingerprint instead of failing when it cannot be computed', () => {
    const json = makeJson();
    // The engine hands over its Resolved layer, so only the fingerprints read the broken source events.
    const chart = { ...makeChartData(), resolvedChart: resolveChart(makeJson()) };
    Object.defineProperty(json, 'events', {
      get: () => {
        throw new Error('broken chart');
      },
    });
    const playlog = createPlaylogRecorder(makeRecorderOptions({ json, chart })).finalize({ summary: makeSummary() });

    expect(playlog.chart).not.toHaveProperty('chartFingerprint');
    expect(playlog.chart).not.toHaveProperty('playFingerprint');
    expect(playlog.chart.title).toBe('My Song');
  });
});
