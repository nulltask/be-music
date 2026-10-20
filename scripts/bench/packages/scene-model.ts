import * as sceneModelAPI from '@be-music/player-scene-model';
import { registerSceneModelExportsCases } from '../../../packages/player-scene-model/scripts/exports-cases.ts';
import type { BenchmarkPackageDefinition } from '../exports.types.ts';

export const sceneModelBenchmarkPackage: BenchmarkPackageDefinition = {
  module: sceneModelAPI as Record<string, unknown>,
  registerCases: registerSceneModelExportsCases,
};
