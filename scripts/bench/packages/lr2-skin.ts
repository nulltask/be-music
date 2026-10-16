import * as lr2SkinApi from '@be-music/lr2-skin';
import * as lr2StateApi from '@be-music/lr2-skin/state';
import { registerLr2SkinExportsCases } from '../../../packages/lr2-skin/scripts/exports-cases.ts';
import type { BenchmarkPackageDefinition } from '../exports.types.ts';

export const lr2SkinBenchmarkPackage: BenchmarkPackageDefinition = {
  module: {
    ...(lr2SkinApi as Record<string, unknown>),
    // Every `@be-music/lr2-skin/state` export, as `state.<name>`: a new resolver needs a case, a removed one drops it.
    ...Object.fromEntries(Object.entries(lr2StateApi).map(([name, value]) => [`state.${name}`, value])),
  },
  registerCases: registerLr2SkinExportsCases,
};
