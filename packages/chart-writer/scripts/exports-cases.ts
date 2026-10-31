import * as stringifierAPI from '@be-music/chart-writer';
import { createEmptyJSON } from '@be-music/chart-source';
import type { DefineBenchmarkCase } from '../../../scripts/bench/exports.types.ts';
const intrinsicGainChart = createEmptyJSON();
intrinsicGainChart.resources.wav = { '01': 'a.wav' };
intrinsicGainChart.resources.wavGain = { '01': 0.8 };
intrinsicGainChart.bms.wavCmds = ['01 01 50'];

const resolutionChart = createEmptyJSON('bmson');
resolutionChart.metadata.bpm = 120;
resolutionChart.bmson.info = { initBPM: 120, resolution: 240, modeHint: 'beat-7k' };
resolutionChart.resources.wav['01'] = 'a.wav';
resolutionChart.events = [{ measure: 0, position: [1, 4], channel: '11', value: '01', bmson: { l: 240 } }];
resolutionChart.bmson.bga.header = [{ id: 1, name: 'a.png' }];
resolutionChart.bmson.bga.events = [{ y: 240, id: 1 }];

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
      stringifierAPI.stringifyBmson(resolutionChart, { resolution: 480 });
      stringifierAPI.stringifyBmson({
        ...fixtures.sampleBmsonJSON,
        bmson: { ...fixtures.sampleBmsonJSON.bmson, extraFields: { vendor: { tags: [null, 1] } } },
      });
    },
  });
}
