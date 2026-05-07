// Regression test for the beatoraja `angle` direction codes.
//
// Source of truth: `SkinSlider.java` line 26 documents `slider移動方向(0:上, 1:右, 2:下, 3:左)`,
// and the `draw()` math (`region.y + (dir==0 ? +currentValue*range : dir==2 ? -currentValue*range
// : 0)`) confirms libGDX Y-UP semantics — direction `0` ADDS to skin y, which is visually upward
// in Y-UP. The renderer Y-flips dst rects when handing them to Pixi (Y-DOWN), so the source
// labels line up with our screen-visual direction labels: `0='up'`, `1='right'`, `2='down'`,
// `3='left'`. The same parity governs `graph[]` (verified in `JSONSkinLoader.java`).

import { describe, it, expect } from 'vitest';
import { normalizeBeatorajaGraphs } from './beatoraja-skin-graph.ts';
import { normalizeBeatorajaSliders } from './beatoraja-skin-slider.ts';

describe('graph[].angle direction mapping (beatoraja parity)', () => {
  it('maps 0 → up, 1 → right, 2 → down, 3 → left', () => {
    const graphs = normalizeBeatorajaGraphs([
      { id: 'g0', src: 0, x: 0, y: 0, w: 1, h: 1, type: 1, angle: 0 },
      { id: 'g1', src: 0, x: 0, y: 0, w: 1, h: 1, type: 1, angle: 1 },
      { id: 'g2', src: 0, x: 0, y: 0, w: 1, h: 1, type: 1, angle: 2 },
      { id: 'g3', src: 0, x: 0, y: 0, w: 1, h: 1, type: 1, angle: 3 },
    ]);
    expect(graphs.map((g) => g.angle)).toEqual(['up', 'right', 'down', 'left']);
  });

  it('defaults to right when angle is missing (Graph.angle Java default = 1)', () => {
    const graphs = normalizeBeatorajaGraphs([{ id: 'g', src: 0, x: 0, y: 0, w: 1, h: 1, type: 1 }]);
    expect(graphs[0]?.angle).toBe('right');
  });
});

describe('slider[].angle direction mapping (beatoraja parity)', () => {
  it('maps 0 → up, 1 → right, 2 → down, 3 → left', () => {
    const sliders = normalizeBeatorajaSliders([
      { id: 's0', src: 0, x: 0, y: 0, w: 1, h: 1, range: 100, type: 4, angle: 0 },
      { id: 's1', src: 0, x: 0, y: 0, w: 1, h: 1, range: 100, type: 4, angle: 1 },
      { id: 's2', src: 0, x: 0, y: 0, w: 1, h: 1, range: 100, type: 4, angle: 2 },
      { id: 's3', src: 0, x: 0, y: 0, w: 1, h: 1, range: 100, type: 4, angle: 3 },
    ]);
    expect(sliders.map((s) => s.angle)).toEqual(['up', 'right', 'down', 'left']);
  });
});
