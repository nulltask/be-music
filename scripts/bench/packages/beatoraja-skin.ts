import * as sceneApi from '@be-music/beatoraja-skin/scene';
import { registerBeatorajaSkinExportsCases } from '../../../packages/beatoraja-skin/scripts/exports-cases.ts';
import type { BenchmarkPackageDefinition } from '../exports.types.ts';

/** The scene mapping subpath only: the skin parser and theme loader of the main entry are not measured. */
export const beatorajaSkinBenchmarkPackage: BenchmarkPackageDefinition = {
  module: Object.fromEntries(Object.entries(sceneApi).map(([name, value]) => [`scene.${name}`, value])),
  registerCases: registerBeatorajaSkinExportsCases,
};
