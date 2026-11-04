import { formatSelectBreadcrumb } from '../src/skins/synesthesia/layout.ts';
import { performance } from 'node:perf_hooks';
import { Graphics, type Filter } from 'pixi.js';
import { bindGlassSurface, drawGlassSurface } from '../src/skins/synesthesia/glass.ts';

// Measure CPU-side frame assembly; filter compilation and GPU sampling are checked in the browser.
const foreground = new Graphics();
const surface = new Graphics();
surface.filters = [{} as Filter];
const iterations = 10_000;
for (const [name, run] of [
  [
    'formatSelectBreadcrumb',
    () => {
      formatSelectBreadcrumb(['BMS', 'Artist', 'Album'], 'Album', 'title');
    },
  ],
  ['bindGlassSurface', () => bindGlassSurface(foreground, surface)],
  [
    'drawGlassSurface',
    () => {
      surface.clear();
      drawGlassSurface(foreground, 20, 40, 240, 80);
    },
  ],
] as const) {
  for (let index = 0; index < 1000; index += 1) run();
  const start = performance.now();
  for (let index = 0; index < iterations; index += 1) run();
  console.log(`${name}: ${(((performance.now() - start) * 1000) / iterations).toFixed(2)} µs/op`);
}
surface.destroy({ context: true });
foreground.destroy({ context: true });
