import { parseChart } from '@be-music/parser';
import * as skinSdkApi from '@be-music/skin-sdk';
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
} satisfies skinSdkApi.BrowserSongEntry;
const BENCH_STATS = skinSdkApi.resolveSongStats(BENCH_SONG);
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
} satisfies skinSdkApi.BeMusicResultData;
const BENCH_CHANNELS_7K = ['16', '11', '12', '13', '14', '15', '18', '19'];
const BENCH_LAYOUT_INPUT = { laneChannels: BENCH_CHANNELS_7K, playVariant: '7' } as const;
const BENCH_LANES = skinSdkApi.resolveGameplayLayout(BENCH_LAYOUT_INPUT, skinSdkApi.wideStage).lanes;
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
  ...skinSdkApi.SILENT_AUDIO,
  level: 0.6,
  bass: 0.7,
  bands: Array.from({ length: skinSdkApi.AUDIO_BAND_COUNT }, (_, index) => index / skinSdkApi.AUDIO_BAND_COUNT),
};
const BENCH_PALETTE = [0xffffff, 0xffd84a, 0x4ad8ff];
const BENCH_SKIN = {
  apiVersion: skinSdkApi.BE_MUSIC_SKIN_API_VERSION,
  id: 'bench',
  label: 'Bench',
  version: '1.0.0',
  author: { name: 'be-music' },
  fontLoads: [],
  context: '2d',
  gameplay: { draw: () => {} },
  select: { layout: { listX: 0, listTop: 0, listBottomInset: 0, rowHeight: 20 }, draw: () => {} },
  result: { draw: () => {} },
} satisfies skinSdkApi.BeMusicSkin<'2d'>;

