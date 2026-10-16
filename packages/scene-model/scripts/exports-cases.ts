import { parseChart } from '@be-music/parser';
import * as sceneModelApi from '@be-music/scene-model';
import type { DefineBenchmarkCase } from '../../../scripts/bench/exports.types.ts';

const BENCH_CHART = parseChart(
  ['#BPM 150', '#DIFFICULTY 3', '#WAV01 a.wav', '#00111:01010101', '#00118:00010001', '#00216:01000000'].join('\n'),
  'bms',
);

function benchChart(id: string, directory: string, title: string, playLevel: number): sceneModelApi.LibraryChart {
  return {
    id,
    sourceId: 'source',
    sourceLabel: 'Bench',
    sourceKind: 'directory',
    chartPath: `${directory}/${id}.bms`,
    directoryLabel: directory,
    fileLabel: `${id}.bms`,
    title,
    artist: 'be-music',
    playLevel,
    bpm: 150,
    totalNotes: 6,
    chart: BENCH_CHART,
  };
}

const BENCH_CHARTS: readonly sceneModelApi.LibraryChart[] = Array.from({ length: 64 }, (_, index) =>
  benchChart(`chart-${index}`, `Pack${index % 8}/song${index}`, `Title ${(index * 37) % 64}`, (index * 7) % 13),
);
const BENCH_COURSE: sceneModelApi.LibraryCourse = {
  id: 'Dan#0',
  definition: {
    name: 'Bench Dan',
    kind: 'grade',
    stages: [],
    constraints: [],
    trophies: [],
    release: true,
    keyMode: 7,
    source: { format: 'beatoraja-json' },
  },
  stages: [{ title: 'Title 1', song: BENCH_CHARTS[1] }],
  playable: true,
};
const BENCH_LIBRARY: sceneModelApi.Library = {
  songs: BENCH_CHARTS,
  courseFolders: [{ label: 'Dan', songs: [], courses: [BENCH_COURSE] }],
};
const BENCH_CHART_ENTRY: sceneModelApi.LibraryEntry = { kind: 'song', song: BENCH_CHARTS[3]! };
const BENCH_ENTRIES: readonly sceneModelApi.LibraryEntry[] = BENCH_CHARTS.map((song) => ({ kind: 'song', song }));
const BENCH_ROOT = sceneModelApi.createBrowseState();
const BENCH_IN_FOLDER = sceneModelApi.reduceBrowse(BENCH_LIBRARY, BENCH_ROOT, { type: 'open' }).state;
const BENCH_SNAPSHOT = sceneModelApi.captureBrowse(BENCH_LIBRARY, BENCH_IN_FOLDER);
const BENCH_LIST = { sort: 'LEVEL', keysFilter: 'KEYS_7', difficultyFilter: 'HYPER' } as const;

