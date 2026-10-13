import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vite-plus/test';
import { parseBms, parseBmson, resolveBmsControlFlow } from '../../parser/src/index.ts';
import { stringifyBmson } from '../../stringifier/src/index.ts';
import {
  canonicalizeFingerprintDocument,
  computeChartFingerprint,
  computeFingerprintOfDocument,
  computePlayFingerprint,
  createChartFingerprintDocument,
  createPlayFingerprintDocument,
  type BeMusicChartFingerprintDocument,
  type BeMusicPlayFingerprintDocument,
  resolveChartPlayVariant,
} from './index.ts';

const NO_PATH = { chartPath: undefined };
const BASE_HEADER = ['#PLAYER 1', '#TITLE Fingerprint', '#ARTIST someone', '#BPM 150', '#WAV01 a.wav', '#WAV02 b.wav'];

/** A small 7-key chart; `extra` lines are appended. */
function chart(...extra: string[]): string {
  return [
    ...BASE_HEADER,
    '#00111:01020102',
    '#00112:00000100',
    '#00118:0001',
    '#00211:01',
    '#00219:00000001',
    ...extra,
  ].join('\n');
}

function playDocument(text: string, chartPath?: string): BeMusicPlayFingerprintDocument {
  return createPlayFingerprintDocument(parseBms(text), { chartPath });
}

function playFingerprint(text: string, chartPath?: string): string {
  return computePlayFingerprint(parseBms(text), { chartPath });
}

function chartFingerprint(text: string): string {
  return computeChartFingerprint(parseBms(text), NO_PATH);
}

function chartDocument(text: string): BeMusicChartFingerprintDocument {
  const document = createChartFingerprintDocument(parseBms(text), NO_PATH);
  expect('random' in document).toBe(true);
  return document as BeMusicChartFingerprintDocument;
}

describe('fingerprint document', () => {
  test('builds the canonical document of a chart', () => {
    const document = playDocument(
      chart(
        '#TOTAL 300',
        '#LNOBJ ZZ',
        '#BPM01 133.333333',
        '#STOP01 96',
        '#STP 002.500 250',
        '#SCROLL01 0.5',
        '#00102:0.75',
        '#00316:01ZZ',
        '#001D3:0A',
        '#00208:01',
        '#00209:01',
        '#002SC:0001',
      ),
    );
    expect(document).toEqual({
      v: 'bmfp0',
      laneMode: '7',
      bpm: '150',
      baseBpm: null,
      judge: { rank: '2' },
      total: { bms: '300' },
      measures: { count: '4', lengths: [['1', '3/4']] },
      notes: [
        { m: '1', p: '0', lane: '11' },
        { m: '1', p: '1/4', lane: '11' },
        { m: '1', p: '1/2', lane: '11' },
        { m: '1', p: '1/2', lane: '12' },
        { m: '1', p: '1/2', lane: '18' },
        { m: '1', p: '3/4', lane: '11' },
        { m: '2', p: '0', lane: '11' },
        { m: '2', p: '3/4', lane: '19' },
        { m: '3', p: '0', lane: '16', end: { m: '3', p: '1/2' }, ln: '1' },
      ],
      mines: [{ m: '1', p: '0', lane: '13', damage: '10' }],
      timeline: [
        { m: '2', p: '0', type: 'bpm', v: '400/3' },
        { m: '2', p: '0', type: 'stop', v: '2' },
        { m: '2', p: '1/2', type: 'scroll', v: '1/2' },
        { m: '2', p: '1/2', type: 'stp', v: '250' },
      ],
    });
  });

  test('serializes with RFC 8785 and hashes the UTF-8 bytes with SHA-256', () => {
    const json = parseBms(chart());
    const canonical = canonicalizeFingerprintDocument(createPlayFingerprintDocument(json, NO_PATH));
    expect(canonical.startsWith('{"baseBpm":null,"bpm":"150","judge":{"rank":"2"},"laneMode":"7","measures":')).toBe(
      true,
    );
    expect(canonical).not.toMatch(/\s/);
    const expected = createHash('sha256').update(Buffer.from(canonical, 'utf8')).digest('hex');
    expect(computePlayFingerprint(json, NO_PATH)).toBe(`bmfp0:${expected}`);
  });

  test('fingerprints a document built elsewhere like the chart it came from', () => {
    const json = parseBms(chart('#RANDOM 2', '#IF 1', '#00213:01', '#ENDIF'));
    const playDocument = createPlayFingerprintDocument(json, NO_PATH);
    const chartDocument = createChartFingerprintDocument(json, NO_PATH);
    expect(computeFingerprintOfDocument(playDocument)).toBe(computePlayFingerprint(json, NO_PATH));
    expect(computeFingerprintOfDocument(chartDocument)).toBe(computeChartFingerprint(json, NO_PATH));
    // A document that went through JSON (as one sent over the wire does) hashes the same, key order notwithstanding.
    const reverseKeys = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(reverseKeys)
        : value !== null && typeof value === 'object'
          ? Object.fromEntries(Object.entries(value).reverse().map(([key, entry]) => [key, reverseKeys(entry)]))
          : value;
    const roundTripped = JSON.parse(JSON.stringify(reverseKeys(playDocument))) as typeof playDocument;
    expect(computeFingerprintOfDocument(roundTripped)).toBe(computePlayFingerprint(json, NO_PATH));
    // Any edit to the document changes it.
    expect(computeFingerprintOfDocument({ ...playDocument, bpm: '151' })).not.toBe(
      computePlayFingerprint(json, NO_PATH),
    );
  });
});

