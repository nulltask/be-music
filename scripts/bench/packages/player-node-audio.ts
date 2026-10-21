import * as nodeAudioAPI from '@be-music/player-node-audio';
import * as sinkAPI from '@be-music/player-node-audio/audio-sink';
import { registerNodeAudioExportsCases } from '../../../packages/player-node-audio/scripts/exports-cases.ts';
import type { BenchmarkPackageDefinition } from '../exports.types.ts';
export const nodeAudioBenchmarkPackage: BenchmarkPackageDefinition = {
  module: {
    ...nodeAudioAPI,
    ...Object.fromEntries(Object.entries(sinkAPI).map(([name, value]) => [`audio-sink.${name}`, value])),
  },
  registerCases: registerNodeAudioExportsCases,
};
