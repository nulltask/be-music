import { expect, test } from 'vite-plus/test';
import { randomizeLR2ConvergeNotes } from './lane-converge.ts';
import type { SRandomNote } from './lane-random.ts';
const lanes = ['a', 'b', 'c'];
const options = { target: 's', scratch: 's', random: () => 0 };

test('CONVERGE concentrates isolated notes onto scratch without changing timing or source data', () => {
  const notes = [
    { channel: 'a', timeMs: 0 },
    { channel: 'b', timeMs: 1 },
    { channel: 'c', timeMs: 2 },
  ];
  const original = structuredClone(notes);
  expect(randomizeLR2ConvergeNotes(notes, lanes, options)).toEqual(['s', 's', 's']);
  expect(notes).toEqual(original);
});

test('CONVERGE places chords in source lane order, with random free-key fallback', () => {
  const notes = [
    { channel: 'c', timeMs: 0 },
    { channel: 'a', timeMs: 0 },
    { channel: 'b', timeMs: 0 },
  ];
  expect(randomizeLR2ConvergeNotes(notes, lanes, options)).toEqual(['b', 's', 'a']);
  expect(randomizeLR2ConvergeNotes(notes, lanes, { ...options, target: 'b' })).toEqual(['c', 'b', 'a']);
});

test('native scratch reserves the target before key notes, including through an LN tail', () => {
  const notes: SRandomNote[] = [
    { channel: 'a', timeMs: 0 },
    { channel: 's', timeMs: 0, endTimeMs: 10 },
    { channel: 'a', timeMs: 5 },
    { channel: 'b', timeMs: 10 },
    { channel: 'c', timeMs: 11 },
  ];
  expect(randomizeLR2ConvergeNotes(notes, lanes, options)).toEqual(['a', 's', 'a', 'a', 's']);
});

test('converged LN keeps its destination and frees it only after the exact tail time', () => {
  const notes: SRandomNote[] = [
    { channel: 'a', timeMs: 0, endTimeMs: 10 },
    { channel: 'b', timeMs: 5 },
    { channel: 'c', timeMs: 10 },
    { channel: 'b', timeMs: 11 },
  ];
  expect(randomizeLR2ConvergeNotes(notes, lanes, options)).toEqual(['s', 'a', 'a', 's']);
});

test('mines use the placement policy and invisible companions share their source mapping', () => {
  const notes: SRandomNote[] = [
    { channel: 'a', timeMs: 0, kind: 'mine' },
    { channel: 'a', timeMs: 0, kind: 'invisible' },
    { channel: 'b', timeMs: 0, kind: 'invisible' },
    { channel: '21', timeMs: 0 },
  ];
  expect(randomizeLR2ConvergeNotes(notes, lanes, options)).toEqual(['s', 's', 'a', '21']);
});

test('PMS uses an explicit key target and invalid targets fail before drawing', () => {
  const notes = [{ channel: 'a', timeMs: 0 }];
  expect(randomizeLR2ConvergeNotes(notes, lanes, { target: 'b', random: () => 0 })).toEqual(['b']);
  expect(() => randomizeLR2ConvergeNotes(notes, lanes, { target: 'x', random: () => 0 })).toThrow(RangeError);
});
