import { parseChart } from '@be-music/chart-parser';
import { describe, expect, test } from 'vite-plus/test';
import { CourseMaker, resolveCourseMakerFolders, type CourseMakerChange } from './course-maker.ts';
import { createChartHashLookup } from './course.ts';
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
    expect(folders[1]!.courses!.map((entry) => entry.newCourse)).toEqual([true]);
  });
});
