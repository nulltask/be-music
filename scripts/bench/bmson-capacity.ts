import { Bench } from 'tinybench';
import { parseBmson } from '@be-music/chart-parser';
import { resolveChart } from '@be-music/chart-model';
import { stringifyBmson } from '@be-music/chart-writer';
import { BMSON_CAPACITY_TEXT } from './bmson-capacity-fixture.ts';

const chart = parseBmson(BMSON_CAPACITY_TEXT);
chart.preservation.bmson.soundChannels = [];
const bench = new Bench({ time: 300, warmupTime: 100, iterations: 10 });
bench.add('parseBmson:3845', () => {
  parseBmson(BMSON_CAPACITY_TEXT);
});
bench.add('resolveChart:3845', () => {
  resolveChart(chart);
});
bench.add('stringifyBmson:3845', () => {
  stringifyBmson(chart);
});
await bench.run();
process.stdout.write(`${JSON.stringify(bench.table(), null, 2)}\n`);
