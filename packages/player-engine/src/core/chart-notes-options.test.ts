import { describe, expect, test } from 'vite-plus/test';
import { parseBMS } from '@be-music/chart-parser';
import { resolveChart } from '@be-music/chart-model';
import type { TimedLandmineNote, TimedPlayableNote } from '../playable-notes.ts';
import { preparePlaybackChart } from './bootstrap.ts';
import {
  copyChartNotes,
  doubleChartNotes,
  resolveChartNotesOption,
  resolveChartNotesPlayVariant,
  resolveEffectiveChartPlayOptions,
} from './chart-notes-options.ts';
import { arrangeChartPlayLanes } from './chart-play-lanes.ts';

const note = (channel: string, seconds: number, endSeconds?: number): TimedPlayableNote => ({
  event: { measure: 0, position: [0, 1], channel, value: '01' },
  channel,
  beat: seconds * 2,
  seconds,
  ...(endSeconds !== undefined ? { endSeconds, endBeat: endSeconds * 2 } : {}),
  judged: false,
});
const mine = (channel: string, seconds: number): TimedLandmineNote => ({
  event: { measure: 0, position: [0, 1], channel: `D${channel[1]}`, value: '01' },
  channel,
  beat: seconds * 2,
  seconds,
  judged: false,
  mine: true,
});
const lanes = (notes: ReadonlyArray<{ channel: string; seconds: number }>) =>
  notes.map((entry) => `${entry.seconds}:${entry.channel}`);

describe('resolveChartNotesOption', () => {
  test.each([
    ['DOUBLE', '7', false, 'DOUBLE'],
    ['DOUBLE', '14', true, 'DOUBLE'],
    ['DOUBLE', '9', false, 'DOUBLE'],
    ['DOUBLE', 'generic-6', false, undefined],
    ['COPY', '5', false, 'COPY'],
    ['COPY', '7', false, 'COPY'],
    ['COPY', '7', true, undefined],
    ['COPY', '14', false, undefined],
    ['COPY', '9', false, undefined],
    ['COPY', '24', false, undefined],
    ['DBLCOPY', '7', false, 'DBLCOPY'],
    ['DBLCOPY', '7', true, 'DOUBLE'],
    ['DBLCOPY', '10', false, 'DOUBLE'],
  ] as const)('%s on %s KEY (course %s) → %s', (option, playVariant, course, expected) => {
    expect(resolveChartNotesOption(option, { playVariant, course })).toBe(expected);
  });

  test('the play variant a copy plays as', () => {
    expect(resolveChartNotesPlayVariant('5', 'COPY')).toBe('10');
    expect(resolveChartNotesPlayVariant('7', 'DBLCOPY')).toBe('14');
    expect(resolveChartNotesPlayVariant('7', 'DOUBLE')).toBe('7');
    expect(resolveChartNotesPlayVariant('9', 'COPY')).toBe('9');
    expect(resolveChartNotesPlayVariant('7', undefined)).toBe('7');
  });

  test('the effective program narrows NOTES and diagnoses what lost its effect', () => {
    const program = { version: 1 as const, options: { random: 'MIRROR' as const, notes: 'COPY' as const } };
    expect(resolveEffectiveChartPlayOptions(program, { playVariant: '7', course: false })).toEqual({
      program,
      diagnostics: [],
    });
    expect(resolveEffectiveChartPlayOptions(program, { playVariant: '7', course: true })).toEqual({
      program: { version: 1, options: { random: 'MIRROR' } },
      diagnostics: [{ code: 'unsupported-option', declaration: '774:NOTES_COPY' }],
    });
    expect(
      resolveEffectiveChartPlayOptions(
        { version: 1, options: { notes: 'DBLCOPY' } },
        { playVariant: '14', course: false },
      ),
    ).toEqual({
      program: { version: 1, options: { notes: 'DOUBLE' } },
      diagnostics: [{ code: 'unsupported-option', declaration: '774:NOTES_DBLCOPY' }],
    });
    const plain = { version: 1 as const, options: { hellJudge: true as const } };
    expect(resolveEffectiveChartPlayOptions(plain, { playVariant: '7', course: true }).program).toBe(plain);
  });
});

describe('doubleChartNotes', () => {
  test('adds each key note on its mirror lane where that lane is free', () => {
    // 7 KEY: 11↔19, 12↔18, 13↔15; 14 is the middle key; 16 is the scratch.
    const notes = [note('11', 1), note('14', 1), note('16', 1), note('12', 2), note('18', 2), note('13', 3, 4)];
    const mines = [mine('15', 3.5)];
    expect(doubleChartNotes(notes, mines, '7')).toBe(1);
    expect(lanes(notes)).toEqual(['1:11', '1:14', '1:16', '1:19', '2:12', '2:18', '3:13']);
    const partner = notes.find((entry) => entry.channel === '19')!;
    expect(partner.event.channel).toBe('19');
    expect(partner.event).not.toBe(notes[0]!.event);
  });

  test('a long note doubles as a long note when its mirror lane is free over its whole span', () => {
    const notes = [note('13', 1, 2), note('15', 2.5)];
    notes[0]!.event.channel = '53';
    notes[0]!.generatedLongNote = true;
    // The tap at 2.5 s doubles too.
    expect(doubleChartNotes(notes, [], '7')).toBe(2);
    const partner = notes.find((entry) => entry.channel === '15' && entry.seconds === 1)!;
    expect(partner).toMatchObject({ endSeconds: 2, event: { channel: '55' } });
    expect(partner.generatedLongNote).toBeUndefined();
    // A tap at the tail's instant blocks it.
    const blocked = [note('13', 1, 2), note('15', 2)];
    expect(doubleChartNotes(blocked, [], '7')).toBe(0);
  });

  test('a double-play chart doubles within each side; 9 KEY across its nine keys', () => {
    const dp = [note('11', 1), note('21', 1)];
    expect(doubleChartNotes(dp, [], '14')).toBe(2);
    expect(lanes(dp)).toEqual(['1:11', '1:19', '1:21', '1:29']);
    const pms = [note('11', 1)];
    pms.push({ ...note('22', 2) });
    expect(doubleChartNotes(pms, [], '9')).toBe(2);
    expect(lanes(pms)).toEqual(['1:11', '1:25', '2:14', '2:22']);
  });
});

