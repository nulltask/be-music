/**
 * Library entries for the select session's tests: charts, courses and a collection, with placeholder values that
 * satisfy the types.
 */

import { createEmptyJSON, type BeMusicEvent, type BeMusicJSON } from '@be-music/json';
import type { CourseDefinition } from '@be-music/player/course';
import type { LibraryChart, LibraryCourse, LibraryFolder } from '@be-music/scene-model';
import type { BrowserSongCollection } from '../../collection/types.ts';

/** A chart titled `id` in the folder `directory`, with one object on each of `channels` (a 7-key chart by default). */
export function makeChart(
  id: string,
  directory: string,
  options: { channels?: readonly string[]; difficulty?: number; modeHint?: string; playLevel?: number } = {},
): LibraryChart {
  const chart: BeMusicJSON = createEmptyJSON();
  chart.events = (options.channels ?? ['11', '18']).map((channel, index): BeMusicEvent => ({
    measure: 1,
    channel,
    position: [index, Math.max(1, options.channels?.length ?? 1)],
    value: '01',
  }));
  if (options.difficulty !== undefined) chart.metadata.difficulty = options.difficulty;
  if (options.modeHint !== undefined) chart.bmson.info.modeHint = options.modeHint;
  return {
    id,
    sourceId: 'test',
    sourceLabel: 'test',
    sourceKind: 'directory',
    chartPath: `${directory}/${id}.bms`,
    directoryLabel: directory,
    fileLabel: `${id}.bms`,
    title: id,
    totalNotes: 1,
    ...(options.playLevel !== undefined ? { playLevel: options.playLevel } : {}),
    chart,
  };
}

/** A playable grade course named `id`. */
export function makeCourse(id: string, overrides: Partial<LibraryCourse> = {}): LibraryCourse {
  const definition: CourseDefinition = {
    name: id,
    kind: 'grade',
    stages: [],
    constraints: [],
    trophies: [],
    release: false,
    source: { format: 'beatoraja-json' },
  };
  return { id, definition, stages: [{ title: 'stage' }], playable: true, ...overrides };
}

/**
 * A collection of `charts` with the course folders given, its charts in one source (`test`) holding `files` (path to
 * bytes).
 */
export function makeCollection(
  charts: readonly LibraryChart[],
  courseFolders: readonly LibraryFolder[] = [],
  files: Readonly<Record<string, Uint8Array>> = {},
): BrowserSongCollection {
  return {
    sources: [{ id: 'test', kind: 'directory', label: 'test', files: new Map(Object.entries(files)) }],
    charts: [...charts],
    errors: [],
    ...(courseFolders.length > 0 ? { courseFolders: [...courseFolders] } : {}),
  };
}

/** A course folder listing `courses`. */
export function makeCourseFolder(label: string, courses: readonly LibraryCourse[]): LibraryFolder {
  return { label, charts: [], courses: [...courses] };
}
