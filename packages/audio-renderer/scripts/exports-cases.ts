import * as audioRendererAPI from '@be-music/audio-renderer';
import type { DefineBenchmarkCase } from '../../../scripts/bench/exports.types.ts';

export function registerAudioRendererExportsCases(define: DefineBenchmarkCase): void {
  define('audio-renderer.renderJSON', {
    ioBound: true,
    run: async (fixtures) => {
      await audioRendererAPI.renderJSON(fixtures.sampleBmsJSON, {
        baseDir: fixtures.tmpDir,
        normalize: false,
        tailSeconds: 0.05,
        fallbackToneSeconds: 0.03,
        inferBmsLNTypeWhenMissing: true,
      });
    },
    timeMs: 12,
    warmupTimeMs: 0,
  });
  define('audio-renderer.renderSingleSample', {
    ioBound: true,
    run: async (fixtures) => {
      await audioRendererAPI.renderSingleSample('01', undefined, {
        sampleRate: 22_050,
        gain: 1,
        baseDir: fixtures.tmpDir,
        fallbackToneSeconds: 0.03,
      });
    },
  });
  define('audio-renderer.renderChartFile', {
    ioBound: true,
    run: async (fixtures) => {
      await audioRendererAPI.renderChartFile(fixtures.paths.bmsPath, fixtures.paths.renderOutputPath, {
        baseDir: fixtures.tmpDir,
        normalize: false,
        tailSeconds: 0.05,
        fallbackToneSeconds: 0.03,
        inferBmsLNTypeWhenMissing: true,
      });
    },
    timeMs: 12,
    warmupTimeMs: 0,
  });
  define('audio-renderer.writeAudioFile', {
    ioBound: true,
    run: async (fixtures) => {
      await audioRendererAPI.writeAudioFile(fixtures.paths.audioOutputPath, fixtures.sampleRenderResult);
    },
  });
}
