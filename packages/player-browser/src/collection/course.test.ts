import { createEmptyJSON } from '@be-music/chart-source';
import { parseChart } from '@be-music/chart-parser';
import {
  evaluateCourseChartFilter,
  parseBeatorajaCourseData,
  parseBeatorajaRandomCourseData,
  parseCourseChartFilter,
} from '@be-music/player-engine/course';
import type { BestRecord } from '@be-music/player-engine/records';
import { describe, expect, test } from 'vite-plus/test';
import {
  createCourseChartRecord,
  createRandomCourseEntry,
  createChartHashLookup,
  drawBrowserRandomCourse,
  isCourseFilePath,
  readCourseFile,
  resolveCourseFolders,
} from './course.ts';
import type { LibraryChart } from '@be-music/player-scene-model';

const MD5_A = '0123456789abcdef0123456789abcdef';
const SHA_B = 'b'.repeat(64);

function chartEntry(id: string, title: string): LibraryChart {
  return {
    id,
    sourceId: 'drop1',
    sourceLabel: 'pack',
    sourceKind: 'directory',
    chartPath: `${id}.bms`,
    directoryLabel: 'pack',
    fileLabel: `${id}.bms`,
    title,
    totalNotes: 100,
    chart: createEmptyJSON('bms'),
  };
}

describe('course files', () => {
  test('isCourseFilePath accepts .lr2crs anywhere and JSON only under a course folder', () => {
    expect(isCourseFilePath('Courses/dan.LR2CRS')).toBe(true);
    expect(isCourseFilePath('beatoraja/course/dan.json')).toBe(true);
    expect(isCourseFilePath('course/dan.json')).toBe(true);
    expect(isCourseFilePath('beatoraja/folder/default.json')).toBe(true);
    expect(isCourseFilePath('folder\\default.json')).toBe(true);
    expect(isCourseFilePath('folder/readme.txt')).toBe(false);
    expect(isCourseFilePath('skin/select.json')).toBe(false);
    expect(isCourseFilePath('songs/chart.bms')).toBe(false);
  });

  test('readCourseFile reads both formats into a group named after the file', () => {
    const lr2 = `<courselist><course><title>Dan</title><type>2</type><hash>${'0'.repeat(32)}${MD5_A}</hash></course></courselist>`;
    expect(readCourseFile('a/dan.lr2crs', new TextEncoder().encode(lr2))).toMatchObject([
      { label: 'dan', courses: [{ name: 'Dan', kind: 'grade' }] },
    ]);
    const json = JSON.stringify([{ name: 'Expert', hash: [{ md5: MD5_A }] }]);
    expect(readCourseFile('course\\expert.json', new TextEncoder().encode(json))).toMatchObject([
      { label: 'expert', courses: [{ name: 'Expert', kind: 'expert' }] },
    ]);
    expect(readCourseFile('course/empty.json', new TextEncoder().encode('[]'))).toEqual([]);
  });

  test('readCourseFile reads the random courses of a command-folder file, one group per folder', () => {
    const json = JSON.stringify([
      { name: 'Lamp', sql: 'level = 12' },
      { name: 'Random', rcourse: [{ name: 'R', stage: [{ sql: 'level = 12' }] }] },
    ]);
    expect(readCourseFile('beatoraja/folder/default.json', new TextEncoder().encode(json))).toEqual([
      {
        label: 'Random',
        courses: [],
        randomCourses: [
          { name: 'R', stages: [{ filter: 'level = 12' }], constraints: [], trophies: [], distinct: false },
        ],
      },
    ]);
    expect(readCourseFile('folder/default.json', new TextEncoder().encode('[{"name":"Lamp","sql":"1"}]'))).toEqual([]);
  });
});

