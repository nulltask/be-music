/**
 * Library entries for the select session's tests: charts, courses and a collection, with placeholder values that
 * satisfy the types.
 */

import { createEmptyJson, type BeMusicEvent, type BeMusicJson } from '@be-music/json';
import type { CourseDefinition } from '@be-music/player/course';
import type {
  BrowserCourseEntry,
  BrowserFolderNode,
  BrowserSongCollection,
  BrowserSongEntry,
} from '../../collection/types.ts';

/** A chart titled `id` in the folder `directory`, with one object on each of `channels` and the options given. */
export function makeChart(
  id: string,
  directory: string,
  options: { channels?: readonly string[]; difficulty?: number; modeHint?: string; playLevel?: number } = {},
): BrowserSongEntry {
  const chart: BeMusicJson = createEmptyJson();
  chart.events = (options.channels ?? ['11']).map((channel, index): BeMusicEvent => ({
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
export function makeCourse(id: string, overrides: Partial<BrowserCourseEntry> = {}): BrowserCourseEntry {
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

/** A collection of `songs` with the course folders given, and no sources. */
export function makeCollection(
  songs: readonly BrowserSongEntry[],
  courseFolders: readonly BrowserFolderNode[] = [],
): BrowserSongCollection {
  return {
    sources: [],
    songs: [...songs],
    errors: [],
    ...(courseFolders.length > 0 ? { courseFolders: [...courseFolders] } : {}),
  };
}

/** A course folder listing `courses`. */
export function makeCourseFolder(label: string, courses: readonly BrowserCourseEntry[]): BrowserFolderNode {
  return { label, songs: [], courses: [...courses] };
}
