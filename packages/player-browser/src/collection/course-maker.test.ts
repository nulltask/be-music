import { parseChart } from '@be-music/chart-parser';
import { describe, expect, test } from 'vite-plus/test';
import {
  CourseMaker,
  createDrawnRandomMixEntry,
  createRandomMixChart,
  resolveCourseMakerFolders,
  type CourseMakerChange,
} from './course-maker.ts';
import { createChartHashLookup } from './course.ts';
import type { CourseDefinition } from '@be-music/player-engine/course';
import type { LibraryChart } from '@be-music/player-scene-model';

function chartEntry(id: string, text: string): LibraryChart {
  return {
    id,
    sourceId: 'drop1',
    sourceLabel: 'pack',
    sourceKind: 'directory',
    chartPath: `${id}.bms`,
    directoryLabel: 'pack',
    fileLabel: `${id}.bms`,
    title: id.toUpperCase(),
    totalNotes: 1,
    chart: parseChart(text, 'bms'),
  };
}

const SEVEN = ['a', 'b', 'c'].map((id) => chartEntry(id, '#00111:01\n#00118:01'));
const DOUBLE = chartEntry('d', '#00111:01\n#00121:01');
const MD5 = new Map([...SEVEN, DOUBLE].map((entry, index) => [entry.id, String(index + 1).repeat(32)]));

function maker(changes: CourseMakerChange[] = []): CourseMaker {
  return new CourseMaker({ md5Of: async (entry) => MD5.get(entry.id), onChange: (change) => changes.push(change) });
}

describe('CourseMaker', () => {
  test('makes a course from the songs decided, newest saved first', async () => {
    const changes: CourseMakerChange[] = [];
    const courses = maker(changes);
    expect(await courses.append(SEVEN[0]!)).toEqual({ ok: false, reason: 'not-making' });
    courses.start('nonstop');
    expect(courses.draft).toMatchObject({ kind: 'nonstop', name: '', stages: [] });
    expect(await courses.append(SEVEN[0]!)).toEqual({ ok: true });
    expect(await courses.append(SEVEN[1]!)).toEqual({ ok: true });
    expect(await courses.append(DOUBLE)).toEqual({ ok: false, reason: 'key-mode' });
    courses.rename('  Mine ');
    courses.stepDefaultConnection(2);
    const saved = courses.finish()!;
    expect(saved).toMatchObject({ name: 'Mine', kind: 'nonstop', keyMode: 7, connections: ['cut'] });
    expect(saved.stages.map((stage) => stage.md5)).toEqual([MD5.get('a'), MD5.get('b')]);
    courses.start('grade');
    await courses.append({ ...SEVEN[0]!, subtitle: '[SPA]' });
    // The draft keeps the song's subtitle for LR2's texts 160-164.
    expect(courses.draft?.stages[0]).toMatchObject({ title: 'A', subtitle: '[SPA]' });
    courses.cancel();
    expect(courses.draft).toBeUndefined();
    courses.start('expert');
    await courses.append(SEVEN[2]!);
    const second = courses.finish()!;
    expect(second.name).toBe('COURSE 1');
    expect(courses.courses).toEqual([second, saved]);
    expect(changes).toContain('courses');
    expect(changes).toContain('settings');
  });

  test('cancels or trims a course being made, and keeps an empty one unsaved', async () => {
    const courses = maker();
    courses.start('grade');
    expect(courses.finish()).toBeUndefined();
    await courses.append(SEVEN[0]!);
    await courses.append(SEVEN[1]!);
    courses.removeLast();
    expect(courses.draft?.stages.map((stage) => stage.title)).toEqual(['A']);
    courses.cancel();
    expect(courses.draft).toBeUndefined();
    expect(courses.courses).toEqual([]);
  });

  test('edits, renames and deletes a saved course', async () => {
    const courses = maker();
    courses.start('nonstop');
    await courses.append(SEVEN[0]!);
    await courses.append(SEVEN[1]!);
    const saved = courses.finish()!;
    const stepped = courses.stepConnection(saved, 0, -1)!;
    expect(stepped.connections).toEqual(['blank2']);
    expect(courses.stepConnection(saved, 0, 1)).toBeUndefined();
    const renamed = courses.renameCourse(stepped, 'Renamed')!;
    expect(courses.courses).toEqual([renamed]);
    courses.deleteCourse(renamed);
    expect(courses.courses).toEqual([]);
  });

  test('flags a saved course for IR once, then keeps its connections and constraints fixed', async () => {
    const changes: CourseMakerChange[] = [];
    const courses = maker(changes);
    courses.start('nonstop');
    await courses.append(SEVEN[0]!);
    await courses.append(SEVEN[1]!);
    const saved = courses.finish()!;
    expect(saved.release).toBe(false);
    expect(courses.isReadOnly(saved)).toBe(false);
    changes.length = 0;
    const flagged = courses.releaseCourse(saved)!;
    expect(flagged.release).toBe(true);
    expect(changes).toEqual(['courses']);
    expect(courses.courses).toEqual([flagged]);
    expect(courses.isReadOnly(flagged)).toBe(true);
    // One-way, as LR2's button 253: a flagged course stays flagged.
    expect(courses.releaseCourse(flagged)).toBeUndefined();
    expect(courses.releaseCourse(saved)).toBeUndefined();
    expect(courses.stepConnection(flagged, 0, 1)).toBeUndefined();
    expect(courses.setCourseConstraints(flagged, ['no_speed'])).toBeUndefined();
    expect(courses.courses).toEqual([flagged]);
    // Renaming and deleting still work, as LR2's ChangeCourseTitle and DeleteCourse do.
    const renamed = courses.renameCourse(flagged, 'Ranked')!;
    expect(renamed).toMatchObject({ name: 'Ranked', release: true });
    courses.deleteCourse(renamed);
    expect(courses.courses).toEqual([]);
  });

  test('reads a course it does not own as not read-only and refuses to flag it', () => {
    const courses = maker();
    const foreign: CourseDefinition = {
      name: 'Table course',
      kind: 'expert',
      stages: [],
      constraints: [],
      trophies: [],
      release: true,
      source: { format: 'beatoraja-json' },
    };
    expect(courses.isReadOnly(foreign)).toBe(false);
    expect(courses.releaseCourse({ ...foreign, release: false })).toBeUndefined();
  });
});

