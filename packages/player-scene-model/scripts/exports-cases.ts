import { parseChart } from '@be-music/chart-parser';
import * as sceneModelAPI from '@be-music/player-scene-model';
import type { DefineBenchmarkCase } from '../../../scripts/bench/exports.types.ts';

const BENCH_CHART = parseChart(
  ['#BPM 150', '#DIFFICULTY 3', '#WAV01 a.wav', '#00111:01010101', '#00118:00010001', '#00216:01000000'].join('\n'),
  'bms',
);

function benchChart(id: string, directory: string, title: string, playLevel: number): sceneModelAPI.LibraryChart {
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

const BENCH_CHARTS: readonly sceneModelAPI.LibraryChart[] = Array.from({ length: 64 }, (_, index) =>
  benchChart(`chart-${index}`, `Pack${index % 8}/song${index}`, `Title ${(index * 37) % 64}`, (index * 7) % 13),
);
const BENCH_COURSE: sceneModelAPI.LibraryCourse = {
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
  stages: [{ title: 'Title 1', chart: BENCH_CHARTS[1] }],
  playable: true,
};
const BENCH_LIBRARY: sceneModelAPI.Library = {
  charts: BENCH_CHARTS,
  courseFolders: [{ label: 'Dan', charts: [], courses: [BENCH_COURSE] }],
};
const BENCH_CHART_ENTRY: sceneModelAPI.LibraryEntry = { kind: 'chart', chart: BENCH_CHARTS[3]! };
const BENCH_ENTRIES: readonly sceneModelAPI.LibraryEntry[] = BENCH_CHARTS.map((chart) => ({ kind: 'chart', chart }));
const BENCH_ROOT = sceneModelAPI.createBrowseState();
const BENCH_IN_FOLDER = sceneModelAPI.reduceBrowse(BENCH_LIBRARY, BENCH_ROOT, { type: 'open' }).state;
const BENCH_SNAPSHOT = sceneModelAPI.captureBrowse(BENCH_LIBRARY, BENCH_IN_FOLDER);
const BENCH_LIST = { sort: 'LEVEL', keysFilter: 'KEYS_7', difficultyFilter: 'HYPER' } as const;

export function registerSceneModelExportsCases(define: DefineBenchmarkCase): void {
  // Library
  define('player-scene-model.libraryEntryKey', {
    run: () => {
      sceneModelAPI.libraryEntryKey(BENCH_CHART_ENTRY);
    },
  });
  define('player-scene-model.groupChartsByFolder', {
    run: () => {
      sceneModelAPI.groupChartsByFolder(BENCH_CHARTS);
    },
  });
  define('player-scene-model.chartFolderLabel', {
    run: () => {
      sceneModelAPI.chartFolderLabel(BENCH_CHARTS[5]!);
    },
  });
  define('player-scene-model.libraryRootFolders', {
    run: () => {
      sceneModelAPI.libraryRootFolders(BENCH_LIBRARY);
    },
  });
  define('player-scene-model.resolveLibraryChartPlayVariant', {
    run: () => {
      sceneModelAPI.resolveLibraryChartPlayVariant(BENCH_CHARTS[0]!);
      sceneModelAPI.resolveLibraryChartPlayVariant(BENCH_CHARTS[0]!, BENCH_CHART);
    },
  });
  define('player-scene-model.seedLibraryChartPlayVariant', {
    run: () => {
      sceneModelAPI.seedLibraryChartPlayVariant(BENCH_CHARTS[0]!, '7');
    },
  });
  define('player-scene-model.resolveLibraryChartKeyMode', {
    run: () => {
      sceneModelAPI.resolveLibraryChartKeyMode(BENCH_CHARTS[2]!);
    },
  });

  // Browse
  define('player-scene-model.sameBrowseListOptions', {
    run: () => {
      sceneModelAPI.sameBrowseListOptions(BENCH_LIST, sceneModelAPI.DEFAULT_BROWSE_LIST_OPTIONS);
    },
  });
  define('player-scene-model.keysFilterKeyMode', {
    run: () => {
      sceneModelAPI.keysFilterKeyMode('KEYS_14');
    },
  });
  define('player-scene-model.chartMatchesDifficultyFilter', {
    run: () => {
      sceneModelAPI.chartMatchesDifficultyFilter(BENCH_CHARTS[0]!, 'HYPER');
    },
  });
  define('player-scene-model.chartMatchesKeysFilter', {
    run: () => {
      sceneModelAPI.chartMatchesKeysFilter(BENCH_CHARTS[0]!, 'KEYS_7');
    },
  });
  define('player-scene-model.courseMatchesKeysFilter', {
    run: () => {
      sceneModelAPI.courseMatchesKeysFilter(BENCH_COURSE, 'KEYS_5');
    },
  });
  define('player-scene-model.entryMatchesListFilters', {
    run: () => {
      sceneModelAPI.entryMatchesListFilters(BENCH_CHART_ENTRY, BENCH_LIST);
    },
  });
  define('player-scene-model.normalizeSearchQuery', {
    run: () => {
      sceneModelAPI.normalizeSearchQuery('  Bench Title ');
    },
  });
  define('player-scene-model.matchesSearchQuery', {
    run: () => {
      sceneModelAPI.matchesSearchQuery(BENCH_CHART_ENTRY, 'bench');
    },
  });
  define('player-scene-model.sortLibraryEntries', {
    run: () => {
      sceneModelAPI.sortLibraryEntries(BENCH_ENTRIES, 'LEVEL');
    },
  });
  define('player-scene-model.createBrowseState', {
    run: () => {
      sceneModelAPI.createBrowseState({ list: { sort: 'TITLE' } });
    },
  });
  define('player-scene-model.browseCursor', {
    run: () => {
      sceneModelAPI.browseCursor(BENCH_IN_FOLDER);
    },
  });
  define('player-scene-model.browseFolder', {
    run: () => {
      sceneModelAPI.browseFolder(BENCH_IN_FOLDER);
    },
  });
  define('player-scene-model.browseEntries', {
    run: () => {
      sceneModelAPI.browseEntries(BENCH_LIBRARY, BENCH_IN_FOLDER);
    },
  });
  define('player-scene-model.listEntriesAt', {
    run: () => {
      sceneModelAPI.listEntriesAt(BENCH_LIBRARY, [], 'title', BENCH_LIST);
    },
  });
  define('player-scene-model.focusedEntry', {
    run: () => {
      sceneModelAPI.focusedEntry(BENCH_LIBRARY, BENCH_IN_FOLDER);
    },
  });
  define('player-scene-model.focusedChart', {
    run: () => {
      sceneModelAPI.focusedChart(BENCH_LIBRARY, BENCH_IN_FOLDER);
    },
  });
  define('player-scene-model.focusedCourse', {
    run: () => {
      sceneModelAPI.focusedCourse(BENCH_LIBRARY, BENCH_IN_FOLDER);
    },
  });
  define('player-scene-model.isFavorite', {
    run: () => {
      sceneModelAPI.isFavorite(BENCH_IN_FOLDER, 'chart-0');
    },
  });
  define('player-scene-model.wrappedCursorDelta', {
    run: () => {
      sceneModelAPI.wrappedCursorDelta(-9, 10);
    },
  });
  define('player-scene-model.reduceBrowse', {
    run: () => {
      const moved = sceneModelAPI.reduceBrowse(BENCH_LIBRARY, BENCH_IN_FOLDER, { type: 'move', delta: 1 });
      sceneModelAPI.reduceBrowse(BENCH_LIBRARY, moved.state, { type: 'list', options: { sort: 'TITLE' } });
    },
  });
  define('player-scene-model.clampIndex', {
    run: () => {
      sceneModelAPI.clampIndex(42.5, 10);
    },
  });
  define('player-scene-model.captureBrowse', {
    run: () => {
      sceneModelAPI.captureBrowse(BENCH_LIBRARY, BENCH_IN_FOLDER);
    },
  });
  define('player-scene-model.restoreBrowse', {
    run: () => {
      sceneModelAPI.restoreBrowse(BENCH_LIBRARY, BENCH_SNAPSHOT);
    },
  });

  // Play options
  define('player-scene-model.clampHiSpeed', {
    run: () => {
      sceneModelAPI.clampHiSpeed(1.3000000000000003);
    },
  });
  define('player-scene-model.clampShutter', {
    run: () => {
      sceneModelAPI.clampShutter(0.30000000000000004);
    },
  });
  define('player-scene-model.resolvePlayOptionValue', {
    run: () => {
      sceneModelAPI.resolvePlayOptionValue('random1P', 'MIRROR');
      sceneModelAPI.resolvePlayOptionValue('hiSpeed', 99);
    },
  });
  define('player-scene-model.cyclePlayOptionValue', {
    run: () => {
      sceneModelAPI.cyclePlayOptionValue('gauge1P', 'GROOVE', -1);
    },
  });
  define('player-scene-model.nextChoice', {
    run: () => {
      sceneModelAPI.nextChoice(sceneModelAPI.RANDOM_CYCLE, 'SCATTER');
    },
  });
  define('player-scene-model.isListPlayOption', {
    run: () => {
      sceneModelAPI.isListPlayOption('sort');
    },
  });
  define('player-scene-model.resolvePlayOptions', {
    run: () => {
      sceneModelAPI.resolvePlayOptions({ hiSpeed: 3.25, random1P: 'MIRROR', gauge1P: 'BOGUS' });
    },
  });
  define('player-scene-model.clampJudgeTimingMs', {
    run: () => {
      sceneModelAPI.clampJudgeTimingMs(125);
    },
  });
  define('player-scene-model.resolveNoteDisplaySeconds', {
    run: () => {
      sceneModelAPI.resolveNoteDisplaySeconds(2, 125);
    },
  });
  define('player-scene-model.resolveNormalHiSpeed', {
    run: () => {
      sceneModelAPI.resolveNormalHiSpeed(3, 120);
    },
  });
  define('player-scene-model.resolveNormalHiSpeedLevel', {
    run: () => {
      sceneModelAPI.resolveNormalHiSpeedLevel(2, 120);
    },
  });
  define('player-scene-model.snapClassicHiSpeed', {
    run: () => {
      sceneModelAPI.snapClassicHiSpeed(2.3);
    },
  });
  define('player-scene-model.stepClassicHiSpeed', {
    run: () => {
      sceneModelAPI.stepClassicHiSpeed(2, 1);
    },
  });
  define('player-scene-model.snapHiSpeed', {
    run: () => {
      sceneModelAPI.snapHiSpeed(1.3000000000000003);
    },
  });
  define('player-scene-model.stepPlayerHiSpeed', {
    run: () => {
      sceneModelAPI.stepPlayerHiSpeed(2.5, 0.1, 0.8);
    },
  });
  define('player-scene-model.easeHiSpeed', {
    run: () => {
      sceneModelAPI.easeHiSpeed(2, 3, 1_000, 1_100, sceneModelAPI.HISPEED_TRANSITION_MS);
    },
  });
  define('player-scene-model.HiSpeedTransition', {
    run: () => {
      const transition = new sceneModelAPI.HiSpeedTransition(2);
      transition.retarget(3, 1_000);
      transition.valueAt(1_100);
    },
  });

  // Play state
  define('player-scene-model.isJudgmentKind', {
    run: () => {
      sceneModelAPI.isJudgmentKind('GREAT');
    },
  });
  define('player-scene-model.gaugePercent', {
    run: () => {
      sceneModelAPI.gaugePercent({ current: 80, max: 100 });
    },
  });
  define('player-scene-model.resolveHSFixMultiplier', {
    run: () => {
      sceneModelAPI.resolveHSFixMultiplier('MAXBPM', BENCH_HS_FIX_TEMPO);
      sceneModelAPI.resolveHSFixMultiplier('STARTBPM', { ...BENCH_HS_FIX_TEMPO, startBPM: 180 });
    },
  });
  define('player-scene-model.createHiSpeedState', {
    run: () => {
      sceneModelAPI.createHiSpeedState({ hiSpeed: 2.5, multiplier: 0.8 });
    },
  });
  define('player-scene-model.reduceHiSpeed', {
    run: () => {
      sceneModelAPI.reduceHiSpeed(BENCH_HI_SPEED, { type: 'hi-speed-step', delta: 0.1 });
    },
  });
  define('player-scene-model.laneCoversFromPlayOptions', {
    run: () => {
      sceneModelAPI.laneCoversFromPlayOptions(BENCH_COVER_OPTIONS, ['1P', '2P']);
    },
  });
  define('player-scene-model.resolveLaneCover', {
    run: () => {
      sceneModelAPI.resolveLaneCover(BENCH_COVERS[0]!);
    },
  });
  define('player-scene-model.reduceLaneCovers', {
    run: () => {
      sceneModelAPI.reduceLaneCovers(BENCH_COVERS, { type: 'cover-adjust', part: 'sudden', delta: 0.05 });
    },
  });
  define('player-scene-model.createPlayState', {
    run: () => {
      sceneModelAPI.createPlayState({ gauge: 20, totalSeconds: 120, courseCarryIn: { combo: 10, maxCombo: 20 } });
    },
  });
  define('player-scene-model.playEventFromUICommand', {
    run: () => {
      sceneModelAPI.playEventFromUICommand({ kind: 'trigger-poor-bga', seconds: 12 });
    },
  });
  define('player-scene-model.playProgress', {
    run: () => {
      sceneModelAPI.playProgress(BENCH_PLAY_STATE, 30);
    },
  });
  define('player-scene-model.reducePlayState', {
    run: () => {
      let state = sceneModelAPI.reducePlayState(BENCH_PLAY_STATE, BENCH_FRAME);
      state = sceneModelAPI.reducePlayState(state, BENCH_JUDGE);
      sceneModelAPI.reducePlayState(state, { type: 'hi-speed-step', delta: 0.1 });
      // A seek rebuilding 200 judgments.
      sceneModelAPI.reducePlayState(BENCH_PLAYED, BENCH_SEEK);
    },
  });
  define('player-scene-model.recentJudgeTimings', {
    run: () => {
      sceneModelAPI.recentJudgeTimings(BENCH_PLAYED, 16);
    },
  });
  define('player-scene-model.resolveWhiteNumber', {
    run: () => {
      sceneModelAPI.resolveWhiteNumber({ laneBeats: 4, hiSpeed: 2.5, sudden: 0.3, bpm: 150 });
    },
  });
  define('player-scene-model.resolveHiSpeedForWhiteNumber', {
    run: () => {
      sceneModelAPI.resolveHiSpeedForWhiteNumber({ laneBeats: 4, sudden: 0.3, bpm: 150, whiteNumberMs: 448 });
    },
  });
  define('player-scene-model.resolveGreenNumber', {
    run: () => {
      sceneModelAPI.resolveGreenNumber(640);
    },
  });
  define('player-scene-model.captureReplayView', {
    run: () => {
      sceneModelAPI.captureReplayView(BENCH_PLAYED.view, {
        scale: sceneModelAPI.BE_MUSIC_HI_SPEED_SCALE,
        laneBeats: 4,
        mainBPM: 150,
      });
    },
  });
  define('player-scene-model.ReplayViewCursor', {
    run: () => {
      const cursor = new sceneModelAPI.ReplayViewCursor({ hiSpeed: 2 }, [{ timeUs: 1_000_000, hiSpeed: 2.5 }]);
      cursor.next(0);
      cursor.next(2_000_000);
      cursor.seek(0);
      cursor.seek(1_500_000);
    },
  });

  // Play result
  define('player-scene-model.playResultRun', {
    run: () => {
      sceneModelAPI.playResultRun({ run: 'stage' });
    },
  });
  define('player-scene-model.resolveResultPresentation', {
    run: () => {
      sceneModelAPI.resolveResultPresentation('nonstop');
    },
  });
  define('player-scene-model.playResultFromPlayState', {
    run: () => {
      sceneModelAPI.playResultFromPlayState(BENCH_PLAYED, {
        chart: BENCH_CHARTS[0]!,
        score: BENCH_SCORE,
        seconds: 100,
        judgeRuleset: 'lr2',
      });
    },
  });
  define('player-scene-model.joinCourseStageHistories', {
    run: () => {
      sceneModelAPI.joinCourseStageHistories([BENCH_STAGE_HISTORY, BENCH_STAGE_HISTORY], [120, 90, 100]);
    },
  });
  define('player-scene-model.playResultFromCourseRun', {
    run: () => {
      sceneModelAPI.playResultFromCourseRun(BENCH_COURSE, BENCH_COURSE_RESULT, BENCH_COURSE_LOG, BENCH_STAGE_HISTORY);
    },
  });

  // Course view
  define('player-scene-model.resolveCourseView', {
    run: () => {
      sceneModelAPI.resolveCourseView(BENCH_COURSE, 0);
    },
  });
  define('player-scene-model.createCourseCombo', {
    run: () => {
      sceneModelAPI.createCourseCombo({ combo: 12, maxCombo: 30 });
    },
  });
  define('player-scene-model.reduceCourseCombo', {
    run: () => {
      sceneModelAPI.reduceCourseCombo({ combo: 12, maxCombo: 30, stageCombo: 4 }, 5);
    },
  });

  // System sounds
  define('player-scene-model.systemSoundSetFromBeatoraja', {
    run: () => {
      sceneModelAPI.systemSoundSetFromBeatoraja({
        paths: { cursor: 'sound/cursor.wav', decide: 'sound/decide.wav' },
        selectBGMPath: 'BGM/select.wav',
        bgm: { clear: BENCH_BYTES },
      });
    },
  });
  define('player-scene-model.hasResultJingle', {
    run: () => {
      sceneModelAPI.hasResultJingle(BENCH_SOUND_SET);
    },
  });
  define('player-scene-model.resolveResultJingles', {
    run: () => {
      sceneModelAPI.resolveResultJingles([undefined, BENCH_SOUND_SET], true);
    },
  });
  define('player-scene-model.resolveResultJingle', {
    run: () => {
      sceneModelAPI.resolveResultJingle({ clear: { bytes: BENCH_BYTES } }, true);
    },
  });
  define('player-scene-model.browseSystemSound', {
    run: () => {
      sceneModelAPI.browseSystemSound({ type: 'move', delta: 1 }, { kind: 'cursor', from: 0, to: 1, delta: 1 });
    },
  });
  define('player-scene-model.startSystemSound', {
    run: () => {
      sceneModelAPI.startSystemSound(BENCH_CHART_ENTRY);
    },
  });
}

const BENCH_BYTES = new Uint8Array([1, 2, 3]);
const BENCH_HS_FIX_TEMPO = { referenceBPM: 150, bpms: [150, 300, 75], mainBPM: 150 };
const BENCH_HI_SPEED = sceneModelAPI.createHiSpeedState({ hiSpeed: 2.5, multiplier: 0.8 });
const BENCH_COVER_OPTIONS = {
  ...sceneModelAPI.DEFAULT_PLAY_OPTIONS,
  hiddenSudden1P: 'HID+SUD',
  laneCover: true,
} as const satisfies sceneModelAPI.PlayOptions;
const BENCH_COVERS = sceneModelAPI.laneCoversFromPlayOptions(BENCH_COVER_OPTIONS, ['1P', '2P']);
const BENCH_PLAY_STATE = sceneModelAPI.createPlayState({
  gauge: 20,
  totalSeconds: 120,
  view: { hiSpeed: BENCH_HI_SPEED, covers: BENCH_COVERS },
});
const BENCH_FRAME: sceneModelAPI.PlayEvent = {
  type: 'frame',
  frame: {
    totalSeconds: 120,
    summary: { exScore: 40, gauge: { current: 46, max: 100, cleared: false, type: 'GROOVE' } },
  },
};
const BENCH_JUDGE: sceneModelAPI.PlayEvent = {
  type: 'judge',
  judge: { judge: 'GREAT', combo: 21, channel: '11', deltaMs: -12 },
  seconds: 30,
  atMs: 30_000,
};
const BENCH_PLAYED = Array.from({ length: 200 }, (_, index): sceneModelAPI.PlayEvent => ({
  type: 'judge',
  judge: { judge: index % 3 === 0 ? 'GREAT' : 'PERFECT', combo: index + 1, deltaMs: (index % 21) - 10 },
  seconds: index / 2,
  atMs: index * 500,
})).reduce(sceneModelAPI.reducePlayState, sceneModelAPI.reducePlayState(BENCH_PLAY_STATE, BENCH_FRAME));
const BENCH_SEEK: sceneModelAPI.PlayEvent = {
  type: 'seek',
  seconds: 100,
  atMs: 100_000,
  snapshot: {
    summary: { exScore: 334, gauge: { current: 80, max: 100, initial: 20, cleared: true, type: 'GROOVE' } },
    combo: 200,
    maxCombo: 200,
    judgments: Array.from({ length: 200 }, (_, index) => ({
      judge: index % 3 === 0 ? 'GREAT' : 'PERFECT',
      combo: index + 1,
      deltaMs: (index % 21) - 10,
      seconds: index / 2,
      gauge: Math.min(100, 20 + index),
      exScore: index * 2,
    })),
  },
};
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
const BENCH_STAGE_HISTORY: sceneModelAPI.CourseStageHistory = {
  gaugeHistory: BENCH_PLAYED.gaugeHistory,
  scoreHistory: BENCH_PLAYED.scoreHistory,
  playSeconds: 100,
};
const BENCH_COURSE_RESULT: Parameters<typeof sceneModelAPI.playResultFromCourseRun>[1] = {
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
  stages: [{ played: true, replay: { play: { judgeRuleset: 'lr2' } } }],
} as unknown as Parameters<typeof sceneModelAPI.playResultFromCourseRun>[2];
const BENCH_SOUND_SET: sceneModelAPI.SystemSoundSet = {
  selectBGM: { bytes: BENCH_BYTES },
  clear: { bytes: BENCH_BYTES },
  cursor: { bytes: BENCH_BYTES },
};