describe('random courses', () => {
  const random = parseBeatorajaRandomCourseData({
    name: 'Random Dan',
    stage: [{ sql: 'level = 12', title: 'Stage 1' }, { sql: 'level >= 11' }, {}],
    constraint: ['MIRROR'],
    rconstraint: ['DISTINCT'],
  })!;

  test('resolveCourseFolders lists random courses after the fixed ones, with no stage drawn', () => {
    const fixed = parseBeatorajaCourseData({ name: 'Fixed', hash: [{ md5: MD5_A }] })!;
    const broken = { ...random, name: 'Broken', stages: [{ filter: 'clear = 5' }] };
    const [folder] = resolveCourseFolders(
      [
        { label: 'Random', courses: [fixed], randomCourses: [random, broken] },
        { label: 'none', courses: [], randomCourses: [] },
      ],
      createChartHashLookup([]),
    );
    expect(folder!.courses!.map((course) => [course.id, course.playable, course.random?.name])).toEqual([
      ['Random#0', false, undefined],
      ['Random#r0', true, 'Random Dan'],
      ['Random#r1', false, 'Broken'],
    ]);
    expect(folder!.courses![1]).toMatchObject({
      definition: { name: 'Random Dan', kind: 'grade', stages: [], constraints: ['grade_mirror'], release: false },
      stages: [{ title: 'Stage 1' }, { title: 'level >= 11' }, { title: 'RANDOM' }],
    });
  });

  test('createRandomCourseEntry needs at least one stage to be playable', () => {
    expect(createRandomCourseEntry('x', { ...random, stages: [] }).playable).toBe(false);
  });

  test('createCourseChartRecord maps a song and its chart onto the filter columns', () => {
    const chart = parseChart(
      [
        '#PLAYER 1',
        '#GENRE TRANCE',
        '#SUBARTIST obj: someone',
        '#PLAYLEVEL 12',
        '#DIFFICULTY 4',
        '#RANK 2',
        '#BPM 150',
        '#BPM01 300',
        '#LNMODE 2',
        '#LNOBJ ZZ',
        '#00108:01',
        '#00111:0101',
        '#00211:ZZ00',
        '#00311:01',
        '#003D1:01',
      ].join('\n'),
      'bms',
    );
    const entry = { ...chartEntry('c', 'Chart C'), artist: 'Artist', genre: 'TRANCE', playLevel: '12', chart };
    const record = createCourseChartRecord(entry, { md5: MD5_A.toUpperCase(), sha256: SHA_B });
    expect({ ...record, chart: undefined }).toEqual({
      chart: undefined,
      md5: MD5_A,
      sha256: SHA_B,
      title: 'Chart C',
      artist: 'Artist',
      subartist: 'obj: someone',
      genre: 'TRANCE',
      path: 'c.bms',
      level: 12,
      difficulty: 4,
      notes: 100,
      judge: 2,
      // Only lane 1 is used, so the chart plays as 5 KEYS (beatoraja mode 5).
      mode: 5,
      minbpm: 150,
      maxbpm: 300,
      // Measure 0 at 150 BPM (1.6 s), then two measures at 300 BPM (1.6 s) up to the last object.
      length: 3200,
      feature: 16 | 2,
      // Two taps and a CN (its end counts too); no #TOTAL, so beatoraja's default for 4 notes.
      information: {
        n: 2,
        ln: 2,
        s: 0,
        ls: 0,
        total: 260,
        density: 0.6,
        peakdensity: 1,
        enddensity: 0.75,
        mainbpm: 300,
      },
    });
    expect(record.chart).toBe(entry);
    // A chart with no lanes in use reads as 5 KEYS, as the play-variant rule gives it.
    const bare = createCourseChartRecord(chartEntry('d', 'Empty'));
    expect([bare.level, bare.difficulty, bare.mode, bare.length, bare.feature, bare.md5]).toEqual([
      0,
      0,
      5,
      0,
      0,
      undefined,
    ]);
  });

  test('createCourseChartRecord counts scratch notes apart and reads #TOTAL', () => {
    const chart = parseChart(
      [
        '#PLAYER 1',
        '#BPM 120',
        '#TOTAL 350',
        '#LNTYPE 1',
        '#00111:01',
        '#00116:01010000',
        '#00156:00000100',
        '#00256:0100',
      ].join('\n'),
      'bms',
    );
    const record = createCourseChartRecord({ ...chartEntry('s', 'Scratch'), chart });
    expect(record.information).toMatchObject({ n: 1, ln: 0, s: 2, ls: 1, total: 350, mainbpm: 120 });
  });

  test('createCourseChartRecord reads the score row from the best record on every read', () => {
    let best: BestRecord | undefined;
    const record = createCourseChartRecord(chartEntry('p', 'Played'), {}, () => best);
    expect(record.score).toBeUndefined();
    best = { lamp: 'EX_HARD', exScore: 150, maxCombo: 90, missCount: 3, playCount: 2 };
    expect(record.score).toEqual({ clear: 7, exscore: 150, combo: 90, minbp: 3, playcount: 2, notes: 100 });
    const parsed = parseCourseChartFilter('score.clear >= 7 AND information.n = 0');
    expect(parsed.ok && evaluateCourseChartFilter(parsed.filter, record)).toBe(true);
    // Without a reader the chart reads as never played.
    expect(createCourseChartRecord(chartEntry('q', 'Unplayed')).score).toBeUndefined();
  });

  test('drawBrowserRandomCourse draws the stages from the collection into a playable fixed course', () => {
    const chartEntries = [10, 11, 12, 12].map((level, index) => ({
      chart: { ...chartEntry(`s${index}`, `Song ${index}`), playLevel: level },
      md5: index.toString(16).padStart(32, '0'),
    }));
    const entry = createRandomCourseEntry('Random#r0', random);
    const drawn = drawBrowserRandomCourse(entry, chartEntries, () => 0);
    expect(drawn.ok).toBe(true);
    if (!drawn.ok) return;
    expect(drawn.course).toMatchObject({
      id: 'Random#r0',
      playable: true,
      definition: { name: 'Random Dan', kind: 'grade', source: { format: 'beatoraja-random' } },
      stages: [
        { title: 'Song 2', chart: chartEntries[2]!.chart },
        { title: 'Song 1', chart: chartEntries[1]!.chart },
        { title: 'Song 3', chart: chartEntries[3]!.chart },
      ],
    });
    expect(drawn.course.definition.stages.map((stage) => stage.md5)).toEqual([
      chartEntries[2]!.md5,
      chartEntries[1]!.md5,
      chartEntries[3]!.md5,
    ]);
    expect(drawBrowserRandomCourse(entry, chartEntries.slice(0, 2), () => 0)).toEqual({
      ok: false,
      stage: 0,
      reason: 'no-candidates',
    });
    const fixed = { ...entry, random: undefined };
    expect(drawBrowserRandomCourse(fixed, chartEntries, () => 0)).toEqual({ ok: true, course: fixed });
  });
});

