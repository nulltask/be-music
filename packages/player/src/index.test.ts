import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEmptyJson } from '../../json/src/index.ts';
import { describe, expect, test } from 'vitest';
import { parseChartFile } from '../../parser/src/index.ts';
import {
  autoPlay,
  extractInvisiblePlayableNotes,
  extractLandmineNotes,
  extractPlayableNotes,
  manualPlay,
  resolveJudgeWindowsMs,
} from './index.ts';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
describe('player', () => {


test('player: auto play finishes successfully', async () => {
  const chartPath = resolve(rootDir, 'examples/test/sequence-regression.bms');
  const json = await parseChartFile(chartPath);

  const summary = await autoPlay(json, {
    auto: true,
    speed: 48,
    leadInMs: 0,
    audio: false,
    tui: false,
  });

  expect(summary.total).toBe(6);
  expect(summary.perfect).toBe(6);
  expect(summary.great).toBe(0);
  expect(summary.good).toBe(0);
  expect(summary.bad).toBe(0);
  expect(summary.poor).toBe(0);
  expect(summary.exScore).toBe(12);
  expect(summary.score).toBe(200000);
});

test('player: resolves control-flow branches at playback time', async () => {
  const chartPath = resolve(rootDir, 'examples/test/control-flow-runtime-fixed.bms');
  const json = await parseChartFile(chartPath);

  expect(extractPlayableNotes(json).length).toBe(0);

  const summary = await autoPlay(json, {
    auto: true,
    speed: 64,
    leadInMs: 0,
    audio: false,
    tui: false,
  });

  expect(summary.total).toBe(2);
  expect(summary.perfect).toBe(2);
  expect(summary.bad).toBe(0);
  expect(summary.exScore).toBe(4);
  expect(summary.score).toBe(200000);
});

test('player: auto play ignores landmine notes in score totals', async () => {
  const json = createEmptyJson('bms');
  json.metadata.bpm = 120;
  json.events = [
    { measure: 0, channel: '11', position: [0, 1], value: '01' },
    { measure: 0, channel: 'D1', position: [1, 2], value: '10' },
  ];

  const summary = await autoPlay(json, {
    auto: true,
    speed: 48,
    leadInMs: 0,
    audio: false,
    tui: false,
  });

  expect(summary.total).toBe(1);
  expect(summary.perfect).toBe(1);
  expect(summary.bad).toBe(0);
  expect(summary.poor).toBe(0);
});

test('player: auto scratch judges 16ch/26ch notes in manual play', async () => {
  const json = createEmptyJson('bms');
  json.metadata.bpm = 120;
  json.events = [
    { measure: 0, channel: '16', position: [0, 1], value: '01' },
    { measure: 0, channel: '11', position: [0, 1], value: '02' },
  ];

  const summary = await manualPlay(json, {
    autoScratch: true,
    speed: 64,
    leadInMs: 0,
    audio: false,
    tui: false,
  });

  expect(summary.total).toBe(2);
  expect(summary.perfect).toBe(1);
  expect(summary.poor).toBe(1);
  expect(summary.bad).toBe(0);
});

test('player: derives long-note end beat from bmson notes.l', () => {
  const json = createEmptyJson('bmson');
  json.metadata.bpm = 120;
  json.bmson.info.resolution = 240;
  json.events = [{ measure: 0, channel: '11', position: [0, 1], value: '01', bmson: { l: 240 } }];

  const notes = extractPlayableNotes(json);
  expect(notes).toHaveLength(1);
  expect(notes[0].beat).toBe(0);
  expect(notes[0].endBeat).toBeCloseTo(1, 6);
});

test('player: derives long-note end beat from bms #LNOBJ', () => {
  const json = createEmptyJson('bms');
  json.metadata.bpm = 120;
  json.bms.lnObj = 'AA';
  json.events = [
    { measure: 0, channel: '11', position: [0, 1], value: '01' },
    { measure: 0, channel: '11', position: [1, 4], value: 'AA' },
    { measure: 0, channel: '11', position: [2, 4], value: '02' },
  ];

  const notes = extractPlayableNotes(json);
  expect(notes).toHaveLength(3);
  expect(notes[0].beat).toBe(0);
  expect(notes[0].endBeat).toBeCloseTo(1, 6);
  expect(notes[0].endSeconds).toBeCloseTo(0.5, 6);
  expect(notes[1].endBeat).toBeUndefined();
});

test('player: extracts landmine objects and maps them to playable lanes', () => {
  const json = createEmptyJson('bms');
  json.metadata.bpm = 120;
  json.events = [
    { measure: 0, channel: 'D1', position: [0, 1], value: '10' },
    { measure: 1, channel: 'E6', position: [0, 1], value: '20' },
    { measure: 2, channel: '11', position: [0, 1], value: '01' },
  ];

  const landmines = extractLandmineNotes(json);
  expect(landmines).toHaveLength(2);
  expect(landmines[0]?.channel).toBe('11');
  expect(landmines[1]?.channel).toBe('26');
  expect(landmines[0]?.mine).toBe(true);
});

test('player: extracts invisible channels and maps them to playable lanes', () => {
  const json = createEmptyJson('bms');
  json.metadata.bpm = 120;
  json.events = [
    { measure: 0, channel: '31', position: [0, 1], value: '10' },
    { measure: 1, channel: '44', position: [0, 1], value: '20' },
    { measure: 2, channel: '11', position: [0, 1], value: '01' },
  ];

  const invisible = extractInvisiblePlayableNotes(json);
  expect(invisible).toHaveLength(2);
  expect(invisible[0]?.channel).toBe('11');
  expect(invisible[1]?.channel).toBe('24');
  expect(invisible[0]?.invisible).toBe(true);
});

test('player: uses baseline judge windows for bms RANK=2', () => {
  const json = createEmptyJson('bms');
  json.metadata.rank = 2;
  const windows = resolveJudgeWindowsMs(json);
  expect(windows.pgreat).toBeCloseTo(16.67, 6);
  expect(windows.great).toBeCloseTo(33.33, 6);
  expect(windows.good).toBeCloseTo(116.67, 6);
  expect(windows.bad).toBeCloseTo(250, 6);
});

test('player: narrows judge windows for bms RANK=0', () => {
  const json = createEmptyJson('bms');
  json.metadata.rank = 0;
  const windows = resolveJudgeWindowsMs(json);
  expect(windows.pgreat).toBeCloseTo((16.67 * 25) / 75, 6);
  expect(windows.great).toBeCloseTo((33.33 * 25) / 75, 6);
  expect(windows.good).toBeCloseTo((116.67 * 25) / 75, 6);
  expect(windows.bad).toBeCloseTo((250 * 25) / 75, 6);
});

test('player: scales judge windows from bms DEFEXRANK using NORMAL baseline', () => {
  const json = createEmptyJson('bms');
  json.metadata.rank = 0;
  json.bms.defExRank = 120;
  const windows = resolveJudgeWindowsMs(json);
  expect(windows.pgreat).toBeCloseTo(16.67 * 1.2, 6);
  expect(windows.great).toBeCloseTo(33.33 * 1.2, 6);
  expect(windows.good).toBeCloseTo(116.67 * 1.2, 6);
  expect(windows.bad).toBeCloseTo(250 * 1.2, 6);
});

test('player: uses baseline judge windows for bmson judge_rank=100', () => {
  const json = createEmptyJson('bmson');
  json.bmson.info.judgeRank = 100;
  const windows = resolveJudgeWindowsMs(json);
  expect(windows.pgreat).toBeCloseTo(16.67, 6);
  expect(windows.great).toBeCloseTo(33.33, 6);
  expect(windows.good).toBeCloseTo(116.67, 6);
  expect(windows.bad).toBeCloseTo(250, 6);
});

test('player: debug judge window override affects BAD only', () => {
  const json = createEmptyJson('bms');
  json.metadata.rank = 4;
  const windows = resolveJudgeWindowsMs(json, 180);
  expect(windows.pgreat).toBeCloseTo((16.67 * 125) / 75, 6);
  expect(windows.great).toBeCloseTo((33.33 * 125) / 75, 6);
  expect(windows.good).toBeCloseTo((116.67 * 125) / 75, 6);
  expect(windows.bad).toBe(180);
});
});
