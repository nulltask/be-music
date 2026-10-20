import { describe, expect, test } from 'vite-plus/test';
import {
  countLines,
  evaluateFileSizeBudget,
  formatFileSizeBudgetReport,
  isBudgetedSourcePath,
} from './file-size-budget.ts';

describe('file-size budget', () => {
  test('countLines matches wc -l and counts an unterminated last line', () => {
    expect(countLines('')).toBe(0);
    expect(countLines('a\nb\n')).toBe(2);
    expect(countLines('a\nb')).toBe(2);
    expect(countLines('\n')).toBe(1);
  });

  test('only package sources are budgeted', () => {
    expect(isBudgetedSourcePath('packages/player/src/core/engine.ts')).toBe(true);
    expect(isBudgetedSourcePath('packages/editor/src/App.vue')).toBe(true);
    expect(isBudgetedSourcePath('packages/player/src/index.test.ts')).toBe(false);
    expect(isBudgetedSourcePath('packages/player/src/types.d.ts')).toBe(false);
    expect(isBudgetedSourcePath('packages/beatoraja-skin/src/__fixtures__/skin.ts')).toBe(false);
    expect(isBudgetedSourcePath('packages/player/scripts/bench.ts')).toBe(false);
    expect(isBudgetedSourcePath('packages/player/src/assets/logo.png')).toBe(false);
  });

  test('splits offenders into failures and allowlisted warnings, and flags stale allowlist entries', () => {
    const report = evaluateFileSizeBudget(
      [
        { path: 'packages/b/src/big.ts', lines: 1600 },
        { path: 'packages/a/src/known.ts', lines: 2000 },
        { path: 'packages/a/src/fixed.ts', lines: 900 },
        { path: 'packages/a/src/small.ts', lines: 1500 },
      ],
      { budget: 1500, allowlist: ['packages/a/src/known.ts', 'packages/a/src/fixed.ts', 'packages/a/src/gone.ts'] },
    );
    expect(report.overBudget).toEqual([{ path: 'packages/b/src/big.ts', lines: 1600 }]);
    expect(report.allowlisted).toEqual([{ path: 'packages/a/src/known.ts', lines: 2000 }]);
    expect(report.staleAllowlistEntries).toEqual(['packages/a/src/fixed.ts', 'packages/a/src/gone.ts']);
    expect(formatFileSizeBudgetReport(report, 1500)).toEqual([
      'warning: packages/a/src/known.ts has 2000 lines (budget 1500; allowlisted, split it when you can)',
      'error: packages/b/src/big.ts has 1600 lines, over the 1500-line budget — split it into modules',
      'error: packages/a/src/fixed.ts is within the 1500-line budget now — remove it from FILE_SIZE_BUDGET_ALLOWLIST',
      'error: packages/a/src/gone.ts is within the 1500-line budget now — remove it from FILE_SIZE_BUDGET_ALLOWLIST',
    ]);
  });
});
