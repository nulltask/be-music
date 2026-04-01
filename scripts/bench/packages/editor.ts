import * as editorApi from '@be-music/editor';
import { registerEditorExportsCases } from '../../../packages/editor/scripts/exports-cases.ts';
import type { BenchmarkPackageDefinition } from '../exports.types.ts';

export const editorBenchmarkPackage: BenchmarkPackageDefinition = {
  module: editorApi as Record<string, unknown>,
  registerCases: registerEditorExportsCases,
};
