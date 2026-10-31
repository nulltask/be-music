import type { RulesetChartFacts } from './facts.ts';

/** Default native compatibility, or bmson 1.0.0's explicit zero-total no-recovery rule. */
export type BmsonTotalMode = 'beatoraja' | 'spec';

/** Whether the selected policy disables recovery; explicit TOTAL units also govern mixed NONSTOP charts. */
export function isBmsonRecoveryDisabled(
  chart: Pick<RulesetChartFacts, 'sourceFormat' | 'total' | 'totalUnit'>,
  mode: BmsonTotalMode | undefined,
): boolean {
  return (
    mode === 'spec' &&
    chart.total === 0 &&
    (chart.totalUnit ?? (chart.sourceFormat === 'bmson' ? 'percent' : 'absolute')) === 'percent'
  );
}
