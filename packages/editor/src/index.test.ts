import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEmptyJson, type BmsJson } from '../../json/src/index.ts';
import { parseChartFile } from '../../parser/src/index.ts';
import { expect, test } from 'vitest';
import {
  addNote,
  createBlankJson,
  deleteNote,
  exportChart,
  importChart,
  listNotes,
  loadJsonFile,
  saveJsonFile,
  setMetadata,
} from './index.ts';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

test('editor: createBlankJson は JSON ベースの空データを返す', () => {
  const json = createBlankJson();
  expect(json.sourceFormat).toBe('json');
  expect(json.format).toBe('be-music-json/0.1.0');
  expect(json.metadata.bpm).toBe(120);
});

test('editor: setMetadata は既知キーと extras と BPM バリデーションを扱える', () => {
  let json = createEmptyJson('json');
  json = setMetadata(json, 'title', 'Song');
  json = setMetadata(json, 'artist', 'Composer');
  json = setMetadata(json, 'playlevel', '12.5');
  json = setMetadata(json, 'rank', '3');
  json = setMetadata(json, 'total', '250');
  json = setMetadata(json, 'difficulty', '4');
  json = setMetadata(json, 'bpm', '150');
  json = setMetadata(json, 'wavcmd', 'legacy');

  expect(json.metadata.title).toBe('Song');
  expect(json.metadata.artist).toBe('Composer');
  expect(json.metadata.playLevel).toBe(12.5);
  expect(json.metadata.rank).toBe(3);
  expect(json.metadata.total).toBe(250);
  expect(json.metadata.difficulty).toBe(4);
  expect(json.metadata.bpm).toBe(150);
  expect(json.metadata.extras.WAVCMD).toBe('legacy');

  const previousBpm = json.metadata.bpm;
  json = setMetadata(json, 'bpm', '-10');
  expect(json.metadata.bpm).toBe(previousBpm);
});

test('editor: addNote/listNotes/deleteNote は正規化と分数位置比較に対応する', () => {
  let json = createEmptyJson('json');
  json = addNote(json, {
    measure: 2,
    channel: '1a',
    positionNumerator: 10,
    positionDenominator: 4,
    value: 'f',
  });
  json = addNote(json, {
    measure: 1,
    channel: '11',
    positionNumerator: 1,
    positionDenominator: 2,
    value: '01',
  });
  json = addNote(json, {
    measure: 1,
    channel: '11',
    positionNumerator: 2,
    positionDenominator: 4,
    value: '02',
  });
  json = addNote(json, {
    measure: 1,
    channel: '11',
    positionNumerator: Number.NaN,
    positionDenominator: 0,
    value: '03',
  });

  const listed = listNotes(json);
  expect(
    listed.map((event) => [event.measure, event.channel, event.position[0], event.position[1], event.value]),
  ).toEqual([
    [1, '11', 0, 1, '03'],
    [1, '11', 1, 2, '01'],
    [1, '11', 2, 4, '02'],
    [2, '1A', 3, 4, '0F'],
  ]);
  expect(json.measures.some((measure) => measure.index === 2)).toBe(true);

  const removedByValue = deleteNote(json, {
    measure: 1,
    channel: '11',
    positionNumerator: 1,
    positionDenominator: 2,
    value: '01',
  });
  expect(removedByValue.events.some((event) => event.value === '01')).toBe(false);
  expect(removedByValue.events.some((event) => event.value === '02')).toBe(true);

  const removedByPosition = deleteNote(json, {
    measure: 1,
    channel: '11',
    positionNumerator: 1,
    positionDenominator: 2,
  });
  expect(removedByPosition.events.some((event) => event.value === '01')).toBe(false);
  expect(removedByPosition.events.some((event) => event.value === '02')).toBe(false);
});

test('editor: 不完全な JSON でも操作時にデフォルトへ正規化される', () => {
  const broken = {
    ...createEmptyJson('json'),
    metadata: undefined,
    resources: undefined,
    measures: [
      { index: 0, length: 1 },
      { index: Number.NaN, length: Number.NaN },
    ],
  } as unknown as BmsJson;

  const normalized = setMetadata(broken, 'genre', 'TEST');
  expect(normalized.metadata.bpm).toBe(120);
  expect(normalized.metadata.extras).toEqual({});
  expect(normalized.resources.wav).toEqual({});
  expect(normalized.resources.bmp).toEqual({});
  expect(normalized.resources.bpm).toEqual({});
  expect(normalized.resources.stop).toEqual({});
  expect(normalized.resources.text).toEqual({});
  expect(normalized.measures).toEqual([{ index: 0, length: 1 }]);
});

test('editor: saveJsonFile/loadJsonFile はファイル往復できる', async () => {
  const tempDir = await mkdtemp(resolve(tmpdir(), 'bms-editor-test-'));
  try {
    let json = createEmptyJson('json');
    json = addNote(json, {
      measure: 0,
      channel: '11',
      positionNumerator: 0,
      positionDenominator: 1,
      value: '01',
    });

    const path = resolve(tempDir, 'chart.json');
    await saveJsonFile(path, json);
    const loaded = await loadJsonFile(path);

    expect(loaded.sourceFormat).toBe('json');
    expect(loaded.events).toHaveLength(1);
    const text = await readFile(path, 'utf8');
    expect(text.endsWith('\n')).toBe(true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('editor: exportChart は .bms / .bmson を出力できる', async () => {
  const tempDir = await mkdtemp(resolve(tmpdir(), 'bms-editor-export-'));
  try {
    let json = createEmptyJson('json');
    json.metadata.title = 'Export Test';
    json.resources.wav['01'] = 'sample.wav';
    json.events.push({ measure: 0, channel: '11', position: [0, 1], value: '01' });

    const bmsPath = resolve(tempDir, 'out.bms');
    const bmsonPath = resolve(tempDir, 'out.bmson');
    await exportChart(bmsPath, json);
    await exportChart(bmsonPath, json);

    const [bmsParsed, bmsonParsed] = await Promise.all([parseChartFile(bmsPath), parseChartFile(bmsonPath)]);
    expect(bmsParsed.sourceFormat).toBe('bms');
    expect(bmsonParsed.sourceFormat).toBe('bmson');
    expect((await readFile(bmsPath, 'utf8')).length).toBeGreaterThan(0);
    expect((await readFile(bmsonPath, 'utf8')).length).toBeGreaterThan(0);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('editor: importChart は譜面ファイルを取り込める', async () => {
  const chartPath = resolve(rootDir, 'examples/test/sequence-regression.bms');
  const json = await importChart(chartPath);
  expect(json.sourceFormat).toBe('bms');
  expect(json.events.length).toBeGreaterThan(0);
});
