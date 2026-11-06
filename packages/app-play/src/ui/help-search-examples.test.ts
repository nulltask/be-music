import type { CourseChartRecord } from '@be-music/player-engine/course';
import {
  DEFAULT_BROWSE_LIST_OPTIONS,
  listEntriesAt,
  parseBrowseSearch,
  type Library,
  type LibraryChart,
} from '@be-music/player-scene-model';
import { describe, expect, test } from 'vite-plus/test';
import { HELP_SEARCH_EXAMPLES } from './help-search-examples.ts';

interface Fixture {
  readonly id: string;
  readonly chart: Partial<LibraryChart>;
  /** The chart as a `?` filter reads it; the library entry's title, artist and genre are copied in. */
  readonly record: CourseChartRecord;
}

const FIXTURES: readonly Fixture[] = [
  {
    id: 'ignition',
    chart: { title: 'Alternate IGNITION', artist: 'YAMD', genre: 'TRANCE' },
    record: { level: 11, difficulty: 4, mode: 7, minbpm: 150, maxbpm: 150, score: { clear: 6, playcount: 3 } },
  },
  {
    id: 'file-label',
    chart: { title: 'Sleepless', fileLabel: 'ignition_another.bms', genre: 'HARDCORE' },
    record: { level: 12, difficulty: 4, mode: 14, minbpm: 120, maxbpm: 240, score: { clear: 4, playcount: 12 } },
  },
  {
    id: 'unplayed',
    chart: { title: 'Starlight', artist: 'yamd feat. Someone', genre: 'Trance' },
    record: { level: 10, difficulty: 3, mode: 7, minbpm: 90, maxbpm: 180 },
  },
  {
    id: 'easy',
    chart: { title: 'Morning', artist: 'Other', genre: 'POP' },
    record: { level: 3, difficulty: 2, mode: 5, minbpm: 128, maxbpm: 128, score: { clear: 5, playcount: 1 } },
  },
  {
    id: 'never-scored',
    chart: { title: 'Glacier', artist: 'Other', genre: 'AMBIENT' },
    record: { level: 12, difficulty: 4, mode: 7, minbpm: 200, maxbpm: 200, score: { clear: 0, playcount: 0 } },
  },
];

/** What each example in Help lists over {@link FIXTURES}, in the order listed; keyed in the order Help shows them. */
const EXPECTED: Readonly<Record<string, readonly string[]>> = {
  ignition: ['ignition', 'file-label'],
  '?level BETWEEN 10 AND 12': ['ignition', 'file-label', 'unplayed', 'never-scored'],
  '?song.mode = 7 AND difficulty = 4': ['ignition', 'never-scored'],
  "?artist LIKE '%yamd%'": ['ignition', 'unplayed'],
  '?maxbpm >= 180 AND minbpm <> maxbpm': ['file-label', 'unplayed'],
  '?score.clear IS NULL OR score.clear < 5': ['file-label', 'unplayed', 'never-scored'],
  "?level >= 10 AND NOT genre IN ('TRANCE', 'HARDCORE')": ['unplayed', 'never-scored'],
  '?playcount > 0 ORDER BY playcount DESC LIMIT 10': ['file-label', 'ignition', 'easy'],
};

function makeLibrary(): Library {
  const records = new Map<LibraryChart, CourseChartRecord>();
  const charts = FIXTURES.map(({ id, chart, record }) => {
    const entry = {
      id,
      sourceId: 'source',
      sourceLabel: 'Source',
      sourceKind: 'folder',
      chartPath: `${id}.bms`,
      directoryLabel: 'Source',
      fileLabel: `${id}.bms`,
      totalNotes: 1000,
      ...chart,
    } as LibraryChart;
    records.set(entry, {
      title: entry.title,
      path: entry.chartPath,
      ...(entry.artist !== undefined ? { artist: entry.artist } : {}),
      ...(entry.genre !== undefined ? { genre: entry.genre } : {}),
      ...record,
    });
    return entry;
  });
  return { charts, chartFilterRecord: (chart) => records.get(chart)! };
}

describe('HELP_SEARCH_EXAMPLES', () => {
  const library = makeLibrary();

  test('every example has its expected result here', () => {
    expect(HELP_SEARCH_EXAMPLES.map((example) => example.query)).toEqual(Object.keys(EXPECTED));
  });

  test.each(HELP_SEARCH_EXAMPLES.map((example) => example.query))('%s parses and lists what Help says', (query) => {
    const search = parseBrowseSearch(query);
    expect(search.kind).toBe(query.startsWith('?') ? 'filter' : 'text');
    const listed = listEntriesAt(library, [], query, DEFAULT_BROWSE_LIST_OPTIONS).map((entry) =>
      entry.kind === 'chart' ? entry.chart.id : entry.kind,
    );
    expect(listed).toEqual(EXPECTED[query]);
  });
});
