import { describe, expect, test } from 'vite-plus/test';
import { createBeatResolver, resolveBMSLongNotes, resolveLNOBJLongNotes } from '../../chart-model/src/index.ts';
import { resolveBMSBase, type BeMusicJSON } from '../../chart-source/src/index.ts';
import { parseBMS, parseBmson } from '../../chart-parser/src/index.ts';
import { resolveLandmineGaugeEffect } from '../../player-engine/src/core/landmine.ts';
import { stringifyBMS, stringifyBmson } from './index.ts';

interface BmsonNote {
  x: number;
  y: number;
  l: number;
  c: boolean;
  t?: number;
}

interface BmsonOutput {
  info: Record<string, unknown>;
  sound_channels: Array<{ name: string; notes: BmsonNote[] }>;
  mine_channels?: Array<{ name: string; notes: Array<{ x: number; y: number; damage?: number }> }>;
}

const bms = (...lines: string[]): BeMusicJSON => parseBMS([...lines, ''].join('\n'));
const toBmson = (json: BeMusicJSON): BmsonOutput => JSON.parse(stringifyBmson(json)) as BmsonOutput;
const bmson = (document: Record<string, unknown>): BeMusicJSON =>
  parseBmson(JSON.stringify({ version: '1.0.0', ...document }));
const headerLines = (output: string, command: string): string[] =>
  output.split('\n').filter((line) => line.startsWith(`#${command} `) || line === `#${command}`);

/** Every long note of a BMS chart as `[lane, startBeat, endBeat]`, both `#LNTYPE` and `#LNOBJ` spellings. */
function bmsLongNotes(json: BeMusicJSON): Array<[string, number, number]> {
  const resolver = createBeatResolver(json);
  const notes: Array<[string, number, number]> = [];
  for (const note of resolveBMSLongNotes(json, { inferLNTypeWhenMissing: true }).notes) {
    if (note.endBeat !== undefined) notes.push([note.channel, note.beat, note.endBeat]);
  }
  for (const [event, endBeat] of resolveLNOBJLongNotes(json).startToEndBeat) {
    notes.push([event.channel, resolver.eventToBeat(event), endBeat]);
  }
  return roundBeats(notes);
}

/** Beats rounded past floating-point noise, sorted by start beat then lane. */
function roundBeats(notes: Array<[string, number, number]>): Array<[string, number, number]> {
  const round = (beat: number): number => Math.round(beat * 1e9) / 1e9;
  return notes
    .map(([lane, start, end]): [string, number, number] => [lane, round(start), round(end)])
    .sort((left, right) => left[1] - right[1] || left[0].localeCompare(right[0]));
}

/** Every long note of a bmson-sourced chart as `[lane, startBeat, endBeat]`. */
function bmsonLongNotes(json: BeMusicJSON): Array<[string, number, number]> {
  const resolver = createBeatResolver(json);
  const resolution = json.bmson.info.resolution ?? 240;
  return roundBeats(
    json.events
      .filter((event) => (event.bmson?.l ?? 0) > 0)
      .map((event): [string, number, number] => {
        const beat = resolver.eventToBeat(event);
        return [event.channel, beat, beat + event.bmson!.l! / resolution];
      }),
  );
}

function mineDamages(json: BeMusicJSON): Array<[string, number]> {
  return json.events
    .filter((event) => /^[DE]/.test(event.channel))
    .map((event) => [event.channel, resolveLandmineGaugeEffect(event, resolveBMSBase(json), json.sourceFormat).damage]);
}

