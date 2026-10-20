import { parseChart } from '@be-music/parser';
import * as skinSdkAPI from '@be-music/skin-sdk';
import type { DefineBenchmarkCase } from '../../../scripts/bench/exports.types.ts';

const BENCH_CHART = parseChart(
  ['#BPM 150', '#WAV01 a.wav', '#00111:01010101', '#00112:00010001', '#00216:01000000', '#00311:01000000'].join('\n'),
  'bms',
);
const BENCH_SONG = {
  id: 'bench',
  sourceId: 'source',
  sourceLabel: 'Bench',
  sourceKind: 'files',
  chartPath: 'Songs/Bench/main.bms',
  directoryLabel: 'Bench',
  fileLabel: 'main.bms',
  title: 'Bench',
  artist: 'be-music',
  bpm: 150,
  totalNotes: 8,
  chart: BENCH_CHART,
} satisfies skinSdkAPI.LibraryChart;
const BENCH_STATS = skinSdkAPI.resolveSongStats(BENCH_SONG);
const BENCH_COURSE_ENTRY = {
  kind: 'course',
  course: {
    id: 'Bench#0',
    definition: {
      name: 'Bench Dan',
      kind: 'grade',
      stages: [],
      constraints: ['grade_mirror', 'gauge_lr2'],
      trophies: [],
      release: true,
      source: { format: 'beatoraja-json' },
    },
    stages: [{ title: 'Bench', chart: BENCH_SONG }, { title: 'Missing' }],
    playable: false,
  },
} satisfies skinSdkAPI.LibraryEntry;
const BENCH_BROWSE_ENTRIES: readonly skinSdkAPI.LibraryEntry[] = [
  { kind: 'chart', chart: BENCH_SONG },
  { kind: 'folder', folder: { label: 'Bench', charts: [BENCH_SONG] } },
  BENCH_COURSE_ENTRY,
];
const BENCH_SCORE = {
  total: 100,
  perfect: 60,
  great: 30,
  good: 5,
  bad: 3,
  poor: 2,
  emptyPoor: 0,
  exScore: 150,
  score: 75_000,
};
const BENCH_RESULT = {
  score: BENCH_SCORE,
  maxCombo: 42,
  gauge: 82,
  cleared: true,
  playSeconds: 95,
  song: BENCH_SONG,
  gaugeHistory: [{ progress: 0, value: 20 }],
  scoreHistory: [{ progress: 0, exScore: 0 }],
} satisfies skinSdkAPI.BeMusicResultData;
const BENCH_CHANNELS_7K = ['16', '11', '12', '13', '14', '15', '18', '19'];
const BENCH_SELECT_ENTRIES: readonly number[] = Array.from({ length: 40 }, (_, index) => index);
const BENCH_LAYOUT_INPUT = { laneChannels: BENCH_CHANNELS_7K, playVariant: '7' } as const;
const BENCH_LANES = skinSdkAPI.resolveGameplayLayout(BENCH_LAYOUT_INPUT, skinSdkAPI.wideStage).lanes;
const BENCH_MOMENT_INPUT = {
  nowMs: 12_000,
  combo: 120,
  gauge: 84,
  clearThreshold: 80,
  survival: false,
  judged: 120,
  totalNotes: 400,
  bad: 0,
  poor: 0,
};
const BENCH_MOMENT_KEY = {};
const BENCH_AUDIO = {
  ...skinSdkAPI.SILENT_AUDIO,
  level: 0.6,
  bass: 0.7,
  bands: Array.from({ length: skinSdkAPI.AUDIO_BAND_COUNT }, (_, index) => index / skinSdkAPI.AUDIO_BAND_COUNT),
};
const BENCH_PALETTE = [0xffffff, 0xffd84a, 0x4ad8ff];
const BENCH_SETTINGS = [
  {
    kind: 'choice',
    id: 'theme',
    label: 'Theme',
    options: [
      { value: 'neon', label: 'Neon' },
      { value: 'mono', label: 'Mono' },
    ],
    default: 'neon',
  },
  { kind: 'number', id: 'judgeOffset', label: 'Judge offset', min: -40, max: 40, step: 2, default: 0, unit: 'px' },
  { kind: 'toggle', id: 'glow', label: 'Glow', default: true },
] satisfies skinSdkAPI.BeMusicSkinSetting[];
const BENCH_STORED_SETTINGS = { theme: 'mono', judgeOffset: 72, glow: 'yes', removed: 1 };
const BENCH_JUDGE_TIMINGS = Array.from({ length: 1000 }, (_, index) => ({
  atMs: index * 120,
  deltaMs: Math.round(Math.sin(index * 1.7) * 60),
  judge: 'GREAT',
})) satisfies skinSdkAPI.BeMusicJudgeTiming[];
const BENCH_SKIN = {
  apiVersion: skinSdkAPI.BE_MUSIC_SKIN_API_VERSION,
  id: 'bench',
  label: 'Bench',
  version: '1.0.0',
  author: { name: 'be-music' },
  fontLoads: [],
  context: '2d',
  gameplay: { draw: () => {} },
  select: { layout: { listX: 0, listTop: 0, listBottomInset: 0, rowHeight: 20 }, draw: () => {} },
  result: { draw: () => {} },
} satisfies skinSdkAPI.BeMusicSkin<'2d'>;

