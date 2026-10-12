import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vite-plus/test';
import { createEmptyJson } from '../../json/src/index.ts';
import { parseBmson, parseChart, parseChartFile } from '../../parser/src/index.ts';
import { resolveRuleset, rulesetChartFactsFromChart, type JudgeWindowSetUs } from '../../player/src/ruleset/index.ts';
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
    const parsed = parseChart(['#00113:11', '#00113:22', ''].join('\n'));
    parsed.events.push({ measure: 1, channel: '13', position: [1, 2], value: '33' });

    const output = stringifyBms(parsed);
    const objectLines = output.split('\n').filter((line) => line.startsWith('#00113:'));

    expect(objectLines).toEqual(['#00113:2233']);
  });

  test('BMS stringify: falls back to canonical sections when parsed sourceLines no longer match', () => {
    const parsed = parseChart(['#TITLE Original', '#00111:11', ''].join('\n'));
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
    json.preservation.bmson.lines = [960, 960];
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
        judge_rank?: number;
        total?: number;
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
    });
    // `metadata.rank` of a non-bmson chart is a BMS `#RANK` index (0..4); 75 is out of range, which judges as NORMAL, so
    // `judge_rank` is left out and the bmson default (100 = NORMAL) applies.
    expect(document.info).not.toHaveProperty('judge_rank');
    // `metadata.total` of a non-bmson chart is an absolute gauge TOTAL, not bmson's percentage, so it is not written.
    expect(document.info).not.toHaveProperty('total');
    expect(document.info.subartists).toEqual(['A', 'B', '']);
    expect(document.bpm_events.map((event) => event.bpm)).toEqual([120, 180]);
    // 96 STOP units = 2 beats = 960 pulses at resolution 480.
    expect(document.stop_events[0].duration).toBe(960);
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

  test('BMS stringify: round-trips `#BASE 62` and preserves lowercase IDs in headers + channel data', () => {
    const input = ['#BASE 62', '#WAV0a lower.wav', '#WAV0A upper.wav', '#00111:0a0AZz', ''].join('\n');
    const parsed = parseChart(input);
    expect(parsed.bms.base).toBe(62);

    // Re-parsing the stringified output must yield an equivalent chart. We assert at the JSON level (not raw line text)
    // because the stringifier may reorder or rewrap lines — what matters is that the case-sensitive base-62 IDs survive
    // intact.
    const output = stringifyBms(parsed);
    expect(output).toContain('#BASE 62');

    const reparsed = parseChart(output);
    expect(reparsed.bms.base).toBe(62);
    expect(reparsed.resources.wav['0a']).toBe('lower.wav');
    expect(reparsed.resources.wav['0A']).toBe('upper.wav');
    expect(reparsed.events).toEqual([
      { measure: 1, channel: '11', position: [0, 3], value: '0a' },
      { measure: 1, channel: '11', position: [1, 3], value: '0A' },
      { measure: 1, channel: '11', position: [2, 3], value: 'Zz' },
    ]);
  });

  test('BMS stringify: writes every `#WAVCMD` line once the header no longer matches its source', () => {
    const parsed = parseChart(['#TITLE Before', '#WAVCMD 00 01 48', '#WAVCMD 01 02 50', '#00111:01', ''].join('\n'));
    parsed.metadata.title = 'After';

    const output = stringifyBms(parsed);

    expect(output).toContain('#TITLE After');
    expect(output.split('\n').filter((line) => line.startsWith('#WAVCMD'))).toEqual([
      '#WAVCMD 00 01 48',
      '#WAVCMD 01 02 50',
    ]);
    expect(parseChart(output).bms.wavCmds).toEqual(['00 01 48', '01 02 50']);
  });

  test('BMS stringify: falls back to the legacy `wavCmd` when `wavCmds` is empty', () => {
    const json = createEmptyJson('bms');
    json.bms.wavCmd = '00 01 48';

    expect(
      stringifyBms(json)
        .split('\n')
        .filter((line) => line.startsWith('#WAVCMD')),
    ).toEqual(['#WAVCMD 00 01 48']);
  });

  test('bmson stringify: writes mines to `mine_channels` with their damage and hidden notes to `key_channels`', () => {
    const source = parseBmson(
      JSON.stringify({
        version: '1.0.0',
        info: { title: 'Mines', init_bpm: 120, resolution: 240, mode_hint: 'beat-7k' },
        sound_channels: [{ name: 'key.wav', notes: [{ x: 1, y: 0, l: 0, c: false }] }],
        key_channels: [{ name: 'hidden.wav', notes: [{ x: 2, y: 240 }] }],
        mine_channels: [
          {
            name: 'mine.wav',
            notes: [
              { x: 2, y: 480, damage: 10 },
              { x: 1, y: 960 },
            ],
          },
        ],
      }),
    );
    const output = JSON.parse(stringifyBmson(source)) as {
      sound_channels: Array<{ name: string; notes: Array<{ x: number; y: number }> }>;
      key_channels?: Array<{ name: string; notes: Array<{ x: number; y: number }> }>;
      mine_channels?: Array<{ name: string; notes: Array<{ x: number; y: number; damage?: number }> }>;
    };

    expect(output.sound_channels.map((channel) => channel.name)).toEqual(['key.wav']);
    expect(output.sound_channels[0]!.notes).toEqual([expect.objectContaining({ x: 1, y: 0 })]);
    expect(output.key_channels).toEqual([{ name: 'hidden.wav', notes: [{ x: 2, y: 240 }] }]);
    expect(output.mine_channels).toEqual([
      {
        name: 'mine.wav',
        notes: [
          { x: 2, y: 480, damage: 10 },
          { x: 1, y: 960 },
        ],
      },
    ]);

    const reparsed = parseBmson(JSON.stringify(output));
    const extensionEvents = reparsed.events.filter((event) => /^[34DE]/i.test(event.channel));
    expect(extensionEvents.map((event) => [event.channel, event.bmson?.damage])).toEqual([
      ['32', undefined],
      ['D2', 10],
      ['D1', undefined],
    ]);
  });

  test('bmson stringify: keeps mines and hidden notes when the preserved document is trusted', () => {
    const source = parseBmson(
      JSON.stringify({
        version: '1.0.0',
        info: { title: 'Mines', init_bpm: 120, resolution: 240, mode_hint: 'beat-7k' },
        sound_channels: [{ name: 'key.wav', notes: [{ x: 1, y: 0, l: 0, c: false }] }],
        key_channels: [{ name: 'hidden.wav', notes: [{ x: 2, y: 240 }] }],
        mine_channels: [{ name: 'mine.wav', notes: [{ x: 3, y: 480, damage: 12 }] }],
      }),
    );
    const output = JSON.parse(stringifyBmson(source, { skipPreservationValidation: true })) as {
      key_channels?: unknown;
      mine_channels?: unknown;
    };

    expect(output.key_channels).toEqual([{ name: 'hidden.wav', notes: [{ x: 2, y: 240 }] }]);
    expect(output.mine_channels).toEqual([{ name: 'mine.wav', notes: [{ x: 3, y: 480, damage: 12 }] }]);
  });

  test('bmson stringify: BMS invisible objects become `key_channels` notes on their own lanes, not extra keys', () => {
    const json = parseChart(
      ['#BPM 120', '#WAV01 key.wav', '#WAV02 hidden.wav', '#00111:01', '#00131:0002', '#00143:02', ''].join('\n'),
    );
    const output = JSON.parse(stringifyBmson(json)) as {
      info: { mode_hint: string };
      sound_channels: Array<{ name: string; notes: Array<{ x: number; y: number }> }>;
      key_channels?: Array<{ name: string; notes: Array<{ x: number; y: number }> }>;
    };

    // Lanes 11 and 23 are numbered `x` 1 / 2; the hidden notes take those lanes instead of new ones.
    expect(output.info.mode_hint).toBe('beat-2k');
    expect(output.sound_channels).toEqual([{ name: 'key.wav', notes: [{ x: 1, y: 960, l: 0, c: false }] }]);
    expect(output.key_channels).toEqual([
      {
        name: 'hidden.wav',
        notes: [
          { x: 2, y: 960 },
          { x: 1, y: 1440 },
        ],
      },
    ]);
    expect(
      parseBmson(JSON.stringify(output))
        .events.filter((event) => /^[34]/.test(event.channel))
        .map((event) => event.channel),
    ).toEqual(['32', '31']);
  });

  test('bmson stringify: writes a 24 KEY chart as keyboard-24k with fixed x lanes, wheel included', () => {
    const json = createEmptyJson('bms');
    json.resources.wav['01'] = 'key.wav';
    json.events = ['11', '1A', '1O', '1P', '1Q', 'DQ'].map((channel, index) => ({
      measure: 0,
      channel,
      position: [index, 8] as const,
      value: '01',
    }));

    const output = JSON.parse(stringifyBmson(json)) as {
      info: { mode_hint: string };
      sound_channels: Array<{ notes: Array<{ x: number }> }>;
      mine_channels?: Array<{ notes: Array<{ x: number }> }>;
    };

    expect(output.info.mode_hint).toBe('keyboard-24k');
    expect(output.sound_channels[0]!.notes.map((note) => note.x)).toEqual([1, 10, 24, 25, 26]);
    expect(output.mine_channels?.[0]!.notes.map((note) => note.x)).toEqual([26]);
    expect(parseBmson(JSON.stringify(output)).events.map((event) => event.channel)).toEqual([
      '11',
      '1A',
      '1O',
      '1P',
      '1Q',
      'DQ',
    ]);
  });

  test('bmson stringify: round-trips a sparse keyboard-24k-double chart without compacting its lanes', () => {
    const source = parseBmson(
      JSON.stringify({
        version: '1.0.0',
        info: { title: 'Keyboard', init_bpm: 120, resolution: 240, mode_hint: 'keyboard-24k-double' },
        sound_channels: [
          {
            name: 'key.wav',
            notes: [
              { x: 5, y: 0 },
              { x: 26, y: 240 },
              { x: 40, y: 480 },
              { x: 51, y: 720 },
            ],
          },
        ],
      }),
    );
    // A different resolution skips the preserved document, so the lanes go through the canonical writer.
    const output = JSON.parse(stringifyBmson(source, { resolution: 480 })) as {
      info: { mode_hint: string };
      sound_channels: Array<{ notes: Array<{ x: number }> }>;
    };

    expect(output.info.mode_hint).toBe('keyboard-24k-double');
    expect(output.sound_channels[0]!.notes.map((note) => note.x)).toEqual([5, 26, 40, 51]);
    expect(parseBmson(JSON.stringify(output)).events.map((event) => event.channel)).toEqual(['15', '1Q', '2E', '2P']);
  });

  describe('bmson stringify: keeps every lane of a non-keyboard mode_hint through parse → stringify → parse', () => {
    const laneCounts: Array<[string, number]> = [
      ['beat-5k', 6],
      ['beat-7k', 8],
      ['beat-10k', 12],
      ['beat-14k', 16],
      ['popn-5k', 5],
      ['popn-9k', 9],
    ];
    // Measure + fraction as one number, since the output resolution rewrites the position denominators.
    const toChannels = (json: ReturnType<typeof parseBmson>) =>
      json.events.map((event) => `${event.measure + event.position[0] / event.position[1]}:${event.channel}`).sort();

    test.each(laneCounts)('%s', (modeHint, laneCount) => {
      const xs = Array.from({ length: laneCount }, (_, index) => index + 1);
      const source = parseBmson(
        JSON.stringify({
          version: '1.0.0',
          info: { title: modeHint, init_bpm: 120, resolution: 240, mode_hint: modeHint },
          sound_channels: [{ name: 'key.wav', notes: xs.map((x) => ({ x, y: x * 60 })) }],
          key_channels: [{ name: 'mine.wav', notes: xs.map((x) => ({ x, y: x * 60 + 30 })) }],
        }),
      );
      // A different resolution skips the preserved document, so the lanes go through the canonical writer.
      const output = JSON.parse(stringifyBmson(source, { resolution: 480 })) as {
        info: { mode_hint: string };
        sound_channels: Array<{ notes: Array<{ x: number }> }>;
      };

      expect(output.info.mode_hint).toBe(modeHint);
      expect(output.sound_channels[0]!.notes.map((note) => note.x)).toEqual(xs);
      expect(toChannels(parseBmson(JSON.stringify(output)))).toEqual(toChannels(source));
    });

    test('bmson-mine-key-channels.bmson (beat-7k, keys 6 / 7, scratch and mines)', async () => {
      const source = parseBmson(
        await readFile(resolve(rootDir, 'examples/test/bmson-mine-key-channels.bmson'), 'utf8'),
      );
      expect(toChannels(parseBmson(stringifyBmson(source)))).toEqual(toChannels(source));
    });

    test('an unknown hint numbers the lanes in use from 1', () => {
      const source = parseBmson(
        JSON.stringify({
          version: '1.0.0',
          info: { title: 'Unknown', init_bpm: 120, resolution: 240, mode_hint: 'custom-3k' },
          sound_channels: [
            {
              name: 'key.wav',
              notes: [
                { x: 4, y: 0 },
                { x: 9, y: 240 },
                { x: 20, y: 480 },
              ],
            },
          ],
        }),
      );
      const output = JSON.parse(stringifyBmson(source, { resolution: 480 })) as {
        sound_channels: Array<{ notes: Array<{ x: number }> }>;
      };
      expect(output.sound_channels[0]!.notes.map((note) => note.x)).toEqual([1, 2, 3]);
    });
  });

  test('bmson stringify: writes a 7 KEY BMS with scratch and keys 6 / 7 as beat-7k on its fixed lanes', () => {
    const source = parseChart(
      ['#BPM 120', '#WAV01 key.wav', '#00111:01', '#00116:01', '#00118:01', '#00119:01', ''].join('\n'),
    );
    const output = JSON.parse(stringifyBmson(source)) as {
      info: { mode_hint: string };
      sound_channels: Array<{ notes: Array<{ x: number }> }>;
    };

    expect(output.info.mode_hint).toBe('beat-7k');
    expect(output.sound_channels[0]!.notes.map((note) => note.x).sort((a, b) => a - b)).toEqual([1, 6, 7, 8]);
    expect(
      parseBmson(JSON.stringify(output))
        .events.map((event) => event.channel)
        .sort(),
    ).toEqual(['11', '16', '18', '19']);
  });

  test('bmson stringify: keeps a BME POPN-9 chart on 11..19 under the positional beat-9k hint', () => {
    const lanes = ['11', '12', '13', '14', '15', '16', '17', '18', '19'];
    const source = parseChart(['#BPM 120', '#WAV01 key.wav', ...lanes.map((lane) => `#001${lane}:01`), ''].join('\n'));
    const output = JSON.parse(stringifyBmson(source)) as { info: { mode_hint: string } };

    expect(output.info.mode_hint).toBe('beat-9k');
    expect(
      parseBmson(JSON.stringify(output))
        .events.map((event) => event.channel)
        .sort(),
    ).toEqual(lanes);
  });

  test('bmson stringify: omits `key_channels` / `mine_channels` when the chart has no hidden notes or mines', () => {
    const source = parseBmson(
      JSON.stringify({
        version: '1.0.0',
        info: { title: 'No mines', init_bpm: 120, resolution: 240 },
        sound_channels: [{ name: 'key.wav', notes: [{ x: 1, y: 0 }] }],
      }),
    );
    const output = JSON.parse(stringifyBmson(source)) as Record<string, unknown>;
    expect(output).not.toHaveProperty('key_channels');
    expect(output).not.toHaveProperty('mine_channels');
  });

  test('bmson stringify: rescales preserved `lines` to the output resolution', async () => {
    const chartPath = resolve(rootDir, 'examples/test/bmson-mine-key-channels.bmson');
    const parsed = parseBmson(await readFile(chartPath, 'utf8'));

    const output = JSON.parse(stringifyBmson(parsed, { resolution: 480 })) as {
      info: { resolution: number };
      lines: Array<{ y: number }>;
    };
    expect(output.info.resolution).toBe(480);
    expect(output.lines.map((line) => line.y)).toEqual([0, 1920, 3840]);

    const toTiming = (event: { measure: number; position: readonly [number, number] }) => ({
      measure: event.measure,
      fraction: event.position[0] / event.position[1],
    });
    const reparsed = parseBmson(JSON.stringify(output));
    expect(reparsed.events.map(toTiming)).toEqual(parsed.events.map(toTiming));
  });

  test('bmson stringify: writes BMS STOP lengths as pulses at the output resolution', () => {
    const parsed = parseChart(['#BPM 120', '#STOP01 24', '#STOP02 192', '#00109:0102', '#00111:01', ''].join('\n'));

    const output = JSON.parse(stringifyBmson(parsed)) as {
      info: { resolution: number };
      stop_events: Array<{ y: number; duration: number }>;
    };
    const { resolution } = output.info;

    expect(output.stop_events.map((event) => event.duration)).toEqual([resolution / 2, resolution * 4]);
    const reparsed = parseBmson(JSON.stringify(output));
    expect(Object.values(reparsed.resources.stop).sort((left, right) => left - right)).toEqual([24, 192]);
  });

  test("bmson stringify: keeps a bmson source's `info.total` as authored on both output paths", () => {
    const document = {
      version: '1.0.0',
      info: { title: 'Total', artist: 'A', genre: 'G', init_bpm: 120, total: 250, resolution: 240 },
      sound_channels: [{ name: 'key.wav', notes: [{ x: 1, y: 0, l: 0, c: false }] }],
    };
    // Preserved-document path: the parsed `sound_channels` are written back verbatim.
    const preserved = parseBmson(JSON.stringify(document));
    expect(preserved.preservation.bmson.soundChannels).toHaveLength(1);
    expect((JSON.parse(stringifyBmson(preserved)) as { info: { total?: number } }).info.total).toBe(250);

    // Regenerated path: a moved note no longer matches the preserved channels, so the document is rebuilt.
    const edited = parseBmson(JSON.stringify(document));
    edited.events[0]!.position = [1, 2];
    const regenerated = JSON.parse(stringifyBmson(edited)) as { info: { total?: number }; lines?: unknown };
    expect(regenerated.lines).toBeDefined();
    expect(regenerated.info.total).toBe(250);
    expect(parseBmson(JSON.stringify(regenerated)).metadata.total).toBe(250);
  });

  test('bmson stringify: does not write a BMS `#TOTAL` into the percentage-based bmson `total`', () => {
    // BMS `#TOTAL 300` is an absolute gauge TOTAL; bmson `total` is a percentage of the player's default TOTAL, so
    // writing 300 would turn it into 300% of the default. The note-count-dependent default has no exact conversion
    // here, so the field is left out and the bmson default (100%) applies.
    const parsed = parseChart(['#BPM 120', '#TOTAL 300', '#WAV01 key.wav', '#00111:01', ''].join('\n'));
    expect(parsed.metadata.total).toBe(300);

    const output = JSON.parse(stringifyBmson(parsed)) as { info: Record<string, unknown> };
    expect(output.info).not.toHaveProperty('total');
    expect(parseBmson(JSON.stringify(output)).metadata.total).toBe(100);
  });

  test('bmson stringify: writes an explicit `bmson.info.total` on a BMS-sourced chart', () => {
    const parsed = parseChart(['#BPM 120', '#TOTAL 300', '#WAV01 key.wav', '#00111:01', ''].join('\n'));
    parsed.bmson.info.total = 120;

    const output = JSON.parse(stringifyBmson(parsed)) as { info: { total?: number } };
    expect(output.info.total).toBe(120);
  });
  describe('bmson stringify: BMS judge rank → `judge_rank`', () => {
    const bmsChart = (...headers: string[]): string =>
      ['#BPM 120', ...headers, '#WAV01 key.wav', '#00111:01', ''].join('\n');
    const judgeRankOf = (source: string): number | undefined =>
      (JSON.parse(stringifyBmson(parseChart(source))) as { info: { judge_rank?: number } }).info.judge_rank;

    // bmson `judge_rank` is on the `#DEFEXRANK` axis (100 = NORMAL); `#RANK` is a 0..4 index and used to be written
    // verbatim, so `#RANK 2` became a 2 % window. Each rank maps to the `#DEFEXRANK` value that judges like it.
    test.each([
      [0, 33],
      [1, 67],
      [2, 100],
      [3, 133],
      [4, 167],
    ])('#RANK %i → judge_rank %i', (rank, expected) => {
      expect(judgeRankOf(bmsChart(`#RANK ${rank}`))).toBe(expected);
    });

    test.each(['5', '75', '-1', '3.5'])(
      'leaves `judge_rank` out for #RANK %s, which judges as NORMAL (the bmson default)',
      (rank) => {
        expect(judgeRankOf(bmsChart(`#RANK ${rank}`))).toBeUndefined();
      },
    );

    test('a chart without #RANK / #DEFEXRANK leaves `judge_rank` out', () => {
      expect(judgeRankOf(bmsChart())).toBeUndefined();
    });

    test('#DEFEXRANK takes precedence and is written verbatim (same unit as `judge_rank`)', () => {
      expect(judgeRankOf(bmsChart('#RANK 0', '#DEFEXRANK 120'))).toBe(120);
      expect(judgeRankOf(bmsChart('#DEFEXRANK 87.5'))).toBe(87.5);
      // A non-positive #DEFEXRANK is ignored by the engine, so #RANK still decides.
      expect(judgeRankOf(bmsChart('#RANK 1', '#DEFEXRANK 0'))).toBe(67);
    });

    test('an explicit `bmson.info.judgeRank` on a BMS-sourced chart wins over #RANK / #DEFEXRANK', () => {
      const parsed = parseChart(bmsChart('#RANK 0', '#DEFEXRANK 120'));
      parsed.bmson.info.judgeRank = 90;
      expect((JSON.parse(stringifyBmson(parsed)) as { info: { judge_rank?: number } }).info.judge_rank).toBe(90);
    });

    test("keeps a bmson source's `judge_rank` as authored on both output paths", () => {
      const document = {
        version: '1.0.0',
        info: { title: 'Rank', artist: 'A', genre: 'G', init_bpm: 120, judge_rank: 3, resolution: 240 },
        sound_channels: [{ name: 'key.wav', notes: [{ x: 1, y: 0, l: 0, c: false }] }],
      };
      // A bmson `judge_rank: 3` is already in bmson units; it must not go through the #RANK table.
      const preserved = parseBmson(JSON.stringify(document));
      expect(preserved.preservation.bmson.soundChannels).toHaveLength(1);
      expect((JSON.parse(stringifyBmson(preserved)) as { info: { judge_rank?: number } }).info.judge_rank).toBe(3);

      const edited = parseBmson(JSON.stringify(document));
      edited.events[0]!.position = [1, 2];
      const regenerated = JSON.parse(stringifyBmson(edited)) as { info: { judge_rank?: number }; lines?: unknown };
      expect(regenerated.lines).toBeDefined();
      expect(regenerated.info.judge_rank).toBe(3);

      // A bmson source without `judge_rank` stays without it (no #RANK fallback).
      const { judge_rank: _omitted, ...withoutRank } = document.info;
      const bare = parseBmson(JSON.stringify({ ...document, info: withoutRank }));
      bare.events[0]!.position = [1, 2];
      expect(JSON.parse(stringifyBmson(bare)).info).not.toHaveProperty('judge_rank');
    });

    describe("be-music's judge windows for the BMS and its bmson conversion", () => {
      const chart = { scorableNotes: [], laneDisplayMode: '7 KEY SP' };
      const windowsOf = (
        json: ReturnType<typeof parseChart>,
        ruleset: 'lr2' | 'beatoraja' | 'iidx',
      ): JudgeWindowSetUs => resolveRuleset(rulesetChartFactsFromChart(json, chart), ruleset).windows.note;
      const convert = (source: string) => {
        const bms = parseChart(source);
        return { bms, bmson: parseBmson(stringifyBmson(bms)) };
      };
      const lateEdges = (set: JudgeWindowSetUs): number[] => set.judges.map((pair) => pair[1]);

      test.each(['#RANK 0', '#RANK 1', '#RANK 2', '#RANK 3', '#RANK 4', '#DEFEXRANK 120', '#RANK 7'])(
        'IIDX (rank-independent windows) matches for %s',
        (header) => {
          const { bms, bmson } = convert(bmsChart(header));
          expect(windowsOf(bmson, 'iidx')).toEqual(windowsOf(bms, 'iidx'));
        },
      );

      test.each(['#RANK 2', '#DEFEXRANK 120', '#DEFEXRANK 64', '#RANK 7'])('LR2 matches exactly for %s', (header) => {
        const { bms, bmson } = convert(bmsChart(header));
        expect(windowsOf(bmson, 'lr2')).toEqual(windowsOf(bms, 'lr2'));
      });

      test.each(['#RANK 0', '#RANK 1', '#RANK 3'])(
        'LR2 matches %s within 0.4 ms (judge_rank is rounded to a whole percent)',
        (header) => {
          const { bms, bmson } = convert(bmsChart(header));
          const expected = lateEdges(windowsOf(bms, 'lr2'));
          const actual = lateEdges(windowsOf(bmson, 'lr2'));
          for (const [index, edge] of actual.entries()) {
            expect(Math.abs(edge - expected[index]!)).toBeLessThanOrEqual(400);
          }
        },
      );

      test('LR2 #RANK 4 differs: LR2 plays VERY EASY as NORMAL, the conversion follows beatoraja (judgerank 125)', () => {
        const { bms, bmson } = convert(bmsChart('#RANK 4'));
        expect(lateEdges(windowsOf(bms, 'lr2'))).toEqual([18_000, 40_000, 100_000, 200_000]);
        expect(lateEdges(windowsOf(bmson, 'lr2'))).toEqual([24_030, 80_200, 140_200, 200_000]);
      });

      test.each(['#RANK 0', '#RANK 1', '#RANK 2', '#RANK 3', '#RANK 4', '#DEFEXRANK 120'])(
        'beatoraja keeps the rank order but judges %s about 4/3 wider (it reads bmson judge_rank unscaled)',
        (header) => {
          const { bms, bmson } = convert(bmsChart(header));
          // PGREAT is never clamped by the BAD leg, so its ratio is the judgerank ratio: bmson `judge_rank` is used as
          // the judgerank itself, while BMS #RANK / #DEFEXRANK sit at 75 % of it (NORMAL = judgerank 75).
          const ratio = windowsOf(bmson, 'beatoraja').judges[0][1] / windowsOf(bms, 'beatoraja').judges[0][1];
          expect(ratio).toBeGreaterThanOrEqual(1.32);
          expect(ratio).toBeLessThanOrEqual(1.34);
        },
      );
    });
  });
});
