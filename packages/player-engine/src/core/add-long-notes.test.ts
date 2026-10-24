import { expect, test } from 'vite-plus/test';
import { parseChart } from '@be-music/chart-parser';
import { resolveChart } from '@be-music/chart-model';
import { addLongNotes, clampLongNoteRate } from './long-note-modifier.ts';
import { preparePlaybackChart } from './bootstrap.ts';

const chart = (body: string) => resolveChart(parseChart(`#BPM 120\n${body}`, 'bms'), { playVariant: '7' });

test('ADD LN terminates at the immediately following BGM/BPM/empty-measure timeline, not the next scoring note', () => {
  const resolved = chart('#00011:01\n#00001:0001\n#00112:01\n#00203:0078');
  const original = structuredClone(resolved.notes);
  const prepared = preparePlaybackChart(resolved, { longNoteModifier: 'ADD_LN' }, 0, () => 0);
  expect(prepared.notes.map((note) => [note.channel, note.beat, note.endBeat, note.longNoteMode])).toEqual([
    ['11', 0, 2, 1],
    ['12', 4, 8, 1],
  ]);
  expect(prepared.notes.every((note) => note.generatedLongNote)).toBe(true);
  expect(prepared.longNoteModifierChangeCount).toBe(2);
  expect(resolved.notes).toEqual(original);
});

test('next-row notes, authored LN tails and mines block additions; hidden objects do not occupy the cell', () => {
  const blocked = chart('#00011:0101\n#00012:01\n#000D2:0001\n#00013:01\n#00033:0001\n#00111:01');
  const prepared = preparePlaybackChart(blocked, { longNoteModifier: 'ADD_LN' }, 0, () => 0);
  const head = (channel: string) => prepared.notes.find((note) => note.channel === channel && note.beat === 0)!;
  expect(head('11').generatedLongNote).toBeUndefined();
  expect(head('12').generatedLongNote).toBeUndefined();
  expect(head('13')).toMatchObject({ endBeat: 2, generatedLongNote: true, longNoteMode: 1 });
  const held = preparePlaybackChart(chart('#LNOBJ AA\n#00011:01\n#00111:AA'), { longNoteModifier: 'ADD_LN' }, 0, () => {
    throw new Error('no normal candidate');
  });
  expect(held.notes[0]).toMatchObject({ endBeat: 4 });
  expect(held.notes[0]?.generatedLongNote).toBeUndefined();
});

test('the final timeline cannot be extended and default/full/zero rates still follow source draws', () => {
  const resolved = chart('#00011:01\n#00112:01');
  for (const [rate, draw, added] of [
    [0, 0, 0],
    [0.5, 0.5, 0],
    [0.5, 0.499, 1],
    [1, 0.999, 1],
  ] as const) {
    let draws = 0;
    const result = preparePlaybackChart(resolved, { longNoteModifier: 'ADD_LN', longNoteRate: rate }, 0, () => {
      draws++;
      return draw;
    });
    expect(result.longNoteModifierChangeCount).toBe(added);
    expect(draws).toBe(1);
    expect(result.notes.at(-1)?.generatedLongNote).toBeUndefined();
  }
  expect(clampLongNoteRate(-1)).toBe(0);
  expect(clampLongNoteRate(2)).toBe(1);
  expect(clampLongNoteRate(NaN)).toBe(1);
});

test('source lane order places a whole chord, including scratch, and ignores unsupported freezone columns', () => {
  const resolved = chart('#00011:01\n#00012:01\n#00016:01\n#00017:0001\n#00101:01');
  const notes = preparePlaybackChart(resolved).notes;
  const draws = [0.1, 0.9, 0.2];
  expect(addLongNotes(resolved, notes, 'ADD_LN', { rate: 0.5, random: () => draws.shift()! })).toBe(2);
  expect(notes.filter((note) => note.generatedLongNote).map((note) => [note.channel, note.endBeat])).toEqual([
    ['11', 4],
    ['16', 4],
  ]);
  expect(draws).toEqual([]);
});

