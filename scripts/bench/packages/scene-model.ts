import * as sceneModelAPI from '@be-music/scene-model';
import { registerSceneModelExportsCases } from '../../../packages/scene-model/scripts/exports-cases.ts';
import type { BenchmarkPackageDefinition } from '../exports.types.ts';

export const sceneModelBenchmarkPackage: BenchmarkPackageDefinition = {
  module: sceneModelAPI as Record<string, unknown>,
  registerCases: registerSceneModelExportsCases,
};
