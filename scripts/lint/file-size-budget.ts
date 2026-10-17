import { readdir, readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * File-size budget for package sources (`pnpm run check`). A source file above {@link FILE_SIZE_BUDGET_LINES} lines is
 * an error unless it is on {@link FILE_SIZE_BUDGET_ALLOWLIST}, where it is reported as a warning instead. An allowlisted
 * file that has shrunk back under the budget is an error too, so the list only ever gets shorter.
 *
 * Tests, declaration files and fixtures are not budgeted.
 */

/** Lines a source file may have before it should be split. */
export const FILE_SIZE_BUDGET_LINES = 1500;

/**
 * Files already over the budget when it was introduced.
 *
 * TODO: split each of these into cohesive modules and drop it from the list (see docs/architecture.md).
 */
export const FILE_SIZE_BUDGET_ALLOWLIST: readonly string[] = [
  'packages/chart/src/index.ts',
  'packages/parser/src/core/parser.ts',
  'packages/player-tui/src/bga.ts',
  'packages/player-tui/src/cli/runner.ts',
  'packages/player-tui/src/tui/tui.ts',
  'packages/player-web-demo/src/main.ts',
  'packages/stringifier/src/index.ts',
];

export interface SourceFileSize {
  /** Repository-relative path with `/` separators. */
  path: string;
  lines: number;
}

export interface FileSizeBudgetReport {
  /** Over the budget and not allowlisted — the check fails. */
  overBudget: SourceFileSize[];
  /** Over the budget but allowlisted — reported as warnings. */
  allowlisted: SourceFileSize[];
  /** Allowlisted but within the budget (or gone) — the check fails until the entry is removed. */
  staleAllowlistEntries: string[];
}

/** Counts lines the way `wc -l` does for a file that ends with a newline, and counts a final unterminated line. */
export function countLines(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  let lines = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 0x0a) {
      lines += 1;
    }
  }
  return text.endsWith('\n') ? lines : lines + 1;
}

/** True for the sources the budget applies to: package `src/` code, not tests, declarations or fixtures. */
export function isBudgetedSourcePath(path: string): boolean {
  if (!/^packages\/[^/]+\/src\//.test(path)) {
    return false;
  }
  if (!/\.(ts|tsx|js|mjs|vue)$/.test(path)) {
    return false;
  }
  return !/\.test\.[^/]+$/.test(path) && !path.endsWith('.d.ts') && !path.includes('/__fixtures__/');
}

export function evaluateFileSizeBudget(
  files: readonly SourceFileSize[],
  options: { budget: number; allowlist: readonly string[] },
): FileSizeBudgetReport {
  const allowlist = new Set(options.allowlist);
  const sizes = new Map(files.map((file) => [file.path, file.lines]));
  const byPath = (left: SourceFileSize, right: SourceFileSize): number => left.path.localeCompare(right.path);
  const over = files.filter((file) => file.lines > options.budget);
  return {
    overBudget: over.filter((file) => !allowlist.has(file.path)).sort(byPath),
    allowlisted: over.filter((file) => allowlist.has(file.path)).sort(byPath),
    staleAllowlistEntries: [...allowlist]
      .filter((path) => !((sizes.get(path) ?? 0) > options.budget))
      .sort((left, right) => left.localeCompare(right)),
  };
}

export function formatFileSizeBudgetReport(report: FileSizeBudgetReport, budget: number): string[] {
  return [
    ...report.allowlisted.map(
      (file) => `warning: ${file.path} has ${file.lines} lines (budget ${budget}; allowlisted, split it when you can)`,
    ),
    ...report.overBudget.map(
      (file) => `error: ${file.path} has ${file.lines} lines, over the ${budget}-line budget — split it into modules`,
    ),
    ...report.staleAllowlistEntries.map(
      (path) => `error: ${path} is within the ${budget}-line budget now — remove it from FILE_SIZE_BUDGET_ALLOWLIST`,
    ),
  ];
}

async function collectSourceFiles(rootDir: string): Promise<SourceFileSize[]> {
  const files: SourceFileSize[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) {
        continue;
      }
      const absolute = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }
      const path = relative(rootDir, absolute).split('\\').join('/');
      if (isBudgetedSourcePath(path)) {
        files.push({ path, lines: countLines(await readFile(absolute, 'utf8')) });
      }
    }
  };
  await walk(resolve(rootDir, 'packages'));
  return files;
}

async function main(): Promise<void> {
  const rootDir = resolve(fileURLToPath(import.meta.url), '../../..');
  const report = evaluateFileSizeBudget(await collectSourceFiles(rootDir), {
    budget: FILE_SIZE_BUDGET_LINES,
    allowlist: FILE_SIZE_BUDGET_ALLOWLIST,
  });
  for (const line of formatFileSizeBudgetReport(report, FILE_SIZE_BUDGET_LINES)) {
    process.stderr.write(`${line}\n`);
  }
  if (report.overBudget.length > 0 || report.staleAllowlistEntries.length > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
