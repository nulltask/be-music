import { describe, expect, test } from 'vite-plus/test';
import type { TimedPlayableNote } from '../playable-notes.ts';
import { doubleNanasiChartNotes, nanasiDoubleSupports } from './nanasi-notes-double.ts';

const note = (channel: string, seconds: number, endSeconds?: number, value = '01'): TimedPlayableNote => ({
  event: {
    measure: 0,
    position: [0, 1],
    channel: endSeconds === undefined ? channel : `${channel[0] === '2' ? '6' : '5'}${channel[1]}`,
    value,
  },
  channel,
  beat: seconds * 2,
  seconds,
  ...(endSeconds !== undefined ? { endSeconds, endBeat: endSeconds * 2 } : {}),
  judged: false,
});
const hidden = (channel: string, seconds: number): TimedPlayableNote => ({
  ...note(channel, seconds),
  event: { measure: 0, position: [0, 1], channel: `3${channel[1]}`, value: '0Z' },
  invisible: true,
});
const lanes = (notes: readonly TimedPlayableNote[]) => notes.map((entry) => `${entry.seconds}:${entry.channel}`);
const on = (notes: readonly TimedPlayableNote[], channel: string) => notes.filter((entry) => entry.channel === channel);

describe('doubleNanasiChartNotes', () => {
  test('5 KEY copies 1→3, 2→4, 3→5, 4→2 and 5→3, each copy passing on what its lane received', () => {
    const notes = [note('11', 1), note('12', 2), note('13', 3), note('14', 4), note('15', 5), note('16', 1)];
    expect(doubleNanasiChartNotes(notes, [], '5')).toBe(6);
    expect(lanes(on(notes, '13'))).toEqual(['1:13', '3:13', '5:13']);
    expect(lanes(on(notes, '15'))).toEqual(['1:15', '3:15', '5:15']);
    expect(lanes(on(notes, '12'))).toEqual(['2:12', '4:12']);
    expect(lanes(on(notes, '14'))).toEqual(['2:14', '4:14']);
    expect(lanes(on(notes, '11'))).toEqual(['1:11']);
    expect(lanes(on(notes, '16'))).toEqual(['1:16']);
  });

  test("the chart's own object keeps its instant", () => {
    const notes = [note('11', 1), note('13', 1)];
    // 15 receives the 3 at 1 s and the 1 behind it: one stays, the first to arrive.
    expect(doubleNanasiChartNotes(notes, [], '5')).toBe(1);
    expect(lanes(notes)).toEqual(['1:11', '1:13', '1:15']);
    expect(on(notes, '15')[0]!.event.value).toBe('01');
  });

  test('at one instant a long note beats a key note, and otherwise the first to arrive stays', () => {
    // 13 receives the 1 (a key note) and then the 5 (a long note) at 1 s.
    const notes = [note('11', 1, undefined, 'AA'), note('15', 1, 2, 'BB')];
    doubleNanasiChartNotes(notes, [], '5');
    expect(on(notes, '13')).toEqual([expect.objectContaining({ seconds: 1, endSeconds: 2 })]);
    expect(on(notes, '13')[0]!.event).toMatchObject({ channel: '53', value: 'BB' });
    const taps = [note('11', 1, undefined, 'AA'), note('15', 1, undefined, 'BB')];
    doubleNanasiChartNotes(taps, [], '5');
    expect(on(taps, '13')[0]!.event.value).toBe('AA');
  });

  test('a long-note copy stays only with both its ends, and a key note does not land inside a long note', () => {
    // 13 has a key note at 2 s, where the 1's long note would end: the long note does not reach 13.
    const blocked = [note('11', 1, 2), note('13', 2)];
    doubleNanasiChartNotes(blocked, [], '5');
    expect(on(blocked, '13')).toHaveLength(1);
    // 15's long note holds 1-3 s: the 1's key note copy at 2 s is dropped there. On 13 the key note copy came first, so
    // the long note's copy is the one dropped.
    const inside = [note('15', 1, 3), note('11', 2)];
    doubleNanasiChartNotes(inside, [], '5');
    expect(lanes(on(inside, '15'))).toEqual(['1:15']);
    expect(lanes(on(inside, '13'))).toEqual(['2:13']);
  });

  test('9 KEY prefers a note from the same side over one from the other', () => {
    // 14 receives the 2 and then the 2P 2 (22) at 1 s; the 22 is a long note but from the other side.
    const notes = [note('12', 1, undefined, 'AA'), note('22', 1, 2, 'BB')];
    doubleNanasiChartNotes(notes, [], '9');
    expect(lanes(on(notes, '14'))).toEqual(['1:14']);
    expect(on(notes, '14')[0]).toMatchObject({ event: { channel: '14', value: 'AA' } });
    expect(on(notes, '14')[0]!.endSeconds).toBeUndefined();
  });

  test('invisible objects travel with their lane and give way to a visible one', () => {
    const notes = [note('15', 1)];
    const invisible = [hidden('11', 1), hidden('11', 2)];
    expect(doubleNanasiChartNotes(notes, invisible, '5')).toBe(3);
    // 13 receives the 1's invisible objects, then the 5's key note, which wins 1 s; 15's own key note keeps 1 s.
    expect(lanes(on(notes, '13'))).toEqual(['1:13']);
    expect(lanes(on(invisible, '13'))).toEqual(['2:13']);
    expect(on(invisible, '13')[0]).toMatchObject({ invisible: true, event: { channel: '33' } });
    expect(lanes(on(invisible, '15'))).toEqual(['2:15']);
  });

  test('a copy is a new object on its lane, without the long-note modifier mark', () => {
    const source = note('11', 1, 2);
    source.generatedLongNote = true;
    const notes = [source];
    doubleNanasiChartNotes(notes, [], '7');
    const copy = on(notes, '13')[0]!;
    expect(copy).toMatchObject({ channel: '13', endSeconds: 2, judged: false, event: { channel: '53' } });
    expect(copy.generatedLongNote).toBeUndefined();
    expect(copy.event).not.toBe(source.event);
    expect(Object.keys(copy)).toEqual(Object.keys(source));
  });

  test('double play doubles each side; variants nanasigroove has no DOUBLE for are left alone', () => {
    const notes = [note('21', 1), note('25', 2)];
    expect(doubleNanasiChartNotes(notes, [], '14')).toBe(4);
    expect(lanes(notes)).toEqual(['1:21', '1:23', '1:25', '1:29', '2:25', '2:29']);
    expect(nanasiDoubleSupports('24')).toBe(false);
    expect(doubleNanasiChartNotes([note('11', 1)], [], '24')).toBe(0);
  });
});