describe('BMS → bmson conversion', () => {
  test('#LNOBJ long notes become one note with `l`; the end object is not a note of its own', () => {
    const source = bms('#BPM 120', '#WAV01 key.wav', '#WAVZZ end.wav', '#LNOBJ ZZ', '#00111:0100ZZ00', '#00112:01');
    const output = toBmson(source);

    expect(output.sound_channels).toEqual([
      {
        name: 'key.wav',
        notes: [
          { x: 1, y: 960, l: 480, c: false },
          { x: 2, y: 960, l: 0, c: false },
        ],
      },
    ]);
    expect(bmsonLongNotes(parseBmson(JSON.stringify(output)))).toEqual(bmsLongNotes(source));
  });

  test('#LNTYPE 1 `5x` / `6x` long notes land on their playable lanes with `l`', () => {
    const source = bms(
      '#BPM 120',
      '#WAV01 key.wav',
      '#LNTYPE 1',
      '#00151:01000100',
      '#00111:00000001',
      '#00162:0001',
      '#00262:01',
    );
    const output = toBmson(source);

    // Lanes 11 and 22 only: `51` sits on `11` and `62` on `22`, so they get no `x` of their own. That is PMS-STD
    // content, written under the canonical `popn-9k` table (11 → x1, 22 → x6).
    expect(output.info.mode_hint).toBe('popn-9k');
    expect(output.sound_channels[0]!.notes).toEqual([
      { x: 1, y: 960, l: 480, c: false },
      { x: 6, y: 1440, l: 480, c: false },
      { x: 1, y: 1680, l: 0, c: false },
    ]);
    expect(bmsonLongNotes(parseBmson(JSON.stringify(output)))).toEqual(bmsLongNotes(source));
  });

  test('#LNTYPE 2 runs become a single long note each', () => {
    const source = bms('#BPM 120', '#WAV01 key.wav', '#LNTYPE 2', '#00151:01010100');
    const output = toBmson(source);

    expect(output.sound_channels[0]!.notes).toEqual([{ x: 1, y: 960, l: 720, c: false }]);
    expect(bmsonLongNotes(parseBmson(JSON.stringify(output)))).toEqual(bmsLongNotes(source));
  });

  test('a `5x` start without an end stays a short note on its lane', () => {
    const output = toBmson(bms('#BPM 120', '#WAV01 key.wav', '#LNTYPE 1', '#00151:01'));
    expect(output.sound_channels[0]!.notes).toEqual([{ x: 1, y: 960, l: 0, c: false }]);
  });

  test.each([
    [1, 1],
    [2, 2],
    [3, 3],
  ])('#LNMODE %i becomes `info.ln_type` %i', (lnMode, lnType) => {
    const output = toBmson(bms('#BPM 120', '#WAV01 key.wav', `#LNMODE ${lnMode}`, '#LNOBJ ZZ', '#00111:01ZZ'));
    expect(output.info.ln_type).toBe(lnType);
  });

  test('a chart without #LNMODE (or with one bmson cannot express) leaves `ln_type` out', () => {
    expect(toBmson(bms('#BPM 120', '#WAV01 key.wav', '#00111:01')).info).not.toHaveProperty('ln_type');
    expect(toBmson(bms('#BPM 120', '#WAV01 key.wav', '#LNMODE 4', '#00111:01')).info).not.toHaveProperty('ln_type');
  });

  test('a mine keeps its base-36 value as `damage`, and the #WAV00 explosion as its sample', () => {
    const source = bms('#BPM 120', '#WAV00 bomb.wav', '#WAV01 key.wav', '#00111:01', '#001D1:0A', '#001D2:00ZZ');
    const output = toBmson(source);

    expect(output.mine_channels).toEqual([
      {
        name: 'bomb.wav',
        notes: [
          { x: 1, y: 960, damage: 10 },
          { x: 2, y: 1440, damage: 1295 },
        ],
      },
    ]);
    // The WAV slot that `#WAV0A` / `#WAVZZ` would name is never mistaken for the mine's sample or damage.
    expect(mineDamages(parseBmson(JSON.stringify(output)))).toEqual(mineDamages(source));
  });

  test('a mine whose value is not a damage encoding leaves `damage` out, so both sides deal the default', () => {
    // Under #BASE 62 the lower-case `0a` is not an upper-case base-36 damage; without #WAV00 the sample is silent.
    const source = bms('#BASE 62', '#BPM 120', '#WAV01 key.wav', '#00111:01', '#001D1:0a');
    const output = toBmson(source);

    expect(output.mine_channels).toEqual([{ name: '', notes: [{ x: 1, y: 960 }] }]);
    expect(mineDamages(parseBmson(JSON.stringify(output)))).toEqual(mineDamages(source));
  });
});