test('recorded generated heads restore exact endpoints without rerolling and malformed placements are atomic', () => {
  const resolved = chart('#00011:01\n#00012:01\n#00101:01');
  const notes = preparePlaybackChart(resolved).notes;
  const placements = [{ sourceChannel: '12', timeUs: 0, endTimeUs: 2_000_000, lnMode: 1 as const }];
  expect(
    addLongNotes(resolved, notes, 'ADD_LN', {
      placements,
      random: () => {
        throw new Error('reroll');
      },
    }),
  ).toBe(1);
  expect(notes.find((note) => note.channel === '12')).toMatchObject({
    endBeat: 4,
    endSeconds: 2,
    longNoteMode: 1,
    generatedLongNote: true,
  });
  const fresh = preparePlaybackChart(resolved).notes;
  const before = structuredClone(fresh);
  expect(() =>
    addLongNotes(resolved, fresh, 'ADD_LN', {
      placements: [...placements, { ...placements[0]!, sourceChannel: '13' }],
    }),
  ).toThrow(/eligible source note/);
  expect(fresh).toEqual(before);
  expect(() =>
    addLongNotes(resolved, fresh, 'ADD_LN', { placements: [{ ...placements[0]!, endTimeUs: 123 }] }),
  ).toThrow(/next source timeline/);
  expect(() => addLongNotes(resolved, fresh, 'ADD_LN', { random: () => 1 })).toThrow(/randomness/);
});

test('generated tails extend playback and reserve cells before ADD ALL mines run', () => {
  const resolved = chart('#00011:01\n#00101:01');
  const prepared = preparePlaybackChart(
    resolved,
    { longNoteModifier: 'ADD_LN', mineModifier: 'ADD_BLANK' },
    0,
    () => 0,
  );
  expect(prepared.totalSeconds).toBe(2);
  expect(prepared.landmineNotes.some((mine) => mine.channel === '11')).toBe(false);
});

test('normalized bmson BGM/BPM rows are also eligible generated endpoints', () => {
  const json = parseChart(
    JSON.stringify({
      version: '1.0.0',
      info: { init_bpm: 120, resolution: 240, mode_hint: 'beat-7k' },
      sound_channels: [{ name: 'a.wav', notes: [{ x: 1, y: 0, l: 0 }] }],
      bpm_events: [{ y: 120, bpm: 180 }],
    }),
    'bmson',
  );
  const resolved = resolveChart(json);
  const prepared = preparePlaybackChart(resolved, { longNoteModifier: 'ADD_LN' }, 0, () => 0);
  expect(prepared.notes[0]).toMatchObject({ endBeat: 0.5, endSeconds: 0.25, longNoteMode: 1, generatedLongNote: true });
  expect(prepared.notes[0]?.event).toBe(resolved.notes[0]?.event);
});

test('ADD CN adds an explicit charge-note type while preserving authored LN and normal head samples', () => {
  const resolved = chart('#LNOBJ AA\n#00011:01\n#00012:01\n#00112:AA\n#00001:0001');
  const prepared = preparePlaybackChart(resolved, { longNoteModifier: 'ADD_CN' }, 0, () => 0);
  expect(prepared.notes.find((note) => note.channel === '11')).toMatchObject({
    longNoteMode: 2,
    endBeat: 2,
    generatedLongNote: true,
    event: { value: '01' },
  });
  expect(prepared.notes.find((note) => note.channel === '12')?.generatedLongNote).toBeUndefined();
  expect(prepared.longNoteModifierChangeCount).toBe(1);
});

test('ADD HCN selects hell-charge behavior independently of the chart CN default', () => {
  const resolved = chart('#LNMODE 2\n#00011:01\n#00001:0001');
  const prepared = preparePlaybackChart(resolved, { longNoteModifier: 'ADD_HCN' }, 0, () => 0);
  expect(prepared.notes[0]).toMatchObject({ longNoteMode: 3, endBeat: 2, endSeconds: 1, generatedLongNote: true });
  expect(resolved.lnMode).toBe(2);
  expect(prepared.longNoteModifierChangeCount).toBe(1);
});