export function registerSceneModelExportsCases(define: DefineBenchmarkCase): void {
  // Library
  define('scene-model.libraryEntryKey', {
    run: () => {
      sceneModelApi.libraryEntryKey(BENCH_CHART_ENTRY);
    },
  });
  define('scene-model.groupChartsByFolder', {
    run: () => {
      sceneModelApi.groupChartsByFolder(BENCH_CHARTS);
    },
  });
  define('scene-model.chartFolderLabel', {
    run: () => {
      sceneModelApi.chartFolderLabel(BENCH_CHARTS[5]!);
    },
  });
  define('scene-model.libraryRootFolders', {
    run: () => {
      sceneModelApi.libraryRootFolders(BENCH_LIBRARY);
    },
  });
  define('scene-model.resolveLibraryChartPlayVariant', {
    run: () => {
      sceneModelApi.resolveLibraryChartPlayVariant(BENCH_CHARTS[0]!);
      sceneModelApi.resolveLibraryChartPlayVariant(BENCH_CHARTS[0]!, BENCH_CHART);
    },
  });
  define('scene-model.seedLibraryChartPlayVariant', {
    run: () => {
      sceneModelApi.seedLibraryChartPlayVariant(BENCH_CHARTS[0]!, '7');
    },
  });
  define('scene-model.resolveLibraryChartKeyMode', {
    run: () => {
      sceneModelApi.resolveLibraryChartKeyMode(BENCH_CHARTS[2]!);
    },
  });

  // Browse
  define('scene-model.sameBrowseListOptions', {
    run: () => {
      sceneModelApi.sameBrowseListOptions(BENCH_LIST, sceneModelApi.DEFAULT_BROWSE_LIST_OPTIONS);
    },
  });
  define('scene-model.keysFilterKeyMode', {
    run: () => {
      sceneModelApi.keysFilterKeyMode('KEYS_14');
    },
  });
  define('scene-model.chartMatchesDifficultyFilter', {
    run: () => {
      sceneModelApi.chartMatchesDifficultyFilter(BENCH_CHARTS[0]!, 'HYPER');
    },
  });
  define('scene-model.chartMatchesKeysFilter', {
    run: () => {
      sceneModelApi.chartMatchesKeysFilter(BENCH_CHARTS[0]!, 'KEYS_7');
    },
  });
  define('scene-model.courseMatchesKeysFilter', {
    run: () => {
      sceneModelApi.courseMatchesKeysFilter(BENCH_COURSE, 'KEYS_5');
    },
  });
  define('scene-model.entryMatchesListFilters', {
    run: () => {
      sceneModelApi.entryMatchesListFilters(BENCH_CHART_ENTRY, BENCH_LIST);
    },
  });
  define('scene-model.normalizeSearchQuery', {
    run: () => {
      sceneModelApi.normalizeSearchQuery('  Bench Title ');
    },
  });
  define('scene-model.matchesSearchQuery', {
    run: () => {
      sceneModelApi.matchesSearchQuery(BENCH_CHART_ENTRY, 'bench');
    },
  });
  define('scene-model.sortLibraryEntries', {
    run: () => {
      sceneModelApi.sortLibraryEntries(BENCH_ENTRIES, 'LEVEL');
    },
  });
  define('scene-model.createBrowseState', {
    run: () => {
      sceneModelApi.createBrowseState({ list: { sort: 'TITLE' } });
    },
  });
  define('scene-model.browseCursor', {
    run: () => {
      sceneModelApi.browseCursor(BENCH_IN_FOLDER);
    },
  });
  define('scene-model.browseFolder', {
    run: () => {
      sceneModelApi.browseFolder(BENCH_IN_FOLDER);
    },
  });
  define('scene-model.browseEntries', {
    run: () => {
      sceneModelApi.browseEntries(BENCH_LIBRARY, BENCH_IN_FOLDER);
    },
  });
  define('scene-model.listEntriesAt', {
    run: () => {
      sceneModelApi.listEntriesAt(BENCH_LIBRARY, [], 'title', BENCH_LIST);
    },
  });
  define('scene-model.focusedEntry', {
    run: () => {
      sceneModelApi.focusedEntry(BENCH_LIBRARY, BENCH_IN_FOLDER);
    },
  });
  define('scene-model.focusedChart', {
    run: () => {
      sceneModelApi.focusedChart(BENCH_LIBRARY, BENCH_IN_FOLDER);
    },
  });
  define('scene-model.focusedCourse', {
    run: () => {
      sceneModelApi.focusedCourse(BENCH_LIBRARY, BENCH_IN_FOLDER);
    },
  });
  define('scene-model.isFavorite', {
    run: () => {
      sceneModelApi.isFavorite(BENCH_IN_FOLDER, 'chart-0');
    },
  });
  define('scene-model.wrappedCursorDelta', {
    run: () => {
      sceneModelApi.wrappedCursorDelta(-9, 10);
    },
  });
  define('scene-model.reduceBrowse', {
    run: () => {
      const moved = sceneModelApi.reduceBrowse(BENCH_LIBRARY, BENCH_IN_FOLDER, { type: 'move', delta: 1 });
      sceneModelApi.reduceBrowse(BENCH_LIBRARY, moved.state, { type: 'list', options: { sort: 'TITLE' } });
    },
  });
  define('scene-model.clampIndex', {
    run: () => {
      sceneModelApi.clampIndex(42.5, 10);
    },
  });
  define('scene-model.captureBrowse', {
    run: () => {
      sceneModelApi.captureBrowse(BENCH_LIBRARY, BENCH_IN_FOLDER);
    },
  });
  define('scene-model.restoreBrowse', {
    run: () => {
      sceneModelApi.restoreBrowse(BENCH_LIBRARY, BENCH_SNAPSHOT);
    },
  });
  define('scene-model.browseSnapshotFromSelectNavigation', {
    run: () => {
      sceneModelApi.browseSnapshotFromSelectNavigation({ folderPath: ['Pack1'], selectedIndex: 3 });
    },
  });
  define('scene-model.browseSnapshotFromBeatorajaSelect', {
    run: () => {
      sceneModelApi.browseSnapshotFromBeatorajaSelect({
        folderPath: ['Dan'],
        cursorStack: [8, 0],
        keymodeFilter: 2,
        sortMode: 4,
        favoriteSongs: [],
        favoriteCharts: ['chart-0'],
        searchQuery: '',
      });
    },
  });
}
