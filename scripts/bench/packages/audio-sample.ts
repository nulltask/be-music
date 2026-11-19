import * as api from '@be-music/audio-sample';
import type { BenchmarkPackageDefinition } from '../exports.types.ts';

export const audioSampleBenchmarkPackage: BenchmarkPackageDefinition = {
  module: api,
  registerCases(define) {
    const channel = new Float32Array(1024);
    define('audio-sample.renderSingleSample', {
      run: async () => {
        await api.renderSingleSample('01', undefined);
      },
    });
    define('audio-sample.createSampleLoader', {
      run: () => {
        api.createSampleLoader({ baseDir: '.', sampleRate: 44100, fallbackToneSeconds: 0 });
      },
    });
    define('audio-sample.measurePeak', {
      run: () => {
        api.measurePeak(channel, channel);
      },
    });
  },
};