describe('copyChartNotes', () => {
  test('copies a 7 KEY chart onto the 2P side as its mirror image, mines and scratch included', () => {
    const chart = resolveChart(parseBMS('#BPM 120\n#00111:01\n#00116:01\n#00113:00010000\n#00119:00000001\n#001D2:0A'));
    const notes = chart.notes.map((entry) => ({ ...entry, judged: false }) as TimedPlayableNote);
    const mines = chart.mines.map((entry) => ({ ...entry, judged: false, mine: true }) as TimedLandmineNote);
    const copied = copyChartNotes(chart, notes, mines, []);
    expect(copied.chart.playVariant).toBe('14');
    expect(notes.map((entry) => entry.channel).sort()).toEqual(['11', '13', '16', '19', '21', '25', '26', '29']);
    expect(mines.map((entry) => entry.channel).sort()).toEqual(['12', '28']);
    expect(() => copyChartNotes(resolveChart(parseBMS('#PLAYER 3\n#00111:01\n#00121:01')), [], [], [])).toThrow();
  });
});

describe('preparePlaybackChart with a chart NOTES conversion', () => {
  const source = resolveChart(parseBMS('#BPM 120\n#00111:01\n#00112:0001\n#00116:01\n#00119:00000001'));

  test('COPY makes the chart double-play and replaces the player battle conversion', () => {
    const prepared = preparePlaybackChart(source, { chartNotes: 'COPY', battleMode: 'SP-TO-DP' });
    expect(prepared.resolvedChart.playVariant).toBe('14');
    expect(prepared.battleMode).toBe('OFF');
    expect(prepared.chartNotes).toBe('COPY');
    expect(prepared.chartNotesChangedObjectCount).toBe(4);
    expect(prepared.laneDisplayMode).toMatch(/DP/);
    expect(prepared.notes.map((entry) => entry.channel).sort()).toEqual([
      '11',
      '12',
      '16',
      '19',
      '21',
      '26',
      '28',
      '29',
    ]);
  });

  test('DBLCOPY doubles, then copies the doubled side', () => {
    const prepared = preparePlaybackChart(source, { chartNotes: 'DBLCOPY' });
    expect(prepared.notes.map((entry) => entry.channel).sort()).toEqual([
      '11',
      '11',
      '12',
      '16',
      '18',
      '19',
      '19',
      '21',
      '21',
      '22',
      '26',
      '28',
      '29',
      '29',
    ]);
  });

  test('a course keeps the key mode: COPY does nothing there, and DOUBLE still runs', () => {
    const copied = preparePlaybackChart(source, { chartNotes: 'COPY', course: { kind: 'grade' } });
    expect(copied.resolvedChart.playVariant).toBe('7');
    expect(copied.chartNotes).toBeUndefined();
    const doubled = preparePlaybackChart(source, { chartNotes: 'DBLCOPY', course: { kind: 'grade' } });
    expect(doubled.chartNotes).toBe('DOUBLE');
    expect(doubled.notes).toHaveLength(7);
  });
});

describe('arrangeChartPlayLanes', () => {
  const sequence = (...values: number[]) => {
    let index = 0;
    return () => values[index++ % values.length]!;
  };

  test('MIRROR reverses each side; scratch stays', () => {
    const notes = [note('11', 1), note('16', 1), note('21', 1)];
    arrangeChartPlayLanes([notes], 'MIRROR', '14', Math.random);
    expect(notes.map((entry) => entry.channel)).toEqual(['19', '16', '29']);
  });

  test('RANDOM permutes each side; RANDOM+ with the scratch; mines move with their lane', () => {
    const notes = [note('11', 1)];
    const mines = [mine('11', 2)];
    // Always draw the last remaining lane: the first target takes the domain's last lane.
    arrangeChartPlayLanes([notes, mines], 'RANDOM', '7', sequence(0.999));
    expect([notes[0]!.channel, mines[0]!.channel]).toEqual(['19', '19']);
    const scratch = [note('16', 1)];
    arrangeChartPlayLanes([scratch], 'RANDOM+', '7', sequence(0.999));
    expect(scratch[0]!.channel).toBe('11');
  });

  test('ALL crosses sides on a double-play chart and is RANDOM on a single-play chart', () => {
    const dp = [note('11', 1)];
    arrangeChartPlayLanes([dp], 'ALL', '14', sequence(0.999));
    expect(dp[0]!.channel.startsWith('2')).toBe(true);
    const sp = [note('11', 1), note('16', 1)];
    arrangeChartPlayLanes([sp], 'ALL', '7', sequence(0.999));
    expect(sp.map((entry) => entry.channel)).toEqual(['19', '16']);
  });
});
