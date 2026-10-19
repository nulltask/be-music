import * as stringifierAPI from '@be-music/stringifier';
import type { DefineBenchmarkCase } from '../../../scripts/bench/exports.types.ts';

export function registerStringifierExportsCases(define: DefineBenchmarkCase): void {
  define('stringifier.stringifyBMS', {
    run: (fixtures) => {
      stringifierAPI.stringifyBMS(fixtures.sampleBmsJSON);
    },
  });
  define('stringifier.stringifyBmson', {
    run: (fixtures) => {
      stringifierAPI.stringifyBmson(fixtures.sampleBmsonJSON);
    },
  });
}