describe('fingerprint invariance', () => {
  test('ignores line order', () => {
    const lines = chart('#BPM01 180', '#00308:01', '#001D3:0A').split('\n');
    const reordered = [...lines].reverse();
    expect(playFingerprint(reordered.join('\n'))).toBe(playFingerprint(lines.join('\n')));
  });

  test('ignores #WAV numbering', () => {
    const original = chart('#00311:0201');
    const renumbered = original
      .replace('#WAV01 a.wav', '#WAV0Z a.wav')
      .replaceAll(/(#\d{3}1[1-9]:)(\w+)/g, (_m, head: string, data: string) => `${head}${data.replace(/01/g, '0Z')}`);
    expect(renumbered).not.toBe(original);
    expect(playFingerprint(renumbered)).toBe(playFingerprint(original));
  });

  test('ignores the measure-position resolution', () => {
    const coarse = chart('#00311:01', '#00312:0001');
    const fine = chart('#00311:0100', '#00312:00000100');
    expect(playFingerprint(fine)).toBe(playFingerprint(coarse));
  });

  test('ignores the decimal precision of measure lengths, BPMs and STOPs', () => {
    const precise = chart('#00102:0.333333', '#BPM01 133.333333', '#00208:01', '#00116:0001', '#00216:01', '#LNOBJ 01');
    const rounded = chart('#00102:0.3333', '#BPM01 133.333', '#00208:01', '#00116:0001', '#00216:01', '#LNOBJ 01');
    expect(playDocument(precise).measures.lengths).toEqual([['1', '1/3']]);
    expect(playFingerprint(rounded)).toBe(playFingerprint(precise));
    expect(playFingerprint(chart('#STOP01 33.3333', '#00209:01'))).toBe(
      playFingerprint(chart('#STOP01 33.333333', '#00209:01')),
    );
  });

  test('absorbs float noise in values', () => {
    expect(playFingerprint(chart('#BPM01 149.99999999', '#00308:01'))).toBe(
      playFingerprint(chart('#BPM01 150', '#00308:01')),
    );
  });

  test('ignores BGA, BGM, keysounds, invisible notes, #CHANGEOPTION and metadata', () => {
    const base = playFingerprint(chart());
    const variants = [
      chart('#BMP01 bg.bmp', '#00104:01', '#00107:01', '#00106:01'),
      chart('#00101:0102', '#00201:02'),
      chart().replace('#00111:01020102', '#00111:02010201'),
      chart('#00131:01', '#00241:02'),
      chart('#GENRE other', '#PLAYLEVEL 12', '#DIFFICULTY 4', '#STAGEFILE s.png', '#BANNER b.png', '#COMMENT hi'),
      chart('#WAV03 c.wav', '#VOLWAV 50', '#00197:80'),
      chart('#CHANGEOPTION01 MIRROR', '#OPTION HRAN'),
    ];
    for (const variant of variants) {
      expect(playFingerprint(variant)).toBe(base);
    }
  });

  test('treats LNOBJ and channel 5x long notes alike', () => {
    const lnobj = chart('#LNOBJ ZZ', '#00316:000100ZZ');
    const legacy = chart('#LNTYPE 1', '#00356:00010001');
    expect(playFingerprint(legacy)).toBe(playFingerprint(lnobj));
  });

  test('drops events that change nothing', () => {
    const base = playFingerprint(chart('#BPM01 180', '#00308:01'));
    const noOps = chart(
      '#BPM01 180',
      '#BPM02 150',
      '#00308:01',
      '#00208:02', // BPM change to the BPM in effect
      '#STOP01 0',
      '#00209:01', // STOP of length 0
      '#STP 002.000 0',
      '#SCROLL01 1',
      '#002SC:01', // SCROLL change to 1
      '#SPEED01 1',
      '#002SP:01', // SPEED keyframe of 1 alone: the curve stays 1
    );
    expect(playFingerprint(noOps)).toBe(base);
  });

  test('keeps the last change of one kind at one time', () => {
    const both = chart('#BPM01 180', '#BPM02 200', '#00308:01', '#00308:02');
    const last = chart('#BPM02 200', '#00308:02');
    expect(playFingerprint(both)).toBe(playFingerprint(last));
    // Channel 08 wins over 03 at one time.
    expect(playFingerprint(chart('#BPM01 200', '#00303:B4', '#00308:01'))).toBe(playFingerprint(last));
  });

  test('drops an #EXRANK change to the value of the previous one', () => {
    const twice = chart('#EXRANK01 50', '#EXRANK02 50', '#002A0:01', '#003A0:02');
    const once = chart('#EXRANK01 50', '#002A0:01');
    expect(playFingerprint(twice)).toBe(playFingerprint(once));
  });

  test('ignores measures after the last included event', () => {
    const base = playFingerprint(chart());
    expect(playFingerprint(chart('#01002:0.5', '#02001:01', '#03004:01'))).toBe(base);
    expect(playDocument(chart('#01002:0.5')).measures.count).toBe('3');
  });
});

describe('fingerprint sensitivity', () => {
  test.each([
    ['a note', chart('#00313:01')],
    ['a moved note', chart().replace('#00118:0001', '#00118:01')],
    ['a note on another lane', chart().replace('#00118:0001', '#00119:0001')],
    ['a long note', chart('#LNOBJ ZZ', '#00316:01ZZ')],
    ['a mine', chart('#001D3:0A')],
    ['the initial BPM', chart().replace('#BPM 150', '#BPM 151')],
    ['a BPM change', chart('#BPM01 180', '#00208:01')],
    ['a STOP', chart('#STOP01 96', '#00209:01')],
    ['an #STP', chart('#STP 002.500 250')],
    ['a SCROLL change', chart('#SCROLL01 0.5', '#002SC:01')],
    ['a SPEED change', chart('#SPEED01 0.5', '#002SP:01')],
    ['an #EXRANK change', chart('#EXRANK01 50', '#002A0:01')],
    ['#BASEBPM', chart('#BASEBPM 160')],
    ['#RANK', chart('#RANK 3')],
    ['#DEFEXRANK', chart('#DEFEXRANK 100')],
    ['#TOTAL', chart('#TOTAL 300')],
    ['a measure length', chart('#00102:0.75')],
  ])('changes with %s', (_label, variant) => {
    expect(playFingerprint(variant)).not.toBe(playFingerprint(chart()));
  });

  test.each([
    ['the LN mode', '#LNMODE 2', '#LNMODE 3'],
    ['the mine damage', '#001D3:0A', '#001D3:0B'],
    ['the BPM value', '#BPM01 180', '#BPM01 181'],
    ['the STOP length', '#STOP01 96', '#STOP01 97'],
    ['the #STP length', '#STP 002.500 250', '#STP 002.500 251'],
    ['the SCROLL value', '#SCROLL01 0.5', '#SCROLL01 0.25'],
    ['the SPEED value', '#SPEED01 0.5', '#SPEED01 0.25'],
    ['the #EXRANK value', '#EXRANK01 50', '#EXRANK01 60'],
    ['the #BASEBPM value', '#BASEBPM 160', '#BASEBPM 200'],
    ['the #RANK value', '#RANK 1', '#RANK 3'],
    ['the #DEFEXRANK value', '#DEFEXRANK 100', '#DEFEXRANK 120'],
    ['the #TOTAL value', '#TOTAL 300', '#TOTAL 301'],
    ['the measure length', '#00102:0.75', '#00102:0.5'],
  ])('changes with %s', (_label, left, right) => {
    const shared = [
      '#LNOBJ ZZ',
      '#00316:01ZZ',
      '#00208:01',
      '#00209:01',
      '#002SC:01',
      '#002SP:01',
      '#002A0:01',
      '#BPM01 180',
      '#STOP01 96',
      '#SCROLL01 0.5',
      '#SPEED01 0.5',
      '#EXRANK01 50',
    ];
    expect(playFingerprint(chart(...shared, left))).not.toBe(playFingerprint(chart(...shared, right)));
  });

  test('changes with #TOTAL present against absent', () => {
    expect(playDocument(chart()).total).toBeNull();
    expect(playDocument(chart('#TOTAL 160')).total).toEqual({ bms: '160' });
  });

  test('keeps #RANK and #DEFEXRANK on separate axes', () => {
    expect(playDocument(chart('#RANK 2')).judge).toEqual({ rank: '2' });
    expect(playDocument(chart('#RANK 2', '#DEFEXRANK 100')).judge).toEqual({ exRank: '100' });
  });

  test('takes the file extension as a lane-mode input', () => {
    const text = chart();
    expect(playDocument(text, 'song.pms').laneMode).toBe('9');
    expect(playFingerprint(text, 'song.pms')).not.toBe(playFingerprint(text, 'song.bms'));
    expect(playFingerprint(text, 'song.bme')).toBe(playFingerprint(text, undefined));
    expect(playDocument(chart('#00221:01')).laneMode).toBe('14');
    // The lanes in use decide the IIDX modes whatever the extension: a `.bme` chart without a 6 / 7 key column is 5 KEY.
    const fiveKeys = ['#BPM 150', '#00111:01', '#00115:01'].join('\n');
    expect(playDocument(fiveKeys).laneMode).toBe('5');
    expect(playDocument(fiveKeys, 'dir.v2/song.BME').laneMode).toBe('5');
    // `.bme` is not a lane-mode input, so a chart document records no extension for it.
    const random = ['#BPM 150', '#00111:01', '#RANDOM 2', '#IF 1', '#00218:01', '#ENDIF', '#ENDRANDOM'].join('\n');
    expect(computeChartFingerprint(parseBms(random), { chartPath: 'song.bme' })).toBe(chartFingerprint(random));
    expect(chartDocument(random).lanes.extension).toBeNull();
    expect(
      (createChartFingerprintDocument(parseBms(random), { chartPath: 'SONG.PMS' }) as BeMusicChartFingerprintDocument)
        .lanes.extension,
    ).toBe('.pms');
  });

  test('counts long-note channels for the lane mode', () => {
    // Lane 18 only through a 5x long note still makes the chart 7 KEY.
    const text = ['#BPM 150', '#LNTYPE 1', '#00111:01', '#00158:0101'].join('\n');
    expect(playDocument(text).laneMode).toBe('7');
  });
});

describe('keyboard lane mode (bmson keyboard-24k)', () => {
  function keyboardBmson(modeHint: string, notes: Array<{ x: number; y: number; l?: number }>): string {
    return JSON.stringify({
      version: '1.0.0',
      info: { title: 'keyboard', init_bpm: 150, mode_hint: modeHint, resolution: 240 },
      sound_channels: [{ name: 'a.wav', notes: notes.map((note) => ({ l: 0, c: false, ...note })) }],
    });
  }
  const FIRST_NINE_KEYS = [
    { x: 1, y: 960 },
    { x: 5, y: 1200 },
    { x: 9, y: 1440 },
  ];

  test('takes the keyboard mode_hint as a lane-mode input, as resolveChartPlayVariant does', () => {
    // Only x <= 9 (lanes 11..19): the lane rules alone would read this as 9 / 7 KEY, the hint makes it 24 KEY.
    const keyboard = parseBmson(keyboardBmson('keyboard-24k', FIRST_NINE_KEYS));
    const document = createPlayFingerprintDocument(keyboard, NO_PATH);
    expect(document.laneMode).toBe('24');
    expect(document.laneMode).toBe(resolveChartPlayVariant(keyboard));
    expect(document.notes.map((note) => note.lane)).toEqual(['11', '15', '19']);

    const beat = parseBmson(keyboardBmson('beat-7k', FIRST_NINE_KEYS));
    expect(createPlayFingerprintDocument(beat, NO_PATH).laneMode).toBe(resolveChartPlayVariant(beat));
    expect(createPlayFingerprintDocument(beat, NO_PATH).laneMode).not.toBe('24');
    expect(computePlayFingerprint(keyboard, NO_PATH)).not.toBe(computePlayFingerprint(beat, NO_PATH));

    const double = parseBmson(keyboardBmson('keyboard-24k-double', FIRST_NINE_KEYS));
    expect(createPlayFingerprintDocument(double, NO_PATH).laneMode).toBe('48');
    expect(createPlayFingerprintDocument(double, NO_PATH).laneMode).toBe(resolveChartPlayVariant(double));
  });

  test('ignores every other mode_hint, as resolveChartPlayVariant does', () => {
    const plain = computePlayFingerprint(parseBmson(keyboardBmson('beat-7k', FIRST_NINE_KEYS)), NO_PATH);
    for (const hint of ['beat-5k', 'popn-9k', 'keyboard-48k', 'unknown']) {
      const json = parseBmson(keyboardBmson(hint, FIRST_NINE_KEYS));
      expect(createPlayFingerprintDocument(json, NO_PATH).laneMode).toBe(resolveChartPlayVariant(json));
    }
    // `popn-9k` maps x onto other lanes; the plain beat hints leave the document unchanged.
    expect(computePlayFingerprint(parseBmson(keyboardBmson('beat-5k', FIRST_NINE_KEYS)), NO_PATH)).toBe(plain);
  });

  test('records wheel notes as ordinary lanes', () => {
    // x = 25 / 26 are the wheel up / down (`1P` / `1Q`); x = 10 is the first extended key (`1A`).
    const keyboard = parseBmson(
      keyboardBmson('keyboard-24k', [
        { x: 1, y: 960 },
        { x: 10, y: 960 },
        { x: 25, y: 1200 },
        { x: 26, y: 1440, l: 240 },
      ]),
    );
    const document = createPlayFingerprintDocument(keyboard, NO_PATH);
    expect(document.laneMode).toBe('24');
    expect(document.notes.map((note) => note.lane)).toEqual(['11', '1A', '1P', '1Q']);
    // A wheel note alone makes a BMS chart 24 KEY, like any other extended lane.
    const bms = ['#BPM 150', '#WAV01 a.wav', '#00111:01', '#0011P:01', '#0021Q:01'].join('\n');
    expect(playDocument(bms).laneMode).toBe('24');
    expect(playDocument(bms).laneMode).toBe(resolveChartPlayVariant(parseBms(bms)));
    expect(playDocument(bms).notes.map((note) => note.lane)).toEqual(['11', '1P', '1Q']);
    // Moving a wheel note changes the fingerprint.
    expect(playFingerprint(bms)).not.toBe(playFingerprint(bms.replace('#0021Q:01', '#0012P:01')));
  });
});

describe('SPEED (finding A1)', () => {
  const speeds = ['#SPEED01 1', '#SPEED02 2', '#00411:01'];

  test('keeps a keyframe that starts a ramp even when it repeats the default', () => {
    // A ramps 1 → 2 over measures 1..3; B jumps to 2 (held from the start) at measure 3.
    const ramp = chart(...speeds, '#001SP:01', '#003SP:02');
    const single = chart(...speeds, '#003SP:02');
    expect(playFingerprint(ramp)).not.toBe(playFingerprint(single));
    expect(playDocument(ramp).timeline.filter((event) => event.type === 'speed')).toEqual([
      { m: '1', p: '0', type: 'speed', v: '1' },
      { m: '3', p: '0', type: 'speed', v: '2' },
    ]);
  });

  test('ramps from 1 at the chart start to the first keyframe', () => {
    // A keyframe after the start is reached by a ramp from 1, so where it sits matters.
    expect(playFingerprint(chart(...speeds, '#003SP:02'))).not.toBe(playFingerprint(chart(...speeds, '#002SP:02')));
    expect(playDocument(chart(...speeds, '#003SP:02')).timeline).toEqual([{ m: '3', p: '0', type: 'speed', v: '2' }]);
    // A keyframe at the start applies at once: the curve is the constant 2.
    expect(playDocument(chart(...speeds, '#000SP:02', '#003SP:02')).timeline).toEqual([
      { m: '0', p: '0', type: 'speed', v: '2' },
    ]);
    // Keyframes of 1 only, wherever they are, leave the speed at 1 throughout.
    expect(playFingerprint(chart(...speeds, '#000SP:01', '#003SP:01'))).toBe(playFingerprint(chart(...speeds)));
  });

  test('drops keyframes inside a run of equal values and at its outer ends', () => {
    const full = chart(...speeds, '#SPEED03 3', '#001SP:02', '#002SP:02', '#003SP:02', '#004SP:03', '#005SP:03');
    const reduced = chart(...speeds, '#SPEED03 3', '#001SP:02', '#003SP:02', '#004SP:03');
    expect(playFingerprint(full)).toBe(playFingerprint(reduced));
    // A middle run keeps both of its ends; a leading run of 1 joins the ramp's head and keeps only its last keyframe.
    const middle = chart(...speeds, '#SPEED03 3', '#001SP:01', '#002SP:02', '#003SP:02', '#004SP:03');
    expect(playDocument(middle).timeline.map((event) => event.m)).toEqual(['1', '2', '3', '4']);
    const leading = chart(...speeds, '#SPEED03 3', '#000SP:01', '#001SP:01', '#002SP:03');
    expect(playDocument(leading).timeline.map((event) => event.m)).toEqual(['1', '2']);
  });
});

describe('positions are exact (findings A2 – A5)', () => {
  /** BMS with one note at cell `k` of `n` in measure 1, and its bmson conversion at `resolution`. */
  function pair(k: number, n: number, resolution: number): { bms: string; bmson: string } {
    const cells = Array.from({ length: n }, (_, index) => (index === k ? '01' : '00')).join('');
    const bms = ['#BPM 150', '#DEFEXRANK 100', '#WAV01 a.wav', '#00111:01', `#00112:${cells}`].join('\n');
    const perMeasure = 4 * resolution;
    const bmson = JSON.stringify({
      version: '1.0.0',
      info: { init_bpm: 150, mode_hint: 'beat-7k', resolution, total: 0 },
      sound_channels: [
        {
          name: 'a.wav',
          notes: [
            { x: 1, y: perMeasure, l: 0, c: false },
            { x: 2, y: perMeasure + Math.round((perMeasure * k) / n), l: 0, c: false },
          ],
        },
      ],
    });
    return { bms, bmson };
  }

  test.each([
    [1, 16, 240],
    [1, 3, 240],
    [1, 192, 240],
    [1, 48, 960],
    [5, 96, 960],
  ])('cell %i/%i is exact at bmson resolution %i, so BMS and bmson match', (k, n, resolution) => {
    const { bms, bmson } = pair(k, n, resolution);
    expect(computePlayFingerprint(parseBmson(bmson), NO_PATH)).toBe(playFingerprint(bms));
  });

  test.each([
    [1, 7, 240],
    [1, 36, 240],
    [1, 128, 240],
    [5, 72, 960],
    [1, 144, 960],
  ])('cell %i/%i is not representable at bmson resolution %i, so they differ', (k, n, resolution) => {
    const { bms, bmson } = pair(k, n, resolution);
    expect(computePlayFingerprint(parseBmson(bmson), NO_PATH)).not.toBe(playFingerprint(bms));
  });

  test('keeps neighbouring cells of a long measure apart', () => {
    const cells = (index: number): string =>
      Array.from({ length: 1024 }, (_, at) => (at === index ? '01' : '00')).join('');
    const left = playDocument(chart('#00102:16', `#00113:${cells(44)}`));
    const right = playDocument(chart('#00102:16', `#00113:${cells(45)}`));
    expect(left.notes).toContainEqual({ m: '1', p: '11/256', lane: '13' });
    expect(right.notes).toContainEqual({ m: '1', p: '45/1024', lane: '13' });
  });

  test('never merges a STOP and a note one cell apart', () => {
    const stop = Array.from({ length: 1000 }, (_, at) => (at === 333 ? '01' : '00')).join('');
    const document = playDocument(chart('#STOP01 96', `#00309:${stop}`, '#00313:000100'));
    expect(document.timeline).toEqual([{ m: '3', p: '333/1000', type: 'stop', v: '2' }]);
    expect(document.notes).toContainEqual({ m: '3', p: '1/3', lane: '13' });
  });

  test('takes long-note ends exactly', () => {
    const cells = Array.from({ length: 384 }, (_, at) => (at === 19 ? 'ZZ' : at === 0 ? '01' : '00')).join('');
    const document = playDocument(chart('#LNOBJ ZZ', `#00314:${cells}`));
    expect(document.notes).toContainEqual({ m: '3', p: '0', lane: '14', end: { m: '3', p: '19/384' }, ln: '1' });
    // The same long note from bmson at resolution 480: 19/384 of a measure is 95 pulses.
    const bmson = JSON.stringify({
      version: '1.0.0',
      info: { init_bpm: 150, mode_hint: 'beat-7k', resolution: 480, total: 0 },
      sound_channels: [{ name: 'a.wav', notes: [{ x: 4, y: 3 * 1920, l: 95, c: false }] }],
    });
    expect(createPlayFingerprintDocument(parseBmson(bmson), NO_PATH).notes).toEqual([
      { m: '3', p: '0', lane: '14', end: { m: '3', p: '19/384' }, ln: '1' },
    ]);
  });
});

describe('engine fallbacks (findings A10 – A13)', () => {
  test('keeps the last BMS #STOP of one time and adds up #STPs and bmson stops', () => {
    // Of several `#STOPxx` at one position the last in event order (here `#STOP02`) wins, as in the engine.
    expect(playFingerprint(chart('#STOP01 48', '#STOP02 96', '#00209:01', '#00209:02'))).toBe(
      playFingerprint(chart('#STOP02 96', '#00209:02')),
    );
    expect(playFingerprint(chart('#STOP01 48', '#00209:01', '#00209:01'))).toBe(
      playFingerprint(chart('#STOP01 48', '#00209:01')),
    );
    expect(playFingerprint(chart('#STP 002.000 100', '#STP 002.000 150'))).toBe(
      playFingerprint(chart('#STP 002.000 250')),
    );
    const bmson = (stops: Array<{ y: number; duration: number }>): string =>
      computePlayFingerprint(
        parseBmson(
          JSON.stringify({
            version: '1.0.0',
            info: { init_bpm: 150, mode_hint: 'beat-7k', resolution: 240 },
            sound_channels: [{ name: 'a.wav', notes: [{ x: 1, y: 960, l: 0, c: false }] }],
            stop_events: stops,
          }),
        ),
        NO_PATH,
      );
    expect(
      bmson([
        { y: 960, duration: 120 },
        { y: 960, duration: 240 },
      ]),
    ).toBe(bmson([{ y: 960, duration: 360 }]));
  });

  test('keeps one judged note per lane and position, a long note over a tap', () => {
    expect(playFingerprint(chart('#00311:01', '#00311:02'))).toBe(playFingerprint(chart('#00311:01')));
    // `#LNOBJ` turns the first `11` object of measure 3 into a long note; the tap on its start is dropped.
    const withTap = chart('#LNOBJ ZZ', '#00311:0100ZZ00', '#00311:02');
    expect(playFingerprint(withTap)).toBe(playFingerprint(chart('#LNOBJ ZZ', '#00311:0100ZZ00')));
    expect(playDocument(withTap).notes).toContainEqual({
      m: '3',
      p: '0',
      lane: '11',
      end: { m: '3', p: '1/2' },
      ln: '1',
    });
  });

  test('keeps a negative #BPMxx with its sign and drops a zero or undefined one', () => {
    // The engine plays a negative `#BPMxx` as LR2's reverse scroll, so it must not fingerprint like the positive BPM.
    const reversed = chart('#BPM01 -150', '#00208:01');
    expect(playDocument(reversed).timeline).toContainEqual({ m: '2', p: '0', type: 'bpm', v: '-150' });
    expect(playFingerprint(reversed)).not.toBe(playFingerprint(chart('#BPM01 150', '#00208:01')));
    // A zero or undefined slot is dropped and the previous tempo continues, as in the engine.
    expect(playFingerprint(chart('#BPM01 0', '#00208:01'))).toBe(playFingerprint(chart()));
    expect(playFingerprint(chart('#00208:01'))).toBe(playFingerprint(chart()));
  });

  test('treats a #TOTAL of 0 or below as absent', () => {
    expect(playFingerprint(chart('#TOTAL 0'))).toBe(playFingerprint(chart()));
    expect(playFingerprint(chart('#TOTAL -5'))).toBe(playFingerprint(chart()));
  });

  test.each([
    ['5', '2'],
    ['-1', '2'],
    ['2.5', '2'],
    ['7.5', '2'],
    ['4', '4'],
    ['3.5', '7/2'],
    ['-0.5', '-1/2'],
  ])('reads #RANK %s as %s', (rank, expected) => {
    expect(playDocument(chart(`#RANK ${rank}`)).judge).toEqual({ rank: expected });
  });

  test('treats #BASEBPM equal to the initial BPM as absent', () => {
    expect(playFingerprint(chart('#BASEBPM 150'))).toBe(playFingerprint(chart()));
  });

  test('keeps an #EXRANK change at the start apart from #DEFEXRANK', () => {
    expect(playFingerprint(chart('#EXRANK01 100', '#000A0:01'))).not.toBe(playFingerprint(chart('#DEFEXRANK 100')));
  });

  test('plays lane 17 as FREE ZONE outside 9 KEY', () => {
    const lnobj = chart('#LNOBJ ZZ', '#00317:01ZZ');
    const tap = chart('#LNOBJ ZZ', '#00317:01');
    expect(playFingerprint(lnobj)).toBe(playFingerprint(tap));
    expect(playDocument(tap).notes).toContainEqual({ m: '3', p: '0', lane: '17', fz: true, ln: '1' });
    // In 9 KEY lane 17 is a key and the #LNOBJ end counts.
    expect(playFingerprint(lnobj, 'x.pms')).not.toBe(playFingerprint(tap, 'x.pms'));
    // A 57 long note keeps its own end.
    expect(playDocument(chart('#LNTYPE 1', '#00357:0101')).notes).toContainEqual({
      m: '3',
      p: '0',
      lane: '17',
      end: { m: '3', p: '1/2' },
      ln: '1',
    });
  });

  test('reads bmson total, judge_rank, mine damage and lines like the engine', () => {
    const bmson = (info: Record<string, unknown>, extra: Record<string, unknown> = {}): string =>
      JSON.stringify({
        version: '1.0.0',
        info: { init_bpm: 150, mode_hint: 'beat-7k', resolution: 240, ...info },
        sound_channels: [{ name: 'a.wav', notes: [{ x: 1, y: 960, l: 0, c: false }] }],
        ...extra,
      });
    const document = (text: string): BeMusicPlayFingerprintDocument =>
      createPlayFingerprintDocument(parseBmson(text), NO_PATH);
    expect(document(bmson({})).total).toBeNull();
    expect(computePlayFingerprint(parseBmson(bmson({})), NO_PATH)).toBe(
      computePlayFingerprint(parseBmson(bmson({ total: 100 })), NO_PATH),
    );
    expect(document(bmson({ total: 0 })).total).toBeNull();
    expect(document(bmson({ total: 120 })).total).toEqual({ bmson: '120' });
    expect(document(bmson({})).judge).toEqual({ exRank: '100' });
    const mines = { mine_channels: [{ name: 'mine.wav', notes: [{ x: 2, y: 960 }] }] };
    expect(document(bmson({}, mines)).mines).toEqual([{ m: '1', p: '0', lane: '12', damage: '4' }]);
    // Adding sound channels does not move the default damage.
    const more = {
      ...mines,
      sound_channels: [
        { name: 'a.wav', notes: [{ x: 1, y: 960, l: 0, c: false }] },
        { name: 'b.wav', notes: [] },
      ],
    };
    expect(document(bmson({}, more)).mines).toEqual(document(bmson({}, mines)).mines);
    const barless = document(bmson({}, { lines: [] }));
    expect(barless.measures.barLines).toBe(false);
    expect(document(bmson({})).measures.barLines).toBeUndefined();
  });
});

describe('bmson lanes as the parser maps them', () => {
  const bmson = (modeHint: string, extra: Record<string, unknown>): string =>
    JSON.stringify({
      version: '1.0.0',
      info: { init_bpm: 150, mode_hint: modeHint, resolution: 240 },
      ...extra,
    });

  test('leaves key_channels (hidden notes) out and reads mine_channels as mines', () => {
    const sound = { sound_channels: [{ name: 'a.wav', notes: [{ x: 1, y: 960, l: 0, c: false }] }] };
    const plain = createPlayFingerprintDocument(parseBmson(bmson('beat-7k', sound)), NO_PATH);
    const hidden = { ...sound, key_channels: [{ name: 'h.wav', notes: [{ x: 2, y: 960 }] }] };
    expect(createPlayFingerprintDocument(parseBmson(bmson('beat-7k', hidden)), NO_PATH)).toEqual(plain);
    const mines = { ...sound, mine_channels: [{ name: 'm.wav', notes: [{ x: 2, y: 960, damage: 7 }] }] };
    expect(createPlayFingerprintDocument(parseBmson(bmson('beat-7k', mines)), NO_PATH).mines).toEqual([
      { m: '1', p: '0', lane: '12', damage: '7' },
    ]);
  });

  test('reads beat-5k / beat-10k with the scratch on x 8 / 16', () => {
    const notes = [1, 5, 8].map((x) => ({ x, y: 960, l: 0, c: false }));
    const fiveKeys = createPlayFingerprintDocument(
      parseBmson(bmson('beat-5k', { sound_channels: [{ name: 'a.wav', notes }] })),
      NO_PATH,
    );
    expect(fiveKeys.laneMode).toBe('5');
    expect(fiveKeys.notes.map((note) => note.lane)).toEqual(['11', '15', '16']);
    expect(fiveKeys).toEqual(
      createPlayFingerprintDocument(
        parseBms(['#BPM 150', '#DEFEXRANK 100', '#00111:01', '#00115:01', '#00116:01'].join('\n')),
        NO_PATH,
      ),
    );
    const tenKeys = createPlayFingerprintDocument(
      parseBmson(
        bmson('beat-10k', {
          sound_channels: [{ name: 'a.wav', notes: [9, 13, 16].map((x) => ({ x, y: 960, l: 0, c: false })) }],
        }),
      ),
      NO_PATH,
    );
    expect(tenKeys.laneMode).toBe('10');
    expect(tenKeys.notes.map((note) => note.lane)).toEqual(['21', '25', '26']);
  });
});

describe('BMS against bmson', () => {
  const bms = [
    '#PLAYER 1',
    '#BPM 150',
    '#DEFEXRANK 100',
    '#WAV01 a.wav',
    '#WAVZZ end.wav',
    '#LNOBJ ZZ',
    '#BPM01 180',
    '#STOP01 48',
    '#00111:0101',
    '#00112:0001',
    '#00118:00000001',
    '#00113:0001',
    '#00213:ZZ',
    '#001D4:0A',
    '#00209:01',
    '#00208:0001',
  ].join('\n');

  const bmson = (total?: number): string =>
    JSON.stringify({
      version: '1.0.0',
      info: {
        title: 'other title',
        init_bpm: 150,
        mode_hint: 'beat-7k',
        resolution: 240,
        ...(total === undefined ? {} : { total }),
      },
      sound_channels: [
        {
          name: 'piano.wav',
          notes: [
            { x: 1, y: 960, l: 0, c: false },
            { x: 1, y: 1440, l: 0, c: false },
            { x: 2, y: 1440, l: 0, c: false },
            { x: 6, y: 1680, l: 0, c: false },
            { x: 3, y: 1440, l: 480, c: false },
            { x: 0, y: 0, l: 0, c: false },
          ],
        },
      ],
      mine_channels: [{ name: 'mine.wav', notes: [{ x: 4, y: 960, damage: 10 }] }],
      bpm_events: [{ y: 2400, bpm: 180 }],
      stop_events: [{ y: 1920, duration: 240 }],
    });

  test('gives the same play fingerprint', () => {
    // bmson `total` 0, absent or 100 all mean 100 % of the ruleset's default TOTAL, like a BMS chart without #TOTAL.
    const fromBms = createPlayFingerprintDocument(parseBms(bms), NO_PATH);
    const fromBmson = createPlayFingerprintDocument(parseBmson(bmson(0)), NO_PATH);
    expect(fromBmson).toEqual(fromBms);
    expect(fromBms.notes).toContainEqual({ m: '1', p: '1/2', lane: '13', end: { m: '2', p: '0' }, ln: '1' });
    expect(fromBms.mines).toEqual([{ m: '1', p: '0', lane: '14', damage: '10' }]);
    expect(computePlayFingerprint(parseBmson(bmson(0)), NO_PATH)).toBe(computePlayFingerprint(parseBms(bms), NO_PATH));
    expect(createPlayFingerprintDocument(parseBmson(bmson()), NO_PATH)).toEqual(fromBms);
    expect(createPlayFingerprintDocument(parseBmson(bmson(100)), NO_PATH)).toEqual(fromBms);
    // Any other percentage scales the default, which no BMS #TOTAL matches.
    expect(createPlayFingerprintDocument(parseBmson(bmson(150)), NO_PATH)).toEqual({
      ...fromBms,
      total: { bmson: '150' },
    });
  });

  // STOPs are left out: `stringifyBmson` writes `stop_events[].duration` in BMS STOP units instead of pulses.
  test('survives a stringifyBmson round trip', () => {
    const text = [
      '#BPM 150',
      '#DEFEXRANK 100',
      '#WAV01 a.wav',
      '#BPM01 180',
      '#00111:01',
      '#00112:0001',
      '#00113:000001',
      '#00114:01',
      '#00115:0100',
      '#00118:00000001',
      '#00119:0001',
      '#00202:0.75',
      '#00211:010101',
      '#00308:0001',
      '#00311:01',
    ].join('\n');
    const original = parseBms(text);
    const converted = parseBmson(stringifyBmson(original));
    // The stringifier leaves out `total`, which bmson reads as 100 % of the default TOTAL, like a BMS without #TOTAL.
    expect(createPlayFingerprintDocument(converted, NO_PATH)).toEqual(createPlayFingerprintDocument(original, NO_PATH));
  });
});

describe('control flow', () => {
  const randomChart = (...blocks: string[]): string => chart('#RANDOM 2', ...blocks, '#ENDRANDOM');

  test('a chart without control flow has equal chart and play fingerprints', () => {
    const json = parseBms(chart());
    expect(createChartFingerprintDocument(json, NO_PATH)).toEqual(createPlayFingerprintDocument(json, NO_PATH));
    expect(computeChartFingerprint(json, NO_PATH)).toBe(computePlayFingerprint(json, NO_PATH));
  });

  test('keeps the chart fingerprint across branch selections while the play fingerprint follows the branch', () => {
    const json = parseBms(randomChart('#IF 1', '#00313:01', '#ENDIF', '#IF 2', '#00314:01', '#ENDIF'));
    const first = resolveBmsControlFlow(json, { random: () => 0 });
    const second = resolveBmsControlFlow(json, { random: () => 0.99 });
    const swapped = randomChart('#IF 2', '#00314:01', '#ENDIF', '#IF 1', '#00313:01', '#ENDIF');
    expect(computeChartFingerprint(json, NO_PATH)).toBe(chartFingerprint(swapped));
    expect(computePlayFingerprint(first, NO_PATH)).not.toBe(computePlayFingerprint(second, NO_PATH));
    expect(computePlayFingerprint(first, NO_PATH)).toBe(playFingerprint(chart('#00313:01')));
    expect(computePlayFingerprint(second, NO_PATH)).toBe(playFingerprint(chart('#00314:01')));
    expect(computeChartFingerprint(json, NO_PATH)).not.toBe(computePlayFingerprint(first, NO_PATH));

    const document = chartDocument(randomChart('#IF 1', '#00313:01', '#ENDIF', '#IF 2', '#00314:01', '#ENDIF'));
    expect(document.random).toEqual([
      {
        random: '2',
        branches: [
          { values: ['1'], add: { notes: [{ m: '3', p: '0', lane: '13' }] } },
          { values: ['2'], add: { notes: [{ m: '3', p: '0', lane: '14' }] } },
        ],
      },
    ]);
    expect(document.lanes).toEqual({ extension: null, player3: false });
    expect(document.measures.count).toBe('4');
  });

  test('resolves #SETRANDOM and #RANDOM 1 in place', () => {
    const inline = playFingerprint(chart('#00314:01'));
    for (const text of [
      chart('#SETRANDOM 2', '#IF 1', '#00313:01', '#ENDIF', '#IF 2', '#00314:01', '#ENDIF', '#ENDRANDOM'),
      chart('#RANDOM 1', '#IF 1', '#00314:01', '#ENDIF', '#IF 2', '#00313:01', '#ENDIF', '#ENDRANDOM'),
    ]) {
      const json = parseBms(text);
      expect('random' in createChartFingerprintDocument(json, NO_PATH)).toBe(false);
      expect(computeChartFingerprint(json, NO_PATH)).toBe(inline);
      expect(computePlayFingerprint(resolveBmsControlFlow(json), NO_PATH)).toBe(inline);
    }
  });

  test('merges sibling #IF blocks with the same value', () => {
    const split = randomChart(
      '#IF 1',
      '#00313:01',
      '#ENDIF',
      '#IF 2',
      '#00314:01',
      '#ENDIF',
      '#IF 1',
      '#00315:01',
      '#ENDIF',
    );
    const merged = randomChart('#IF 1', '#00313:01', '#00315:01', '#ENDIF', '#IF 2', '#00314:01', '#ENDIF');
    expect(chartFingerprint(split)).toBe(chartFingerprint(merged));
  });

  test('keys branches by value sets, so #ELSE equals listing the other values (finding A8)', () => {
    const withElse = chart('#RANDOM 3', '#IF 1', '#00313:01', '#ELSE', '#00314:01', '#ENDIF', '#ENDRANDOM');
    const listed = chart(
      '#RANDOM 3',
      '#IF 1',
      '#00313:01',
      '#ENDIF',
      '#IF 2',
      '#00314:01',
      '#ENDIF',
      '#IF 3',
      '#00314:01',
      '#ENDIF',
      '#ENDRANDOM',
    );
    expect(chartFingerprint(listed)).toBe(chartFingerprint(withElse));
    expect(chartDocument(withElse).random).toEqual([
      {
        random: '3',
        branches: [
          { values: ['1'], add: { notes: [{ m: '3', p: '0', lane: '13' }] } },
          { values: ['2-3'], add: { notes: [{ m: '3', p: '0', lane: '14' }] } },
        ],
      },
    ]);
  });

  test('gives #SWITCH and the equivalent #RANDOM one node type (finding A8)', () => {
    const switched = chart('#SWITCH 3', '#CASE 1', '#00313:01', '#SKIP', '#DEF', '#00314:01', '#ENDSW');
    const random = chart('#RANDOM 3', '#IF 1', '#00313:01', '#ELSE', '#00314:01', '#ENDIF', '#ENDRANDOM');
    expect(chartFingerprint(switched)).toBe(chartFingerprint(random));
  });

  test('builds #SWITCH branches with fall-through and #DEF', () => {
    const document = chartDocument(
      chart('#SWITCH 3', '#CASE 1', '#00313:01', '#CASE 2', '#00314:01', '#SKIP', '#DEF', '#00315:01', '#ENDSW'),
    );
    expect(document.random).toEqual([
      {
        random: '3',
        branches: [
          {
            values: ['1'],
            add: {
              notes: [
                { m: '3', p: '0', lane: '13' },
                { m: '3', p: '0', lane: '14' },
              ],
            },
          },
          { values: ['2'], add: { notes: [{ m: '3', p: '0', lane: '14' }] } },
          { values: ['3'], add: { notes: [{ m: '3', p: '0', lane: '15' }] } },
        ],
      },
    ]);
  });

  test('hoists content every outcome plays, so a block that plays alike for every value disappears', () => {
    const plain = playFingerprint(chart('#00315:01'));
    for (const text of [
      chart('#RANDOM 2', '#00315:01', '#ENDRANDOM'),
      chart('#RANDOM 2', '#IF 1', '#00315:01', '#ENDIF', '#IF 2', '#00315:01', '#ENDIF', '#ENDRANDOM'),
      chart('#RANDOM 2', '#IF 1', '#00315:01', '#ELSE', '#00315:01', '#ENDIF', '#ENDRANDOM'),
      chart('#00315:01', '#RANDOM 2', '#IF 1', '#WAV03 c.wav', '#ENDIF', '#ENDRANDOM'),
    ]) {
      expect(chartFingerprint(text)).toBe(plain);
    }
    // Content outside every #IF goes to the top, with or without #ENDRANDOM.
    const inside = chart('#RANDOM 2', '#00315:01', '#IF 1', '#00313:01', '#ENDIF', '#ENDRANDOM');
    const outside = chart('#00315:01', '#RANDOM 2', '#IF 1', '#00313:01', '#ENDIF', '#ENDRANDOM');
    const withoutEnd = chart('#RANDOM 2', '#00315:01', '#IF 1', '#00313:01', '#ENDIF');
    expect(chartFingerprint(inside)).toBe(chartFingerprint(outside));
    expect(chartFingerprint(withoutEnd)).toBe(chartFingerprint(outside));
  });

  test('applies definitions and header values made inside a branch to the whole chart (finding A6)', () => {
    const redefine = (bpm: number): string =>
      chart('#BPM01 300', '#00208:01', '#RANDOM 2', '#IF 1', `#BPM01 ${bpm}`, '#ENDIF', '#ENDRANDOM');
    expect(chartFingerprint(redefine(200))).not.toBe(chartFingerprint(redefine(250)));
    expect(chartDocument(redefine(200)).random).toEqual([
      {
        random: '2',
        branches: [
          {
            values: ['1'],
            add: { timeline: [{ m: '2', p: '0', type: 'bpm', v: '200' }] },
            remove: { timeline: [{ m: '2', p: '0', type: 'bpm', v: '300' }] },
          },
          { values: ['2'] },
        ],
      },
    ]);
    const document = chartDocument(randomChart('#IF 1', '#TOTAL 400', '#00202:0.5', '#ENDIF'));
    expect(document.random).toEqual([
      {
        random: '2',
        branches: [
          { values: ['1'], add: { lengths: [['2', '1/2']] }, header: { total: { bms: '400' } } },
          { values: ['2'] },
        ],
      },
    ]);
  });

  test('pairs long-note halves across a branch boundary (finding A6)', () => {
    const halves = chart('#LNOBJ ZZ', '#00313:01', '#RANDOM 2', '#IF 1', '#00413:ZZ', '#ENDIF', '#ENDRANDOM');
    const taps = chart('#LNOBJ ZZ', '#00313:01', '#RANDOM 2', '#IF 1', '#00413:01', '#ENDIF', '#ENDRANDOM');
    expect(chartFingerprint(halves)).not.toBe(chartFingerprint(taps));
    expect(chartDocument(halves).random).toEqual([
      {
        random: '2',
        branches: [
          {
            values: ['1'],
            add: { notes: [{ m: '3', p: '0', lane: '13', end: { m: '4', p: '0' }, ln: '1' }] },
            remove: { notes: [{ m: '3', p: '0', lane: '13' }] },
          },
          { values: ['2'] },
        ],
      },
    ]);
  });

  test('keeps a no-op drop only for state no branch changes (finding A9)', () => {
    const block = ['#RANDOM 2', '#IF 1', '#00313:01', '#ENDIF', '#ENDRANDOM'];
    // The BPM change to the BPM in effect is dropped: no branch changes the BPM.
    expect(chartFingerprint(chart('#BPM01 150', '#00208:01', ...block))).toBe(chartFingerprint(chart(...block)));
    // A branch that changes the BPM keeps the outside change: whether it is a no-op depends on the outcome.
    const bpmBlock = ['#BPM02 180', '#RANDOM 2', '#IF 1', '#00108:02', '#ENDIF', '#ENDRANDOM'];
    expect(chartFingerprint(chart('#BPM01 150', '#00208:01', ...bpmBlock))).not.toBe(
      chartFingerprint(chart(...bpmBlock)),
    );
  });

  test('changes the chart fingerprint with the branch content', () => {
    expect(chartFingerprint(randomChart('#IF 1', '#00313:01', '#ENDIF'))).not.toBe(
      chartFingerprint(randomChart('#IF 1', '#00314:01', '#ENDIF')),
    );
    // The values that play a branch are part of the document.
    expect(chartFingerprint(randomChart('#IF 1', '#00313:01', '#ENDIF'))).not.toBe(
      chartFingerprint(randomChart('#IF 2', '#00313:01', '#ENDIF')),
    );
    expect(chartFingerprint(chart('#RANDOM 3', '#IF 1', '#00313:01', '#ENDIF', '#ENDRANDOM'))).not.toBe(
      chartFingerprint(randomChart('#IF 1', '#00313:01', '#ENDIF')),
    );
  });
});
