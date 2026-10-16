import * as sceneApi from '@be-music/beatoraja-skin/scene';
import { BEATORAJA_NUM, BEATORAJA_TEXT, OFFSET_HIDDEN_COVER } from '@be-music/beatoraja-skin';
import type { LibraryChart, LibraryCourse, LibraryEntry, LaneCoverState } from '@be-music/scene-model';
import type { DefineBenchmarkCase } from '../../../scripts/bench/exports.types.ts';

// The cases measure `@be-music/beatoraja-skin/scene`, the scene mapping a skin view asks every frame; the parser and
// theme loader the package's main entry exports are not measured.

const BENCH_COVER: LaneCoverState = {
  side: '1P',
  sudden: 0.25,
  suddenOn: true,
  hidden: 0.2,
  hiddenOn: true,
  lift: 0.1,
};
const BENCH_SCORE: sceneApi.BeatorajaScoreInput = {
  total: 1200,
  perfect: 900,
  great: 200,
  good: 50,
  bad: 20,
  poor: 30,
  exScore: 2000,
  score: 180_000,
  fast: 120,
  slow: 130,
};
const BENCH_GAUGE: sceneApi.BeatorajaGaugeInput = {
  current: 82,
  max: 100,
  clearThreshold: 80,
  effectiveTotal: 300,
  type: 'GROOVE',
};
const BENCH_BPM_SEGMENTS: readonly sceneApi.BeatorajaBpmSegment[] = Array.from({ length: 64 }, (_, index) => ({
  timeMs: index * 2000,
  bpm: index % 9 === 8 ? 0 : 120 + (index % 5) * 20,
}));
const BENCH_CHART_FACTS: sceneApi.BeatorajaPlayChartFacts = {
  bpm: 150,
  mainBpm: 150,
  minBpm: 120,
  maxBpm: 200,
  bpmSegments: BENCH_BPM_SEGMENTS,
  playLevel: 12,
};
const BENCH_TIMINGS = Array.from({ length: 1200 }, (_, index) => ({
  deltaMs: ((index * 37) % 61) - 30,
  judge: index % 7 === 0 ? 'GREAT' : 'PERFECT',
}));
const BENCH_PLAY_NUMBERS: sceneApi.BeatorajaPlayNumberInput = {
  score: BENCH_SCORE,
  gauge: BENCH_GAUGE,
  combo: 321,
  maxCombo: 654,
  earlyLate: { PERFECT: { early: 400, late: 500 }, GREAT: { early: 90, late: 110 } },
  chartTotal: 300,
  hiSpeed: 2.5,
  cover: BENCH_COVER,
  chart: BENCH_CHART_FACTS,
  clock: { currentSeconds: 64.5, totalSeconds: 128 },
  lastJudgeDeltaMs: -7.5,
  plateCombos: [321, 0, 0],
  wallClock: { year: 2026, month: 10, day: 16, hour: 12, minute: 34, second: 56 },
  operatingMs: 3_725_000,
  fps: 120,
};
const BENCH_BREAKDOWN: sceneApi.BeatorajaNoteBreakdown = { normal: 900, ln: 150, scratch: 120, bss: 30 };
const BENCH_SCORE_HISTORY = Array.from({ length: 1200 }, (_, index) => ({
  progress: index / 1200,
  exScore: Math.round((index * 2000) / 1200),
}));
const BENCH_GAUGE_HISTORY = Array.from({ length: 1200 }, (_, index) => ({
  progress: index / 1200,
  value: 20 + ((index * 3) % 80),
}));
const BENCH_DISTRIBUTION = {
  buckets: Array.from({ length: 128 }, (_, index) => [1, 2, 3, 1, 4, 8 + (index % 5), 0]),
  totalMs: 128_000,
};
const BENCH_JUDGE_STATE_GRAPH = sceneApi.createBeatorajaJudgeStateGraph(BENCH_DISTRIBUTION)!;
const BENCH_PLACEMENT = sceneApi.resolveBeatorajaLanePlacement('13', '7', 3);
const BENCH_OFFSET_INPUT: sceneApi.BeatorajaPlayOffsetInput = {
  cover: BENCH_COVER,
  laneHeight: 580,
  maxCombo: 654,
  comboDigits: { 1: { width: 40, space: 0 }, 2: { width: 40, space: 0 } },
};
const BENCH_OFFSET = { x: 0, y: 0, a: 0 };
const BENCH_COURSE_VIEW = {
  kind: 'grade' as const,
  title: 'Bench Dan',
  stages: [{ title: 'One' }, { title: 'Two' }, { title: 'Three' }, { title: 'Four' }],
  stageIndex: 2,
};
const BENCH_RESULT: sceneApi.BeatorajaResultInput = {
  result: {
    score: BENCH_SCORE,
    fast: 120,
    slow: 130,
    maxCombo: 654,
    cleared: true,
    lamp: 'NORMAL',
    gaugeHistory: BENCH_GAUGE_HISTORY,
    scoreHistory: BENCH_SCORE_HISTORY,
    judgeTimings: BENCH_TIMINGS,
    course: BENCH_COURSE_VIEW,
  },
  gauge: BENCH_GAUGE,
  chartTotal: 300,
  breakdown: BENCH_BREAKDOWN,
  song: { title: 'Bench', subtitle: '[ANOTHER]', artist: 'be-music', genre: 'BENCH' },
  skin: { name: 'Bench Skin', author: 'be-music' },
};
const BENCH_SONG: LibraryChart = {
  id: 'bench',
  sourceId: 'source',
  sourceLabel: 'Bench',
  sourceKind: 'directory',
  chartPath: 'Pack/bench.bms',
  directoryLabel: 'Pack',
  fileLabel: 'bench.bms',
  title: 'Bench',
  subtitle: '[ANOTHER]',
  artist: 'be-music',
  playLevel: 12,
  bpm: 150,
  totalNotes: 1200,
  chart: { metadata: { difficulty: 4 } } as unknown as LibraryChart['chart'],
};
const BENCH_COURSE: LibraryCourse = {
  id: 'Dan#0',
  definition: {
    name: 'Bench Dan',
    kind: 'grade',
    stages: [],
    constraints: ['grade_mirror', 'gauge_lr2', 'no_speed'],
    trophies: [],
    release: true,
    source: { format: 'beatoraja-json' },
  },
  stages: [{ title: 'One', song: BENCH_SONG }, { title: 'Two' }],
  playable: false,
};
const BENCH_SELECT_FACTS: sceneApi.BeatorajaSelectChartFacts = {
  playVariant: '7',
  traits: { longNote: true, bga: true, bpmChange: true, random: false, stop: true, stageFile: true, banner: false },
  difficulty: 4,
  judgeRank: 2,
  total: 300,
  lnMode: 2,
  subartist: 'obj: bench',
  noteBreakdown: BENCH_BREAKDOWN,
  density: { peak: { whole: 21, afterDot: 4 }, end: { whole: 9, afterDot: 0 }, average: { whole: 6, afterDot: 5 } },
  lengthSeconds: 128,
  bpmRange: { min: 120, max: 200 },
};
const BENCH_SONG_BAR: LibraryEntry = { kind: 'song', song: BENCH_SONG };
const BENCH_SELECT: sceneApi.BeatorajaSelectInput = {
  focused: BENCH_SONG_BAR,
  chart: BENCH_SELECT_FACTS,
  folderLabel: 'Pack',
  searchText: 'bench',
  list: { keysFilter: 'KEYS_7', sort: 'LEVEL' },
  skin: { name: 'Bench Skin', author: 'be-music' },
  judgeTiming: -10,
  wallClock: { year: 2026, month: 10, day: 16, hour: 12, minute: 34, second: 56 },
};
const BENCH_COURSE_SELECT: sceneApi.BeatorajaSelectInput = {
  ...BENCH_SELECT,
  focused: { kind: 'course', course: BENCH_COURSE },
};
const BENCH_FILES = new Map<string, Uint8Array>(
  [
    'Theme/sound/Cursor.wav',
    'sound/decide.ogg',
    'sound/back.wav',
    'sound/f-open.wav',
    'Bgm/select.ogg',
    'Theme/Sound/clear.wav',
    'Theme/Sound/fail.wav',
    'Theme/Sound/course_clear.wav',
    ...Array.from({ length: 200 }, (_, index) => `Theme/parts/image${index}.png`),
  ].map((path) => [path, new Uint8Array(0)]),
);
const BENCH_DATE = new Date(2026, 9, 16, 12, 34, 56);

