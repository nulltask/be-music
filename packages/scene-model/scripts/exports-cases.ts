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

  // Play options
  define('scene-model.clampHiSpeed', {
    run: () => {
      sceneModelApi.clampHiSpeed(1.3000000000000003);
    },
  });
  define('scene-model.clampShutter', {
    run: () => {
      sceneModelApi.clampShutter(0.30000000000000004);
    },
  });
  define('scene-model.resolvePlayOptionValue', {
    run: () => {
      sceneModelApi.resolvePlayOptionValue('random1P', 'MIRROR');
      sceneModelApi.resolvePlayOptionValue('hiSpeed', 99);
    },
  });
  define('scene-model.cyclePlayOptionValue', {
    run: () => {
      sceneModelApi.cyclePlayOptionValue('gauge1P', 'GROOVE', -1);
    },
  });
  define('scene-model.nextChoice', {
    run: () => {
      sceneModelApi.nextChoice(sceneModelApi.RANDOM_CYCLE, 'SCATTER');
    },
  });
  define('scene-model.isListPlayOption', {
    run: () => {
      sceneModelApi.isListPlayOption('sort');
    },
  });
  define('scene-model.resolvePlayOptions', {
    run: () => {
      sceneModelApi.resolvePlayOptions({ hiSpeed: 3.25, random1P: 'MIRROR', gauge1P: 'BOGUS' });
    },
  });
  define('scene-model.snapHiSpeed', {
    run: () => {
      sceneModelApi.snapHiSpeed(1.3000000000000003);
    },
  });
  define('scene-model.stepPlayerHiSpeed', {
    run: () => {
      sceneModelApi.stepPlayerHiSpeed(2.5, 0.1, 0.8);
    },
  });
  define('scene-model.easeHiSpeed', {
    run: () => {
      sceneModelApi.easeHiSpeed(2, 3, 1_000, 1_100, sceneModelApi.HISPEED_TRANSITION_MS);
    },
  });
  define('scene-model.HiSpeedTransition', {
    run: () => {
      const transition = new sceneModelApi.HiSpeedTransition(2);
      transition.retarget(3, 1_000);
      transition.valueAt(1_100);
    },
  });

  // Play state
  define('scene-model.isJudge', {
    run: () => {
      sceneModelApi.isJudge('GREAT');
    },
  });
  define('scene-model.gaugePercent', {
    run: () => {
      sceneModelApi.gaugePercent({ current: 80, max: 100 });
    },
  });
  define('scene-model.resolveHsFixMultiplier', {
    run: () => {
      sceneModelApi.resolveHsFixMultiplier('MAXBPM', BENCH_HS_FIX_TEMPO);
    },
  });
  define('scene-model.createHiSpeedState', {
    run: () => {
      sceneModelApi.createHiSpeedState({ hiSpeed: 2.5, multiplier: 0.8 });
    },
  });
  define('scene-model.reduceHiSpeed', {
    run: () => {
      sceneModelApi.reduceHiSpeed(BENCH_HI_SPEED, { type: 'hi-speed-step', delta: 0.1 });
    },
  });
  define('scene-model.laneCoversFromPlayOptions', {
    run: () => {
      sceneModelApi.laneCoversFromPlayOptions(BENCH_COVER_OPTIONS, ['1P', '2P']);
    },
  });
  define('scene-model.resolveLaneCover', {
    run: () => {
      sceneModelApi.resolveLaneCover(BENCH_COVERS[0]!);
    },
  });
  define('scene-model.reduceLaneCovers', {
    run: () => {
      sceneModelApi.reduceLaneCovers(BENCH_COVERS, { type: 'cover-adjust', part: 'sudden', delta: 0.05 });
    },
  });
  define('scene-model.createPlayState', {
    run: () => {
      sceneModelApi.createPlayState({ gauge: 20, totalSeconds: 120, courseCarryIn: { combo: 10, maxCombo: 20 } });
    },
  });
  define('scene-model.playEventFromUiCommand', {
    run: () => {
      sceneModelApi.playEventFromUiCommand({ kind: 'trigger-poor-bga', seconds: 12 });
    },
  });
  define('scene-model.playProgress', {
    run: () => {
      sceneModelApi.playProgress(BENCH_PLAY_STATE, 30);
    },
  });
  define('scene-model.reducePlayState', {
    run: () => {
      let state = sceneModelApi.reducePlayState(BENCH_PLAY_STATE, BENCH_FRAME);
      state = sceneModelApi.reducePlayState(state, BENCH_JUDGE);
      sceneModelApi.reducePlayState(state, { type: 'hi-speed-step', delta: 0.1 });
    },
  });
  define('scene-model.recentJudgeTimings', {
    run: () => {
      sceneModelApi.recentJudgeTimings(BENCH_PLAYED, 16);
    },
  });
  define('scene-model.resolveWhiteNumber', {
    run: () => {
      sceneModelApi.resolveWhiteNumber({ laneBeats: 4, hiSpeed: 2.5, sudden: 0.3, bpm: 150 });
    },
  });
  define('scene-model.resolveHiSpeedForWhiteNumber', {
    run: () => {
      sceneModelApi.resolveHiSpeedForWhiteNumber({ laneBeats: 4, sudden: 0.3, bpm: 150, whiteNumberMs: 448 });
    },
  });
  define('scene-model.resolveGreenNumber', {
    run: () => {
      sceneModelApi.resolveGreenNumber(640);
    },
  });
  define('scene-model.resolvePlaylogView', {
    run: () => {
      sceneModelApi.resolvePlaylogView(BENCH_PLAYED.view, {
        scale: sceneModelApi.BE_MUSIC_HI_SPEED_SCALE,
        laneBeats: 4,
        mainBpm: 150,
      });
    },
  });
  define('scene-model.resolveBeatorajaPlaylogView', {
    run: () => {
      sceneModelApi.resolveBeatorajaPlaylogView({
        hiSpeed: 2,
        lanecover: 0.25,
        lift: 0.1,
        hiddenRatio: 0.5,
        hiddenEnabled: true,
        mainBpm: 150,
        sides: ['1P'],
      });
    },
  });
  define('scene-model.PlaylogViewCursor', {
    run: () => {
      const cursor = new sceneModelApi.PlaylogViewCursor({ hiSpeed: 2 }, [{ timeUs: 1_000_000, hiSpeed: 2.5 }]);
      cursor.next(0);
      cursor.next(2_000_000);
    },
  });

  // Play result
  define('scene-model.playResultRun', {
    run: () => {
      sceneModelApi.playResultRun({ run: 'stage' });
    },
  });
  define('scene-model.resolveResultPresentation', {
    run: () => {
      sceneModelApi.resolveResultPresentation('nonstop');
    },
  });
  define('scene-model.playResultFromPlayState', {
    run: () => {
      sceneModelApi.playResultFromPlayState(BENCH_PLAYED, {
        song: BENCH_CHARTS[0]!,
        score: BENCH_SCORE,
        seconds: 100,
        judgeRuleset: 'lr2',
      });
    },
  });
  define('scene-model.joinCourseStageHistories', {
    run: () => {
      sceneModelApi.joinCourseStageHistories([BENCH_STAGE_HISTORY, BENCH_STAGE_HISTORY], [120, 90, 100]);
    },
  });
  define('scene-model.playResultFromCourseRun', {
    run: () => {
      sceneModelApi.playResultFromCourseRun(BENCH_COURSE, BENCH_COURSE_RESULT, BENCH_COURSE_LOG, BENCH_STAGE_HISTORY);
    },
  });

  // Course view
  define('scene-model.resolveCourseView', {
    run: () => {
      sceneModelApi.resolveCourseView(BENCH_COURSE, 0);
    },
  });
  define('scene-model.createCourseCombo', {
    run: () => {
      sceneModelApi.createCourseCombo({ combo: 12, maxCombo: 30 });
    },
  });
  define('scene-model.reduceCourseCombo', {
    run: () => {
      sceneModelApi.reduceCourseCombo({ combo: 12, maxCombo: 30, stageCombo: 4 }, 5);
    },
  });
  define('scene-model.advanceCourseCombo', {
    run: () => {
      sceneModelApi.advanceCourseCombo({ combo: 12, maxCombo: 30, stageCombo: 4 }, 5);
    },
  });

  // System sounds
  define('scene-model.systemSoundSetFromLr2Theme', {
    run: () => {
      sceneModelApi.systemSoundSetFromLr2Theme(BENCH_LR2_THEME_SOUNDS);
    },
  });
  define('scene-model.systemSoundSetFromBeatoraja', {
    run: () => {
      sceneModelApi.systemSoundSetFromBeatoraja({
        paths: { cursor: 'sound/cursor.wav', decide: 'sound/decide.wav' },
        selectBgmPath: 'Bgm/select.wav',
        bgm: { clear: BENCH_BYTES },
      });
    },
  });
  define('scene-model.hasResultJingle', {
    run: () => {
      sceneModelApi.hasResultJingle(BENCH_SOUND_SET);
    },
  });
  define('scene-model.resolveResultJingles', {
    run: () => {
      sceneModelApi.resolveResultJingles([undefined, BENCH_SOUND_SET], true);
    },
  });
  define('scene-model.resolveResultJingle', {
    run: () => {
      sceneModelApi.resolveResultJingle({ clear: { bytes: BENCH_BYTES } }, true);
    },
  });
  define('scene-model.browseSystemSound', {
    run: () => {
      sceneModelApi.browseSystemSound({ type: 'move', delta: 1 }, { kind: 'cursor', from: 0, to: 1, delta: 1 });
    },
  });
  define('scene-model.startSystemSound', {
    run: () => {
      sceneModelApi.startSystemSound(BENCH_CHART_ENTRY);
    },
  });
}

