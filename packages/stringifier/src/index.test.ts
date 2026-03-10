import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { createEmptyJson } from '../../json/src/index.ts';
import { parseBmson, parseChart, parseChartFile } from '../../parser/src/index.ts';
import { stringifyBms, stringifyBmson } from './index.ts';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const unifiedBmsChartPath = resolve(rootDir, 'examples/test/four-measure-command-combo-test.bms');
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
  const json = await parseChartFile(unifiedBmsChartPath);

  const output = stringifyBms(json);
  expect(output).toMatch(/#SETRANDOM 2/);
  expect(output).toMatch(/#IF 2/);
  expect(output).toMatch(/#02012:01/);
  expect(output).toMatch(/#SETSWITCH 3/);
  expect(output).toMatch(/#CASE 3/);
  expect(output).toMatch(/#02116:01/);
  expect(output).toMatch(/#RANDOM 2/);
  expect(output).toMatch(/#02324:01/);
  expect(output).toMatch(/#ENDRANDOM/);
});

test('BMS stringify: writes extension headers', async () => {
  const json = await parseChartFile(unifiedBmsChartPath);

  const output = stringifyBms(json);
  expect(output).toMatch(/#PREVIEW sample\.wav/);
  expect(output).toMatch(/#PLAYER 3/);
  expect(output).toMatch(/#PATH_WAV \.\//);
  expect(output).toMatch(/#BASEBPM 128/);
  expect(output).toMatch(/#STP 008\.192/);
  expect(output).toMatch(/#OPTION RANDOM/);
  expect(output).toMatch(/#CHANGEOPTION01 MIRROR/);
  expect(output).toMatch(/#CHANGEOPTION02 RANDOM/);
  expect(output).toMatch(/#WAVCMD legacy/);
  expect(output).toMatch(/#LNTYPE 1/);
  expect(output).toMatch(/#LNMODE 1/);
  expect(output).toMatch(/#LNOBJ AA/);
  expect(output).toMatch(/#LNOBJ AB/);
  expect(output).toMatch(/#VOLWAV 90/);
  expect(output).toMatch(/#DEFEXRANK 120/);
  expect(output).toMatch(/#EXRANK01 120,90,60,30/);
  expect(output).toMatch(/#ARGB01 FF000000/);
  expect(output).toMatch(/#EXWAV01 ex_sample\.wav/);
  expect(output).toMatch(/#EXBMP01 ex_image\.bmp/);
  expect(output).toMatch(/#BGA01 01/);
  expect(output).toMatch(/#SCROLL01 0\.5/);
  expect(output).toMatch(/#SCROLL02 1/);
  expect(output).toMatch(/#SCROLL03 1\.5/);
  expect(output).toMatch(/#POORBGA 03/);
  expect(output).toMatch(/#SWBGA01 02/);
  expect(output).toMatch(/#VIDEOFILE demo\.mp4/);
  expect(output).toMatch(/#MIDIFILE demo\.mid/);
  expect(output).toMatch(/#MATERIALS demo\.materials/);
  expect(output).toMatch(/#DIVIDEPROP lane=2/);
  expect(output).toMatch(/#CHARSET UTF-8/);
});

test('BMS stringify: writes multiple LNOBJ declarations in order', () => {
  const json = createEmptyJson('bms');
  json.bms.lnObjs = ['AA', 'BB'];

  const output = stringifyBms(json);
  const lnObjLines = output
    .split('\n')
    .filter((line) => line.startsWith('#LNOBJ '))
    .map((line) => line.trim());
  expect(lnObjLines).toEqual(['#LNOBJ AA', '#LNOBJ BB']);
});

test('BMS stringify: writes SPEED indexed headers', () => {
  const json = createEmptyJson('bms');
  json.bms.speed = { '01': 1, '02': 0.5 };

  const output = stringifyBms(json);
  expect(output).toMatch(/#SPEED01 1/);
  expect(output).toMatch(/#SPEED02 0\.5/);
});

test('BMS stringify: preserves parsed duplicate object lines and BGM/A6 line boundaries', () => {
  const parsed = parseChart(
    [
      '#00113:11111111',
      '#00113:0022332255224400',
      '#00113:0066',
      '#00101:11',
      '#00101:22',
      '#001A6:11',
      '#001A6:22',
      '#00102:1.5',
      '#00102:0.75',
      '',
    ].join('\n'),
  );

  const output = stringifyBms(parsed);
  const measureLines = output.split('\n').filter((line) => line.startsWith('#00102:'));
  const objectLines = output.split('\n').filter((line) => /^#001(13|01|A6):/.test(line));

  expect(measureLines).toEqual(['#00102:1.5', '#00102:0.75']);
  expect(objectLines).toEqual([
    '#00113:11111111',
    '#00113:0022332255224400',
    '#00113:0066',
    '#00101:11',
    '#00101:22',
    '#001A6:11',
    '#001A6:22',
  ]);
});

test('BMS stringify: preserves parsed header order and control-flow placement', () => {
  const input = [
    '#RANDOM 2',
    '#IF 1',
    '#TITLE Branch',
    '#00111:11',
    '#ENDIF',
    '#ENDRANDOM',
    '#TITLE Final',
    '#WAV02 b.wav',
    '#WAV01 a.wav',
    '#00111:22',
    '',
  ].join('\n');

  const output = stringifyBms(parseChart(input));

  expect(output.split('\n')).toEqual([
    '#RANDOM 2',
    '#IF 1',
    '#TITLE Branch',
    '#00111:11',
    '#ENDIF',
    '#ENDRANDOM',
    '#TITLE Final',
    '#WAV02 b.wav',
    '#WAV01 a.wav',
    '#00111:22',
  ]);
});

test('BMS stringify: falls back to regenerated object lines when parsed structure no longer matches events', () => {
  const parsed = parseChart(
    [
      '#00113:11',
      '#00113:22',
      '',
    ].join('\n'),
  );
  parsed.events.push({ measure: 1, channel: '13', position: [1, 2], value: '33' });

  const output = stringifyBms(parsed);
  const objectLines = output.split('\n').filter((line) => line.startsWith('#00113:'));

  expect(objectLines).toEqual(['#00113:2233']);
});

test('BMS stringify: falls back to canonical sections when parsed sourceLines no longer match', () => {
  const parsed = parseChart(
    [
      '#TITLE Original',
      '#00111:11',
      '',
    ].join('\n'),
  );
  parsed.metadata.title = 'Changed';

  const output = stringifyBms(parsed);

  expect(output).toContain('*---------------------- METADATA FIELD');
  expect(output).toContain('#TITLE Changed');
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

test('bmson stringify: preserves parsed sound_channels and bpm/stop event ordering', () => {
  const parsed = parseBmson(
    JSON.stringify({
      version: '1.0.0',
      info: {
        title: 'Test',
        artist: 'Codex',
        init_bpm: 120,
        resolution: 240,
      },
      lines: [{ y: 0 }, { y: 960 }],
      bpm_events: [
        { y: 480, bpm: 180 },
        { y: 0, bpm: 120 },
      ],
      stop_events: [
        { y: 960, duration: 96 },
        { y: 480, duration: 48 },
      ],
      sound_channels: [
        { name: 'unused.wav', notes: [] },
        { name: 'lead.wav', notes: [{ x: 1, y: 0, l: 120, c: true }] },
      ],
    }),
  );

  const document = JSON.parse(stringifyBmson(parsed)) as {
    bpm_events: Array<{ y: number; bpm: number }>;
    stop_events: Array<{ y: number; duration: number }>;
    sound_channels: Array<{ name: string; notes: Array<{ x?: number; y: number; l?: number; c?: boolean }> }>;
  };

  expect(document.bpm_events).toEqual([
    { y: 480, bpm: 180 },
    { y: 0, bpm: 120 },
  ]);
  expect(document.stop_events).toEqual([
    { y: 960, duration: 96 },
    { y: 480, duration: 48 },
  ]);
  expect(document.sound_channels).toEqual([
    { name: 'unused.wav', notes: [] },
    { name: 'lead.wav', notes: [{ x: 1, y: 0, l: 120, c: true }] },
  ]);
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

test('BMS stringify: writes optional metadata and sorts extension/resource entries', () => {
  const json = createEmptyJson('bms');
  json.metadata.title = 'Sort Check';
  json.metadata.subtitle = 'Sub';
  json.metadata.artist = 'Codex';
  json.metadata.genre = 'Genre';
  json.metadata.comment = 'Comment';
  json.metadata.stageFile = 'stage.png';
  json.metadata.playLevel = 7;
  json.metadata.rank = 2;
  json.metadata.total = 320;
  json.metadata.difficulty = 4;
  json.metadata.extras = {
    ZZZ: 'last',
    AAA: 'first',
    ARGB0A: 'filtered-argb',
    CHANGEOPTION01: 'filtered-change',
    SWBGA01: 'filtered-swbga',
  };

  json.bms.changeOption = { '0B': 'MIRROR', '0A': 'RANDOM' };
  json.bms.exRank = { '0B': '120,90,60,30', '0A': '100,80,50,20' };
  json.bms.exWav = { '0B': 'b.wav', '0A': 'a.wav' };
  json.bms.exBmp = { '0B': 'b.bmp', '0A': 'a.bmp' };
  json.bms.swBga = { '0B': '0B', '0A': '0A' };

  json.resources.bpm = { '0B': 180, '0A': 150 };
  json.resources.stop = { '0B': 64, '0A': 32 };

  json.measures = [
    { index: 2, length: 0.75 },
    { index: 1, length: 1.5 },
    { index: 3, length: 1 },
  ];
  json.events = [
    { measure: 0, channel: '13', position: [0, 1], value: '01' },
    { measure: 0, channel: '11', position: [0, 1], value: '01' },
  ];

  const output = stringifyBms(json);

  expect(output).toContain('#SUBTITLE Sub');
  expect(output).toContain('#PLAYLEVEL 7');
  expect(output).toContain('#RANK 2');
  expect(output).toContain('#TOTAL 320');
  expect(output).toContain('#DIFFICULTY 4');
  expect(output).toContain('#COMMENT Comment');
  expect(output).toContain('#STAGEFILE stage.png');

  expect(output.indexOf('#AAA first')).toBeGreaterThan(-1);
  expect(output.indexOf('#ZZZ last')).toBeGreaterThan(output.indexOf('#AAA first'));
  expect(output).not.toContain('#ARGB0A filtered-argb');
  expect(output).not.toContain('#CHANGEOPTION01 filtered-change');
  expect(output).not.toContain('#SWBGA01 filtered-swbga');

  expect(output.indexOf('#CHANGEOPTION0A RANDOM')).toBeLessThan(output.indexOf('#CHANGEOPTION0B MIRROR'));
  expect(output.indexOf('#EXRANK0A 100,80,50,20')).toBeLessThan(output.indexOf('#EXRANK0B 120,90,60,30'));
  expect(output.indexOf('#EXWAV0A a.wav')).toBeLessThan(output.indexOf('#EXWAV0B b.wav'));
  expect(output.indexOf('#EXBMP0A a.bmp')).toBeLessThan(output.indexOf('#EXBMP0B b.bmp'));
  expect(output.indexOf('#SWBGA0A 0A')).toBeLessThan(output.indexOf('#SWBGA0B 0B'));
  expect(output.indexOf('#BPM0A 150')).toBeLessThan(output.indexOf('#BPM0B 180'));
  expect(output.indexOf('#STOP0A 32')).toBeLessThan(output.indexOf('#STOP0B 64'));

  expect(output.indexOf('#00102:1.5')).toBeLessThan(output.indexOf('#00202:0.75'));
  expect(output).not.toContain('#00302:1');
  expect(output.indexOf('#00011:01')).toBeLessThan(output.indexOf('#00013:01'));
});

test('BMS stringify: writes string PLAYLEVEL values as-is', () => {
  const json = createEmptyJson('bms');
  json.metadata.title = 'String Level';
  json.metadata.artist = 'Codex';
  json.metadata.playLevel = '安心';

  const output = stringifyBms(json);

  expect(output).toContain('#PLAYLEVEL 安心');
});

test('BMS stringify: writes #RANK 4 without normalization', () => {
  const json = createEmptyJson('bms');
  json.metadata.title = 'Rank 4';
  json.metadata.bpm = 130;
  json.metadata.rank = 4;
  json.events = [{ measure: 0, channel: '11', position: [0, 1], value: '01' }];

  const output = stringifyBms(json);

  expect(output).toContain('#RANK 4');
});

test('BMS stringify: writes #DEFEXRANK decimals without normalization', () => {
  const json = createEmptyJson('bms');
  json.metadata.title = 'DefExRank';
  json.metadata.bpm = 130;
  json.bms.defExRank = 199.97;
  json.events = [{ measure: 0, channel: '11', position: [0, 1], value: '01' }];

  const output = stringifyBms(json);

  expect(output).toContain('#DEFEXRANK 199.97');
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
    { measure: 0, channel: '02', position: [0, 1], value: '01' },
    { measure: 0, channel: '03', position: [0, 1], value: '78' },
    { measure: 0, channel: '08', position: [1, 2], value: 'AA' },
    { measure: 0, channel: '09', position: [3, 4], value: 'AB' },
    { measure: 0, channel: 'AA', position: [0, 1], value: 'FF' },
  ];
  json.bmson.lines = [960, 960];
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

test('stringifier: stringifyBms/stringifyBmson handle equivalent chart content', () => {
  const demo = createEmptyJson('json');
  demo.metadata.title = 'Demo Chart';
  demo.metadata.artist = 'unknown';
  demo.resources.wav['01'] = 'kick.wav';
  demo.events = [
    { measure: 0, channel: '11', position: [0, 1], value: '01' },
    { measure: 0, channel: '11', position: [1, 2], value: '01' },
    { measure: 1, channel: '11', position: [0, 1], value: '01' },
    { measure: 1, channel: '11', position: [1, 2], value: '01' },
  ];

  const bms = stringifyBms(demo);
  const bmson = stringifyBmson(demo);
  expect(bms).toContain('#TITLE Demo Chart');
  expect(bmson).toContain('"sound_channels"');
});
});
