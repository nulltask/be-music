import { expect, test } from 'vite-plus/test';
import { parseChart } from '@be-music/chart-parser';
import { resolveChart } from '@be-music/chart-model';
import type { LaneRandomSource } from '../lane-random-source.ts';
import { toTimedLandmineNote, toTimedPlayableNote } from '../playable-notes.ts';
import { preparePlaybackChart } from './bootstrap.ts';
import {
  addLR2LongNotes,
  addLR2Mines,
  addLR2Notes,
  applyLR2Loudness,
  clampLR2ManiaRate,
  createLR2ManiaLocator,
  hasLR2ManiaChart,
  resolveLR2ManiaEndSeconds,
  resolveLR2ManiaSides,
} from './lr2-mania-chart.ts';

/** BPM 120: a beat is half a second and a measure two seconds. */
const load = (...lines: string[]) => {
  const resolved = resolveChart(parseChart(['#BPM 120', ...lines].join('\n'), 'bms'));
  return {
    resolved,
    notes: resolved.notes.map(toTimedPlayableNote),
    mines: resolved.mines.map(toTimedLandmineNote),
    sides: resolveLR2ManiaSides(resolved),
  };
};
/** LR2's `GetRand` results in the order they are asked for; a draw past the script fails the test. */
const script = (...values: number[]): LaneRandomSource => {
  const queue = [...values];
  const random = (() => {
    throw new Error('unexpected float draw');
  }) as LaneRandomSource;
  random.nextInt = (bound) => {
    const value = queue.shift();
    if (value === undefined || value >= bound) throw new Error(`unexpected draw of ${bound}`);
    return value;
  };
  return random;
};
const cells = (notes: readonly { channel: string; seconds: number }[]) =>
  notes.map((note) => `${note.channel}@${note.seconds}`);

test('clamps a rate to a whole 0–100 and tells whether any generator is on', () => {
  expect([undefined, Number.NaN, -5, 0, 34.9, 100, 250].map(clampLR2ManiaRate)).toEqual([0, 0, 0, 0, 34, 100, 100]);
  expect(hasLR2ManiaChart(undefined)).toBe(false);
  expect(hasLR2ManiaChart({ addNotes: 0, loudness: 0 })).toBe(false);
  expect(hasLR2ManiaChart({ addMines: 10 })).toBe(true);
});

test('walks the scratch and the keys of each side, and no scratch on a nine-key chart', () => {
  expect(load('#00111:01').sides).toEqual([{ scratch: '16', keys: ['11', '12', '13', '14', '15'] }]);
  expect(load('#00118:01').sides).toEqual([{ scratch: '16', keys: ['11', '12', '13', '14', '15', '18', '19'] }]);
  const double = load('#00118:01', '#00121:01').sides;
  expect(double.map((side) => side.scratch)).toEqual(['16', '26']);
  const pms = resolveLR2ManiaSides(resolveChart(parseChart('#BPM 120\n#00111:01\n#00125:01', 'pms')));
  expect(pms).toHaveLength(1);
  expect(pms[0]?.scratch).toBeUndefined();
  expect(pms[0]?.keys).toHaveLength(9);
});

test('ADD NOTES tries once per object of a row and fills an empty lane, scratch included', () => {
  // A two-note chord at 2 s and one note at 3 s, on 7 KEY.
  const { notes, mines, sides } = load('#00111:0100', '#00118:0100', '#00112:0001');
  // Row 1: two tries. The first passes (10 <= 10) and takes the first of the six empty lanes, the scratch; the second
  // fails (11 > 10). Row 2: one try passes and takes the last of the seven empty lanes.
  const added = addLR2Notes(notes, mines, sides, 10, script(10, 0, 11, 0, 6));
  expect(added).toBe(2);
  expect(cells(notes)).toEqual(['11@2', '16@2', '18@2', '12@3', '19@3']);
  expect(notes.find((note) => note.channel === '16')?.event).toMatchObject({ measure: 1, channel: '16', value: 'ZY' });
});

