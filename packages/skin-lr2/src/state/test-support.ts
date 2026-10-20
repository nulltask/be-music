import { createEmptyJSON, type BeMusicEvent, type BeMusicJSON } from '@be-music/chart-source';
import type { CourseDefinition } from '@be-music/player-engine/course';
import type { LibraryChart, LibraryCourse } from '@be-music/player-scene-model';

/** A library chart for tests: an empty chart, with `overrides` applied. */
export function makeChart(overrides: Partial<LibraryChart> = {}): LibraryChart {
  return {
    id: 'test:song',
    sourceId: 'test',
    sourceLabel: 'test',
    sourceKind: 'files',
    chartPath: 'test/song.bms',
    directoryLabel: 'test',
    fileLabel: 'song.bms',
    title: 'Untitled',
    totalNotes: 0,
    chart: createEmptyJSON(),
    ...overrides,
  };
}

/** A chart with one object on each of `channels`, and the `#DIFFICULTY` / `#RANK` / bmson mode hint given. */
export function makeChartWith(
  options: { channels?: readonly string[]; difficulty?: number; rank?: number; modeHint?: string },
  overrides: Partial<LibraryChart> = {},
): LibraryChart {
  const chart: BeMusicJSON = createEmptyJSON();
  chart.events = (options.channels ?? []).map((channel, index): BeMusicEvent => ({
    measure: 1,
    channel,
    position: [index, Math.max(1, options.channels?.length ?? 1)],
    value: '01',
  }));
  if (options.difficulty !== undefined) chart.metadata.difficulty = options.difficulty;
  if (options.rank !== undefined) chart.metadata.rank = options.rank;
  if (options.modeHint !== undefined) chart.bmson.info.modeHint = options.modeHint;
  return makeChart({ chart, ...overrides });
}

/** A course bar for tests: a grade course, playable, with one stage per title. */
export function makeCourse(
  overrides: Partial<LibraryCourse> = {},
  titles: readonly string[] = ['stage'],
): LibraryCourse {
  const definition: CourseDefinition = {
    name: 'Dan',
    kind: 'grade',
    stages: [],
    constraints: [],
    trophies: [],
    release: false,
    source: { format: 'beatoraja-json' },
  };
  return { id: 'dan#0', definition, stages: titles.map((title) => ({ title })), playable: true, ...overrides };
}
