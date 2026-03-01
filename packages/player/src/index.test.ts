import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEmptyJson } from '../../json/src/index.ts';
import { expect, test } from 'vitest';
import { parseChartFile } from '../../parser/src/index.ts';
import { autoPlay, extractPlayableNotes } from './index.ts';

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
