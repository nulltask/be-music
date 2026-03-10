import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { BMS_JSON_FORMAT } from '../../json/src/index.ts';
import { parseBmson, parseChart, parseChartFile, resolveBmsControlFlow } from './index.ts';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const unifiedBmsChartPath = resolve(rootDir, 'examples/test/four-measure-command-combo-test.bms');
describe('parser', () => {


test('BMS: parses measure length, BPM, STOP, and BGA channels', async () => {
  const json = await parseChartFile(unifiedBmsChartPath);

  expect(json.sourceFormat).toBe('bms');
  expect(json.metadata.title).toBe('Four-Measure Command Combo Test');
  expect(json.resources.bpm['01']).toBe(96);
  expect(json.resources.stop['01']).toBe(48);
  expect(json.measures).toContainEqual({ index: 4, length: 0.75 });
  expect(json.events.some((event) => event.channel === '04' && event.value === '01')).toBe(true);
  expect(json.events.some((event) => event.channel === '07' && event.value === '02')).toBe(true);
  expect(json.events.some((event) => event.channel === '0A' && event.value === '01')).toBe(true);
  expect(json.events.some((event) => event.channel === 'SC' && event.value === '01')).toBe(true);
  expect(json.events.some((event) => event.channel === '11' && event.value === '01')).toBe(true);
});

test('BMS: auto-detects and reads Shift_JIS files', async () => {
  const chartPath = resolve(rootDir, 'examples/test/sjis-encoding-test.bms');
  const json = await parseChartFile(chartPath);

  expect(json.metadata.title).toBe('テスト曲');
  expect(json.metadata.artist).toBe('佐藤');
});

test('BMS: uses 130 BPM when #BPM is omitted', () => {
  const parsed = parseChart(
    [
      '#TITLE No BPM',
      '#00111:01',
      '',
    ].join('\n'),
  );
  expect(parsed.sourceFormat).toBe('bms');
  expect(parsed.metadata.bpm).toBe(130);
});

test('BMS: keeps declared #BPM even when it is 120', () => {
  const parsed = parseChart(
    [
      '#TITLE Explicit BPM',
      '#BPM 120',
      '#00111:01',
      '',
    ].join('\n'),
  );
  expect(parsed.sourceFormat).toBe('bms');
  expect(parsed.metadata.bpm).toBe(120);
});

test('BMS: accepts CR-only line endings', () => {
  const parsed = parseChart('#TITLE CR Only\r#BPM 150\r#00111:01\r');

  expect(parsed.sourceFormat).toBe('bms');
  expect(parsed.metadata.title).toBe('CR Only');
  expect(parsed.metadata.bpm).toBe(150);
  expect(parsed.events).toContainEqual({
    measure: 1,
    channel: '11',
    position: [0, 1],
    value: '01',
  });
});

test('BMS: parses #RANK 4 as metadata rank 4', () => {
  const parsed = parseChart(
    [
      '#TITLE Rank 4',
      '#RANK 4',
      '#00111:01',
      '',
    ].join('\n'),
  );

  expect(parsed.sourceFormat).toBe('bms');
  expect(parsed.metadata.rank).toBe(4);
});

test('BMS: parses #STAGEFILE into metadata.stageFile', () => {
  const parsed = parseChart(
    [
      '#TITLE StageFile',
      '#STAGEFILE loading.png',
      '#00111:01',
      '',
    ].join('\n'),
  );

  expect(parsed.sourceFormat).toBe('bms');
  expect(parsed.metadata.stageFile).toBe('loading.png');
});

test('BMS: keeps the last #DEFEXRANK with decimals', () => {
  const parsed = parseChart(
    [
      '#TITLE DefExRank',
      '#DEFEXRANK 120',
      '#DEFEXRANK 199.97',
      '#00111:01',
      '',
    ].join('\n'),
  );

  expect(parsed.sourceFormat).toBe('bms');
  expect(parsed.bms.defExRank).toBe(199.97);
});

test('BMS: keeps 130 fallback unless a control-flow branch applies #BPM', () => {
  const parsed = parseChart(
    [
      '#RANDOM 2',
      '#IF 1',
      '#BPM 150',
      '#ENDIF',
      '#ENDRANDOM',
      '#00111:01',
      '',
    ].join('\n'),
  );
  expect(parsed.metadata.bpm).toBe(130);

  const resolvedWhenBranchIsActive = resolveBmsControlFlow(parsed, { random: () => 0 });
  expect(resolvedWhenBranchIsActive.metadata.bpm).toBe(150);

  const resolvedWhenBranchIsInactive = resolveBmsControlFlow(parsed, { random: () => 0.9999999 });
  expect(resolvedWhenBranchIsInactive.metadata.bpm).toBe(130);
});

test('BMS: parses extension headers into dedicated fields', async () => {
  const json = await parseChartFile(unifiedBmsChartPath);

  expect(json.bms.preview).toBe('sample.wav');
  expect(json.bms.player).toBe(3);
  expect(json.bms.pathWav).toBe('./');
  expect(json.bms.baseBpm).toBe(128);
  expect(json.bms.stp).toEqual(['008.192']);
  expect(json.bms.option).toBe('RANDOM');
  expect(json.bms.changeOption['01']).toBe('MIRROR');
  expect(json.bms.changeOption['02']).toBe('RANDOM');
  expect(json.bms.wavCmd).toBe('legacy');
  expect(json.bms.lnType).toBe(1);
  expect(json.bms.lnMode).toBe(1);
  expect(json.bms.lnObjs).toEqual(['AA', 'AB']);
  expect(json.bms.volWav).toBe(90);
  expect(json.bms.defExRank).toBe(120);
  expect(json.bms.exRank['01']).toBe('120,90,60,30');
  expect(json.bms.argb['01']).toBe('FF000000');
  expect(json.bms.exWav['01']).toBe('ex_sample.wav');
  expect(json.bms.exBmp['01']).toBe('ex_image.bmp');
  expect(json.bms.bga['01']).toBe('01');
  expect(json.bms.scroll['01']).toBe(0.5);
  expect(json.bms.scroll['02']).toBe(1);
  expect(json.bms.scroll['03']).toBe(1.5);
  expect(json.bms.poorBga).toBe('03');
  expect(json.bms.swBga['01']).toBe('02');
  expect(json.bms.videoFile).toBe('demo.mp4');
  expect(json.bms.midiFile).toBe('demo.mid');
  expect(json.bms.materials).toBe('demo.materials');
  expect(json.bms.divideProp).toBe('lane=2');
  expect(json.bms.charset).toBe('UTF-8');
  expect(json.events.some((event) => event.channel === 'SC' && event.value === '01')).toBe(true);

  expect(json.metadata.extras.PREVIEW).toBeUndefined();
  expect(json.metadata.extras.PLAYER).toBeUndefined();
  expect(json.metadata.extras.PATH_WAV).toBeUndefined();
  expect(json.metadata.extras.BASEBPM).toBeUndefined();
  expect(json.metadata.extras.STP).toBeUndefined();
  expect(json.metadata.extras.OPTION).toBeUndefined();
  expect(json.metadata.extras.CHANGEOPTION01).toBeUndefined();
  expect(json.metadata.extras.CHANGEOPTION02).toBeUndefined();
  expect(json.metadata.extras.WAVCMD).toBeUndefined();
  expect(json.metadata.extras.LNTYPE).toBeUndefined();
  expect(json.metadata.extras.LNMODE).toBeUndefined();
  expect(json.metadata.extras.LNOBJ).toBeUndefined();
  expect(json.metadata.extras.VOLWAV).toBeUndefined();
  expect(json.metadata.extras.DEFEXRANK).toBeUndefined();
  expect(json.metadata.extras.EXRANK01).toBeUndefined();
  expect(json.metadata.extras.ARGB01).toBeUndefined();
  expect(json.metadata.extras.EXWAV01).toBeUndefined();
  expect(json.metadata.extras.EXBMP01).toBeUndefined();
  expect(json.metadata.extras.BGA01).toBeUndefined();
  expect(json.metadata.extras.SCROLL01).toBeUndefined();
  expect(json.metadata.extras.SCROLL02).toBeUndefined();
  expect(json.metadata.extras.SCROLL03).toBeUndefined();
  expect(json.metadata.extras.POORBGA).toBeUndefined();
  expect(json.metadata.extras.SWBGA01).toBeUndefined();
  expect(json.metadata.extras.VIDEOFILE).toBeUndefined();
  expect(json.metadata.extras.MIDIFILE).toBeUndefined();
  expect(json.metadata.extras.MATERIALS).toBeUndefined();
  expect(json.metadata.extras.DIVIDEPROP).toBeUndefined();
  expect(json.metadata.extras.CHARSET).toBeUndefined();
});

test('BMS: keeps all LNOBJ declarations in declaration order', () => {
  const parsed = parseChart(
    [
      '#LNOBJ AA',
      '#LNOBJ BB',
      '#00111:01',
      '',
    ].join('\n'),
  );

  expect(parsed.bms.lnObjs).toEqual(['AA', 'BB']);
  expect(parsed.metadata.extras.LNOBJ).toBeUndefined();
});

test('BMS: prefers EOF-side definitions for duplicate headers, indexed headers, and measure lengths', () => {
  const parsed = parseChart(
    [
      '#TITLE First Title',
      '#TITLE Final Title',
      '#BPM 120',
      '#BPM 150',
      '#WAV01 first.wav',
      '#WAV01 second.wav',
      '#SCROLL01 0.5',
      '#SCROLL01 -1',
      '#00102:1.5',
      '#00102:0.75',
      '#00111:01',
      '',
    ].join('\n'),
  );

  expect(parsed.metadata.title).toBe('Final Title');
  expect(parsed.metadata.bpm).toBe(150);
  expect(parsed.resources.wav['01']).toBe('second.wav');
  expect(parsed.bms.scroll['01']).toBe(-1);
  expect(parsed.measures).toContainEqual({ index: 1, length: 0.75 });
});

test('BMS: preserves repeated STP, LNOBJ, and control-flow entries instead of collapsing them', () => {
  const parsed = parseChart(
    [
      '#STP 001.192',
      '#STP 002.096',
      '#LNOBJ AA',
      '#LNOBJ BB',
      '#RANDOM 2',
      '#IF 1',
      '#TITLE Branch Title',
      '#ENDIF',
      '#ENDRANDOM',
      '#00111:01',
      '',
    ].join('\n'),
  );

  expect(parsed.bms.stp).toEqual(['001.192', '002.096']);
  expect(parsed.bms.lnObjs).toEqual(['AA', 'BB']);
  expect(parsed.metadata.title).toBeUndefined();
  expect(parsed.bms.controlFlow).toEqual([
    { kind: 'directive', command: 'RANDOM', value: '2' },
    { kind: 'directive', command: 'IF', value: '1' },
    { kind: 'header', command: 'TITLE', value: 'Branch Title' },
    { kind: 'directive', command: 'ENDIF', value: undefined },
    { kind: 'directive', command: 'ENDRANDOM', value: undefined },
  ]);
});

test('BMS: preserves non-control-flow object line boundaries for roundtrip', () => {
  const parsed = parseChart(
    [
      '#TITLE First',
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

  expect(parsed.bms.sourceLines.map((line) => line.kind)).toEqual([
    'header',
    'object',
    'object',
    'object',
    'object',
    'object',
    'object',
    'object',
    'object',
    'object',
  ]);
  expect(parsed.bms.objectLines.map((line) => `${line.measure}:${line.channel}:${line.events.length}:${line.measureLength ?? '-'}`)).toEqual([
    '1:13:4:-',
    '1:13:6:-',
    '1:13:1:-',
    '1:01:1:-',
    '1:01:1:-',
    '1:A6:1:-',
    '1:A6:1:-',
    '1:02:0:1.5',
    '1:02:0:0.75',
  ]);
});

test('BMS: parses RANDOM/IF/SWITCH control flow directives', async () => {
  const parsed = await parseChartFile(unifiedBmsChartPath);

  expect(parsed.resources.wav['02']).toBe('branch.wav');
  expect(parsed.bms.controlFlow.length).toBeGreaterThan(0);
  expect(parsed.events.some((event) => event.measure === 20 && event.channel === '12')).toBe(false);
  expect(parsed.events.some((event) => event.measure === 21 && event.channel === '16')).toBe(false);
  expect(parsed.events.some((event) => event.measure === 23 && event.channel === '22')).toBe(false);

  const resolvedWhenRandomIs1 = resolveBmsControlFlow(parsed, { random: () => 0 });
  expect(resolvedWhenRandomIs1.resources.wav['02']).toBe('right.wav');
  expect(resolvedWhenRandomIs1.events.some((event) => event.measure === 20 && event.channel === '12')).toBe(true);
  expect(resolvedWhenRandomIs1.events.some((event) => event.measure === 22 && event.channel === '11')).toBe(false);
  expect(resolvedWhenRandomIs1.events.some((event) => event.measure === 22 && event.channel === '12')).toBe(true);
  expect(resolvedWhenRandomIs1.events.some((event) => event.measure === 22 && event.channel === '13')).toBe(false);
  expect(resolvedWhenRandomIs1.events.some((event) => event.measure === 21 && event.channel === '16')).toBe(true);
  expect(resolvedWhenRandomIs1.events.some((event) => event.measure === 22 && event.channel === '14')).toBe(false);
  expect(resolvedWhenRandomIs1.events.some((event) => event.measure === 22 && event.channel === '15')).toBe(false);
  expect(resolvedWhenRandomIs1.events.some((event) => event.measure === 22 && event.channel === '18')).toBe(false);
  expect(resolvedWhenRandomIs1.events.some((event) => event.measure === 23 && event.channel === '21')).toBe(false);
  expect(resolvedWhenRandomIs1.events.some((event) => event.measure === 23 && event.channel === '22')).toBe(true);
  expect(resolvedWhenRandomIs1.events.some((event) => event.measure === 23 && event.channel === '23')).toBe(true);
  expect(resolvedWhenRandomIs1.events.some((event) => event.measure === 23 && event.channel === '24')).toBe(false);

  const resolvedWhenRandomIs2 = resolveBmsControlFlow(parsed, { random: () => 0.9999999 });
  expect(resolvedWhenRandomIs2.events.some((event) => event.measure === 23 && event.channel === '23')).toBe(false);
  expect(resolvedWhenRandomIs2.events.some((event) => event.measure === 23 && event.channel === '24')).toBe(true);

  expect(parsed.metadata.extras.RANDOM).toBeUndefined();
  expect(parsed.metadata.extras.SWITCH).toBeUndefined();
  expect(parsed.metadata.extras.SETRANDOM).toBeUndefined();
  expect(parsed.metadata.extras.SETSWITCH).toBeUndefined();
});

test('bmson: maps version/lines/info.resolution into IR', async () => {
  const chartPath = resolve(rootDir, 'examples/test/bmson-lines-resolution-test.bmson');
  const input = await readFile(chartPath, 'utf8');
  const json = parseBmson(input);

  expect(json.sourceFormat).toBe('bmson');
  expect(json.bmson.version).toBe('1.0.0');
  expect(json.bmson.info.resolution).toBe(240);
  expect(json.bmson.lines).toEqual([0, 960, 1680, 2640]);
  expect(json.bmson.soundChannels.map((channel) => channel.name)).toEqual(['sample.wav']);
  expect(json.bmson.bpmEvents.map((event) => event.bpm)).toEqual([180]);
  expect(json.bmson.stopEvents.map((event) => event.duration)).toEqual([96]);
  expect(json.measures).toEqual([{ index: 1, length: 0.75 }]);

  expect(
    json.events.some(
      (event) =>
        event.channel === '11' && event.measure === 1 && event.position[0] === 240 && event.position[1] === 720,
    ),
  ).toBe(true);
  expect(
    json.events.some(
      (event) => event.channel === '08' && event.measure === 1 && event.position[0] === 0 && event.position[1] === 720,
    ),
  ).toBe(true);
});

test('bmson: preserves bga/info extensions and notes.l/c in IR', async () => {
  const chartPath = resolve(rootDir, 'examples/test/bmson-strict-features.bmson');
  const input = await readFile(chartPath, 'utf8');
  const json = parseBmson(input);

  expect(json.bmson.info.subartists).toEqual(['Alice', 'Bob']);
  expect(json.bmson.info.chartName).toBe('HYPER');
  expect(json.bmson.info.modeHint).toBe('beat-7k');
  expect(json.bmson.info.judgeRank).toBe(125);
  expect(json.bmson.info.total).toBe(340);
  expect(json.bmson.info.backImage).toBe('back.png');
  expect(json.bmson.info.eyecatchImage).toBe('eye.png');
  expect(json.bmson.info.bannerImage).toBe('banner.png');
  expect(json.bmson.info.previewMusic).toBe('preview.ogg');
  expect(json.metadata.rank).toBe(125);
  expect(json.metadata.total).toBe(340);

  expect(json.bmson.bga.header).toEqual([
    { id: 1, name: 'base.png' },
    { id: 2, name: 'layer.png' },
    { id: 3, name: 'poor.png' },
  ]);
  expect(json.bmson.bga.events).toEqual([{ y: 0, id: 1 }]);
  expect(json.bmson.bga.layerEvents).toEqual([{ y: 480, id: 2 }]);
  expect(json.bmson.bga.poorEvents).toEqual([{ y: 960, id: 3 }]);

  const longNote = json.events.find((event) => event.value === '01' && event.position[0] === 0);
  expect(longNote?.bmson?.l).toBe(120);
  expect(longNote?.bmson?.c).toBe(true);
  const normalNote = json.events.find((event) => event.value === '01' && event.position[0] > 0);
  expect(normalNote?.bmson?.l).toBe(0);
  expect(normalNote?.bmson?.c).toBe(false);
});

test('bmson: treats x=0/null notes as BGM(01) and prioritizes playable notes on same tick', () => {
  const json = parseBmson(
    JSON.stringify({
      version: '1.0.0',
      info: {
        init_bpm: 120,
        resolution: 240,
      },
      sound_channels: [
        {
          name: 'sample.wav',
          notes: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { y: 240 }, { x: 1, y: 480 }],
        },
      ],
    }),
  );

  const bgmNotes = json.events.filter((event) => event.channel === '01');
  const playableNotes = json.events.filter((event) => event.channel === '11');

  expect(bgmNotes).toHaveLength(1);
  expect(playableNotes).toHaveLength(2);
  expect(bgmNotes[0].position).toEqual([240, 960]);
  expect(playableNotes.some((event) => event.position[0] === 0)).toBe(true);
  expect(playableNotes.some((event) => event.position[0] === 480)).toBe(true);
});

test('JSON: normalizes bms/bmson extensions, ignores deprecated bms.lnObj, and rejects invalid positions', () => {
  const parsed = parseChart(
    JSON.stringify({
      format: BMS_JSON_FORMAT,
      sourceFormat: 'json',
      metadata: { bpm: 120, extras: {} },
      resources: { wav: {}, bmp: {}, bpm: {}, stop: {}, text: {} },
      measures: [],
      events: [],
      bms: {
        preview: 'preview.ogg',
        lnType: '2',
        lnMode: '1',
        lnObj: 'yy',
        lnObjs: ['zz'],
        volWav: '90',
        defExRank: '100.5',
        player: '2',
        pathWav: 'sounds/',
        baseBpm: '145.5',
        stp: ['001.240', 120, '002.120'],
        option: 'HS',
        changeOption: {
          1: 'MIRROR',
        },
        wavCmd: 'legacy',
        exRank: {
          1: 120,
          ab: '70,55,40,25',
        },
        argb: {
          a: 'FF000000',
        },
        exWav: {
          1: 'extended.wav',
        },
        exBmp: {
          2: 'extended.bmp',
        },
        bga: {
          3: '01',
        },
        scroll: {
          1: '0.5',
        },
        poorBga: '02',
        swBga: {
          4: '03',
        },
        videoFile: 'movie.mp4',
        midiFile: 'song.mid',
        materials: 'materials.def',
        divideProp: 'lane=2',
        charset: 'Shift_JIS',
        sourceLines: [
          { kind: 'header', command: 'title', value: 'Roundtrip' },
          {
            kind: 'object',
            measure: 1,
            channel: '1a',
            events: [{ measure: 1, channel: '1a', position: [0, 2], value: '01' }],
          },
        ],
        controlFlow: [
          { kind: 'directive', command: 'random', value: 2 },
          {
            kind: 'object',
            measure: 1,
            channel: '1a',
            events: [{ measure: 1, channel: '1a', position: [0, 2], value: '01' }],
          },
        ],
      },
      bmson: {
        version: '1.0.1',
        lines: [960, { y: 0 }, -100, { y: 1680 }],
        info: { resolution: 480 },
        bpm_events: [{ y: 240.4, bpm: 150 }],
        stop_events: [{ y: 960.2, duration: 48 }],
        sound_channels: [
          {
            name: 'sample.wav',
            notes: [{ x: 1.9, y: 0.2, l: 240.8, c: true }],
          },
        ],
      },
    }),
    'json',
  );

  expect(parsed.bmson.version).toBe('1.0.1');
  expect(parsed.bmson.info.resolution).toBe(480);
  expect(parsed.bmson.lines).toEqual([0, 960, 1680]);
  expect(parsed.bms.preview).toBe('preview.ogg');
  expect(parsed.bms.lnType).toBe(2);
  expect(parsed.bms.lnMode).toBe(1);
  expect(parsed.bms.lnObjs).toEqual(['ZZ']);
  expect(parsed.bms.lnObjs).not.toContain('YY');
  expect(parsed.bms.volWav).toBe(90);
  expect(parsed.bms.defExRank).toBe(100.5);
  expect(parsed.bms.player).toBe(2);
  expect(parsed.bms.pathWav).toBe('sounds/');
  expect(parsed.bms.baseBpm).toBe(145.5);
  expect(parsed.bms.stp).toEqual(['001.240', '002.120']);
  expect(parsed.bms.option).toBe('HS');
  expect(parsed.bms.changeOption['01']).toBe('MIRROR');
  expect(parsed.bms.wavCmd).toBe('legacy');
  expect(parsed.bms.exRank['01']).toBe('120');
  expect(parsed.bms.exRank.AB).toBe('70,55,40,25');
  expect(parsed.bms.argb['0A']).toBe('FF000000');
  expect(parsed.bms.exWav['01']).toBe('extended.wav');
  expect(parsed.bms.exBmp['02']).toBe('extended.bmp');
  expect(parsed.bms.bga['03']).toBe('01');
  expect(parsed.bms.scroll['01']).toBe(0.5);
  expect(parsed.bms.poorBga).toBe('02');
  expect(parsed.bms.swBga['04']).toBe('03');
  expect(parsed.bms.videoFile).toBe('movie.mp4');
  expect(parsed.bms.midiFile).toBe('song.mid');
  expect(parsed.bms.materials).toBe('materials.def');
  expect(parsed.bms.divideProp).toBe('lane=2');
  expect(parsed.bms.charset).toBe('Shift_JIS');
  expect(parsed.bms.sourceLines).toEqual([
    { kind: 'header', command: 'TITLE', value: 'Roundtrip' },
    {
      kind: 'object',
      measure: 1,
      channel: '1A',
      events: [{ measure: 1, channel: '1A', position: [0, 2], value: '01' }],
      measureLength: undefined,
    },
  ]);
  expect(parsed.bms.controlFlow).toEqual([
    { kind: 'directive', command: 'RANDOM', value: '2' },
    {
      kind: 'object',
      measure: 1,
      channel: '1A',
      events: [{ measure: 1, channel: '1A', position: [0, 2], value: '01' }],
      measureLength: undefined,
    },
  ]);
  expect(parsed.bmson.bpmEvents).toEqual([{ y: 240, bpm: 150 }]);
  expect(parsed.bmson.stopEvents).toEqual([{ y: 960, duration: 48 }]);
  expect(parsed.bmson.soundChannels).toEqual([
    {
      name: 'sample.wav',
      notes: [{ x: 1, y: 0, l: 240, c: true }],
    },
  ]);

  expect(() =>
    parseChart(
      JSON.stringify({
        format: BMS_JSON_FORMAT,
        sourceFormat: 'json',
        metadata: { bpm: 120, extras: {} },
        resources: { wav: {}, bmp: {}, bpm: {}, stop: {}, text: {} },
        measures: [],
        events: [{ measure: 0, channel: '11', value: '01' }],
      }),
      'json',
    ),
  ).toThrow(/position \[numerator, denominator\] is required/);
});

test('JSON: migrates legacy metadata.extras extension headers to bms extensions', () => {
  const parsed = parseChart(
    JSON.stringify({
      format: BMS_JSON_FORMAT,
      sourceFormat: 'json',
      metadata: {
        bpm: 120,
        extras: {
          PREVIEW: 'preview.ogg',
          LNTYPE: '1',
          LNMODE: '2',
          LNOBJ: 'zz',
          VOLWAV: '70',
          DEFEXRANK: '120',
          PLAYER: '1',
          PATH_WAV: 'sounds/',
          BASEBPM: '150',
          STP: '001.240',
          OPTION: 'HS',
          CHANGEOPTION01: 'MIRROR',
          WAVCMD: 'legacy',
          EXRANK01: '100,80,60,40',
          ARGB0A: 'FF000000',
          EXWAV01: 'extended.wav',
          EXBMP0A: 'extended.bmp',
          BGA01: '01',
          SCROLL01: '1.25',
          POORBGA: '02',
          SWBGA01: '03',
          VIDEOFILE: 'movie.mp4',
          MIDIFILE: 'song.mid',
          MATERIALS: 'materials.def',
          DIVIDEPROP: 'lane=2',
          CHARSET: 'Shift_JIS',
          CUSTOM: 'ok',
        },
      },
      resources: { wav: {}, bmp: {}, bpm: {}, stop: {}, text: {} },
      measures: [],
      events: [],
      bms: {
        controlFlow: [],
      },
      bmson: {
        lines: [],
        info: {},
      },
    }),
    'json',
  );

  expect(parsed.bms.preview).toBe('preview.ogg');
  expect(parsed.bms.lnType).toBe(1);
  expect(parsed.bms.lnMode).toBe(2);
  expect(parsed.bms.lnObjs).toEqual(['ZZ']);
  expect(parsed.bms.volWav).toBe(70);
  expect(parsed.bms.defExRank).toBe(120);
  expect(parsed.bms.player).toBe(1);
  expect(parsed.bms.pathWav).toBe('sounds/');
  expect(parsed.bms.baseBpm).toBe(150);
  expect(parsed.bms.stp).toEqual(['001.240']);
  expect(parsed.bms.option).toBe('HS');
  expect(parsed.bms.changeOption['01']).toBe('MIRROR');
  expect(parsed.bms.wavCmd).toBe('legacy');
  expect(parsed.bms.exRank['01']).toBe('100,80,60,40');
  expect(parsed.bms.argb['0A']).toBe('FF000000');
  expect(parsed.bms.exWav['01']).toBe('extended.wav');
  expect(parsed.bms.exBmp['0A']).toBe('extended.bmp');
  expect(parsed.bms.bga['01']).toBe('01');
  expect(parsed.bms.scroll['01']).toBe(1.25);
  expect(parsed.bms.poorBga).toBe('02');
  expect(parsed.bms.swBga['01']).toBe('03');
  expect(parsed.bms.videoFile).toBe('movie.mp4');
  expect(parsed.bms.midiFile).toBe('song.mid');
  expect(parsed.bms.materials).toBe('materials.def');
  expect(parsed.bms.divideProp).toBe('lane=2');
  expect(parsed.bms.charset).toBe('Shift_JIS');
  expect(parsed.metadata.extras.CUSTOM).toBe('ok');
  expect(parsed.metadata.extras.MIDIFILE).toBeUndefined();
  expect(parsed.metadata.extras.LNTYPE).toBeUndefined();
});

test('JSON: normalizes and imports bmson extensions (info/bga/notes.l/c)', () => {
  const parsed = parseChart(
    JSON.stringify({
      format: BMS_JSON_FORMAT,
      sourceFormat: 'json',
      metadata: { bpm: 120, extras: {} },
      resources: { wav: {}, bmp: {}, bpm: {}, stop: {}, text: {} },
      measures: [],
      events: [{ measure: 0, channel: '11', position: [0, 1], value: '01', bmson: { l: 240.8, c: true } }],
      bms: {
        controlFlow: [],
        exRank: {},
        argb: {},
      },
      bmson: {
        version: '1.0.0',
        lines: [0, 960],
        info: {
          resolution: 240.5,
          chart_name: 'NORMAL',
          mode_hint: 'beat-5k',
          judge_rank: 110,
          total: 320,
          back_image: 'back.png',
          eyecatch_image: 'eye.png',
          banner_image: 'banner.png',
          preview_music: 'preview.ogg',
          subartists: ['Sub'],
        },
        bga: {
          bga_header: [{ id: 1.8, name: 'base.png' }],
          bga_events: [{ y: 0.4, id: 1.1 }],
          layer_events: [{ y: 240.9, id: 2.2 }],
          poor_events: [{ y: 480.2, id: 3.3 }],
        },
      },
    }),
    'json',
  );

  expect(parsed.events[0].bmson).toEqual({ l: 240, c: true });
  expect(parsed.bmson.info.resolution).toBe(240);
  expect(parsed.bmson.info.chartName).toBe('NORMAL');
  expect(parsed.bmson.info.modeHint).toBe('beat-5k');
  expect(parsed.bmson.info.judgeRank).toBe(110);
  expect(parsed.bmson.info.total).toBe(320);
  expect(parsed.bmson.info.backImage).toBe('back.png');
  expect(parsed.bmson.info.eyecatchImage).toBe('eye.png');
  expect(parsed.bmson.info.bannerImage).toBe('banner.png');
  expect(parsed.bmson.info.previewMusic).toBe('preview.ogg');
  expect(parsed.bmson.info.subartists).toEqual(['Sub']);
  expect(parsed.bmson.bga.header).toEqual([{ id: 1, name: 'base.png' }]);
  expect(parsed.bmson.bga.events).toEqual([{ y: 0, id: 1 }]);
  expect(parsed.bmson.bga.layerEvents).toEqual([{ y: 240, id: 2 }]);
  expect(parsed.bmson.bga.poorEvents).toEqual([{ y: 480, id: 3 }]);
});
});
