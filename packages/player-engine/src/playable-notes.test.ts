import { resolveChart } from '@be-music/chart-model';
import { createEmptyJSON } from '@be-music/chart-source';
import { describe, expect, test } from 'vite-plus/test';
import { removeLongNoteTails } from './core/long-note-modifier.ts';
import {
  createTimedLandmineNote,
  toTimedInvisibleNote,
  toTimedLandmineNote,
  toTimedPlayableNote,
} from './playable-notes.ts';

/** BPM 240: a tap on `11`, an `#LNOBJ` long note on `12`, an invisible object on `31` and a mine on `D3`. */
function resolveFixture() {
  const json = createEmptyJSON('bms');
  json.metadata.bpm = 240;
  json.bms.lnObjs = ['AA'];
  json.events = [
    { measure: 1, channel: '11', position: [0, 1], value: '01' },
    { measure: 1, channel: '12', position: [0, 1], value: '01' },
    { measure: 2, channel: '12', position: [0, 1], value: 'AA' },
    { measure: 1, channel: '31', position: [1, 2], value: '01' },
    { measure: 1, channel: 'D3', position: [1, 2], value: '0A' },
  ];
  return resolveChart(json);
}

describe('play note shapes', () => {
  test('taps, long notes and invisible objects carry the same keys in the same order', () => {
    const resolved = resolveFixture();
    const notes = resolved.notes.map(toTimedPlayableNote);
    const invisible = resolved.invisibleNotes.map(toTimedInvisibleNote);
    expect(notes).toHaveLength(2);
    expect(invisible).toHaveLength(1);
    const keys = Object.keys(notes[0]!);
    expect(keys).toEqual([
      'event',
      'soundEvents',
      'endSoundEvent',
      'channel',
      'beat',
      'endBeat',
      'endSeconds',
      'longNoteMode',
      'generatedLongNote',
      'visibleUntilBeat',
      'seconds',
      'judged',
      'invisible',
    ]);
    for (const note of [...notes, ...invisible]) expect(Object.keys(note)).toEqual(keys);
    expect(invisible[0]!.invisible).toBe(true);
    expect(notes.find((note) => note.channel === '12')!.endSeconds).toBe(2);
  });

  test('removing a long-note tail keeps the keys and leaves them out of JSON', () => {
    const notes = resolveFixture().notes.map(toTimedPlayableNote);
    const keys = Object.keys(notes[0]!);
    expect(removeLongNoteTails(notes, 'REMOVE', 1)).toBe(1);
    const head = notes.find((note) => note.channel === '12')!;
    expect(Object.keys(head)).toEqual(keys);
    expect(head.endSeconds).toBeUndefined();
    expect(head.endBeat).toBeUndefined();
    expect(head.longNoteMode).toBeUndefined();
    expect(Object.keys(JSON.parse(JSON.stringify(head)) as object)).toEqual([
      'event',
      'channel',
      'beat',
      'seconds',
      'judged',
    ]);
  });

  test('authored and generated mines share one shape', () => {
    const resolved = resolveFixture();
    const authored = resolved.mines.map(toTimedLandmineNote);
    expect(authored).toHaveLength(1);
    const generated = createTimedLandmineNote(authored[0]!.event, '14', 1, 1, true);
    expect(Object.keys(generated)).toEqual(Object.keys(authored[0]!));
    expect(authored[0]!.silent).toBeUndefined();
    expect(generated).toMatchObject({ channel: '14', beat: 1, seconds: 1, judged: false, mine: true, silent: true });
  });
});
