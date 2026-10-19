import * as editorAPI from '@be-music/editor';
import { registerEditorExportsCases } from '../../../packages/editor/scripts/exports-cases.ts';
import type { BenchmarkPackageDefinition } from '../exports.types.ts';

export const editorBenchmarkPackage: BenchmarkPackageDefinition = {
  module: editorAPI as Record<string, unknown>,
  registerCases: registerEditorExportsCases,
};