test('ADD NOTES turns every long note back into its head and adds nothing to a full row', () => {
  const { notes, mines, sides } = load(
    '#LNOBJ ZZ',
    '#00111:0100',
    '#00211:ZZ',
    // A full 5 KEY row: nothing can be added however the draw falls.
    '#00311:01',
    '#00312:01',
    '#00313:01',
    '#00314:01',
    '#00315:01',
    '#00316:01',
  );
  expect(notes[0]?.endSeconds).toBe(4);
  // The head's row adds one note (100 <= 100, the first empty lane); the full row tries six times and adds nothing.
  const added = addLR2Notes(notes, mines, sides, 100, script(100, 0, 0, 0, 0, 0, 0, 0));
  expect(added).toBe(1);
  expect(notes.filter((note) => note.seconds === 6)).toHaveLength(6);
  expect(notes.every((note) => note.endSeconds === undefined && note.longNoteMode === undefined)).toBe(true);
});

test('LOUDNESS draws once per row and side, and fills the whole side', () => {
  // 10 KEY: a 1P note at 2 s, a 2P note at 3 s.
  const { notes, mines, sides } = load('#00111:0100', '#00121:0001');
  // The 1P row passes (0 <= 50); the 2P row fails (51 > 50).
  const filled = applyLR2Loudness(notes, mines, sides, 50, script(0, 51));
  expect(filled).toBe(1);
  expect(cells(notes)).toEqual(['11@2', '12@2', '13@2', '14@2', '15@2', '16@2', '21@3']);
});

test('LOUDNESS counts a mine as holding its lane', () => {
  const { notes, mines, sides } = load('#00111:01', '#001D2:01');
  applyLR2Loudness(notes, mines, sides, 100, script(0));
  expect(cells(notes)).toEqual(['11@2', '13@2', '14@2', '15@2', '16@2']);
});

test('ADD LONGNOTES holds a note half-way to the next object of its lane, and leaves the scratch alone', () => {
  // Lane 11 at 2 s, 3 s and 4 s; a scratch at 2 s and 3 s.
  const { resolved, notes, mines, sides } = load('#00111:0101', '#00211:01', '#00116:0101');
  const locate = createLR2ManiaLocator(resolved);
  // Two draws for lane 11's first two notes: the first passes (9 < 10), the second does not (10 >= 10).
  const changed = addLR2LongNotes(notes, mines, sides, 10, script(9, 10), 6, (seconds) => locate(seconds).beat);
  expect(changed).toBe(1);
  const held = notes.filter((note) => note.endSeconds !== undefined);
  expect(held).toHaveLength(1);
  expect(held[0]).toMatchObject({
    channel: '11',
    seconds: 2,
    endSeconds: 2.5,
    endBeat: 5,
    longNoteMode: 1,
    generatedLongNote: true,
  });
});

test('ADD LONGNOTES at 100 holds the last note of each lane to the end of the chart', () => {
  const { resolved, notes, mines, sides } = load('#00111:0101', '#00112:01');
  const end = resolveLR2ManiaEndSeconds(resolved, notes);
  expect(end).toBe(5);
  const locate = createLR2ManiaLocator(resolved);
  const changed = addLR2LongNotes(notes, mines, sides, 100, script(0), end, (seconds) => locate(seconds).beat);
  expect(changed).toBe(3);
  expect(notes.map((note) => [note.channel, note.seconds, note.endSeconds])).toEqual([
    ['11', 2, 2.5],
    ['12', 2, 5],
    ['11', 3, 5],
  ]);
});

test('ADD LONGNOTES keeps a long note that is already held longer, and never holds a mine', () => {
  // A long note on 11 from 2 s to 5 s, then a note at 6 s; a mine on 12 at 2 s before a note at 4 s.
  const { resolved, notes, mines, sides } = load(
    '#LNOBJ ZZ',
    '#00111:01',
    '#00211:00ZZ',
    '#00311:01',
    '#001D2:01',
    '#00212:01',
  );
  const locate = createLR2ManiaLocator(resolved);
  const changed = addLR2LongNotes(notes, mines, sides, 50, script(0, 0), 9, (seconds) => locate(seconds).beat);
  expect(changed).toBe(0);
  expect(notes.find((note) => note.channel === '11' && note.seconds === 2)?.endSeconds).toBe(5);
  expect(notes.find((note) => note.channel === '12')?.endSeconds).toBeUndefined();
});

