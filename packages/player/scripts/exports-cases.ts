import * as playerApi from '@be-music/player';
import * as judgingApi from '@be-music/player/judging';
import * as playlogApi from '@be-music/player/playlog';
import type { PlayerOptions } from '@be-music/player';
import type { BeMusicPlaylog } from '@be-music/player/playlog';
import type { DefineBenchmarkCase } from '../../../scripts/bench/exports.types.ts';

const BENCH_PLAYER_OPTIONS: PlayerOptions = {
  audio: false,
  tui: false,
  leadInMs: 0,
  speed: 8,
  highSpeed: 1,
  inferBmsLnTypeWhenMissing: true,
};

export function registerPlayerExportsCases(define: DefineBenchmarkCase): void {
  define('player.applyFastSlowForJudge', {
    run: () => {
      const summary = { fast: 0, slow: 0 };
      playerApi.applyFastSlowForJudge(summary, 'GREAT', -8);
    },
  });
  define('player.applyHighSpeedControlAction', {
    run: () => {
      playerApi.applyHighSpeedControlAction(2, 'increase');
    },
  });
  define('player.resolveHighSpeedControlActionFromLaneChannels', {
    run: () => {
      playerApi.resolveHighSpeedControlActionFromLaneChannels(['11']);
    },
  });
  define('player.resolveJudgeWindowsMs', {
    run: (fixtures) => {
      playerApi.resolveJudgeWindowsMs(fixtures.sampleBmsJson, 250);
    },
  });
  define('player.extractPlayableNotes', {
    run: (fixtures) => {
      playerApi.extractPlayableNotes(fixtures.sampleBmsJson, { inferBmsLnTypeWhenMissing: true });
    },
  });
  define('player.extractLandmineNotes', {
    run: (fixtures) => {
      playerApi.extractLandmineNotes(fixtures.sampleBmsJson);
    },
  });
  define('player.extractInvisiblePlayableNotes', {
    run: (fixtures) => {
      playerApi.extractInvisiblePlayableNotes(fixtures.sampleBmsJson);
    },
  });
  define('player.extractTimedNotes', {
    run: (fixtures) => {
      playerApi.extractTimedNotes(fixtures.sampleBmsJson, {
        includeLandmine: true,
        includeInvisible: true,
        inferBmsLnTypeWhenMissing: true,
      });
    },
  });
  define('player.formatRandomPatternSummary', {
    run: (fixtures) => {
      playerApi.formatRandomPatternSummary(fixtures.randomPatterns);
    },
  });
  define('player.shouldUseAutoMixBgmHeadroomControl', {
    run: () => {
      playerApi.shouldUseAutoMixBgmHeadroomControl({ limiter: false });
    },
  });
  define('player.resolveBgmHeadroomGain', {
    run: (fixtures) => {
      playerApi.resolveBgmHeadroomGain(fixtures.playableRenderResult, fixtures.bgmRenderResult);
    },
  });
  define('player.resolveBmsControlFlowForPlayback', {
    run: (fixtures) => {
      playerApi.resolveBmsControlFlowForPlayback(fixtures.controlFlowJson, () => 0.42);
    },
  });
  define('player.preparePlaybackChartData', {
    run: (fixtures) => {
      playerApi.preparePlaybackChartData(
        fixtures.sampleBmsJson,
        { showInvisibleNotes: true, laneModeExtension: '.bms' },
        true /* inferBmsLnTypeWhenMissing */,
        0 /* auxiliaryPlaybackEndSeconds */,
      );
    },
  });
  define('player.judging.findClosestCandidateInWindow', {
    run: () => {
      judgingApi.findClosestCandidateInWindow(
        [
          { channel: '11', seconds: 0.95, hit: false },
          { channel: '11', seconds: 1.02, hit: false },
        ],
        { channel: '11', nowSec: 1, judgeWindowSec: 0.05, isConsumed: (note) => note.hit },
      );
    },
  });
  define('player.autoPlay', {
    run: async (fixtures) => {
      await runSilently(async () => {
        await playerApi.autoPlay(fixtures.emptyBmsJson, BENCH_PLAYER_OPTIONS);
      });
    },
    interactive: true,
    timeMs: 8,
    warmupTimeMs: 0,
  });
  define('player.manualPlay', {
    run: async (fixtures) => {
      await runSilently(async () => {
        await playerApi.manualPlay(fixtures.emptyBmsJson, {
          ...BENCH_PLAYER_OPTIONS,
          judgeWindowMs: 80,
        });
      });
    },
    interactive: true,
    timeMs: 8,
    warmupTimeMs: 0,
  });
  define('player.PlayerInterruptedError', {
    run: () => {
      new playerApi.PlayerInterruptedError('escape');
    },
  });
  define('player.playlog.serializePlaylog', {
    run: () => {
      playlogApi.serializePlaylog(BENCH_PLAYLOG);
    },
  });
  define('player.playlog.parsePlaylog', {
    run: () => {
      playlogApi.parsePlaylog(BENCH_PLAYLOG_JSON);
    },
  });
  define('player.playlog.simulatePlaylog', {
    run: () => {
      playlogApi.simulatePlaylog(BENCH_PLAYLOG, { ruleset: 'lr2' });
    },
  });
  define('player.playlog.simulatePlaylogRulesets', {
    run: () => {
      playlogApi.simulatePlaylogRulesets(BENCH_PLAYLOG);
    },
  });
}

const BENCH_PLAYLOG: BeMusicPlaylog = {
  format: 'be-music-playlog',
  version: 1,
  clock: { unit: 'us', origin: 'chart-zero' },
  chart: {
    title: 'bench',
    sourceFormat: 'bms',
    laneMode: '7keys',
    total: 300,
    lnMode: 1,
    judgeRank: { percent: 75, sourceRank: 2 },
    noteCount: 64,
    notes: Array.from({ length: 64 }, (_, index) => ({
      id: index,
      channel: `1${(index % 7) + 1}`,
      type: 'normal' as const,
      timeUs: 250_000 * (index + 1),
    })),
  },
  inputs: Array.from({ length: 128 }, (_, index) => ({
    seq: index,
    timeUs: 125_000 * (index + 1) + (index % 2 === 0 ? 5_000 : 0),
    action: index % 2 === 0 ? ('down' as const) : ('up' as const),
    channels: [`1${((index >> 1) % 7) + 1}`],
  })),
  play: { mode: 'manual', autoScratch: false, gauge: 'GROOVE' },
};
const BENCH_PLAYLOG_JSON = JSON.stringify(BENCH_PLAYLOG);

async function runSilently<T>(task: () => Promise<T>): Promise<T> {
  const stdout = process.stdout as NodeJS.WriteStream & { write: typeof process.stdout.write };
  const stderr = process.stderr as NodeJS.WriteStream & { write: typeof process.stderr.write };
  const originalStdoutWrite = stdout.write;
  const originalStderrWrite = stderr.write;

  stdout.write = ((..._args: unknown[]) => true) as typeof stdout.write;
  stderr.write = ((..._args: unknown[]) => true) as typeof stderr.write;

  try {
    return await task();
  } finally {
    stdout.write = originalStdoutWrite;
    stderr.write = originalStderrWrite;
  }
}
