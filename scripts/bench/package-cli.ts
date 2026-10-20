import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCLIMain } from './cli-utils.ts';
import type { ExportsBenchmarkCLIOverrides, ExportsBenchmarkSnapshot, PackageName } from './exports.types.ts';

type RunExportsBenchmarkCLI = (
  args?: readonly string[],
  overrides?: ExportsBenchmarkCLIOverrides,
) => Promise<ExportsBenchmarkSnapshot>;

export function resolvePackageBenchmarkOutputPath(packageScriptURL: string, packageName: PackageName): string {
  const packageScriptDir = dirname(fileURLToPath(packageScriptURL));
  const repositoryDir = resolve(packageScriptDir, '../../..');
  return resolve(repositoryDir, `tmp/bench/exports-${packageName}.json`);
}

export async function runPackageExportsBenchmarkCLI(
  packageName: PackageName,
  packageScriptURL: string,
  args: readonly string[] = process.argv.slice(2),
): Promise<ExportsBenchmarkSnapshot> {
  const benchModule = await import('./exports.ts');
  const runExportsBenchmarkCLI = (benchModule as { runExportsBenchmarkCLI?: RunExportsBenchmarkCLI })
    .runExportsBenchmarkCLI;

  if (typeof runExportsBenchmarkCLI !== 'function') {
    throw new Error('runExportsBenchmarkCLI is not available in scripts/bench/exports.ts');
  }

  return runExportsBenchmarkCLI(args, {
    defaultPackages: [packageName],
    defaultOutputPath: resolvePackageBenchmarkOutputPath(packageScriptURL, packageName),
  });
}

export function runPackageExportsBenchmarkScript(packageName: PackageName, packageScriptURL: string): void {
  runCLIMain(packageScriptURL, () => runPackageExportsBenchmarkCLI(packageName, packageScriptURL));
}

export default {
  resolvePackageBenchmarkOutputPath,
  runPackageExportsBenchmarkCLI,
  runPackageExportsBenchmarkScript,
};
