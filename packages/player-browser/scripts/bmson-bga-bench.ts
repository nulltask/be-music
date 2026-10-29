import { Bench } from 'tinybench';
import { createEmptyJSON } from '@be-music/chart-source';
import { collectBmsonBGAFrameKeys } from '../src/chart/bmson-bga.ts';
import { resolveBGAStacks } from '../src/chart/bga-timeline.ts';

const chart = createEmptyJSON('bmson');
chart.bmson.bga.header = Array.from({ length: 128 }, (_, id) => ({ id: id + 1000, name: `frame-${id}.png` }));
chart.bmson.bga.sequences = Array.from({ length: 4 }, (_, id) => ({
  id,
  sequence: [...Array.from({ length: 128 }, (_, index) => ({ time: index * 20, id: index })), { time: 2560 }],
}));
chart.bmson.bga.layerEvents = Array.from({ length: 20 }, (_, index) => ({
  y: index * 960,
  id: 0,
  idSet: [0, 1, 2, 3],
  condition: index % 2 === 0 ? 'play' : 'miss',
}));
const input = {
  timeline: { base: [{ seconds: 0, bmpKey: 'base.png' }], layer: [], poor: [] },
  seconds: 3,
  inPoorWindow: false,
  bmsonBGA: { plane: 'poor' as const, key: 'frame-0.png', startedSeconds: 2, frameStartSeconds: 2.5 },
};
const bench = new Bench({ time: 200, warmupTime: 100, iterations: 10 });
bench.add('collectBmsonBGAFrameKeys:20x4x128', () => {
  collectBmsonBGAFrameKeys(chart);
});
bench.add('resolveBGAStacks:bmson', () => {
  resolveBGAStacks(input);
});
await bench.run();
process.stdout.write(`${JSON.stringify(bench.table(), null, 2)}\n`);