describe('bmson → BMS conversion', () => {
  const longNoteChart = (info: Record<string, unknown>, notes: Array<Record<string, unknown>>) =>
    bmson({
      info: { title: 'LN', init_bpm: 120, resolution: 240, mode_hint: 'beat-7k', ...info },
      sound_channels: [{ name: 'key.wav', notes }],
    });

  test('long notes become #LNTYPE 1 `5x` / `6x` pairs that re-parse to the same long notes', () => {
    const source = longNoteChart({}, [
      { x: 1, y: 0, l: 480 },
      { x: 2, y: 240, l: 0 },
      { x: 8, y: 480, l: 1200 },
    ]);
    const output = stringifyBMS(source);

    expect(headerLines(output, 'LNTYPE')).toEqual(['#LNTYPE 1']);
    expect(output).toMatch(/^#00051:/m);
    expect(output).toMatch(/^#00056:/m);
    const reparsed = parseBMS(output);
    expect(bmsLongNotes(reparsed)).toEqual(bmsonLongNotes(source));
    // The short note stays a short note.
    expect(reparsed.events.filter((event) => event.channel === '12')).toHaveLength(1);
  });

  test('a long note crossing measures and `lines` keeps its exact end', () => {
    const source = bmson({
      info: { title: 'LN', init_bpm: 120, resolution: 240, mode_hint: 'beat-7k' },
      lines: [{ y: 0 }, { y: 720 }, { y: 1680 }],
      sound_channels: [{ name: 'key.wav', notes: [{ x: 3, y: 600, l: 1000 }] }],
    });
    const reparsed = parseBMS(stringifyBMS(source));
    expect(bmsLongNotes(reparsed)).toEqual(bmsonLongNotes(source));
  });

  test('BMS → bmson → BMS keeps #LNOBJ long notes as long notes', () => {
    const source = bms('#BPM 120', '#WAV01 key.wav', '#LNOBJ ZZ', '#00111:01ZZ', '#00212:01', '#00312:ZZ');
    const roundTrip = parseBMS(stringifyBMS(parseBmson(stringifyBmson(source))));
    expect(bmsLongNotes(roundTrip)).toEqual(bmsLongNotes(source));
  });

  test.each([
    ['a uniform `ln_type`', { ln_type: 2 }, [undefined, undefined], ['#LNMODE 2']],
    ['a uniform per-note `t`', {}, [3, 3], ['#LNMODE 3']],
    ['per-note `t` agreeing with `ln_type`', { ln_type: 1 }, [1, undefined], ['#LNMODE 1']],
    ['mixed `t` falling back to `ln_type`', { ln_type: 2 }, [3, undefined], ['#LNMODE 2']],
    ['mixed `t` without `ln_type`', {}, [1, 3], []],
    ['no type at all', {}, [undefined, undefined], []],
  ])('#LNMODE from %s', (_label, info, types, expected) => {
    const source = longNoteChart(
      info,
      types.map((t, index) => ({ x: index + 1, y: index * 960, l: 240, ...(t !== undefined ? { t } : {}) })),
    );
    expect(headerLines(stringifyBMS(source), 'LNMODE')).toEqual(expected);
  });

  test.each([
    [10, '0A', 10],
    [0, '01', 1],
    [2.4, '02', 2],
    [2.5, '03', 3],
    [5000, 'ZZ', 1295],
    [undefined, '04', 4],
  ])('a mine with `damage` %s is written as the BMS mine value %s', (damage, value, dealt) => {
    const source = bmson({
      info: { title: 'Mine', init_bpm: 120, resolution: 240, mode_hint: 'beat-7k' },
      sound_channels: [{ name: 'key.wav', notes: [{ x: 1, y: 0 }] }],
      mine_channels: [{ name: 'mine.wav', notes: [{ x: 2, y: 240, ...(damage !== undefined ? { damage } : {}) }] }],
    });
    const output = stringifyBMS(source);

    const reparsed = parseBMS(output);
    expect(reparsed.events.filter((event) => event.channel === 'D2').map((event) => event.value)).toEqual([value]);
    // The mine's sample becomes the BMS explosion sound.
    expect(headerLines(output, 'WAV00')).toEqual(['#WAV00 mine.wav']);
    expect(mineDamages(reparsed)).toEqual([['D2', dealt]]);
  });

  test('BMS → bmson → BMS keeps mine damage', () => {
    const source = bms('#BPM 120', '#WAV00 bomb.wav', '#WAV01 key.wav', '#00111:01', '#001D1:0A', '#001D2:00ZZ');
    const roundTrip = parseBMS(stringifyBMS(parseBmson(stringifyBmson(source))));
    expect(mineDamages(roundTrip)).toEqual(mineDamages(source));
    expect(roundTrip.resources.wav['00']).toBe('bomb.wav');
  });

  test('`judge_rank` becomes #DEFEXRANK (same unit) instead of an out-of-range #RANK', () => {
    const output = stringifyBMS(
      bmson({
        info: { title: 'Rank', init_bpm: 120, resolution: 240, judge_rank: 120 },
        sound_channels: [{ name: 'key.wav', notes: [{ x: 1, y: 0 }] }],
      }),
    );
    expect(headerLines(output, 'DEFEXRANK')).toEqual(['#DEFEXRANK 120']);
    expect(headerLines(output, 'RANK')).toEqual([]);
    expect(parseBMS(output).bms.defExRank).toBe(120);
  });

  test('a missing or non-positive `judge_rank` writes neither #RANK nor #DEFEXRANK', () => {
    for (const info of [{}, { judge_rank: 0 }]) {
      const output = stringifyBMS(
        bmson({
          info: { title: 'Rank', init_bpm: 120, resolution: 240, ...info },
          sound_channels: [{ name: 'key.wav', notes: [{ x: 1, y: 0 }] }],
        }),
      );
      expect(headerLines(output, 'DEFEXRANK')).toEqual([]);
      expect(headerLines(output, 'RANK')).toEqual([]);
    }
  });

  test('the percentage `total` is not written as an absolute #TOTAL', () => {
    for (const total of [undefined, 100, 260]) {
      const output = stringifyBMS(
        bmson({
          info: { title: 'Total', init_bpm: 120, resolution: 240, ...(total !== undefined ? { total } : {}) },
          sound_channels: [{ name: 'key.wav', notes: [{ x: 1, y: 0 }] }],
        }),
      );
      expect(headerLines(output, 'TOTAL')).toEqual([]);
    }
  });
});