export function registerSkinSdkExportsCases(define: DefineBenchmarkCase): void {
  define('skin-sdk.audioDrive', {
    run: () => {
      skinSdkApi.audioDrive(BENCH_AUDIO, 'reduced');
    },
  });
  define('skin-sdk.bandAt', {
    run: () => {
      skinSdkApi.bandAt(BENCH_AUDIO.bands, 5, 24);
    },
  });
  define('skin-sdk.bandLevel', {
    run: () => {
      skinSdkApi.bandLevel(BENCH_AUDIO.bands, 5, 24);
    },
  });
  define('skin-sdk.comboTier', {
    run: () => {
      skinSdkApi.comboTier(120);
    },
  });
  define('skin-sdk.createMomentState', {
    run: () => {
      skinSdkApi.createMomentState();
    },
  });
  define('skin-sdk.defineBeMusicSkin', {
    run: () => {
      skinSdkApi.defineBeMusicSkin(BENCH_SKIN);
    },
  });
  define('skin-sdk.easeOutBack', {
    run: () => {
      skinSdkApi.easeOutBack(0.6);
    },
  });
  define('skin-sdk.easeOutCubic', {
    run: () => {
      skinSdkApi.easeOutCubic(0.6);
    },
  });
  define('skin-sdk.effectProfile', {
    run: () => {
      skinSdkApi.effectProfile('reduced');
    },
  });
  define('skin-sdk.flashingGreatColor', {
    run: () => {
      skinSdkApi.flashingGreatColor(1234, BENCH_PALETTE);
    },
  });
  define('skin-sdk.formatBpmRange', {
    run: () => {
      skinSdkApi.formatBpmRange(120, 180);
    },
  });
  define('skin-sdk.formatPlayVariantLabel', {
    run: () => {
      skinSdkApi.formatPlayVariantLabel(BENCH_SONG);
    },
  });
  define('skin-sdk.formatSongLength', {
    run: () => {
      skinSdkApi.formatSongLength(125.4);
    },
  });
  define('skin-sdk.hash01', {
    run: () => {
      skinSdkApi.hash01(1234);
    },
  });
  define('skin-sdk.impulse', {
    run: () => {
      skinSdkApi.impulse(1000, 1100, 300);
    },
  });
  define('skin-sdk.isFlashingGreat', {
    run: () => {
      skinSdkApi.isFlashingGreat('PERFECT');
    },
  });
  define('skin-sdk.isScratchLaneForVariant', {
    run: () => {
      skinSdkApi.isScratchLaneForVariant('16', '7');
    },
  });
  define('skin-sdk.isSupportedBeMusicSkinApiVersion', {
    run: () => {
      skinSdkApi.isSupportedBeMusicSkinApiVersion(skinSdkApi.BE_MUSIC_SKIN_API_VERSION);
    },
  });
  define('skin-sdk.judgeDisplayWord', {
    run: () => {
      skinSdkApi.judgeDisplayWord('PERFECT');
    },
  });
  define('skin-sdk.layoutTabularRun', {
    run: () => {
      skinSdkApi.layoutTabularRun('1,234,567', (char) => (char === ',' ? 4 : 8));
    },
  });
  define('skin-sdk.loadingDots', {
    run: () => {
      skinSdkApi.loadingDots(1234);
    },
  });
  define('skin-sdk.momentProgress', {
    run: () => {
      skinSdkApi.momentProgress(1000, 1300, 900);
    },
  });
  define('skin-sdk.punchScale', {
    run: () => {
      skinSdkApi.punchScale(1000, 1050, 180, 0.2);
    },
  });
  define('skin-sdk.resolveBeMusicLaneKind', {
    run: () => {
      skinSdkApi.resolveBeMusicLaneKind('12', 2, '7');
    },
  });
  define('skin-sdk.resolveFallbackLaneLayout', {
    run: () => {
      skinSdkApi.resolveFallbackLaneLayout({
        channels: BENCH_CHANNELS_7K,
        playVariant: '7',
        x: 33,
        w: 194,
        fixedWidths: skinSdkApi.IIDX_LANE_WIDTHS,
      });
    },
  });
  define('skin-sdk.resolveFallbackPlayfieldSpan', {
    run: () => {
      skinSdkApi.resolveFallbackPlayfieldSpan('24');
    },
  });
  define('skin-sdk.resolveGameplayLayout', {
    run: () => {
      skinSdkApi.resolveGameplayLayout(BENCH_LAYOUT_INPUT, skinSdkApi.wideStage);
    },
  });
  define('skin-sdk.resolveLaneRuns', {
    run: () => {
      skinSdkApi.resolveLaneRuns(BENCH_LANES);
    },
  });
  define('skin-sdk.resolveMilestoneArea', {
    run: () => {
      skinSdkApi.resolveMilestoneArea(260);
    },
  });
  define('skin-sdk.resolveResultLamp', {
    run: () => {
      skinSdkApi.resolveResultLamp(BENCH_RESULT);
    },
  });
  define('skin-sdk.resolveResultTrackRows', {
    run: () => {
      skinSdkApi.resolveResultTrackRows(BENCH_RESULT);
    },
  });
  define('skin-sdk.resolveSkinlessLaneLayout', {
    run: () => {
      skinSdkApi.resolveSkinlessLaneLayout(BENCH_CHANNELS_7K, BENCH_CHANNELS_7K.length, '7');
    },
  });
  define('skin-sdk.resolveSongRowFacts', {
    run: () => {
      skinSdkApi.resolveSongRowFacts(BENCH_SONG);
    },
  });
  define('skin-sdk.resolveSongStats', {
    run: () => {
      skinSdkApi.resolveSongStats(BENCH_SONG);
    },
  });
  define('skin-sdk.resolveSongTags', {
    run: () => {
      skinSdkApi.resolveSongTags(BENCH_STATS);
    },
  });
  define('skin-sdk.resolveStageBgaRect', {
    run: () => {
      skinSdkApi.resolveStageBgaRect(260);
    },
  });
  define('skin-sdk.rollUpValue', {
    run: () => {
      skinSdkApi.rollUpValue(123_456, 0.4);
    },
  });
  define('skin-sdk.shouldPreserveFallbackSideWidth', {
    run: () => {
      skinSdkApi.shouldPreserveFallbackSideWidth(BENCH_CHANNELS_7K, '14');
    },
  });
  define('skin-sdk.stageProgress', {
    run: () => {
      skinSdkApi.stageProgress(400, 100, 600);
    },
  });
  define('skin-sdk.trackMoments', {
    run: () => {
      skinSdkApi.trackMoments(BENCH_MOMENT_KEY, BENCH_MOMENT_INPUT);
    },
  });
  define('skin-sdk.updateMoments', {
    run: () => {
      skinSdkApi.updateMoments(skinSdkApi.createMomentState(), BENCH_MOMENT_INPUT);
    },
  });
  define('skin-sdk.usesIidxLaneWidths', {
    run: () => {
      skinSdkApi.usesIidxLaneWidths('7');
    },
  });
  define('skin-sdk.validateBeMusicSkin', {
    run: () => {
      skinSdkApi.validateBeMusicSkin(BENCH_SKIN);
    },
  });
}