describe('resolveCourseFolders', () => {
  test('matches stages by hash and marks a course with a missing stage unplayable', () => {
    const a = chartEntry('a', 'Song A');
    const b = chartEntry('b', 'Song B');
    const lookup = createChartHashLookup([
      { chart: a, md5: MD5_A.toUpperCase() },
      { chart: b, sha256: SHA_B },
      { chart: chartEntry('dup', 'Duplicate'), md5: MD5_A },
    ]);
    const full = parseBeatorajaCourseData({ name: 'Full', hash: [{ md5: MD5_A }, { sha256: SHA_B }] })!;
    const missing = parseBeatorajaCourseData({
      name: 'Missing',
      hash: [{ md5: MD5_A }, { md5: 'f'.repeat(32), title: 'Gone' }],
    })!;
    const [folder] = resolveCourseFolders(
      [
        { label: 'dan', courses: [full, missing] },
        { label: 'empty', courses: [] },
      ],
      lookup,
    );
    expect(folder).toMatchObject({ label: 'dan', charts: [] });
    expect(folder!.courses!.map((course) => [course.id, course.playable])).toEqual([
      ['dan#0', true],
      ['dan#1', false],
    ]);
    expect(folder!.courses![0]!.stages).toEqual([
      { title: 'Song A', chart: a },
      { title: 'Song B', chart: b },
    ]);
    expect(folder!.courses![1]!.stages[1]).toEqual({ title: 'Gone' });
  });
});
