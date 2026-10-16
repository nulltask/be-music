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
}
