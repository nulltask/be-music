import { createEmptyJson, type BeMusicEvent, type BeMusicJson } from '@be-music/json';
import type { CourseDefinition } from '@be-music/player/course';
import type { LibraryChart, LibraryCourse, LibraryFolder } from '../library/entries.ts';

/** A library chart for tests: an empty chart in `directory` (the folder it is grouped in), with `overrides` applied. */
export function makeChart(id: string, directory: string, overrides: Partial<LibraryChart> = {}): LibraryChart {
  return {
    id,
    sourceId: 'test',
    sourceLabel: 'test',
    sourceKind: 'directory',
    chartPath: `${directory}/${id}.bms`,
    directoryLabel: directory,
    fileLabel: `${id}.bms`,
    title: id,
    totalNotes: 0,
    chart: createEmptyJson(),
    ...overrides,
  };
}

/** A chart whose parsed chart has one note on each of `channels` and the given `#DIFFICULTY` / bmson mode hint. */
export function makeChartWith(
  id: string,
  directory: string,
  options: { channels?: readonly string[]; difficulty?: number; modeHint?: string; chartPath?: string },
  overrides: Partial<LibraryChart> = {},
): LibraryChart {
  const chart: BeMusicJson = createEmptyJson();
  chart.events = (options.channels ?? []).map((channel, index): BeMusicEvent => ({
    measure: 1,
    channel,
    position: [index, Math.max(1, options.channels?.length ?? 1)],
    value: '01',
  }));
  if (options.difficulty !== undefined) chart.metadata.difficulty = options.difficulty;
  if (options.modeHint !== undefined) chart.bmson.info.modeHint = options.modeHint;
  return makeChart(id, directory, {
    chart,
    ...(options.chartPath !== undefined ? { chartPath: options.chartPath } : {}),
    ...overrides,
  });
}

/** A course bar for tests: a grade course named `id`, playable, with one stage per title. */
export function makeCourse(id: string, overrides: Partial<LibraryCourse> = {}, keyMode?: number): LibraryCourse {
  const definition: CourseDefinition = {
    name: id,
    kind: 'grade',
    stages: [],
    constraints: [],
    trophies: [],
    release: false,
    source: { format: 'beatoraja-json' },
    ...(keyMode !== undefined ? { keyMode } : {}),
  };
  return { id, definition, stages: [{ title: 'stage' }], playable: true, ...overrides };
}

/** A course folder for tests. */
export function makeCourseFolder(label: string, courses: readonly LibraryCourse[]): LibraryFolder {
  return { label, charts: [], courses };
}
