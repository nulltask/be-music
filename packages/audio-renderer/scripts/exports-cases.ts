import * as audioRendererApi from '@be-music/audio-renderer';
import type { DefineBenchmarkCase } from '../../../scripts/bench/exports.types.ts';

export function registerAudioRendererExportsCases(define: DefineBenchmarkCase): void {
  define('audio-renderer.createTimingResolver', {
    run: (fixtures) => {
      audioRendererApi.createTimingResolver(fixtures.sampleBmsJson);
    },
  });
  define('audio-renderer.createTimingBuildContext', {
    run: (fixtures) => {
      audioRendererApi.createTimingBuildContext(fixtures.sampleBmsJson);
    },
  });
  define('audio-renderer.createTimingResolverWithContext', {
    run: (fixtures) => {
      const context = audioRendererApi.createTimingBuildContext(fixtures.sampleBmsJson);
      audioRendererApi.createTimingResolverWithContext(fixtures.sampleBmsJson, context);
    },
  });
  define('audio-renderer.collectSampleTriggers', {
    run: (fixtures) => {
      const resolver = audioRendererApi.createTimingResolver(fixtures.sampleBmsJson);
      audioRendererApi.collectSampleTriggers(fixtures.sampleBmsJson, resolver, {
        inferBmsLnTypeWhenMissing: true,
      });
    },
  });
  define('audio-renderer.collectSampleTriggersWithContext', {
    run: (fixtures) => {
      const context = audioRendererApi.createTimingBuildContext(fixtures.sampleBmsJson);
      const resolver = audioRendererApi.createTimingResolverWithContext(fixtures.sampleBmsJson, context);
      audioRendererApi.collectSampleTriggersWithContext(fixtures.sampleBmsJson, resolver, context, {
        inferBmsLnTypeWhenMissing: true,
      });
    },
  });
  define('audio-renderer.createBmsonSamplePlaybackMap', {
    run: (fixtures) => {
      const context = audioRendererApi.createTimingBuildContext(fixtures.sampleBmsonJson);
      const resolver = audioRendererApi.createTimingResolverWithContext(fixtures.sampleBmsonJson, context);
      audioRendererApi.createBmsonSamplePlaybackMap(
        fixtures.sampleBmsonJson,
        resolver,
        fixtures.sampleBmsonJson.events,
        context.beatResolver,
      );
    },
  });
  define('audio-renderer.renderJson', {
    run: async (fixtures) => {
      await audioRendererApi.renderJson(fixtures.sampleBmsJson, {
        baseDir: fixtures.tmpDir,
        normalize: false,
        tailSeconds: 0.05,
        fallbackToneSeconds: 0.03,
        inferBmsLnTypeWhenMissing: true,
      });
    },
    timeMs: 12,
    warmupTimeMs: 0,
  });
  define('audio-renderer.renderSingleSample', {
    run: async (fixtures) => {
      await audioRendererApi.renderSingleSample('01', undefined, {
        sampleRate: 22_050,
        gain: 1,
        baseDir: fixtures.tmpDir,
        fallbackToneSeconds: 0.03,
      });
    },
  });
  define('audio-renderer.renderChartFile', {
    run: async (fixtures) => {
      await audioRendererApi.renderChartFile(fixtures.paths.bmsPath, fixtures.paths.renderOutputPath, {
        baseDir: fixtures.tmpDir,
        normalize: false,
        tailSeconds: 0.05,
        fallbackToneSeconds: 0.03,
        inferBmsLnTypeWhenMissing: true,
      });
    },
    timeMs: 12,
    warmupTimeMs: 0,
  });
  define('audio-renderer.writeAudioFile', {
    run: async (fixtures) => {
      await audioRendererApi.writeAudioFile(fixtures.paths.audioOutputPath, fixtures.sampleRenderResult);
    },
  });
}