test('ADD MINES puts a mine half-way across a gap over 200 ms', () => {
  // Lane 11 at 2 s, 3 s and 3.125 s.
  const lane = load('#00111:01000000000000000100000000000000', '#00111:00000000000000000001000000000000');
  expect(lane.notes.map((note) => note.seconds)).toEqual([2, 3, 3.125]);
  // Both pairs pass the draw; only the first gap is over 200 ms.
  const added = addLR2Mines(
    lane.notes,
    lane.mines,
    lane.sides,
    100,
    script(0, 0),
    createLR2ManiaLocator(lane.resolved),
  );
  expect(added).toBe(1);
  expect(lane.mines).toHaveLength(1);
  expect(lane.mines[0]).toMatchObject({ channel: '11', seconds: 2.5, beat: 5, mine: true, silent: true });
  expect(lane.mines[0]?.event).toEqual({ measure: 1, position: [250000, 1000000], channel: 'D1', value: '04' });
});

test('ADD MINES measures from a long note end when the next object is a long note', () => {
  // A long note on 11 from 2 s to 3 s, then a long note from 4 s to 5 s.
  const first = load('#LNOBJ ZZ', '#00111:0100ZZ00', '#00211:0100ZZ00');
  expect(
    addLR2Mines(first.notes, first.mines, first.sides, 100, script(0), createLR2ManiaLocator(first.resolved)),
  ).toBe(1);
  expect(first.mines[0]?.seconds).toBe(3.5);
  // A plain note at 2 s before a long note at 4 s: LR2 reads the plain note's end as −1 ms, so the mine lands at half
  // the long note's time.
  const quirk = load('#LNOBJ ZZ', '#00111:01', '#00211:0100ZZ00');
  expect(
    addLR2Mines(quirk.notes, quirk.mines, quirk.sides, 100, script(0), createLR2ManiaLocator(quirk.resolved)),
  ).toBe(1);
  expect(quirk.mines[0]?.seconds).toBeCloseTo(1.9995);
});

test('ADD MINES skips a failed draw and the scratch lane', () => {
  const { resolved, notes, mines, sides } = load('#00111:01', '#00211:01', '#00116:01', '#00216:01');
  expect(addLR2Mines(notes, mines, sides, 50, script(50), createLR2ManiaLocator(resolved))).toBe(0);
  expect(mines).toHaveLength(0);
});

test('a prepared chart applies the generators from one seed and records it', () => {
  const resolved = resolveChart(parseChart('#BPM 120\n#00111:01010101\n#00112:00010001\n#00218:01000100', 'bms'));
  const rates = { addNotes: 50, loudness: 20, addLongNotes: 50, addMines: 100 };
  const first = preparePlaybackChart(resolved, { lr2Mania: { ...rates, seed: '12345' } });
  expect(first.lr2Mania).toMatchObject({ ...rates, seed: '12345' });
  expect(first.lr2Mania!.changes.addNotes + first.lr2Mania!.changes.loudness).toBeGreaterThan(0);
  // The same seed rebuilds the same chart; another seed does not have to.
  const again = preparePlaybackChart(resolved, { lr2Mania: { ...rates, seed: '12345' } });
  const shape = (chart: typeof first) => [
    chart.notes.map((note) => [note.channel, note.seconds, note.endSeconds]),
    chart.landmineNotes.map((mine) => [mine.channel, mine.seconds]),
  ];
  expect(shape(again)).toEqual(shape(first));
  expect(again.lr2Mania).toEqual(first.lr2Mania);
  // Without a seed the play draws one from the supplied randomness.
  const drawn = preparePlaybackChart(resolved, { lr2Mania: { addMines: 100 } }, 0, () => 0.5);
  expect(drawn.lr2Mania?.seed).toBe('8388608');
  expect(() => preparePlaybackChart(resolved, { lr2Mania: { addMines: 100 } })).toThrow(/require supplied randomness/);
});

test('a prepared chart leaves the generators off in a course, in PRACTICE and when every rate is 0', () => {
  const resolved = resolveChart(parseChart('#BPM 120\n#00111:01010101', 'bms'));
  const rates = { loudness: 100, seed: '1' };
  expect(preparePlaybackChart(resolved, { lr2Mania: rates, course: { kind: 'grade' } }).lr2Mania).toBeUndefined();
  expect(preparePlaybackChart(resolved, { lr2Mania: { addNotes: 0, seed: '1' } }).lr2Mania).toBeUndefined();
  expect(preparePlaybackChart(resolved, { lr2Mania: rates }).notes.length).toBeGreaterThan(4);
});
