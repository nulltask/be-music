import { describe, expect, test } from 'vite-plus/test';
import { createBeatResolver, resolveBmsLongNotes, resolveLnobjLongNotes } from '../../chart/src/index.ts';
import { resolveBmsBase, type BeMusicJson } from '../../json/src/index.ts';
import { parseBms, parseBmson } from '../../parser/src/index.ts';
import { resolveLandmineGaugeEffect } from '../../player/src/core/landmine.ts';
import { stringifyBmson } from './index.ts';

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

const bms = (...lines: string[]): BeMusicJson => parseBms([...lines, ''].join('\n'));
const toBmson = (json: BeMusicJson): BmsonOutput => JSON.parse(stringifyBmson(json)) as BmsonOutput;

/** Every long note of a BMS chart as `[lane, startBeat, endBeat]`, both `#LNTYPE` and `#LNOBJ` spellings. */
function bmsLongNotes(json: BeMusicJson): Array<[string, number, number]> {
  const resolver = createBeatResolver(json);
  const notes: Array<[string, number, number]> = [];
  for (const note of resolveBmsLongNotes(json, { inferLnTypeWhenMissing: true }).notes) {
    if (note.endBeat !== undefined) notes.push([note.channel, note.beat, note.endBeat]);
  }
  for (const [event, endBeat] of resolveLnobjLongNotes(json).startToEndBeat) {
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
function bmsonLongNotes(json: BeMusicJson): Array<[string, number, number]> {
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

function mineDamages(json: BeMusicJson): Array<[string, number]> {
  return json.events
    .filter((event) => /^[DE]/.test(event.channel))
    .map((event) => [event.channel, resolveLandmineGaugeEffect(event, resolveBmsBase(json), json.sourceFormat).damage]);
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

    // Lanes 11 and 22 only: `51` sits on `11` and `62` on `22`, so they get no `x` of their own.
    expect(output.info.mode_hint).toBe('beat-2k');
    expect(output.sound_channels[0]!.notes).toEqual([
      { x: 1, y: 960, l: 480, c: false },
      { x: 2, y: 1440, l: 480, c: false },
      { x: 1, y: 1680, l: 0, c: false },
    ]);
    // `beat-<lanes>k` renumbers the lanes in use on re-read (22 comes back as 12), so compare the timing only.
    const timing = (notes: Array<[string, number, number]>) => notes.map(([, start, end]) => [start, end]);
    expect(timing(bmsonLongNotes(parseBmson(JSON.stringify(output))))).toEqual(timing(bmsLongNotes(source)));
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
