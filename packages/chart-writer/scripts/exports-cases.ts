import * as stringifierAPI from '@be-music/chart-writer';
import type { DefineBenchmarkCase } from '../../../scripts/bench/exports.types.ts';

export function registerStringifierExportsCases(define: DefineBenchmarkCase): void {
  define('chart-writer.stringifyBMS', {
    run: (fixtures) => {
      stringifierAPI.stringifyBMS(fixtures.sampleBmsJSON);
    },
  });
  define('chart-writer.stringifyBmson', {
    run: (fixtures) => {
      stringifierAPI.stringifyBmson(fixtures.sampleBmsonJSON);
    },
  });
}
