import * as lr2SkinAPI from '@be-music/skin-lr2';
import * as lr2StateAPI from '@be-music/skin-lr2/state';
import { registerLR2SkinExportsCases } from '../../../packages/skin-lr2/scripts/exports-cases.ts';
import type { BenchmarkPackageDefinition } from '../exports.types.ts';

export const lr2SkinBenchmarkPackage: BenchmarkPackageDefinition = {
  module: {
    ...(lr2SkinAPI as Record<string, unknown>),
    // Every `@be-music/skin-lr2/state` export, as `state.<name>`: a new resolver needs a case, a removed one drops it.
    ...Object.fromEntries(Object.entries(lr2StateAPI).map(([name, value]) => [`state.${name}`, value])),
  },
  registerCases: registerLR2SkinExportsCases,
};
