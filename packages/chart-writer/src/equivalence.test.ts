import { describe, expect, test } from 'vite-plus/test';
import { parseBMS, parseBmson } from '../../chart-parser/src/index.ts';
import { areBMSChartsEquivalent, areBmsonChartsEquivalent, areEventBmsonExtensionsEqual } from './equivalence.ts';

const bms = (title: string): string => [`#TITLE ${title}`, '#BPM 150', '#WAV01 kick.wav', '#00111:01'].join('\n');

const bmson = (initBPM: number): string =>
  JSON.stringify({
    version: '1.0.0',
    info: { title: 'Doc', init_bpm: initBPM, resolution: 240 },
    lines: [{ y: 0 }, { y: 960 }],
    sound_channels: [{ name: 'kick.wav', notes: [{ x: 1, y: 0, l: 0, c: false }] }],
  });

describe('areEventBmsonExtensionsEqual', () => {
  test('compares the bmson length and continuation flag', () => {
    expect(areEventBmsonExtensionsEqual(undefined, undefined)).toBe(true);
    expect(areEventBmsonExtensionsEqual({ l: 240, c: true }, { l: 240, c: true })).toBe(true);
    expect(areEventBmsonExtensionsEqual({ l: 240 }, { l: 480 })).toBe(false);
    expect(areEventBmsonExtensionsEqual({ c: true }, undefined)).toBe(false);
    expect(areEventBmsonExtensionsEqual({ up: true }, { up: false })).toBe(false);
    expect(areEventBmsonExtensionsEqual({ t: 1 }, { t: 2 })).toBe(false);
    expect(
      areEventBmsonExtensionsEqual(
        { extraFields: { vendor: { a: [null, 1], b: false } } },
        { extraFields: { vendor: { b: false, a: [null, 1] } } },
      ),
    ).toBe(true);
    expect(
      areEventBmsonExtensionsEqual({ extraFields: { vendor: [null, 1] } }, { extraFields: { vendor: [1, null] } }),
    ).toBe(false);
  });
});

describe('areBMSChartsEquivalent', () => {
  test('holds for the same BMS source and fails when a header differs', () => {
    expect(areBMSChartsEquivalent(parseBMS(bms('A')), parseBMS(bms('A')))).toBe(true);
    expect(areBMSChartsEquivalent(parseBMS(bms('A')), parseBMS(bms('B')))).toBe(false);
  });
});

describe('areBmsonChartsEquivalent', () => {
  test('holds for the same bmson source and fails when the chart differs', () => {
    expect(areBmsonChartsEquivalent(parseBmson(bmson(150)), parseBmson(bmson(150)))).toBe(true);
    expect(areBmsonChartsEquivalent(parseBmson(bmson(150)), parseBmson(bmson(180)))).toBe(false);
    const source = parseBmson(bmson(150));
    const suppressed = structuredClone(source);
    suppressed.bmson.barlinesSuppressed = true;
    expect(areBmsonChartsEquivalent(source, suppressed)).toBe(false);
  });
});

test('bmson equivalence includes up and type changes in preserved sound channels', () => {
  const source = parseBmson(bmson(120));
  for (const field of ['up', 't'] as const) {
    const changed = structuredClone(source);
    const note = changed.preservation.bmson.soundChannels[0]!.notes[0]!;
    if (field === 'up') note.up = true;
    else note.t = 2;
    expect(areBmsonChartsEquivalent(source, changed)).toBe(false);
  }
});

test('BMS preservation rejects edits to an unselected random branch', () => {
  const source = parseBMS(
    [
      '#TITLE Chart',
      '#BPM 120',
      '#WAV01 a.wav',
      '#WAV02 b.wav',
      '#RANDOM 2',
      '#IF 1',
      '#00111:01',
      '#ELSE',
      '#00112:02',
      '#ENDIF',
      '#ENDRANDOM',
    ].join('\n'),
  );
  const edited = structuredClone(source);
  const elseIndex = edited.preservation.bms.sourceLines.findIndex(
    (entry) => entry.kind === 'directive' && entry.command === 'ELSE',
  );
  expect(elseIndex).toBeGreaterThan(-1);
  const branch = edited.preservation.bms.sourceLines[elseIndex + 1];
  if (branch?.kind !== 'object') throw new Error('Missing preserved object in the ELSE branch');
  edited.preservation.bms.sourceLines[elseIndex + 1] = {
    ...branch,
    events: branch.events.map((event) => ({ ...event, value: '01' })),
  };
  expect(edited.events).toEqual(source.events);
  expect(edited.bms.controlFlow).toEqual(source.bms.controlFlow);
  expect(areBMSChartsEquivalent(source, edited)).toBe(false);
});

test.each([
  ['BPM', { bpmEvents: [{ y: 240, bpm: 180 }] }, { bpmEvents: [{ y: 240, bpm: 200 }] }],
  ['STOP', { stopEvents: [{ y: 480, duration: 120 }] }, { stopEvents: [{ y: 480, duration: 240 }] }],
  ['SCROLL', { scrollEvents: [{ y: 720, rate: 0.5 }] }, { scrollEvents: [{ y: 720, rate: 0.75 }] }],
] as const)(
  'bmson preservation detects a stale %s event even when the live chart still matches',
  (_, before, after) => {
    const source = parseBmson(bmson(120));
    const preserved = structuredClone(source);
    Object.assign(preserved.preservation.bmson, before);
    const edited = structuredClone(preserved);
    Object.assign(edited.preservation.bmson, after);

    expect(areBmsonChartsEquivalent(preserved, structuredClone(preserved))).toBe(true);
    expect(areBmsonChartsEquivalent(preserved, edited)).toBe(false);
  },
);
