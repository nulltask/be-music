import { expect, test } from 'vite-plus/test';
import { restrictLegacyBenchmarkCases } from './legacy-case-runner.ts';

const runner = `function isFilterMatch(key: string, filter: string | undefined): boolean {
  return filter === undefined || key.includes(filter);
}`;

test('inserts an exact-match guard before the legacy filter', () => {
  const source = restrictLegacyBenchmarkCases(runner, ['chart-model.compareEvents']);
  expect(source).toContain('new Set(["chart-model.compareEvents"])');
  expect(source).toContain('if (!confirmationCaseKeys.has(key)) return false;\n  return filter');
});

test('rejects an empty selection or a runner with an unrecognized filter', () => {
  expect(() => restrictLegacyBenchmarkCases(runner, [])).toThrow('non-empty benchmark keys');
  expect(() => restrictLegacyBenchmarkCases('another runner', ['a.case'])).toThrow('legacy benchmark filter');
  expect(() => restrictLegacyBenchmarkCases(runner + runner, ['a.case'])).toThrow('legacy benchmark filter');
});
