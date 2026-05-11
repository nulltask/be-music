import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCliMain } from './cli-utils.ts';
import type { ExportsBenchmarkCliOverrides, ExportsBenchmarkSnapshot, PackageName } from './exports.types.ts';

type RunExportsBenchmarkCli = (
  args?: readonly string[],
  overrides?: ExportsBenchmarkCliOverrides,
) => Promise<ExportsBenchmarkSnapshot>;

export function resolvePackageBenchmarkOutputPath(packageScriptUrl: string, packageName: PackageName): string {
  const packageScriptDir = dirname(fileURLToPath(packageScriptUrl));
  const repositoryDir = resolve(packageScriptDir, '../../..');
  return resolve(repositoryDir, `tmp/bench/exports-${packageName}.json`);
}

export async function runPackageExportsBenchmarkCli(
  packageName: PackageName,
  packageScriptUrl: string,
  args: readonly string[] = process.argv.slice(2),
): Promise<ExportsBenchmarkSnapshot> {
  const benchModule = await import('./exports.ts');
  const runExportsBenchmarkCli = (benchModule as { runExportsBenchmarkCli?: RunExportsBenchmarkCli })
    .runExportsBenchmarkCli;

  if (typeof runExportsBenchmarkCli !== 'function') {
    throw new Error('runExportsBenchmarkCli is not available in scripts/bench/exports.ts');
  }

  return runExportsBenchmarkCli(args, {
    defaultPackages: [packageName],
    defaultOutputPath: resolvePackageBenchmarkOutputPath(packageScriptUrl, packageName),
  });
}

export function runPackageExportsBenchmarkScript(packageName: PackageName, packageScriptUrl: string): void {
  runCliMain(packageScriptUrl, () => runPackageExportsBenchmarkCli(packageName, packageScriptUrl));
}

export default {
  resolvePackageBenchmarkOutputPath,
  runPackageExportsBenchmarkCli,
  runPackageExportsBenchmarkScript,
};
