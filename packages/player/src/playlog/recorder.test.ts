import { createEmptyJson, type BeMusicEvent, type BeMusicJson } from '@be-music/json';
import { describe, expect, test } from 'vitest';
import type { PlayerSummary } from '../core/engine.ts';
import { resolveLandmineGaugeEffect } from '../core/landmine.ts';
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

  test('captures chart metadata, noteCount, TOTAL, judge rank, and lnMode from the JSON', () => {
    const recorder = createPlaylogRecorder(makeRecorderOptions());
    const playlog = recorder.finalize({ summary: makeSummary() });

    expect(playlog.chart.sourceFormat).toBe('bms');
    expect(playlog.chart.laneMode).toBe('7keys');
    expect(playlog.chart.title).toBe('My Song');
    expect(playlog.chart.artist).toBe('composer');
    expect(playlog.chart.subtitle).toBeUndefined();
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
  });
});
