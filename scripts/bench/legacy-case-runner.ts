import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { resolveCLIValue, runCLIMain } from './cli-utils.ts';

const FILTER = 'function isFilterMatch(key: string, filter: string | undefined): boolean {';

/** Adapt an older runner's selector while keeping its cases, fixtures, and timing code. */
export function restrictLegacyBenchmarkCases(source: string, caseKeys: readonly string[]): string {
  if (caseKeys.length === 0 || caseKeys.some((key) => !key)) throw new Error('Expected non-empty benchmark keys.');
  if (source.split(FILTER).length !== 2) throw new Error('Could not find the legacy benchmark filter.');
  return source.replace(
    FILTER,
    () =>
      `const confirmationCaseKeys = new Set(${JSON.stringify(caseKeys)});\n\n${FILTER}\n  if (!confirmationCaseKeys.has(key)) return false;`,
  );
}

runCLIMain(import.meta.url, async () => {
  const baseDir = resolveCLIValue(process.argv[2], 'baseline worktree');
  const caseKeys = resolveCLIValue(process.argv[3], 'benchmark keys').split(',');
  const source = await readFile(resolve(baseDir, 'scripts/bench/exports.ts'), 'utf8');
  // Keep relative imports in the baseline checkout and leave its tracked runner untouched.
  const path = resolve(baseDir, 'scripts/bench/.confirmation-exports.ts');
  await writeFile(path, restrictLegacyBenchmarkCases(source, caseKeys));
  process.stdout.write(path + '\n');
});