export function registerSkinSDKExportsCases(define: DefineBenchmarkCase): void {
  define('skin-sdk.audioDrive', {
    run: () => {
      skinSdkAPI.audioDrive(BENCH_AUDIO, 'reduced');
    },
  });
  define('skin-sdk.bandAt', {
    run: () => {
      skinSdkAPI.bandAt(BENCH_AUDIO.bands, 5, 24);
    },
  });
  define('skin-sdk.bandLevel', {
    run: () => {
      skinSdkAPI.bandLevel(BENCH_AUDIO.bands, 5, 24);
    },
  });
  define('skin-sdk.binJudgeTimings', {
    run: () => {
      skinSdkAPI.binJudgeTimings(BENCH_JUDGE_TIMINGS, 2, 100);
    },
  });
  define('skin-sdk.describeCourseCard', {
    run: () => {
      skinSdkAPI.describeCourseCard(BENCH_COURSE_ENTRY.course);
    },
  });
  define('skin-sdk.comboTier', {
    run: () => {
      skinSdkAPI.comboTier(120);
    },
  });
  define('skin-sdk.createMomentState', {
    run: () => {
      skinSdkAPI.createMomentState();
    },
  });
  define('skin-sdk.defineBeMusicSkin', {
    run: () => {
      skinSdkAPI.defineBeMusicSkin(BENCH_SKIN);
    },
  });
  define('skin-sdk.easeOutBack', {
    run: () => {
      skinSdkAPI.easeOutBack(0.6);
    },
  });
  define('skin-sdk.easeOutCubic', {
    run: () => {
      skinSdkAPI.easeOutCubic(0.6);
    },
  });
  define('skin-sdk.effectProfile', {
    run: () => {
      skinSdkAPI.effectProfile('reduced');
    },
  });
  define('skin-sdk.flashingGreatColor', {
    run: () => {
      skinSdkAPI.flashingGreatColor(1234, BENCH_PALETTE);
    },
  });
  define('skin-sdk.formatBPMRange', {
    run: () => {
      skinSdkAPI.formatBPMRange(120, 180);
    },
  });
  define('skin-sdk.formatPlayVariantLabel', {
    run: () => {
      skinSdkAPI.formatPlayVariantLabel(BENCH_SONG);
    },
  });
  define('skin-sdk.formatSongLength', {
    run: () => {
      skinSdkAPI.formatSongLength(125.4);
    },
  });
  define('skin-sdk.holdSparks', {
    run: () => {
      skinSdkAPI.holdSparks(5_000, 1234, 40);
    },
  });
  define('skin-sdk.holdSeed', {
    run: () => {
      skinSdkAPI.holdSeed('11', 123_456);
    },
  });
  define('skin-sdk.hash01', {
    run: () => {
      skinSdkAPI.hash01(1234);
    },
  });
  define('skin-sdk.impulse', {
    run: () => {
      skinSdkAPI.impulse(1000, 1100, 300);
    },
  });
  define('skin-sdk.isFlashingGreat', {
    run: () => {
      skinSdkAPI.isFlashingGreat('PERFECT');
    },
  });
  define('skin-sdk.isScratchLaneForVariant', {
    run: () => {
      skinSdkAPI.isScratchLaneForVariant('16', '7');
    },
  });
  define('skin-sdk.isSupportedBeMusicSkinAPIVersion', {
    run: () => {
      skinSdkAPI.isSupportedBeMusicSkinAPIVersion(skinSdkAPI.BE_MUSIC_SKIN_API_VERSION);
    },
  });
  define('skin-sdk.judgeDisplayWord', {
    run: () => {
      skinSdkAPI.judgeDisplayWord('PERFECT');
    },
  });
  define('skin-sdk.layoutTabularRun', {
    run: () => {
      skinSdkAPI.layoutTabularRun('1,234,567', (char) => (char === ',' ? 4 : 8));
    },
  });
  define('skin-sdk.loadingDots', {
    run: () => {
      skinSdkAPI.loadingDots(1234);
    },
  });
  define('skin-sdk.momentProgress', {
    run: () => {
      skinSdkAPI.momentProgress(1000, 1300, 900);
    },
  });
  define('skin-sdk.punchScale', {
    run: () => {
      skinSdkAPI.punchScale(1000, 1050, 180, 0.2);
    },
  });
  define('skin-sdk.resolveBeMusicLaneKind', {
    run: () => {
      skinSdkAPI.resolveBeMusicLaneKind('12', 2, '7');
    },
  });
  define('skin-sdk.resolveBeMusicSkinSettings', {
    run: () => {
      skinSdkAPI.resolveBeMusicSkinSettings({ settings: BENCH_SETTINGS }, BENCH_STORED_SETTINGS);
    },
  });
  define('skin-sdk.resolveFallbackLaneLayout', {
    run: () => {
      skinSdkAPI.resolveFallbackLaneLayout({
        channels: BENCH_CHANNELS_7K,
        playVariant: '7',
        x: 33,
        w: 194,
        fixedWidths: skinSdkAPI.IIDX_LANE_WIDTHS,
      });
    },
  });
  define('skin-sdk.resolveFallbackPlayfieldSpan', {
    run: () => {
      skinSdkAPI.resolveFallbackPlayfieldSpan('24');
    },
  });
  define('skin-sdk.resolveGameplayLayout', {
    run: () => {
      skinSdkAPI.resolveGameplayLayout(BENCH_LAYOUT_INPUT, skinSdkAPI.wideStage);
    },
  });
  define('skin-sdk.resolveLaneRuns', {
    run: () => {
      skinSdkAPI.resolveLaneRuns(BENCH_LANES);
    },
  });
  define('skin-sdk.resolveMilestoneArea', {
    run: () => {
      skinSdkAPI.resolveMilestoneArea(260);
    },
  });
  define('skin-sdk.resolveResultLamp', {
    run: () => {
      skinSdkAPI.resolveResultLamp(BENCH_RESULT);
    },
  });
  define('skin-sdk.resolveResultVerdict', {
    run: () => {
      skinSdkAPI.resolveResultVerdict(BENCH_RESULT);
    },
  });
  define('skin-sdk.resolveResultTrackRows', {
    run: () => {
      skinSdkAPI.resolveResultTrackRows(BENCH_RESULT);
    },
  });
  define('skin-sdk.resolveGameplayLaneGeometry', {
    run: () => {
      skinSdkAPI.resolveGameplayLaneGeometry(BENCH_CHANNELS_7K, BENCH_CHANNELS_7K.length, '7', 'touch');
    },
  });
  define('skin-sdk.resolveTouchLaneLayout', {
    run: () => {
      skinSdkAPI.resolveTouchLaneLayout(BENCH_CHANNELS_7K, BENCH_CHANNELS_7K.length, '7');
    },
  });
  define('skin-sdk.supportsTouchLayout', {
    run: () => {
      skinSdkAPI.supportsTouchLayout('7');
    },
  });
  define('skin-sdk.resolveStageOrientation', {
    run: () => {
      skinSdkAPI.resolveStageOrientation(skinSdkAPI.tallStage);
    },
  });
  define('skin-sdk.supportsPortraitLayout', {
    run: () => {
      skinSdkAPI.supportsPortraitLayout(BENCH_CHANNELS_7K, '7');
    },
  });
  define('skin-sdk.resolveBeMusicStage', {
    run: () => {
      skinSdkAPI.resolveBeMusicStage(
        { stage: skinSdkAPI.wideStage, portraitStage: skinSdkAPI.tallStage },
        { width: 390, height: 844 },
        { laneChannels: BENCH_CHANNELS_7K, playVariant: '7' },
      );
    },
  });
  define('skin-sdk.selectListRows', {
    run: () => {
      skinSdkAPI.selectListRows(
        { entries: BENCH_SELECT_ENTRIES, firstVisibleIndex: 10, visibleRows: 14, listScroll: 9 },
        28,
      );
    },
  });
  define('skin-sdk.resolveBeMusicSelectLayout', {
    run: () => {
      skinSdkAPI.resolveBeMusicSelectLayout(
        { layout: { listX: 322, listTop: 56, listBottomInset: 28, rowHeight: 28 } },
        skinSdkAPI.tallStage,
      );
    },
  });
  define('skin-sdk.resolvePortraitLaneLayout', {
    run: () => {
      skinSdkAPI.resolvePortraitLaneLayout(
        BENCH_CHANNELS_7K,
        BENCH_CHANNELS_7K.length,
        '7',
        'touch',
        skinSdkAPI.tallStage,
      );
    },
  });
  define('skin-sdk.resolveSkinlessLaneLayout', {
    run: () => {
      skinSdkAPI.resolveSkinlessLaneLayout(BENCH_CHANNELS_7K, BENCH_CHANNELS_7K.length, '7');
    },
  });
  define('skin-sdk.resolveSongRowFacts', {
    run: () => {
      skinSdkAPI.resolveSongRowFacts(BENCH_SONG);
    },
  });
  define('skin-sdk.resolveSongStats', {
    run: () => {
      skinSdkAPI.resolveSongStats(BENCH_SONG);
    },
  });
  define('skin-sdk.resolveSongTags', {
    run: () => {
      skinSdkAPI.resolveSongTags(BENCH_STATS);
    },
  });
  define('skin-sdk.resolveStageBGARect', {
    run: () => {
      skinSdkAPI.resolveStageBGARect(260);
    },
  });
  define('skin-sdk.rollUpValue', {
    run: () => {
      skinSdkAPI.rollUpValue(123_456, 0.4);
    },
  });
  define('skin-sdk.shouldPreserveFallbackSideWidth', {
    run: () => {
      skinSdkAPI.shouldPreserveFallbackSideWidth(BENCH_CHANNELS_7K, '14');
    },
  });
  define('skin-sdk.stageProgress', {
    run: () => {
      skinSdkAPI.stageProgress(400, 100, 600);
    },
  });
  define('skin-sdk.trackMoments', {
    run: () => {
      skinSdkAPI.trackMoments(BENCH_MOMENT_KEY, BENCH_MOMENT_INPUT);
    },
  });
  define('skin-sdk.updateMoments', {
    run: () => {
      skinSdkAPI.updateMoments(skinSdkAPI.createMomentState(), BENCH_MOMENT_INPUT);
    },
  });
  define('skin-sdk.usesIIDXLaneWidths', {
    run: () => {
      skinSdkAPI.usesIIDXLaneWidths('7');
    },
  });
  define('skin-sdk.validateBeMusicSkin', {
    run: () => {
      skinSdkAPI.validateBeMusicSkin(BENCH_SKIN);
    },
  });
  define('skin-sdk.validateBeMusicSkinSettings', {
    run: () => {
      skinSdkAPI.validateBeMusicSkinSettings(BENCH_SETTINGS);
    },
  });
  define('skin-sdk.browseEntryTitle', {
    run: () => {
      for (const entry of BENCH_BROWSE_ENTRIES) skinSdkAPI.browseEntryTitle(entry);
    },
  });
  define('skin-sdk.browseEntryCount', {
    run: () => {
      for (const entry of BENCH_BROWSE_ENTRIES) skinSdkAPI.browseEntryCount(entry);
    },
  });
  define('skin-sdk.browseEntryBadge', {
    run: () => {
      for (const entry of BENCH_BROWSE_ENTRIES) skinSdkAPI.browseEntryBadge(entry);
    },
  });
}
