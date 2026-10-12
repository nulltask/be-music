import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vite-plus/test';
import { parseBms, parseBmson, resolveBmsControlFlow } from '../../parser/src/index.ts';
import { stringifyBmson } from '../../stringifier/src/index.ts';
import {
  canonicalizeFingerprintDocument,
  computeChartFingerprint,
  computePlayFingerprint,
  createChartFingerprintDocument,
  createPlayFingerprintDocument,
} from './index.ts';

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

function playFingerprint(text: string, chartPath?: string): string {
  return computePlayFingerprint(parseBms(text), { chartPath });
}

function chartFingerprint(text: string): string {
  return computeChartFingerprint(parseBms(text));
}

function firstRandom(random: unknown[]): unknown {
  expect(random).toHaveLength(1);
  return random[0];
}

describe('fingerprint document', () => {
  test('builds the canonical document of a chart', () => {
    const document = createPlayFingerprintDocument(
      parseBms(
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
      ),
    );
    expect(document).toEqual({
      v: 'bmfp1',
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
      random: [],
    });
  });

  test('serializes with RFC 8785 and hashes the UTF-8 bytes with SHA-256', () => {
    const json = parseBms(chart());
    const canonical = canonicalizeFingerprintDocument(createPlayFingerprintDocument(json));
    expect(canonical.startsWith('{"baseBpm":null,"bpm":"150","judge":{"rank":"2"},"laneMode":"7","measures":')).toBe(
      true,
    );
    expect(canonical).not.toMatch(/\s/);
    const expected = createHash('sha256').update(Buffer.from(canonical, 'utf8')).digest('hex');
    expect(computePlayFingerprint(json)).toBe(`bmfp1:${expected}`);
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
    const rounded = chart(
      '#00102:0.3333',
      '#BPM01 133.3333333333',
      '#00208:01',
      '#00116:0001',
      '#00216:01',
      '#LNOBJ 01',
    );
    const document = createPlayFingerprintDocument(parseBms(precise));
    expect(document.measures.lengths).toEqual([['1', '1/3']]);
    expect(playFingerprint(rounded)).toBe(playFingerprint(precise));
  });

  test('absorbs float noise in values', () => {
    expect(playFingerprint(chart('#BPM01 149.99999999', '#00308:01'))).toBe(
      playFingerprint(chart('#BPM01 150', '#00308:01')),
    );
  });

  test('ignores BGA, BGM, keysounds, invisible notes and metadata', () => {
    const base = playFingerprint(chart());
    const variants = [
      chart('#BMP01 bg.bmp', '#00104:01', '#00107:01', '#00106:01'),
      chart('#00101:0102', '#00201:02'),
      chart().replace('#00111:01020102', '#00111:02010201'),
      chart('#00131:01', '#00241:02'),
      chart('#GENRE other', '#PLAYLEVEL 12', '#DIFFICULTY 4', '#STAGEFILE s.png', '#BANNER b.png', '#COMMENT hi'),
      chart('#WAV03 c.wav', '#VOLWAV 50', '#00197:80'),
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
      '#002SP:01', // SPEED change to 1
    );
    expect(playFingerprint(noOps)).toBe(base);
  });

  test('keeps the last change of one kind at one time', () => {
    const both = chart('#BPM01 180', '#BPM02 200', '#00308:01', '#00308:02');
    const last = chart('#BPM02 200', '#00308:02');
    expect(playFingerprint(both)).toBe(playFingerprint(last));
  });

  test('drops an #EXRANK change to the value of the previous one', () => {
    const twice = chart('#EXRANK01 50', '#EXRANK02 50', '#002A0:01', '#003A0:02');
    const once = chart('#EXRANK01 50', '#002A0:01');
    expect(playFingerprint(twice)).toBe(playFingerprint(once));
  });

  test('ignores measures after the last included event', () => {
    const base = playFingerprint(chart());
    expect(playFingerprint(chart('#01002:0.5', '#02001:01', '#03004:01'))).toBe(base);
    expect(createPlayFingerprintDocument(parseBms(chart('#01002:0.5'))).measures.count).toBe('3');
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
    ['#BASEBPM', chart('#BASEBPM 150')],
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
    ['the #BASEBPM value', '#BASEBPM 150', '#BASEBPM 200'],
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
    const json = parseBms(chart());
    expect(createPlayFingerprintDocument(json).total).toBeNull();
    expect(createPlayFingerprintDocument(parseBms(chart('#TOTAL 160'))).total).toEqual({ bms: '160' });
  });

  test('keeps #RANK and #DEFEXRANK on separate axes', () => {
    expect(createPlayFingerprintDocument(parseBms(chart('#RANK 2'))).judge).toEqual({ rank: '2' });
    expect(createPlayFingerprintDocument(parseBms(chart('#RANK 2', '#DEFEXRANK 100'))).judge).toEqual({
      exRank: '100',
    });
  });

  test('changes with the lane mode', () => {
    const text = chart();
    expect(createPlayFingerprintDocument(parseBms(text), { chartPath: 'song.pms' }).laneMode).toBe('9');
    expect(playFingerprint(text, 'song.pms')).not.toBe(playFingerprint(text, 'song.bms'));
    expect(createPlayFingerprintDocument(parseBms(chart('#00221:01'))).laneMode).toBe('14');
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

  const bmson = JSON.stringify({
    version: '1.0.0',
    info: { title: 'other title', init_bpm: 150, mode_hint: 'beat-7k', resolution: 240 },
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
    key_channels: [{ name: 'mine.wav', notes: [{ x: 4, y: 960, damage: 10 }] }],
    bpm_events: [{ y: 2400, bpm: 180 }],
    stop_events: [{ y: 1920, duration: 240 }],
  });

  test('gives the same play fingerprint', () => {
    const fromBms = createPlayFingerprintDocument(parseBms(bms));
    const fromBmson = createPlayFingerprintDocument(parseBmson(bmson));
    expect(fromBmson).toEqual(fromBms);
    expect(fromBms.notes).toContainEqual({ m: '1', p: '1/2', lane: '13', end: { m: '2', p: '0' }, ln: '1' });
    expect(fromBms.mines).toEqual([{ m: '1', p: '0', lane: '14', damage: '10' }]);
    expect(computePlayFingerprint(parseBmson(bmson))).toBe(computePlayFingerprint(parseBms(bms)));
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
    expect(createPlayFingerprintDocument(converted)).toEqual(createPlayFingerprintDocument(original));
  });
});

describe('control flow', () => {
  const randomChart = (...blocks: string[]): string => chart('#RANDOM 2', ...blocks, '#ENDRANDOM');

  test('a chart without control flow has equal chart and play fingerprints', () => {
    const json = parseBms(chart());
    expect(createChartFingerprintDocument(json)).toEqual(createPlayFingerprintDocument(json));
    expect(computeChartFingerprint(json)).toBe(computePlayFingerprint(json));
  });

  test('keeps the chart fingerprint across branch selections while the play fingerprint follows the branch', () => {
    const json = parseBms(randomChart('#IF 1', '#00313:01', '#ENDIF', '#IF 2', '#00314:01', '#ENDIF'));
    const first = resolveBmsControlFlow(json, { random: () => 0 });
    const second = resolveBmsControlFlow(json, { random: () => 0.99 });
    const swapped = randomChart('#IF 2', '#00314:01', '#ENDIF', '#IF 1', '#00313:01', '#ENDIF');
    expect(computeChartFingerprint(json)).toBe(chartFingerprint(swapped));
    expect(computePlayFingerprint(first)).not.toBe(computePlayFingerprint(second));
    expect(computePlayFingerprint(first)).toBe(playFingerprint(chart('#00313:01')));
    expect(computePlayFingerprint(second)).toBe(playFingerprint(chart('#00314:01')));
    expect(computeChartFingerprint(json)).not.toBe(computePlayFingerprint(first));

    const document = createChartFingerprintDocument(json);
    expect(firstRandom(document.random)).toEqual({
      random: '2',
      branches: [
        {
          when: '1',
          measures: { lengths: [] },
          notes: [{ m: '3', p: '0', lane: '13' }],
          mines: [],
          timeline: [],
          random: [],
        },
        {
          when: '2',
          measures: { lengths: [] },
          notes: [{ m: '3', p: '0', lane: '14' }],
          mines: [],
          timeline: [],
          random: [],
        },
      ],
    });
    expect(document.measures.count).toBe('4');
  });

  test('resolves #SETRANDOM and #RANDOM 1 in place', () => {
    const inline = playFingerprint(chart('#00314:01'));
    for (const text of [
      chart('#SETRANDOM 2', '#IF 1', '#00313:01', '#ENDIF', '#IF 2', '#00314:01', '#ENDIF', '#ENDRANDOM'),
      chart('#RANDOM 1', '#IF 1', '#00314:01', '#ENDIF', '#IF 2', '#00313:01', '#ENDIF', '#ENDRANDOM'),
    ]) {
      const json = parseBms(text);
      expect(createChartFingerprintDocument(json).random).toEqual([]);
      expect(computeChartFingerprint(json)).toBe(inline);
      expect(computePlayFingerprint(resolveBmsControlFlow(json))).toBe(inline);
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

  test('turns #ELSE into the default branch and drops empty branches', () => {
    const json = parseBms(
      chart(
        '#RANDOM 3',
        '#IF 1',
        '#00313:01',
        '#ELSE',
        '#00314:01',
        '#ENDIF',
        '#IF 2',
        '#WAV03 c.wav',
        '#ENDIF',
        '#ENDRANDOM',
      ),
    );
    const node = firstRandom(createChartFingerprintDocument(json).random) as {
      branches: Array<Record<string, unknown>>;
    };
    expect(node.branches.map((branch) => branch.when ?? (branch.default ? 'default' : '?'))).toEqual([
      '1',
      '2',
      'default',
    ]);
    // `#IF 2` only defines a sound, but `#ELSE` of the first block still plays for 2.
    expect(node.branches[1]!.notes).toEqual([{ m: '3', p: '0', lane: '14' }]);
  });

  test('lists content outside every #IF at the top level', () => {
    const inside = chart('#RANDOM 2', '#00315:01', '#IF 1', '#00313:01', '#ENDIF', '#ENDRANDOM');
    const outside = chart('#00315:01', '#RANDOM 2', '#IF 1', '#00313:01', '#ENDIF', '#ENDRANDOM');
    const withoutEnd = chart('#RANDOM 2', '#00315:01', '#IF 1', '#00313:01', '#ENDIF');
    expect(chartFingerprint(inside)).toBe(chartFingerprint(outside));
    expect(chartFingerprint(withoutEnd)).toBe(chartFingerprint(outside));
  });

  test('applies definitions and header values made inside a branch', () => {
    const json = parseBms(
      randomChart(
        '#IF 1',
        '#BPM02 200',
        '#00308:02',
        '#TOTAL 400',
        '#00302:0.5',
        '#ENDIF',
        '#IF 2',
        '#00313:01',
        '#ENDIF',
      ),
    );
    const node = firstRandom(createChartFingerprintDocument(json).random) as {
      branches: Array<Record<string, unknown>>;
    };
    expect(node.branches[0]).toMatchObject({
      when: '1',
      header: { total: '400' },
      measures: { lengths: [['3', '1/2']] },
      timeline: [{ m: '3', p: '0', type: 'bpm', v: '200' }],
    });
  });

  test('builds #SWITCH branches with fall-through and #DEF', () => {
    const json = parseBms(
      chart('#SWITCH 3', '#CASE 1', '#00313:01', '#CASE 2', '#00314:01', '#SKIP', '#DEF', '#00315:01', '#ENDSW'),
    );
    const node = firstRandom(createChartFingerprintDocument(json).random) as {
      switch: string;
      branches: Array<{ notes: unknown[] }>;
    };
    expect(node.switch).toBe('3');
    expect(node.branches.map((branch) => branch.notes.length)).toEqual([2, 1, 1]);
  });

  test('changes the chart fingerprint with the branch content', () => {
    expect(chartFingerprint(randomChart('#IF 1', '#00313:01', '#ENDIF'))).not.toBe(
      chartFingerprint(randomChart('#IF 1', '#00314:01', '#ENDIF')),
    );
    expect(chartFingerprint(randomChart('#IF 1', '#00313:01', '#ENDIF'))).not.toBe(
      chartFingerprint(randomChart('#IF 2', '#00313:01', '#ENDIF')),
    );
  });
});
