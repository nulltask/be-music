/** Internal draw-label microbenchmark; run with `node scripts/performance/frame-labels.ts`. */
import { performance } from 'node:perf_hooks';
import { drawLabel } from '../../packages/player-browser/src/stage/draw-label.ts';

const owner = {};
const channels = ['11', '12', '13', '14', '15', '18', '19', '16'];
let checksum = 0;
function measure(cached: boolean): number {
  const start = performance.now();
  for (let index = 0; index < 1_000_000; index += 1) {
    const lane = index % channels.length;
    const channel = channels[lane]!;
    const label = cached ? drawLabel(owner, 'note', lane, channel) : `note[lane=${lane},ch=${channel}]`;
    checksum += label.length;
  }
  return performance.now() - start;
}
measure(false);
measure(true);
const samples = [];
for (let trial = 0; trial < 5; trial += 1) {
  // Alternate the order to reduce warm-up and execution-order bias.
  if (trial % 2 === 0) samples.push({ formattedMs: measure(false), cachedMs: measure(true) });
  else {
    const cachedMs = measure(true);
    samples.push({ formattedMs: measure(false), cachedMs });
  }
}
console.log(JSON.stringify({ iterations: 1_000_000, samples, checksum }, null, 2));
