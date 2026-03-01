import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { createEmptyJson } from '../../json/src/index.ts';
import { parseBmson, parseChartFile } from '../../parser/src/index.ts';
import { createDemoJson, stringifyBms, stringifyBmson, stringifyChart, tokenFromNumber } from './index.ts';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
describe('stringifier', () => {


test('BMS stringify: generates measure resolution from fractional positions', () => {
  const json = createEmptyJson('json');
  json.metadata.title = 'Stringify BMS Test';
  json.metadata.artist = 'Codex';
  json.resources.wav['01'] = 'sample.wav';
  json.events = [
    { measure: 0, channel: '11', position: [0, 1], value: '01' },
    { measure: 0, channel: '11', position: [1, 4], value: '01' },
    { measure: 0, channel: '11', position: [1, 2], value: '01' },
    { measure: 0, channel: '11', position: [3, 4], value: '01' },
  ];

  const text = stringifyBms(json);
  const lines = text.split('\n');
  const sections = [
    'METADATA',
    'EXTENDED HEADER',
    'RESOURCES',
    'MEASURE LENGTH',
    'OBJECT DATA',
    'CONTROL FLOW',
  ] as const;

  expect(lines[0]).toBe('*---------------------- METADATA FIELD');
  expect(lines[1]).toBe('');

  for (const section of sections.slice(1)) {
    const marker = `*---------------------- ${section} FIELD`;
    const index = lines.indexOf(marker);
    expect(index).toBeGreaterThan(0);
    expect(lines[index - 1]).toBe('');
    expect(lines[index + 1]).toBe('');
  }

  expect(text.startsWith('\n')).toBe(false);
  expect(text).toMatch(/#00011:01010101/);
});

test('bmson stringify: outputs version/lines/info.resolution', async () => {
  const chartPath = resolve(rootDir, 'examples/test/bmson-lines-resolution-test.bmson');
  const source = parseBmson(await readFile(chartPath, 'utf8'));

  const output = stringifyBmson(source);
  const document = JSON.parse(output) as {
    version: string;
    info: { resolution: number };
    lines: Array<{ y: number }>;
  };

  expect(document.version).toBe('1.0.0');
  expect(document.info.resolution).toBe(240);
  expect(document.lines.map((line) => line.y)).toEqual([0, 960, 1680, 2640]);
});

test('bmson stringify: generates lines from measure lengths when IR has no lines', () => {
  const json = createEmptyJson('json');
  json.metadata.title = 'Lines Fallback Test';
  json.metadata.artist = 'Codex';
  json.metadata.bpm = 120;
  json.resources.wav['01'] = 'sample.wav';
  json.events = [
    { measure: 0, channel: '11', position: [0, 1], value: '01' },
    { measure: 1, channel: '11', position: [0, 1], value: '01' },
  ];
  json.measures = [{ index: 1, length: 0.5 }];
  json.bmson.info.resolution = 240;

  const output = stringifyBmson(json);
  const document = JSON.parse(output) as { lines: Array<{ y: number }> };
  expect(document.lines.map((line) => line.y)).toEqual([0, 960, 1440]);
});

test('BMS stringify: preserves and writes controlFlow', async () => {
  const chartPath = resolve(rootDir, 'examples/test/control-flow-test.bms');
  const json = await parseChartFile(chartPath);

  const output = stringifyBms(json);
  expect(output).toMatch(/#SETRANDOM 2/);
  expect(output).toMatch(/#IF 1/);
  expect(output).toMatch(/#00012:01/);
  expect(output).toMatch(/#SETSWITCH 3/);
  expect(output).toMatch(/#CASE 3/);
  expect(output).toMatch(/#ENDRANDOM/);
});

test('BMS stringify: writes extension headers', async () => {
  const chartPath = resolve(rootDir, 'examples/test/extensions-headers-test.bms');
  const json = await parseChartFile(chartPath);

  const output = stringifyBms(json);
  expect(output).toMatch(/#PLAYER 1/);
  expect(output).toMatch(/#PATH_WAV sounds\//);
  expect(output).toMatch(/#BASEBPM 155/);
  expect(output).toMatch(/#STP 001\.240/);
  expect(output).toMatch(/#OPTION HIGH-SPEED/);
  expect(output).toMatch(/#CHANGEOPTION01 MIRROR/);
  expect(output).toMatch(/#WAVCMD legacy/);
  expect(output).toMatch(/#LNTYPE 1/);
  expect(output).toMatch(/#LNOBJ ZZ/);
  expect(output).toMatch(/#DEFEXRANK 120/);
  expect(output).toMatch(/#EXRANK01 120,90,60,30/);
  expect(output).toMatch(/#ARGB0A FF000000/);
  expect(output).toMatch(/#EXWAV01 sample_ex\.wav/);
  expect(output).toMatch(/#EXBMP01 image_ex\.bmp/);
  expect(output).toMatch(/#BGA01 01/);
  expect(output).toMatch(/#POORBGA 01/);
  expect(output).toMatch(/#SWBGA01 02/);
  expect(output).toMatch(/#VIDEOFILE movie\.mp4/);
  expect(output).toMatch(/#MATERIALS materials\.def/);
  expect(output).toMatch(/#DIVIDEPROP lane=2/);
  expect(output).toMatch(/#CHARSET Shift_JIS/);
});

test('bmson stringify: preserves and outputs bga/info extensions and notes.l/c', async () => {
  const chartPath = resolve(rootDir, 'examples/test/bmson-strict-features.bmson');
  const source = parseBmson(await readFile(chartPath, 'utf8'));

  const output = stringifyBmson(source);
  const document = JSON.parse(output) as {
    info: {
      subartists?: string[];
      chart_name?: string;
      mode_hint?: string;
      judge_rank?: number;
      total?: number;
      back_image?: string;
      eyecatch_image?: string;
      banner_image?: string;
      preview_music?: string;
    };
    bga?: {
      bga_header: Array<{ id: number; name: string }>;
      bga_events: Array<{ y: number; id: number }>;
      layer_events: Array<{ y: number; id: number }>;
      poor_events: Array<{ y: number; id: number }>;
    };
    sound_channels: Array<{
      name: string;
      notes: Array<{ x: number; y: number; l: number; c: boolean }>;
    }>;
  };

  expect(document.info.subartists).toEqual(['Alice', 'Bob']);
  expect(document.info.chart_name).toBe('HYPER');
  expect(document.info.mode_hint).toBe('beat-7k');
  expect(document.info.judge_rank).toBe(125);
  expect(document.info.total).toBe(340);
  expect(document.info.back_image).toBe('back.png');
  expect(document.info.eyecatch_image).toBe('eye.png');
  expect(document.info.banner_image).toBe('banner.png');
  expect(document.info.preview_music).toBe('preview.ogg');

  expect(document.bga?.bga_header).toEqual([
    { id: 1, name: 'base.png' },
    { id: 2, name: 'layer.png' },
    { id: 3, name: 'poor.png' },
  ]);
  expect(document.bga?.bga_events).toEqual([{ y: 0, id: 1 }]);
  expect(document.bga?.layer_events).toEqual([{ y: 480, id: 2 }]);
  expect(document.bga?.poor_events).toEqual([{ y: 960, id: 3 }]);

  const lead = document.sound_channels.find((channel) => channel.name === 'lead.wav');
  expect(lead?.notes[0]).toEqual({ x: 1, y: 0, l: 120, c: true });
  expect(lead?.notes[1]).toEqual({ x: 1, y: 1080, l: 0, c: false });
});

test('BMS stringify: handles maxResolution/eol options and controlFlow objects', () => {
  const json = createEmptyJson('bms');
  json.metadata.title = 'Options';
  json.metadata.artist = 'Codex';
  json.metadata.extras = {
    CUSTOM: 'YES',
    PLAYER: 'ignored-as-extra',
  };
  json.resources.wav = { '01': 'a.wav', '02': 'b.wav' };
  json.events = [
    { measure: 0, channel: '11', position: [1, 8], value: '01' },
    { measure: 0, channel: '11', position: [7, 8], value: '02' },
  ];
  json.bms.controlFlow = [
    { kind: 'directive', command: 'RANDOM', value: '2' },
    { kind: 'header', command: 'ENDIF', value: '' },
    {
      kind: 'object',
      measure: 1,
      channel: '11',
      events: [{ measure: 1, channel: '11', position: [0, 1], value: '01' }],
      measureLength: 0.5,
    },
    {
      kind: 'object',
      measure: 2,
      channel: '12',
      events: [
        { measure: 2, channel: '12', position: [0, 2], value: '01' },
        { measure: 2, channel: '12', position: [1, 2], value: '00' },
      ],
    },
  ];

  const output = stringifyBms(json, { maxResolution: 4, eol: '\r\n' });
  expect(output).toContain('#CUSTOM YES');
  expect(output).not.toContain('#PLAYER ignored-as-extra');
  expect(output).toContain('#00011:0001');
  expect(output).toContain('#00111:0.5');
  expect(output).toContain('#00212:01');
  expect(output).toContain('#ENDIF');
  expect(output).toContain('\r\n');
});

test('bmson stringify: handles resolution/version/lines normalization and fallback metadata', () => {
  const json = createEmptyJson('json');
  json.metadata.title = 'Fallback';
  json.metadata.artist = 'Composer';
  json.metadata.genre = 'Genre';
  json.metadata.bpm = 150;
  json.metadata.playLevel = 7;
  json.metadata.rank = 75;
  json.metadata.total = 320;
  json.resources.wav['01'] = 'sample.wav';
  json.resources.bpm['AA'] = 180;
  json.resources.stop['AB'] = 96;
  json.events = [
    { measure: 0, channel: '11', position: [0, 1], value: '01' },
    { measure: 0, channel: '03', position: [0, 1], value: '78' },
    { measure: 0, channel: '08', position: [1, 2], value: 'AA' },
    { measure: 0, channel: '09', position: [3, 4], value: 'AB' },
    { measure: 0, channel: 'AA', position: [0, 1], value: 'FF' },
  ];
  json.bmson.lines = [960, 0, 960];
  json.bmson.info.subartists = ['A', 'B', ''];
  json.bmson.version = '';

  const output = stringifyBmson(json, { resolution: 480, indent: 0 });
  const document = JSON.parse(output) as {
    version: string;
    lines: Array<{ y: number }>;
    info: {
      title: string;
      artist: string;
      genre: string;
      level: number;
      init_bpm: number;
      mode_hint: string;
      resolution: number;
      judge_rank: number;
      total: number;
      subartists?: string[];
    };
    bpm_events: Array<{ y: number; bpm: number }>;
    stop_events: Array<{ y: number; duration: number }>;
  };

  expect(document.version).toBe('1.0.0');
  expect(document.lines.map((line) => line.y)).toEqual([0, 960]);
  expect(document.info).toMatchObject({
    title: 'Fallback',
    artist: 'Composer',
    genre: 'Genre',
    level: 7,
    init_bpm: 150,
    mode_hint: 'beat-2k',
    resolution: 480,
    judge_rank: 75,
    total: 320,
  });
  expect(document.info.subartists).toEqual(['A', 'B', '']);
  expect(document.bpm_events.map((event) => event.bpm)).toEqual([120, 180]);
  expect(document.stop_events[0].duration).toBe(96);
});

test('stringifier: stringifyChart / createDemoJson / tokenFromNumber', () => {
  const demo = createDemoJson();
  expect(demo.events.length).toBeGreaterThan(0);

  const bms = stringifyChart(demo, 'bms');
  const bmson = stringifyChart(demo, 'bmson');
  expect(bms).toContain('#TITLE Demo Chart');
  expect(bmson).toContain('"sound_channels"');

  expect(tokenFromNumber(35)).toBe('0Z');
});
});
