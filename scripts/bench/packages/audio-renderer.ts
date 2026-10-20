import * as audioRendererAPI from '@be-music/audio-renderer';
import { registerAudioRendererExportsCases } from '../../../packages/audio-renderer/scripts/exports-cases.ts';
import type { BenchmarkPackageDefinition } from '../exports.types.ts';

export const audioRendererBenchmarkPackage: BenchmarkPackageDefinition = {
  module: audioRendererAPI as Record<string, unknown>,
  registerCases: registerAudioRendererExportsCases,
};
