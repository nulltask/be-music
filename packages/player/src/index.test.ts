import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEmptyJson } from '../../json/src/index.ts';
import { expect, test } from 'vitest';
import { parseChartFile } from '../../parser/src/index.ts';
import { autoPlay, extractPlayableNotes, resolveJudgeWindowsMs } from './index.ts';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

test('player: auto 再生が完走できる', async () => {
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
  expect(summary.miss).toBe(0);
  expect(summary.exScore).toBe(12);
  expect(summary.score).toBe(200000);
});

test('player: 制御構文付き譜面は再生時に分岐解決される', async () => {
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

test('player: bmson notes.l からロングノート終端 beat を算出できる', () => {
  const json = createEmptyJson('bmson');
  json.metadata.bpm = 120;
  json.bmson.info.resolution = 240;
  json.events = [{ measure: 0, channel: '11', position: [0, 1], value: '01', bmson: { l: 240 } }];

  const notes = extractPlayableNotes(json);
  expect(notes).toHaveLength(1);
  expect(notes[0].beat).toBe(0);
  expect(notes[0].endBeat).toBeCloseTo(1, 6);
});

test('player: bms #LNOBJ からロングノート終端 beat を算出できる', () => {
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

test('player: bms RANK=2 は基準判定幅になる', () => {
  const json = createEmptyJson('bms');
  json.metadata.rank = 2;
  const windows = resolveJudgeWindowsMs(json);
  expect(windows.pgreat).toBeCloseTo(16.67, 6);
  expect(windows.great).toBeCloseTo(33.33, 6);
  expect(windows.good).toBeCloseTo(116.67, 6);
  expect(windows.bad).toBeCloseTo(250, 6);
});

test('player: bms RANK=0 は判定幅が狭くなる', () => {
  const json = createEmptyJson('bms');
  json.metadata.rank = 0;
  const windows = resolveJudgeWindowsMs(json);
  expect(windows.pgreat).toBeCloseTo((16.67 * 25) / 75, 6);
  expect(windows.great).toBeCloseTo((33.33 * 25) / 75, 6);
  expect(windows.good).toBeCloseTo((116.67 * 25) / 75, 6);
  expect(windows.bad).toBeCloseTo((250 * 25) / 75, 6);
});

test('player: bms DEFEXRANK は NORMAL 基準で倍率換算される', () => {
  const json = createEmptyJson('bms');
  json.metadata.rank = 0;
  json.bms.defExRank = 120;
  const windows = resolveJudgeWindowsMs(json);
  expect(windows.pgreat).toBeCloseTo(16.67 * 1.2, 6);
  expect(windows.great).toBeCloseTo(33.33 * 1.2, 6);
  expect(windows.good).toBeCloseTo(116.67 * 1.2, 6);
  expect(windows.bad).toBeCloseTo(250 * 1.2, 6);
});

test('player: bmson judge_rank=100 は基準判定幅になる', () => {
  const json = createEmptyJson('bmson');
  json.bmson.info.judgeRank = 100;
  const windows = resolveJudgeWindowsMs(json);
  expect(windows.pgreat).toBeCloseTo(16.67, 6);
  expect(windows.great).toBeCloseTo(33.33, 6);
  expect(windows.good).toBeCloseTo(116.67, 6);
  expect(windows.bad).toBeCloseTo(250, 6);
});

test('player: debug judge window は BAD のみ上書きする', () => {
  const json = createEmptyJson('bms');
  json.metadata.rank = 4;
  const windows = resolveJudgeWindowsMs(json, 180);
  expect(windows.pgreat).toBeCloseTo((16.67 * 125) / 75, 6);
  expect(windows.great).toBeCloseTo((33.33 * 125) / 75, 6);
  expect(windows.good).toBeCloseTo((116.67 * 125) / 75, 6);
  expect(windows.bad).toBe(180);
});
