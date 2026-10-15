export * from './eligibility.ts';
export * from './format.ts';
export * from './recorder.ts';
export * from './simulate.ts';
// The score-rate / DJ Rank helpers a result (or a ranked play log's simulated result) is read with, so consumers
// stay on this rules-side entry point instead of reaching into `core/scoring`.
export {
  computeScoreRate,
  IIDX_RANK_LABELS,
  resolveIidxRankLabel,
  type IidxRankLabel,
  type ScoreSummary,
} from '../core/scoring.ts';