test('restores saved courses without reporting a change', async () => {
  const changes: CourseMakerChange[] = [];
  const source = maker();
  source.start('expert');
  await source.append(SEVEN[0]!);
  const saved = source.finish()!;
  const restored = maker(changes);
  restored.restore({ courses: [saved], defaultConnection: 'blank2' });
  expect(restored.courses).toEqual([saved]);
  expect(restored.defaultConnection).toBe('blank2');
  expect(restored.owns(saved)).toBe(true);
  expect(changes).toEqual([]);
});

test('sets the constraints of the course being made and of a saved one', async () => {
  const courses = maker();
  courses.start('grade');
  expect(courses.draft?.constraints).toEqual(['grade', 'gauge_lr2']);
  courses.setConstraints(['grade', 'no_speed']);
  await courses.append(SEVEN[0]!);
  const saved = courses.finish()!;
  expect(saved.constraints).toEqual(['grade', 'no_speed']);
  const edited = courses.setCourseConstraints(saved, ['grade_random', 'gauge_7k'])!;
  expect(edited.constraints).toEqual(['grade_random', 'gauge_7k']);
  expect(courses.courses).toEqual([edited]);
});

describe('resolveCourseMakerFolders', () => {
  test('lists each kind with its saved courses then a NEW COURSE bar', async () => {
    const courses = maker();
    courses.start('expert');
    await courses.append(SEVEN[0]!);
    courses.finish();
    const lookup = createChartHashLookup(SEVEN.map((entry) => ({ chart: entry, md5: MD5.get(entry.id)! })));
    const folders = resolveCourseMakerFolders(courses.courses, lookup);
    expect(folders.map((folder) => folder.label)).toEqual(['MY COURSES', 'MY NONSTOP', 'MY DAN']);
    const [made, add] = folders[0]!.courses!;
    expect(made).toMatchObject({ editable: true, playable: true, stages: [{ title: 'A' }] });
    expect(add).toMatchObject({ newCourse: true, definition: { kind: 'expert', name: 'NEW COURSE' } });
    // A RANDOM MIX bar follows NEW COURSE in the EXPERT and NONSTOP folders, not in GRADE.
    expect(folders.map((folder) => folder.courses!.map((entry) => entry.randomMix === true))).toEqual([
      [false, false, true],
      [false, true],
      [false],
    ]);
    expect(folders[1]!.courses![1]).toMatchObject({ definition: { kind: 'nonstop', name: 'RANDOM MIX' } });
  });
});

