import { loadExportsBenchmarkSnapshot, parsePositiveCLINumber, resolveCLIValue, runCLIMain } from './cli-utils.ts';
import { compareSnapshots } from './compare-results.ts';
import type { ExportsBenchmarkSnapshot } from './exports.types.ts';

interface Comparison {
  base: ExportsBenchmarkSnapshot;
  head: ExportsBenchmarkSnapshot;
}

/** Select regressions with a measurement in every run on both sides. */
export function findBenchmarkRegressions({ base, head }: Comparison, threshold: number) {
  const runs = base.aggregation?.runCount;
  if (runs === undefined || runs < 2 || runs !== head.aggregation?.runCount) return [];
  const cutoff = 1 - threshold / 100;
  return compareSnapshots(base, head).filter(
    (row) =>
      row.significant &&
      !row.ioBound &&
      row.headHz <= row.baseHz * cutoff &&
      base.results[row.key]?.runMedianHz?.length === runs &&
      head.results[row.key]?.runMedianHz?.length === runs,
  );
}

/** Keep cases that exceed the threshold on both measurements of the same commits. */
export function confirmBenchmarkRegressions(initial: Comparison, repeat: Comparison, threshold: number) {
  if (
    !initial.base.gitSha ||
    !initial.head.gitSha ||
    initial.base.gitSha !== repeat.base.gitSha ||
    initial.head.gitSha !== repeat.head.gitSha
  ) {
    throw new Error('Confirmation must compare the same base and head commits.');
  }
  const repeated = new Map(findBenchmarkRegressions(repeat, threshold).map((row) => [row.key, row]));
  return findBenchmarkRegressions(initial, threshold)
    .flatMap((row) => {
      const confirmation = repeated.get(row.key);
      return confirmation ? [{ key: row.key, initial: row, confirmation }] : [];
    })
    .sort((left, right) => left.confirmation.deltaPercent - right.confirmation.deltaPercent);
}

async function loadComparison(basePath: string | undefined, headPath: string | undefined): Promise<Comparison> {
  const [base, head] = await Promise.all([
    loadExportsBenchmarkSnapshot(resolveCLIValue(basePath, 'base snapshot')),
    loadExportsBenchmarkSnapshot(resolveCLIValue(headPath, 'head snapshot')),
  ]);
  return { base, head };
}

runCLIMain(import.meta.url, async () => {
  const [rawThreshold, basePath, headPath, repeatBase, repeatHead] = process.argv.slice(2);
  const threshold = parsePositiveCLINumber(rawThreshold, 'threshold');
  const initial = await loadComparison(basePath, headPath);
  const rows =
    repeatBase === undefined && repeatHead === undefined
      ? findBenchmarkRegressions(initial, threshold)
      : confirmBenchmarkRegressions(initial, await loadComparison(repeatBase, repeatHead), threshold);
  process.stdout.write(JSON.stringify(rows) + '\n');
});
