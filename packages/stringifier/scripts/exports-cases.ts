import * as stringifierApi from '@be-music/stringifier';
import type { DefineBenchmarkCase } from '../../../scripts/bench/exports.types.ts';

export function registerStringifierExportsCases(define: DefineBenchmarkCase): void {
  define('stringifier.stringifyBms', {
    run: (fixtures) => {
      stringifierApi.stringifyBms(fixtures.sampleBmsJson);
    },
  });
  define('stringifier.stringifyBmson', {
    run: (fixtures) => {
      stringifierApi.stringifyBmson(fixtures.sampleBmsonJson);
    },
  });
}