describe('RANDOM MIX', () => {
  const charts = [...SEVEN, DOUBLE].map((entry) => createRandomMixChart(entry, MD5.get(entry.id)!));

  test('reads a song as LR2 song database columns', () => {
    const song = createRandomMixChart({ ...SEVEN[0]!, chartPath: 'pack/x/a.bms', playLevel: '7.5' }, 'A'.repeat(32));
    expect(song).toMatchObject({ md5: 'a'.repeat(32), folder: 'drop1/pack/x', keyMode: 7, level: 7, title: 'A' });
    expect(createRandomMixChart(DOUBLE, MD5.get('d')!).keyMode).toBe(10);
  });

  test('keeps the last draw of a folder in place of the previous one, and a renamed one as the player own', () => {
    const changes: CourseMakerChange[] = [];
    const courses = maker(changes);
    courses.stepRandomMixSetting('stageCount', -2);
    expect(courses.randomMixSettings.stageCount).toBe(3);
    const first = courses.drawRandomMix('expert', 7, charts, () => 0);
    expect(first.ok && first.charts.length).toBe(1);
    expect(first.ok && first.course).toMatchObject({ name: 'RANDOM MIX', kind: 'expert', keyMode: 7 });
    const nonstop = courses.drawRandomMix('nonstop', 7, charts, () => 0);
    const second = courses.drawRandomMix('expert', 7, charts, () => 0);
    if (!first.ok || !second.ok || !nonstop.ok) throw new Error('draw failed');
    expect(courses.courses).toEqual([second.course, nonstop.course]);
    expect(courses.randomMixes).toEqual([second.course, nonstop.course]);
    const renamed = courses.renameCourse(second.course, 'Keep')!;
    courses.drawRandomMix('expert', 7, charts, () => 0);
    expect(courses.courses).toHaveLength(3);
    expect(courses.courses).toContain(renamed);
    // A flagged draw becomes the player's own too: the next draw keeps it.
    const kept = courses.courses[0]!;
    const flaggedDraw = courses.releaseCourse(kept)!;
    expect(courses.randomMixes).not.toContain(flaggedDraw);
    courses.drawRandomMix('expert', 7, charts, () => 0);
    expect(courses.courses).toHaveLength(4);
    expect(courses.courses).toContain(flaggedDraw);
    expect(courses.drawRandomMix('expert', 9, charts, () => 0)).toEqual({ ok: false, reason: 'no-candidates' });
    expect(courses.courses).toHaveLength(4);
    expect(changes).toContain('settings');
    expect(changes).toContain('courses');
    const entry = createDrawnRandomMixEntry(second.course, second.charts);
    expect(entry).toMatchObject({ id: 'maker:expert#0', playable: true, editable: true });
    expect(entry.stages.map((stage) => stage.chart)).toEqual(second.charts.map(({ chart }) => chart));
  });

  test('writes back min and max swapped by a draw, and restores the settings and draws', () => {
    const courses = maker();
    courses.stepRandomMixSetting('minLevel', 5);
    courses.stepRandomMixSetting('maxLevel', 1);
    courses.drawRandomMix('expert', 7, charts, () => 0);
    expect(courses.randomMixSettings).toMatchObject({ minLevel: 1, maxLevel: 5 });
    const restored = maker();
    restored.restore({
      courses: courses.courses,
      randomMixSettings: { ...courses.randomMixSettings, stageCount: 9 },
      randomMixes: courses.randomMixes,
    });
    expect(restored.randomMixSettings.stageCount).toBe(5);
    expect(restored.randomMixes).toEqual(courses.randomMixes);
  });
});