export function registerBeatorajaSkinExportsCases(define: DefineBenchmarkCase): void {
  // Inputs and the score numbers
  define('beatoraja-skin.scene.beatorajaWallClockOf', {
    run: () => {
      sceneApi.beatorajaWallClockOf(BENCH_DATE);
    },
  });
  define('beatoraja-skin.scene.beatorajaScoreRate', {
    run: () => {
      sceneApi.beatorajaScoreRate(BENCH_SCORE.exScore, 1200);
    },
  });
  define('beatoraja-skin.scene.beatorajaNotesJudged', {
    run: () => {
      sceneApi.beatorajaNotesJudged(BENCH_SCORE);
    },
  });
  define('beatoraja-skin.scene.beatorajaChartTotalReadout', {
    run: () => {
      sceneApi.beatorajaChartTotalReadout(BENCH_GAUGE, 300);
    },
  });
  define('beatoraja-skin.scene.resolveBeatorajaScoreNumber', {
    run: () => {
      sceneApi.resolveBeatorajaScoreNumber(BEATORAJA_NUM.EARLY_GREAT, BENCH_PLAY_NUMBERS);
    },
  });
  define('beatoraja-skin.scene.resolveBeatorajaPlayScoreOps', {
    run: () => {
      sceneApi.resolveBeatorajaPlayScoreOps(BENCH_SCORE, BENCH_GAUGE);
    },
  });

  // Texts
  define('beatoraja-skin.scene.joinBeatorajaText', {
    run: () => {
      sceneApi.joinBeatorajaText('Bench', '[ANOTHER]');
    },
  });
  define('beatoraja-skin.scene.resolveBeatorajaSongText', {
    run: () => {
      sceneApi.resolveBeatorajaSongText(BEATORAJA_TEXT.FULLTITLE, BENCH_RESULT.song);
    },
  });
  define('beatoraja-skin.scene.resolveBeatorajaSkinText', {
    run: () => {
      sceneApi.resolveBeatorajaSkinText(BEATORAJA_TEXT.SKIN_NAME, BENCH_RESULT.skin);
    },
  });
  define('beatoraja-skin.scene.resolveBeatorajaPlayText', {
    run: () => {
      sceneApi.resolveBeatorajaPlayText(BEATORAJA_TEXT.TITLE, { song: BENCH_RESULT.song, course: BENCH_COURSE_VIEW });
    },
  });

  // Play numbers and ops
  define('beatoraja-skin.scene.beatorajaBpmAt', {
    run: () => {
      sceneApi.beatorajaBpmAt(BENCH_BPM_SEGMENTS, 77_000, 150);
    },
  });
  define('beatoraja-skin.scene.resolveBeatorajaPlayNumber', {
    run: () => {
      sceneApi.resolveBeatorajaPlayNumber(BEATORAJA_NUM.NOWBPM, BENCH_PLAY_NUMBERS);
      sceneApi.resolveBeatorajaPlayNumber(BEATORAJA_NUM.DURATION_GREEN, BENCH_PLAY_NUMBERS);
      sceneApi.resolveBeatorajaPlayNumber(BEATORAJA_NUM.PERFECT, BENCH_PLAY_NUMBERS);
    },
  });
  define('beatoraja-skin.scene.resolveBeatorajaChartTraitOps', {
    run: () => {
      sceneApi.resolveBeatorajaChartTraitOps(BENCH_SELECT_FACTS.traits);
    },
  });
  define('beatoraja-skin.scene.beatorajaKeysongOp', {
    run: () => {
      sceneApi.beatorajaKeysongOp('14');
    },
  });
  define('beatoraja-skin.scene.resolveBeatorajaPlayStartOps', {
    run: () => {
      sceneApi.resolveBeatorajaPlayStartOps({ playVariant: '7', autoPlay: false, traits: BENCH_SELECT_FACTS.traits });
    },
  });
  define('beatoraja-skin.scene.resolveBeatorajaCoverOps', {
    run: () => {
      sceneApi.resolveBeatorajaCoverOps(BENCH_COVER, true);
    },
  });
  define('beatoraja-skin.scene.beatorajaFastSlowOp', {
    run: () => {
      sceneApi.beatorajaFastSlowOp(2, -4);
    },
  });

  // Play timers
  define('beatoraja-skin.scene.resolveBeatorajaLanePlacement', {
    run: () => {
      sceneApi.resolveBeatorajaLanePlacement('24', '9', 8);
    },
  });
  define('beatoraja-skin.scene.resolveBeatorajaLaneTimers', {
    run: () => {
      sceneApi.resolveBeatorajaLaneTimers('release', BENCH_PLACEMENT);
    },
  });
  define('beatoraja-skin.scene.isBeatorajaComboJudge', {
    run: () => {
      sceneApi.isBeatorajaComboJudge('GOOD');
    },
  });
  define('beatoraja-skin.scene.isBeatorajaCleanHit', {
    run: () => {
      sceneApi.isBeatorajaCleanHit('GREAT');
    },
  });
  define('beatoraja-skin.scene.beatorajaJudgeIndex', {
    run: () => {
      sceneApi.beatorajaJudgeIndex('POOR');
    },
  });
  define('beatoraja-skin.scene.resolveBeatorajaJudgeEffect', {
    run: () => {
      sceneApi.resolveBeatorajaJudgeEffect({ judge: 'PERFECT', combo: 321, deltaMs: -3 }, BENCH_PLACEMENT, 1200);
    },
  });
  define('beatoraja-skin.scene.resolveBeatorajaFrameTimers', {
    run: () => {
      sceneApi.resolveBeatorajaFrameTimers({
        beat: 128.2,
        previousBeat: 127.9,
        gauge: BENCH_GAUGE,
        previousGauge: 81,
        lastNoteBeats: { 1: 300 },
      });
    },
  });

  // Play gauge, graphs and offsets
  define('beatoraja-skin.scene.resolveBeatorajaGaugeState', {
    run: () => {
      sceneApi.resolveBeatorajaGaugeState(BENCH_GAUGE);
    },
  });
  define('beatoraja-skin.scene.beatorajaGaugePercent', {
    run: () => {
      sceneApi.beatorajaGaugePercent(BENCH_GAUGE);
    },
  });
  define('beatoraja-skin.scene.resolveBeatorajaPlayGraphValue', {
    run: () => {
      sceneApi.resolveBeatorajaPlayGraphValue(2, BENCH_PLAY_NUMBERS);
    },
  });
  define('beatoraja-skin.scene.resolveBeatorajaPlaySliderValue', {
    run: () => {
      sceneApi.resolveBeatorajaPlaySliderValue(6, BENCH_PLAY_NUMBERS);
    },
  });
  define('beatoraja-skin.scene.resolveBeatorajaScorePolyline', {
    run: () => {
      sceneApi.resolveBeatorajaScorePolyline(BENCH_SCORE_HISTORY, 1200);
    },
  });
  define('beatoraja-skin.scene.resolveBeatorajaGaugePolyline', {
    run: () => {
      sceneApi.resolveBeatorajaGaugePolyline(BENCH_GAUGE_HISTORY);
    },
  });
  define('beatoraja-skin.scene.beatorajaNoteBreakdownBars', {
    run: () => {
      sceneApi.beatorajaNoteBreakdownBars(BENCH_BREAKDOWN);
    },
  });
  define('beatoraja-skin.scene.beatorajaJudgeCountBars', {
    run: () => {
      sceneApi.beatorajaJudgeCountBars(BENCH_SCORE);
    },
  });
  define('beatoraja-skin.scene.beatorajaTimingHistogram', {
    run: () => {
      sceneApi.beatorajaTimingHistogram(BENCH_TIMINGS.slice(0, 50));
    },
  });
  define('beatoraja-skin.scene.resolveBeatorajaPlayJudgeGraph', {
    run: () => {
      sceneApi.resolveBeatorajaPlayJudgeGraph(1, { breakdown: BENCH_BREAKDOWN, score: BENCH_SCORE, recentTimings: [] });
    },
  });
  define('beatoraja-skin.scene.createBeatorajaJudgeStateGraph', {
    run: () => {
      sceneApi.createBeatorajaJudgeStateGraph(BENCH_DISTRIBUTION);
    },
  });
  define('beatoraja-skin.scene.beatorajaJudgeStateSlot', {
    run: () => {
      sceneApi.beatorajaJudgeStateSlot('BAD');
    },
  });
  define('beatoraja-skin.scene.resolveBeatorajaJudgeStateMove', {
    run: () => {
      sceneApi.resolveBeatorajaJudgeStateMove(BENCH_JUDGE_STATE_GRAPH, 'GREAT', 64_250);
    },
  });
  define('beatoraja-skin.scene.beatorajaLaneJudgeRef', {
    run: () => {
      sceneApi.beatorajaLaneJudgeRef(513);
    },
  });
  define('beatoraja-skin.scene.beatorajaLaneJudgeImage', {
    run: () => {
      sceneApi.beatorajaLaneJudgeImage(1, 120);
    },
  });
  define('beatoraja-skin.scene.writeBeatorajaPlayOffset', {
    run: () => {
      sceneApi.writeBeatorajaPlayOffset(OFFSET_HIDDEN_COVER, BENCH_OFFSET_INPUT, BENCH_OFFSET);
    },
  });

  // Result
  define('beatoraja-skin.scene.beatorajaEarlyLateFromTimings', {
    run: () => {
      sceneApi.beatorajaEarlyLateFromTimings(BENCH_TIMINGS.slice(0, 200));
    },
  });
  define('beatoraja-skin.scene.beatorajaTimingStats', {
    run: () => {
      sceneApi.beatorajaTimingStats(BENCH_TIMINGS.slice(0, 200));
    },
  });
  define('beatoraja-skin.scene.resolveBeatorajaResultNumber', {
    run: () => {
      sceneApi.resolveBeatorajaResultNumber(BEATORAJA_NUM.STDDEV_TIMING, BENCH_RESULT);
      sceneApi.resolveBeatorajaResultNumber(BEATORAJA_NUM.LATE_GREAT, BENCH_RESULT);
    },
  });
  define('beatoraja-skin.scene.resolveBeatorajaResultOps', {
    run: () => {
      sceneApi.resolveBeatorajaResultOps(BENCH_RESULT);
    },
  });
  define('beatoraja-skin.scene.resolveBeatorajaResultText', {
    run: () => {
      sceneApi.resolveBeatorajaResultText(BEATORAJA_TEXT.FULLTITLE, BENCH_RESULT);
    },
  });
  define('beatoraja-skin.scene.resolveBeatorajaResultGaugeState', {
    run: () => {
      sceneApi.resolveBeatorajaResultGaugeState(BENCH_RESULT);
    },
  });
  define('beatoraja-skin.scene.resolveBeatorajaResultGaugePercent', {
    run: () => {
      sceneApi.resolveBeatorajaResultGaugePercent(BENCH_RESULT);
    },
  });
  define('beatoraja-skin.scene.resolveBeatorajaResultGraphValue', {
    run: () => {
      sceneApi.resolveBeatorajaResultGraphValue(7, BENCH_RESULT);
    },
  });
  define('beatoraja-skin.scene.resolveBeatorajaResultPolyline', {
    run: () => {
      sceneApi.resolveBeatorajaResultPolyline(107, BENCH_RESULT);
    },
  });
  define('beatoraja-skin.scene.resolveBeatorajaResultJudgeGraph', {
    run: () => {
      sceneApi.resolveBeatorajaResultJudgeGraph(2, BENCH_RESULT);
    },
  });

  // Select
  define('beatoraja-skin.scene.beatorajaKeysFilterIndex', {
    run: () => {
      sceneApi.beatorajaKeysFilterIndex('KEYS_48');
    },
  });
  define('beatoraja-skin.scene.beatorajaSortIndex', {
    run: () => {
      sceneApi.beatorajaSortIndex('NOTES');
    },
  });
  define('beatoraja-skin.scene.beatorajaKeyModeIndex', {
    run: () => {
      sceneApi.beatorajaKeyModeIndex('9');
    },
  });
  define('beatoraja-skin.scene.beatorajaLnModeIndex', {
    run: () => {
      sceneApi.beatorajaLnModeIndex(3);
    },
  });
  define('beatoraja-skin.scene.beatorajaDifficultyOps', {
    run: () => {
      sceneApi.beatorajaDifficultyOps(4);
    },
  });
  define('beatoraja-skin.scene.beatorajaJudgeRankOp', {
    run: () => {
      sceneApi.beatorajaJudgeRankOp(1);
    },
  });
  define('beatoraja-skin.scene.resolveBeatorajaSelectBarOps', {
    run: () => {
      sceneApi.resolveBeatorajaSelectBarOps(BENCH_SELECT);
    },
  });
  define('beatoraja-skin.scene.resolveBeatorajaSelectText', {
    run: () => {
      sceneApi.resolveBeatorajaSelectText(BEATORAJA_TEXT.FULLARTIST, BENCH_SELECT);
      sceneApi.resolveBeatorajaSelectText(BEATORAJA_TEXT.COURSE1_TITLE + 1, BENCH_COURSE_SELECT);
    },
  });
  define('beatoraja-skin.scene.resolveBeatorajaSelectNumber', {
    run: () => {
      sceneApi.resolveBeatorajaSelectNumber(BEATORAJA_NUM.DENSITY_PEAK, BENCH_SELECT);
    },
  });
  define('beatoraja-skin.scene.resolveBeatorajaSelectRefValue', {
    run: () => {
      sceneApi.resolveBeatorajaSelectRefValue(308, BENCH_SELECT);
    },
  });
  define('beatoraja-skin.scene.resolveBeatorajaSelectSliderValue', {
    run: () => {
      sceneApi.resolveBeatorajaSelectSliderValue(18);
    },
  });

  // Course and clear lamp
  define('beatoraja-skin.scene.resolveBeatorajaCourseConstraintOps', {
    run: () => {
      sceneApi.resolveBeatorajaCourseConstraintOps(BENCH_COURSE.definition.constraints);
    },
  });
  define('beatoraja-skin.scene.resolveBeatorajaCourseBarOps', {
    run: () => {
      sceneApi.resolveBeatorajaCourseBarOps(BENCH_COURSE, 106);
    },
  });
  define('beatoraja-skin.scene.resolveBeatorajaCourseStageOps', {
    run: () => {
      sceneApi.resolveBeatorajaCourseStageOps(BENCH_COURSE_VIEW);
    },
  });
  define('beatoraja-skin.scene.withBeatorajaCourseStageOps', {
    run: () => {
      sceneApi.withBeatorajaCourseStageOps(new Set([900, 901]), BENCH_COURSE_VIEW);
    },
  });
  define('beatoraja-skin.scene.resolveBeatorajaCourseText', {
    run: () => {
      sceneApi.resolveBeatorajaCourseText(152, BENCH_COURSE_VIEW);
    },
  });
  define('beatoraja-skin.scene.beatorajaMissingCourseStages', {
    run: () => {
      sceneApi.beatorajaMissingCourseStages(BENCH_COURSE);
    },
  });
  define('beatoraja-skin.scene.beatorajaClearLampOp', {
    run: () => {
      sceneApi.beatorajaClearLampOp('EX_HARD');
    },
  });

  // System sounds
  define('beatoraja-skin.scene.discoverBeatorajaSystemSoundPaths', {
    run: () => {
      sceneApi.discoverBeatorajaSystemSoundPaths(BENCH_FILES);
    },
  });
  define('beatoraja-skin.scene.discoverBeatorajaSelectBgmPath', {
    run: () => {
      sceneApi.discoverBeatorajaSelectBgmPath(BENCH_FILES);
    },
  });
  define('beatoraja-skin.scene.pickBeatorajaThemeBgmPaths', {
    run: () => {
      sceneApi.pickBeatorajaThemeBgmPaths(BENCH_FILES.keys());
    },
  });
}
