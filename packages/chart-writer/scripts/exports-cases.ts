import * as stringifierAPI from '@be-music/chart-writer';
import { createEmptyJSON } from '@be-music/chart-source';
import type { DefineBenchmarkCase } from '../../../scripts/bench/exports.types.ts';
const intrinsicGainChart = createEmptyJSON();
intrinsicGainChart.resources.wav = { '01': 'a.wav' };
intrinsicGainChart.resources.wavGain = { '01': 0.8 };
intrinsicGainChart.bms.wavCmds = ['01 01 50'];

export function registerStringifierExportsCases(define: DefineBenchmarkCase): void {
  define('chart-writer.stringifyBMS', {
    run: (fixtures) => {
      stringifierAPI.stringifyBMS(fixtures.sampleBmsJSON);
      stringifierAPI.stringifyBMS(intrinsicGainChart);
    },
  });
  define('chart-writer.stringifyBmson', {
    run: (fixtures) => {
      stringifierAPI.stringifyBmson(fixtures.sampleBmsonJSON);
    },
  });
}
