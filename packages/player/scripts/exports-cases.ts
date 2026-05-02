import * as playerApi from '@be-music/player';
import type { PlayerOptions } from '@be-music/player';
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
}

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
