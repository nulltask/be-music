import { describe, expect, test } from 'vite-plus/test';
import { parseLRX } from '../../chart-parser/src/index.ts';
import {
  computePlayFingerprint,
  countScoredNotes,
  createChartFingerprintDocument,
  createPlayFingerprintDocument,
  playsAtKeysoundVolume,
  resolveChart,
  resolveChartPlayVariant,
} from './index.ts';
import { resolveFingerprintLaneMode } from './fingerprint-items.ts';

const chart = (laneType: number | undefined, ...notes: string[]) =>
  parseLRX({
    lrs: `<LRS><n c="301" s="0" p="120" /><n c="300" s="0" /><n c="300" s="1920" />${notes.join('')}</LRS>`,
    ...(laneType === undefined ? {} : { lrh: `<LRH><information lanetype="${laneType}" /></LRH>` }),
  });

describe('LRX charts in the chart model', () => {
  test('the lanetype names the mode, whatever lanes the chart uses', () => {
    // A 10-key chart on the 2P keys 2–5 only: by its lanes alone it would read as PMS-STD (9 KEY).
    const tenKeys = chart(3, '<n c="1" s="0" p="0" />', '<n c="12" s="480" p="0" />', '<n c="15" s="960" p="0" />');
    expect(resolveChartPlayVariant(tenKeys)).toBe('10');
    expect(resolveChartPlayVariant({ ...tenKeys, lrx: undefined })).toBe('9');
    expect(resolveChartPlayVariant(chart(0, '<n c="1" s="0" p="0" />'))).toBe('7');
    expect(resolveChartPlayVariant(chart(4, '<n c="1" s="0" p="0" />'))).toBe('9');
    expect(resolveChartPlayVariant(chart(6, '<n c="1" s="0" p="0" />'))).toBe('14');
    expect(resolveChartPlayVariant(chart(undefined, '<n c="1" s="0" p="0" />'))).toBe('5');
    expect(countScoredNotes(tenKeys).playVariant).toBe('10');
  });

  test('a lane note with an end is a CN that lasts its ticks', () => {
    const json = chart(1, '<n c="1" s="480" e="1440" p="0" />', '<n c="2" s="0" p="0" />');
    const resolved = resolveChart(json);
    const long = resolved.notes.find((note) => note.channel === '11')!;
    expect(long.beat).toBe(1);
    expect(long.endBeat).toBe(3);
    expect(long.endSeconds).toBeCloseTo(1.5);
    expect(long.lnMode).toBe(2);
    expect(resolved.notes.find((note) => note.channel === '12')!.endBeat).toBeUndefined();
  });

  test('the fingerprint reads the long-note tail and the lanetype', () => {
    const json = chart(3, '<n c="12" s="480" e="2400" p="0" />');
    const play = createPlayFingerprintDocument(json, { chartPath: 'song/01.lrs' });
    expect(play.laneMode).toBe('10');
    // 480 → 2400 ticks: a quarter into measure 0 to a quarter into measure 1, a CN.
    expect(play.notes).toEqual([{ m: '0', p: '1/4', lane: '22', end: { m: '1', p: '1/4' }, ln: '2' }]);
    // Without control flow the chart document is the play document, lane mode and all.
    expect(createChartFingerprintDocument(json, { chartPath: 'song/01.lrs' })).toMatchObject({ laneMode: '10' });
    // The same notes read as another lane type are another chart.
    expect(computePlayFingerprint(json, { chartPath: '01.lrs' })).not.toBe(
      computePlayFingerprint(chart(1, '<n c="12" s="480" e="2400" p="0" />'), { chartPath: '01.lrs' }),
    );
  });

  test('a control-flow chart document carries the lanetype among its lane-mode inputs', () => {
    const notes = [{ lane: '22' }, { lane: '25' }] as unknown as Parameters<typeof resolveFingerprintLaneMode>[0];
    expect(resolveFingerprintLaneMode(notes, null, false, null)).toBe('9');
    expect(resolveFingerprintLaneMode(notes, null, false, null, 3)).toBe('10');
  });

  test('ties each chain note to the judged note before it on its lane, with its delay', () => {
    // 120 BPM: 480 ticks is 0.5 s.
    const json = chart(
      0,
      '<n c="1" s="480" p="0" />',
      '<n c="1" s="600" p="1" cn="1" />',
      '<n c="1" s="720" p="2" cn="1" />',
      '<n c="2" s="720" p="3" cn="1" />',
      '<n c="1" s="960" p="4" />',
      '<n c="1" s="1440" p="5" cn="1" />',
    );
    const notes = resolveChart(json).notes;
    const chains = (channel: string, beat: number) =>
      notes
        .find((note) => note.channel === channel && note.beat === beat)!
        .chainSounds?.map((sound) => [sound.event.value, sound.delaySeconds]);
    expect(chains('11', 1)).toEqual([
      ['02', 0.125],
      ['03', 0.25],
    ]);
    expect(chains('11', 2)).toEqual([['06', 0.5]]);
    // Lane 2 has no note before its chain note: it plays in the background, tied to nothing.
    expect(notes.some((note) => note.chainSounds?.some((sound) => sound.event.value === '04'))).toBe(false);
  });

  test('a background sound plugout plays in its key group plays at the keysound volume', () => {
    expect(playsAtKeysoundVolume('11')).toBe(true);
    expect(playsAtKeysoundVolume('01')).toBe(false);
    expect(playsAtKeysoundVolume('01', { lrx: { keyVolume: true } })).toBe(true);
    expect(playsAtKeysoundVolume('01', {})).toBe(false);
  });

  test('a hidden lane note is also an invisible note on its lane, and no chain follows it', () => {
    const json = chart(
      0,
      '<n c="1" s="480" p="0" dmg="0" />',
      '<n c="1" s="600" p="1" cn="1" />',
      '<n c="2" s="480" p="2" />',
    );
    const resolved = resolveChart(json);
    expect(resolved.invisibleNotes.map((note) => [note.channel, note.event.value])).toEqual([['11', '01']]);
    // It still plays in the background, and the chain note after it has no judged note to follow.
    expect(resolved.sampleTriggers.some((trigger) => trigger.event.value === '01')).toBe(true);
    expect(resolved.notes.some((note) => note.chainSounds !== undefined)).toBe(false);
  });
});