const BENCH_BYTES = new Uint8Array([1, 2, 3]);
const BENCH_HS_FIX_TEMPO = { referenceBpm: 150, bpms: [150, 300, 75], mainBpm: 150 };
const BENCH_HI_SPEED = sceneModelApi.createHiSpeedState({ hiSpeed: 2.5, multiplier: 0.8 });
const BENCH_COVER_OPTIONS = {
  ...sceneModelApi.DEFAULT_PLAY_OPTIONS,
  hiddenSudden1P: 'HID+SUD',
  laneCover: true,
} as const satisfies sceneModelApi.PlayOptions;
const BENCH_COVERS = sceneModelApi.laneCoversFromPlayOptions(BENCH_COVER_OPTIONS, ['1P', '2P']);
const BENCH_PLAY_STATE = sceneModelApi.createPlayState({
  gauge: 20,
  totalSeconds: 120,
  view: { hiSpeed: BENCH_HI_SPEED, covers: BENCH_COVERS },
});
const BENCH_FRAME: sceneModelApi.PlayEvent = {
  type: 'frame',
  frame: {
    totalSeconds: 120,
    summary: { exScore: 40, gauge: { current: 46, max: 100, cleared: false, type: 'GROOVE' } },
  },
};
const BENCH_JUDGE: sceneModelApi.PlayEvent = {
  type: 'judge',
  judge: { judge: 'GREAT', combo: 21, channel: '11', deltaMs: -12 },
  seconds: 30,
  atMs: 30_000,
};
const BENCH_PLAYED = Array.from({ length: 200 }, (_, index): sceneModelApi.PlayEvent => ({
  type: 'judge',
  judge: { judge: index % 3 === 0 ? 'GREAT' : 'PERFECT', combo: index + 1, deltaMs: (index % 21) - 10 },
  seconds: index / 2,
  atMs: index * 500,
})).reduce(sceneModelApi.reducePlayState, sceneModelApi.reducePlayState(BENCH_PLAY_STATE, BENCH_FRAME));
const BENCH_SCORE = {
  total: 200,
  perfect: 133,
  great: 67,
  good: 0,
  bad: 0,
  poor: 0,
  emptyPoor: 0,
  exScore: 333,
  score: 333,
};
const BENCH_STAGE_HISTORY: sceneModelApi.CourseStageHistory = {
  gaugeHistory: BENCH_PLAYED.gaugeHistory,
  scoreHistory: BENCH_PLAYED.scoreHistory,
  playSeconds: 100,
};
const BENCH_COURSE_RESULT: Parameters<typeof sceneModelApi.playResultFromCourseRun>[1] = {
  ruleset: 'lr2',
  judge: { pgreat: 133, great: 67, good: 0, bad: 0, poor: 0, emptyPoor: 0 },
  fast: 30,
  slow: 37,
  exScore: 333,
  noteCount: 200,
  missCount: 0,
  maxCombo: 200,
  djLevel: 'AA',
  gauge: { type: 'GRADE', final: 80, cleared: true },
  stagesPlayed: 1,
  lamp: 'FULL_COMBO',
  stages: [],
};
const BENCH_COURSE_LOG = {
  stages: [{ played: true, playlog: { play: { judgeRuleset: 'lr2' } } }],
} as unknown as Parameters<typeof sceneModelApi.playResultFromCourseRun>[2];
const BENCH_LR2_THEME_SOUNDS: sceneModelApi.Lr2ThemeSounds = {
  selectBgm: { path: 'LR2files/Bgm/x/select.wav', bytes: BENCH_BYTES },
  clearBgm: { path: 'LR2files/Sound/lr2/clear.wav', bytes: BENCH_BYTES },
  systemSounds: { cursorMove: { path: 'LR2files/Sound/lr2/scratch.wav', bytes: BENCH_BYTES } },
};
const BENCH_SOUND_SET = sceneModelApi.systemSoundSetFromLr2Theme(BENCH_LR2_THEME_SOUNDS);
